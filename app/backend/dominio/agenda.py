from datetime import date, datetime, time

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from .models import Disponibilidad, Medico, Usuario
from .permissions import has_valid_role_profile


class AgendaConflict(APIException):
    status_code = 409
    default_detail = "La operación entra en conflicto con la agenda actual."
    default_code = "conflicto_agenda"


def lock_medico(medico_id):
    """Common parent lock. Call inside atomic, after authorizing the operation."""
    try:
        # Always lock the parent, including for an agenda with no blocks yet.
        medico = Medico.objects.select_for_update().get(pk=medico_id)
    except (Medico.DoesNotExist, ValueError, TypeError, OverflowError):
        raise NotFound()
    return medico


def _lock_medico(actor, medico_id, *, publish=False):
    if not (actor.is_authenticated and actor.is_active and has_valid_role_profile(actor)
            and actor.rol in (Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA)):
        raise PermissionDenied()
    medico = lock_medico(medico_id)
    if actor.rol == Usuario.Rol.MEDICO and medico.usuario_id != actor.pk:
        raise NotFound()
    if medico.usuario.rol != Usuario.Rol.MEDICO or not has_valid_role_profile(medico.usuario):
        raise AgendaConflict("El médico no tiene un perfil válido para gestionar agenda.")
    if publish and not medico.usuario.is_active:
        raise ValidationError({"medico": "El médico debe estar activo para habilitar horarios."})
    return medico


def _validate_interval(data):
    fecha, start, end = (data.get(key) for key in ("fecha", "hora_inicio", "hora_fin"))
    if not isinstance(fecha, date) or isinstance(fecha, datetime):
        raise ValidationError({"fecha": "Ingrese una fecha válida."})
    for field, value in (("hora_inicio", start), ("hora_fin", end)):
        if not isinstance(value, time) or value.tzinfo is not None or value.second or value.microsecond:
            raise ValidationError({field: "Ingrese una hora con precisión de minutos, sin segundos ni zona horaria."})
    if end <= start:
        raise ValidationError({"hora_fin": "Debe ser posterior a la hora de inicio del mismo día."})
    if timezone.make_aware(datetime.combine(fecha, start)) <= timezone.now():
        raise ValidationError({"fecha": "El bloque debe comenzar en el futuro."})


def _reject_overlap(medico, data, *, exclude=None):
    rows = Disponibilidad.objects.filter(medico=medico, fecha=data["fecha"],
                                         hora_inicio__lt=data["hora_fin"], hora_fin__gt=data["hora_inicio"])
    if exclude is not None:
        rows = rows.exclude(pk=exclude)
    if rows.exists():
        raise AgendaConflict("El intervalo se superpone con otro bloque del mismo médico.")


def _lock_block(medico, block_id):
    try:
        return Disponibilidad.objects.select_for_update().get(pk=block_id, medico=medico)
    except (Disponibilidad.DoesNotExist, ValueError, TypeError, OverflowError):
        raise NotFound()


def _editable_block(block):
    if block.estado == Disponibilidad.Estado.OCUPADO:
        raise AgendaConflict("No se puede modificar un bloque ocupado.")
    _validate_interval({"fecha": block.fecha, "hora_inicio": block.hora_inicio, "hora_fin": block.hora_fin})


@transaction.atomic
def create_blocks(actor, medico_id, blocks):
    medico = _lock_medico(actor, medico_id, publish=True)
    if not blocks or len(blocks) > 100:
        raise ValidationError({"bloques": "Envíe entre 1 y 100 bloques."})
    candidates = []
    for data in blocks:
        if set(data) != {"fecha", "hora_inicio", "hora_fin"}:
            raise ValidationError("Cada bloque debe contener únicamente fecha, hora_inicio y hora_fin.")
        _validate_interval(data)
        _reject_overlap(medico, data)
        if any(previous["fecha"] == data["fecha"] and previous["hora_inicio"] < data["hora_fin"]
               and previous["hora_fin"] > data["hora_inicio"] for previous in candidates):
            raise AgendaConflict("Existen intervalos superpuestos dentro del lote.")
        candidates.append(data)
    try:
        return Disponibilidad.objects.bulk_create([Disponibilidad(medico=medico, **data) for data in candidates])
    except IntegrityError as error:
        raise AgendaConflict("No se pudieron crear los bloques por un conflicto de agenda.") from error


@transaction.atomic
def update_block(actor, medico_id, block_id, changes):
    medico = _lock_medico(actor, medico_id, publish=True)
    block = _lock_block(medico, block_id)
    _editable_block(block)
    if set(changes) - {"fecha", "hora_inicio", "hora_fin"}:
        raise ValidationError("Solo se permite modificar fecha y horario.")
    if block.turnos.exists():
        raise AgendaConflict("El bloque tiene historial de turnos; no se puede cambiar su fecha u horario.")
    data = {field: changes.get(field, getattr(block, field)) for field in ("fecha", "hora_inicio", "hora_fin")}
    _validate_interval(data)
    _reject_overlap(medico, data, exclude=block.pk)
    for field, value in changes.items():
        setattr(block, field, value)
    try:
        block.save(update_fields=list(changes))
    except IntegrityError as error:
        raise AgendaConflict("No se pudo modificar el bloque por un conflicto de agenda.") from error
    return block


@transaction.atomic
def set_blocked(actor, medico_id, block_id, *, blocked):
    medico = _lock_medico(actor, medico_id, publish=not blocked)
    block = _lock_block(medico, block_id)
    _editable_block(block)
    block.estado = Disponibilidad.Estado.BLOQUEADO if blocked else Disponibilidad.Estado.DISPONIBLE
    block.save(update_fields=["estado"])
    return block


@transaction.atomic
def delete_block(actor, medico_id, block_id):
    medico = _lock_medico(actor, medico_id)
    block = _lock_block(medico, block_id)
    _editable_block(block)
    if block.turnos.exists():
        raise AgendaConflict("El bloque tiene historial de turnos y no se puede eliminar.")
    if block.propuestas_origen.exists() or block.propuestas_destino.exists():
        raise AgendaConflict("El bloque tiene historial de propuestas y no se puede eliminar.")
    block.delete()
