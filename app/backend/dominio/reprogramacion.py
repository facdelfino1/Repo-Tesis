"""Deterministic rescheduling, exclusively to an explicitly supplied date."""
from datetime import date, datetime

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from .agenda import AgendaConflict, lock_medico, _lock_block
from .models import Disponibilidad, PropuestaReprogramacion as Propuesta, Turno, Usuario
from .permissions import has_valid_role_profile
from .triage import tiene_triaje
from .turnos import _available, _duration, _lock_turn, _lock_users, _occupied, _timeline, _valid_user


def _seleccion_invalida(ids, message):
    error = AgendaConflict(message)
    error.detail = {'detail': error.detail, 'turnos_rechazados': ids}
    return error


def ordenar_turnos(items):
    """Pure function over projections, never mutating inputs or querying the ORM."""
    if not items:
        return []
    context = (items[0]['medico'], items[0]['especialidad'])
    clinical = tiene_triaje(context[1])
    for item in items:
        if (item['medico'], item['especialidad']) != context:
            raise ValueError('La operación requiere una única agenda y especialidad.')
        if type(item['id']) is not int or item['id'] <= 0:
            raise ValueError('Identidad de turno invalida.')
        if clinical:
            created = item['creacion']
            if (not item['tiene_triaje'] or item['prioridad'] not in ('ALTA', 'MEDIA', 'BAJA') or not isinstance(created, datetime)
                    or created.tzinfo is None or created.utcoffset() is None):
                raise ValueError('Prioridad o fecha de creación inconsistente.')
        elif item['prioridad'] is not None or item['tiene_triaje']:
            raise ValueError('La especialidad convencional no debe tener triaje clínico.')
    if clinical:
        ranks = {'ALTA': 0, 'MEDIA': 1, 'BAJA': 2}
        return sorted(items, key=lambda i: (ranks[i['prioridad']], i['creacion'], i['id']))
    return sorted(items, key=lambda i: (i['fecha'], i['hora'], i['id']))


def proyeccion(turno):
    triage = getattr(turno, 'triaje', None)
    return dict(id=turno.pk, medico=turno.medico_id, especialidad=turno.medico.especialidad.nombre,
                prioridad=triage.nivel_prioridad if triage else None, tiene_triaje=triage is not None,
                creacion=turno.fecha_hora_creacion, fecha=turno.fecha, hora=turno.hora)


def _gestor(actor, medico_id):
    if not (actor.is_authenticated and actor.is_active and has_valid_role_profile(actor)
            and actor.rol in (Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA)):
        raise PermissionDenied()
    medico = lock_medico(medico_id)
    if actor.rol == Usuario.Rol.MEDICO and medico.usuario_id != actor.pk:
        raise NotFound()
    return medico


def _cuentas(actor, medico, turns):
    users = _lock_users(actor.pk, medico.usuario_id, *(t.paciente.usuario_id for t in turns))
    if not _valid_user(users.get(actor.pk), actor.rol):
        raise PermissionDenied()
    if not _valid_user(users.get(medico.usuario_id), Usuario.Rol.MEDICO):
        raise AgendaConflict('El médico no está habilitado para reprogramar.')
    if any(not _valid_user(users.get(t.paciente.usuario_id), Usuario.Rol.PACIENTE) for t in turns):
        raise AgendaConflict('Hay pacientes no habilitados en la selección.')


def _fecha(value):
    if type(value) is not date or value < timezone.localdate():
        raise ValidationError({'nueva_fecha': 'Indique una fecha de destino no pasada.'})


def _cerrar(propuesta, estado, motivo=''):
    propuesta.estado = estado
    propuesta.fecha_hora_resolucion = timezone.now()
    propuesta.motivo_cierre = motivo
    propuesta.save(update_fields=['estado', 'fecha_hora_resolucion', 'motivo_cierre'])


def anular_propuestas(turno):
    # Caller already owns the doctor's, users' and Turno locks.
    for proposal in Propuesta.objects.select_for_update().filter(turno=turno, estado='EN_ESPERA').order_by('pk'):
        _cerrar(proposal, 'ANULADA', 'El turno fue cancelado o reasignado directamente.')


def destino_vigente(proposal):
    block = proposal.disponibilidad_destino
    if (block.medico_id != proposal.turno.medico_id
            or (block.fecha, block.hora_inicio, block.hora_fin) !=
               (proposal.fecha_destino, proposal.hora_inicio_destino, proposal.hora_fin_destino)):
        return False
    try:
        _available(block)
    except AgendaConflict:
        return False
    return True


def _slots(medico, nueva_fecha):
    return Disponibilidad.objects.filter(medico=medico, fecha=nueva_fecha, estado='DISPONIBLE').order_by('fecha', 'hora_inicio', 'pk')


def _crear(actor, turno, block, motivo):
    return Propuesta.objects.create(turno=turno, disponibilidad_origen_id=turno.disponibilidad_id,
        fecha_origen=turno.fecha, hora_origen=turno.hora, duracion_origen=turno.duracion_turno,
        disponibilidad_destino=block, fecha_destino=block.fecha, hora_inicio_destino=block.hora_inicio,
        hora_fin_destino=block.hora_fin, creada_por=actor, motivo=motivo)


@transaction.atomic
def reprogramar(actor, medico_id, *, fecha_original, hora_inicio, hora_fin, nueva_fecha, turnos, motivo):
    _fecha(nueva_fecha)
    if nueva_fecha == fecha_original:
        raise ValidationError({'nueva_fecha': 'La nueva fecha debe ser distinta de la original.'})
    medico = _gestor(actor, medico_id)
    rows = Turno.objects.filter(pk__in=turnos, medico=medico).select_related('paciente', 'medico__especialidad', 'triaje')
    context = list(rows.order_by('pk'))
    if len(context) != len(turnos):
        raise _seleccion_invalida(turnos, 'La seleccion no pertenece integramente a esta agenda.')
    _cuentas(actor, medico, context)
    locked = list(rows.select_for_update(of=('self',)).order_by('pk'))
    origin_ids = {t.disponibilidad_id for t in locked}
    if None in origin_ids:
        raise _seleccion_invalida(turnos, 'Hay turnos sin asignacion verificable.')
    scope = list(Disponibilidad.objects.filter(medico=medico, fecha=fecha_original,
        hora_inicio__lt=hora_fin, hora_fin__gt=hora_inicio).order_by('pk'))
    candidates = list(_slots(medico, nueva_fecha))
    ids = origin_ids | {b.pk for b in scope + candidates}
    blocks = {pk: _lock_block(medico, pk) for pk in sorted(ids)}
    bad = []
    for turno in locked:
        block = blocks[turno.disponibilidad_id]
        if (turno.estado != 'RESERVADO' or turno.fecha != fecha_original or block not in scope
                or not (block.hora_inicio < hora_fin and block.hora_fin > hora_inicio)):
            bad.append(turno.pk)
            continue
        try:
            _timeline(turno, 1, timezone.now())
            _occupied(turno, block)
        except AgendaConflict:
            bad.append(turno.pk)
    if bad:
        raise _seleccion_invalida(bad, 'No se aplico ningun cambio: seleccion inconsistente.')
    try:
        ordered = ordenar_turnos([proyeccion(t) for t in locked])
    except ValueError as error:
        raise _seleccion_invalida(turnos, str(error)) from error
    # No proposal is locked before all affected blocks. Parent lock serializes writers.
    existing = list(Propuesta.objects.select_for_update().filter(turno__in=locked, estado='EN_ESPERA').order_by('pk'))
    if existing:
        raise _seleccion_invalida([p.turno_id for p in existing], 'Hay propuestas abiertas inconsistentes.')
    offered = set(Propuesta.objects.filter(estado='EN_ESPERA').values_list('disponibilidad_destino_id', flat=True))
    valid = []
    for candidate in candidates:
        block = blocks[candidate.pk]
        if block.pk in offered:
            continue
        try:
            _available(block)
        except AgendaConflict:
            continue
        valid.append(block)
    for block in scope:
        current = blocks[block.pk]
        if current.estado == 'DISPONIBLE':
            # Never mask an inconsistent occupied association by blocking a free row.
            if current.turnos.exclude(estado__in=['PENDIENTE', 'CANCELADO']).exists():
                raise AgendaConflict('Un bloque libre del alcance tiene una asociación incompatible.')
            current.estado = 'BLOQUEADO'
            current.save(update_fields=['estado'])
    by_id = {t.pk: t for t in locked}
    proposals, review = [], []
    for index, item in enumerate(ordered):
        turno = by_id[item['id']]
        old = blocks[turno.disponibilidad_id]
        old.estado = 'BLOQUEADO'
        old.save(update_fields=['estado'])
        turno.estado = 'PENDIENTE'
        turno.save(update_fields=['estado'])
        if index < len(valid):
            proposals.append(_crear(actor, turno, valid[index], motivo))
        else:
            review.append(turno.pk)
    return {'nueva_fecha': nueva_fecha, 'propuestas': proposals, 'requiere_revision': review, 'turnos_rechazados': []}


@transaction.atomic
def proponer_pendiente(actor, medico_id, turno_id, *, nueva_fecha, motivo):
    _fecha(nueva_fecha)
    turno, medico, doctor = _lock_turn(actor, turno_id, medico_id, (Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA))
    if turno.estado != 'PENDIENTE':
        raise AgendaConflict('Solo se generan nuevas propuestas para turnos pendientes.')
    _timeline(turno, 1, timezone.now())
    if not _valid_user(doctor, Usuario.Rol.MEDICO) or not _valid_user(turno.paciente.usuario, Usuario.Rol.PACIENTE):
        raise AgendaConflict('Las cuentas deben estar habilitadas para generar propuestas.')
    try:
        ordenar_turnos([proyeccion(turno)])
    except ValueError as error:
        raise AgendaConflict(str(error)) from error
    context = list(Propuesta.objects.filter(turno=turno, estado='EN_ESPERA'))
    candidates = list(_slots(medico, nueva_fecha))
    ids = {p.disponibilidad_destino_id for p in context} | {b.pk for b in candidates}
    blocks = {pk: _lock_block(medico, pk) for pk in sorted(ids)}
    for proposal in Propuesta.objects.select_for_update().filter(pk__in=[p.pk for p in context]).order_by('pk'):
        proposal.disponibilidad_destino = blocks[proposal.disponibilidad_destino_id]
        if destino_vigente(proposal):
            raise AgendaConflict('El turno ya tiene una propuesta vigente.')
        _cerrar(proposal, 'INVALIDADA', 'El destino anterior dejó de ser válido.')
    offered = set(Propuesta.objects.filter(estado='EN_ESPERA').values_list('disponibilidad_destino_id', flat=True))
    for candidate in candidates:
        block = blocks[candidate.pk]
        if block.pk == turno.disponibilidad_id or block.pk in offered:
            continue
        try:
            _available(block)
        except AgendaConflict:
            continue
        return {'nueva_fecha': nueva_fecha, 'propuestas': [_crear(actor, turno, block, motivo)],
                'requiere_revision': [], 'turnos_rechazados': []}
    return {'nueva_fecha': nueva_fecha, 'propuestas': [], 'requiere_revision': [turno.pk], 'turnos_rechazados': []}


def responder(actor, propuesta_id, *, aceptar):
    # Return the conflict after atomic exits: invalidation must remain committed.
    with transaction.atomic():
        if not (actor.is_authenticated and actor.is_active and actor.rol == Usuario.Rol.PACIENTE and has_valid_role_profile(actor)):
            raise PermissionDenied()
        try:
            context = Propuesta.objects.filter(turno__paciente__usuario_id=actor.pk).get(pk=propuesta_id)
        except (Propuesta.DoesNotExist, ValueError, TypeError, OverflowError):
            raise NotFound()
        turno, medico, doctor = _lock_turn(actor, context.turno_id, None, (Usuario.Rol.PACIENTE,))
        ids = {context.disponibilidad_destino_id}
        if context.disponibilidad_origen_id:
            ids.add(context.disponibilidad_origen_id)
        blocks = {pk: _lock_block(medico, pk) for pk in sorted(ids)}
        proposal = Propuesta.objects.select_for_update().get(pk=context.pk)
        target_state = 'ACEPTADA' if aceptar else 'RECHAZADA'
        if proposal.estado == target_state:
            return proposal, False
        if proposal.estado != 'EN_ESPERA':
            raise AgendaConflict('La propuesta ya fue resuelta de otra manera.')
        if turno.estado != 'PENDIENTE':
            raise AgendaConflict('El turno ya no está pendiente de asignación.')
        _timeline(turno, 1, timezone.now())
        if not aceptar:
            _cerrar(proposal, 'RECHAZADA')
            return proposal, False
        proposal.turno = turno
        proposal.disponibilidad_destino = blocks[proposal.disponibilidad_destino_id]
        history_matches = (turno.disponibilidad_id, turno.fecha, turno.hora, turno.duracion_turno) == (proposal.disponibilidad_origen_id, proposal.fecha_origen, proposal.hora_origen, proposal.duracion_origen)
        if not history_matches or not _valid_user(doctor, Usuario.Rol.MEDICO) or not destino_vigente(proposal):
            _cerrar(proposal, 'INVALIDADA', 'El destino o la cuenta médica dejaron de estar disponibles.')
            return proposal, True
        block = blocks[proposal.disponibilidad_destino_id]
        turno.disponibilidad, turno.fecha, turno.hora = block, block.fecha, block.hora_inicio
        turno.duracion_turno, turno.estado = _duration(block), 'RESERVADO'
        turno.save(update_fields=['disponibilidad', 'fecha', 'hora', 'duracion_turno', 'estado'])
        block.estado = 'OCUPADO'
        block.save(update_fields=['estado'])
        _cerrar(proposal, 'ACEPTADA')
        return proposal, False


@transaction.atomic
def reasignar_pendiente(actor, turno_id, disponibilidad_id, *, medico_id=None):
    turno, medico, doctor = _lock_turn(actor, turno_id, medico_id, (Usuario.Rol.PACIENTE, Usuario.Rol.SECRETARIA))
    if turno.estado != 'PENDIENTE':
        raise AgendaConflict('El turno no está pendiente de asignación.')
    if not _valid_user(doctor, Usuario.Rol.MEDICO) or not _valid_user(turno.paciente.usuario, Usuario.Rol.PACIENTE):
        raise AgendaConflict('Las cuentas deben estar habilitadas para reasignar.')
    _timeline(turno, 1, timezone.now())
    block = _lock_block(medico, disponibilidad_id)
    _available(block)
    anular_propuestas(turno)
    turno.disponibilidad, turno.fecha, turno.hora = block, block.fecha, block.hora_inicio
    turno.duracion_turno, turno.estado = _duration(block), 'RESERVADO'
    turno.save(update_fields=['disponibilidad', 'fecha', 'hora', 'duracion_turno', 'estado'])
    block.estado = 'OCUPADO'
    block.save(update_fields=['estado'])
    return turno
