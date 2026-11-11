"""Atomic reservation of an existing agenda block. No rescheduling or priority queue."""
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from .agenda import AgendaConflict, lock_medico, _lock_block, _validate_interval
from .models import Disponibilidad, Paciente, Turno, Triaje, Usuario
from .permissions import has_valid_role_profile
from .triage import clasificar_triaje, tiene_triaje, TriajeInvalido


def _valid_user(user, role):
    return bool(user and user.is_active and user.rol == role and has_valid_role_profile(user))


def _lock_users(*ids):
    return {u.pk: u for u in Usuario.objects.select_for_update().filter(pk__in=ids).order_by('pk')}


def _available(block):
    if block.estado != Disponibilidad.Estado.DISPONIBLE:
        raise AgendaConflict('El horario ya no está disponible. Seleccione otro horario.')
    try:
        _validate_interval({'fecha': block.fecha, 'hora_inicio': block.hora_inicio, 'hora_fin': block.hora_fin})
    except ValidationError as error:
        raise AgendaConflict('El intervalo seleccionado ya no es válido para reservar.') from error
    if block.turnos.exclude(estado__in=[Turno.Estado.CANCELADO, Turno.Estado.PENDIENTE]).exists():
        raise AgendaConflict('No fue posible verificar la disponibilidad del horario.')


def _duration(block):
    return int((datetime.combine(block.fecha, block.hora_fin)
                - datetime.combine(block.fecha, block.hora_inicio)).total_seconds() // 60)


@transaction.atomic
def reservar_turno(actor, medico_id, disponibilidad_id, respuestas=None, *, paciente_id=None):
    if not (actor.is_authenticated and actor.is_active and has_valid_role_profile(actor)
            and actor.rol in (Usuario.Rol.PACIENTE, Usuario.Rol.SECRETARIA)):
        raise PermissionDenied()
    if actor.rol == Usuario.Rol.PACIENTE:
        if paciente_id is not None:
            raise PermissionDenied()
        paciente = actor.paciente
    else:
        try:
            paciente = Paciente.objects.get(pk=paciente_id)
        except (Paciente.DoesNotExist, ValueError, TypeError, OverflowError):
            raise NotFound()
    medico = lock_medico(medico_id)
    users = _lock_users(actor.pk, paciente.usuario_id, medico.usuario_id)
    current_actor = users.get(actor.pk)
    if not _valid_user(current_actor, actor.rol):
        raise PermissionDenied()
    patient_user = users.get(paciente.usuario_id)
    if not _valid_user(patient_user, Usuario.Rol.PACIENTE):
        raise ValidationError({'paciente': 'Seleccione un paciente activo con perfil válido.'})
    doctor_user = users.get(medico.usuario_id)
    if not _valid_user(doctor_user, Usuario.Rol.MEDICO):
        raise AgendaConflict('El médico no está habilitado para recibir reservas.')
    block = _lock_block(medico, disponibilidad_id)
    _available(block)
    specialty = medico.especialidad.nombre
    evaluated_at = timezone.now()
    priority = None
    if tiene_triaje(specialty):
        try:
            priority = clasificar_triaje(specialty, respuestas, timezone.localdate(evaluated_at),
                                         fecha_atencion=block.fecha)
        except TriajeInvalido as error:
            raise ValidationError({'respuestas': error.errores}) from error
    elif respuestas is not None:
        raise ValidationError({'respuestas': 'Esta especialidad no utiliza cuestionario de triaje.'})
    turno = Turno.objects.create(paciente=patient_user.paciente, medico=medico, disponibilidad=block,
                                fecha=block.fecha, hora=block.hora_inicio, duracion_turno=_duration(block),
                                estado=Turno.Estado.RESERVADO,
                                secretaria=current_actor.secretaria if actor.rol == Usuario.Rol.SECRETARIA else None)
    if priority is not None:
        Triaje.objects.create(turno=turno, respuesta_sintomas=respuestas,
                              nivel_prioridad=priority, fecha_hora_evaluacion=evaluated_at)
    block.estado = Disponibilidad.Estado.OCUPADO
    block.save(update_fields=['estado'])
    return turno


def _lock_turn(actor, turno_id, medico_id, roles):
    if not (actor.is_authenticated and actor.is_active and actor.rol in roles and has_valid_role_profile(actor)):
        raise PermissionDenied()
    rows = Turno.objects.all()
    if actor.rol == Usuario.Rol.PACIENTE:
        rows = rows.filter(paciente__usuario_id=actor.pk)
    if medico_id is not None:
        rows = rows.filter(medico_id=medico_id)
    try:
        context = rows.values('medico_id', 'paciente__usuario_id').get(pk=turno_id)
    except (Turno.DoesNotExist, ValueError, TypeError, OverflowError):
        raise NotFound()
    medico = lock_medico(context['medico_id'])
    if actor.rol == Usuario.Rol.MEDICO and medico.usuario_id != actor.pk:
        raise NotFound()
    users = _lock_users(actor.pk, medico.usuario_id, context['paciente__usuario_id'])
    if not _valid_user(users.get(actor.pk), actor.rol):
        raise PermissionDenied()
    turno = rows.select_for_update(of=('self',)).get(pk=turno_id)
    return turno, medico, users[medico.usuario_id]


def _occupied(turno, block):
    if (block is None or block.medico_id != turno.medico_id
            or block.estado != Disponibilidad.Estado.OCUPADO
            or block.fecha != turno.fecha or block.hora_inicio != turno.hora
            or _duration(block) != turno.duracion_turno
            or block.turnos.exclude(pk=turno.pk).exclude(estado__in=[Turno.Estado.CANCELADO, Turno.Estado.PENDIENTE]).exists()):
        raise AgendaConflict('No fue posible verificar la asignación del turno. Actualice la información.')


def _timeline(turno, expected, now):
    dates = [turno.fecha_hora_creacion, turno.fecha_hora_arribo, turno.fecha_hora_inicio, turno.fecha_hora_cierre]
    # expected = number of timestamps already required, starting with creation.
    if (any(value is None for value in dates[:expected])
            or any(value is not None for value in dates[expected:])):
        raise AgendaConflict('Los registros temporales del turno requieren revisión.')
    sequence = dates[:expected] + [now]
    if any(a > b for a, b in zip(sequence, sequence[1:])):
        raise AgendaConflict('Los registros temporales del turno requieren revisión.')


@transaction.atomic
def registrar_presencia(actor, turno_id, *, medico_id):
    turno, _, doctor = _lock_turn(actor, turno_id, medico_id, (Usuario.Rol.SECRETARIA,))
    if turno.estado != Turno.Estado.RESERVADO:
        raise AgendaConflict('El turno no permite registrar presencia.')
    now = timezone.now()
    if turno.fecha != timezone.localdate(now):
        raise AgendaConflict('La presencia solo se registra durante la fecha programada.')
    _timeline(turno, 1, now)
    block = _lock_block(turno.medico, turno.disponibilidad_id)
    _occupied(turno, block)
    turno.estado, turno.fecha_hora_arribo = Turno.Estado.PRESENTE, now
    turno.save(update_fields=['estado', 'fecha_hora_arribo'])
    return turno


@transaction.atomic
def _consulta(actor, turno_id, medico_id, *, finalizar):
    roles = (Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA) if finalizar else (Usuario.Rol.MEDICO,)
    turno, _, _ = _lock_turn(actor, turno_id, medico_id, roles)
    source = Turno.Estado.EN_ATENCION if finalizar else Turno.Estado.PRESENTE
    if turno.estado != source:
        raise AgendaConflict('La acción no corresponde al estado actual del turno.')
    now = timezone.now()
    _timeline(turno, 3 if finalizar else 2, now)
    block = _lock_block(turno.medico, turno.disponibilidad_id)
    _occupied(turno, block)
    field = 'fecha_hora_cierre' if finalizar else 'fecha_hora_inicio'
    turno.estado = Turno.Estado.COMPLETADO if finalizar else Turno.Estado.EN_ATENCION
    setattr(turno, field, now)
    fields = ['estado', field]
    if finalizar:
        turno.cerrado_por = actor
        fields.append('cerrado_por')
    turno.save(update_fields=fields)
    return turno


def iniciar_consulta(actor, turno_id, *, medico_id):
    return _consulta(actor, turno_id, medico_id, finalizar=False)


def finalizar_consulta(actor, turno_id, *, medico_id):
    return _consulta(actor, turno_id, medico_id, finalizar=True)


@transaction.atomic
def cancelar_turno(actor, turno_id, *, medico_id=None):
    turno, _, _ = _lock_turn(actor, turno_id, medico_id, (Usuario.Rol.PACIENTE, Usuario.Rol.SECRETARIA))
    if turno.estado == Turno.Estado.CANCELADO:
        return turno  # Never touch a block possibly reused since the first cancellation.
    if turno.estado == Turno.Estado.PENDIENTE:
        _timeline(turno, 1, timezone.now())
        from .reprogramacion import anular_propuestas
        anular_propuestas(turno)
        turno.estado = Turno.Estado.CANCELADO
        turno.save(update_fields=['estado'])
        return turno
    if turno.estado != Turno.Estado.RESERVADO:
        raise AgendaConflict('El turno no se encuentra en un estado cancelable.')
    now = timezone.now()
    _timeline(turno, 1, now)
    if actor.rol == Usuario.Rol.PACIENTE:
        start = timezone.make_aware(datetime.combine(turno.fecha, turno.hora))
        if start - now < timedelta(hours=2):
            raise AgendaConflict('Para cancelar se requieren al menos dos horas de anticipación. Comuníquese con Secretaría.')
    block = _lock_block(turno.medico, turno.disponibilidad_id)
    _occupied(turno, block)
    block.estado = Disponibilidad.Estado.DISPONIBLE
    block.save(update_fields=['estado'])
    turno.estado = Turno.Estado.CANCELADO
    turno.save(update_fields=['estado'])
    return turno


@transaction.atomic
def modificar_turno(actor, turno_id, disponibilidad_id, *, medico_id=None):
    turno, medico, doctor = _lock_turn(actor, turno_id, medico_id, (Usuario.Rol.PACIENTE, Usuario.Rol.SECRETARIA))
    if turno.estado != Turno.Estado.RESERVADO:
        raise AgendaConflict('El turno no se encuentra en un estado modificable.')
    if not _valid_user(doctor, Usuario.Rol.MEDICO):
        raise AgendaConflict('El médico no está habilitado para nuevas asignaciones.')
    now = timezone.now()
    _timeline(turno, 1, now)
    if actor.rol == Usuario.Rol.PACIENTE and timezone.make_aware(datetime.combine(turno.fecha, turno.hora)) <= now:
        raise AgendaConflict('El horario actual ya no permite modificación desde el portal.')
    if turno.disponibilidad_id is None:
        raise AgendaConflict('El turno no tiene una asignación verificable.')
    blocks = {pk: _lock_block(medico, pk) for pk in sorted({turno.disponibilidad_id, disponibilidad_id})}
    old, new = blocks[turno.disponibilidad_id], blocks[disponibilidad_id]
    _occupied(turno, old)
    if old.pk == new.pk:
        return turno
    _available(new)
    actualizar_triaje_fecha(turno, new.fecha)
    old.estado, new.estado = Disponibilidad.Estado.DISPONIBLE, Disponibilidad.Estado.OCUPADO
    old.save(update_fields=['estado'])
    new.save(update_fields=['estado'])
    turno.disponibilidad, turno.fecha, turno.hora = new, new.fecha, new.hora_inicio
    turno.duracion_turno = _duration(new)
    turno.save(update_fields=['disponibilidad', 'fecha', 'hora', 'duracion_turno'])
    return turno


def actualizar_triaje_fecha(turno, fecha_atencion):
    """Re-evaluate age-sensitive priority only when an assigned date changes."""
    if turno.fecha == fecha_atencion or turno.medico.especialidad.nombre != 'Pediatría':
        return
    triaje = Triaje.objects.select_for_update().filter(turno=turno).first()
    if triaje is None:
        return
    try:
        priority = clasificar_triaje('Pediatría', triaje.respuesta_sintomas, timezone.localdate(),
                                     fecha_atencion=fecha_atencion)
    except TriajeInvalido as error:
        raise ValidationError({'respuestas': error.errores}) from error
    if priority != triaje.nivel_prioridad:
        triaje.nivel_prioridad = priority
        triaje.fecha_hora_evaluacion = timezone.now()
        triaje.save(update_fields=['nivel_prioridad', 'fecha_hora_evaluacion'])
        turno.triaje = triaje
