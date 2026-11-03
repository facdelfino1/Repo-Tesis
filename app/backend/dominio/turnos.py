"""Atomic reservation of an existing agenda block. No rescheduling or priority queue."""
from datetime import datetime

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .agenda import AgendaConflict, lock_medico, _lock_block, _validate_interval
from .models import Disponibilidad, Turno, Triaje, Usuario
from .permissions import has_valid_role_profile
from .triage import clasificar_triaje, tiene_triaje, TriajeInvalido


@transaction.atomic
def reservar_turno(actor, medico_id, disponibilidad_id, respuestas=None):
    if not (actor.is_authenticated and actor.is_active and actor.rol == Usuario.Rol.PACIENTE
            and has_valid_role_profile(actor)):
        raise PermissionDenied()
    medico = lock_medico(medico_id)
    users = {user.pk: user for user in Usuario.objects.select_for_update().filter(
        pk__in=[actor.pk, medico.usuario_id]).order_by('pk')}
    patient_user = users.get(actor.pk)
    doctor_user = users.get(medico.usuario_id)
    if not (patient_user and patient_user.is_active and patient_user.rol == Usuario.Rol.PACIENTE
            and has_valid_role_profile(patient_user)):
        raise PermissionDenied()
    if not (doctor_user and doctor_user.is_active and doctor_user.rol == Usuario.Rol.MEDICO
            and has_valid_role_profile(doctor_user)):
        raise AgendaConflict('El médico no está habilitado para recibir reservas.')
    block = _lock_block(medico, disponibilidad_id)
    if block.estado != Disponibilidad.Estado.DISPONIBLE:
        raise AgendaConflict('El horario ya no está disponible. Seleccione otro horario.')
    try:
        _validate_interval({'fecha': block.fecha, 'hora_inicio': block.hora_inicio, 'hora_fin': block.hora_fin})
    except ValidationError as error:
        raise AgendaConflict('El intervalo seleccionado ya no es válido para reservar.') from error
    # Canceled history does not consume a block. Other associations require review.
    if block.turnos.exclude(estado=Turno.Estado.CANCELADO).exists():
        raise AgendaConflict('No fue posible verificar la disponibilidad del horario.')
    specialty = medico.especialidad.nombre
    evaluated_at = timezone.now()
    priority = None
    if tiene_triaje(specialty):
        try:
            priority = clasificar_triaje(specialty, respuestas, timezone.localdate(evaluated_at))
        except TriajeInvalido as error:
            raise ValidationError({'respuestas': error.errores}) from error
    elif respuestas is not None:
        raise ValidationError({'respuestas': 'Esta especialidad no utiliza cuestionario de triaje.'})
    duration = int((datetime.combine(block.fecha, block.hora_fin)
                    - datetime.combine(block.fecha, block.hora_inicio)).total_seconds() // 60)
    turno = Turno.objects.create(paciente=patient_user.paciente, medico=medico, disponibilidad=block,
                                fecha=block.fecha, hora=block.hora_inicio, duracion_turno=duration,
                                estado=Turno.Estado.RESERVADO)
    if priority is not None:
        Triaje.objects.create(turno=turno, respuesta_sintomas=respuestas,
                              nivel_prioridad=priority, fecha_hora_evaluacion=evaluated_at)
    block.estado = Disponibilidad.Estado.OCUPADO
    block.save(update_fields=['estado'])
    return turno
