"""Informative delay and remaining queue wait in today's medical agenda."""
from datetime import datetime, timedelta
from math import ceil

from django.db.models import Avg, DurationField, ExpressionWrapper, F, Q
from django.utils import timezone

from .models import Turno


def estimar_demora(turno, calculado_en=None):
    now = calculado_en or timezone.now()

    # Share the unrounded historical mean with every result, even when delay is ineligible.
    observed = ExpressionWrapper(F('fecha_hora_cierre') - F('fecha_hora_inicio'),
                                 output_field=DurationField())
    mean = Turno.objects.filter(
        medico_id=turno.medico_id, estado=Turno.Estado.COMPLETADO,
        fecha_hora_inicio__isnull=False, fecha_hora_cierre__isnull=False,
        fecha_hora_inicio__gte=F('fecha_hora_creacion'),
        fecha_hora_cierre__gt=F('fecha_hora_inicio'),
        fecha_hora_cierre__lte=now,
    ).aggregate(duration=Avg(observed))['duration']

    def result(estado, motivo, minutos=None, inicio=None, espera=None):
        return {
            'promedio_consulta_minutos': ceil(mean.total_seconds() / 60) if mean is not None else None,
            'demora_estimada_minutos': minutos,
            'espera_estimada_minutos': espera,
            'inicio_estimado': inicio.isoformat() if inicio is not None else None,
            'estado_estimacion': estado,
            'motivo': motivo,
            'calculado_en': now.isoformat(),
        }

    if turno.estado not in (Turno.Estado.RESERVADO, Turno.Estado.PRESENTE):
        return result('NO_APLICA', 'El turno no espera el inicio de una atención asignada.')
    if turno.fecha != timezone.localdate(now):
        return result('SIN_DATOS', 'La actividad de esta jornada todavía no permite estimar la demora.')

    scheduled = timezone.make_aware(datetime.combine(turno.fecha, turno.hora), timezone.get_current_timezone())
    if turno.estado == Turno.Estado.RESERVADO and scheduled < now:
        return result('SIN_DATOS', 'El horario pasó y no se registró la llegada del paciente.')
    if turno.estado == Turno.Estado.PRESENTE and (turno.fecha_hora_arribo is None
            or not turno.fecha_hora_creacion <= turno.fecha_hora_arribo <= now):
        return result('SIN_DATOS', 'Falta una hora de llegada válida para este turno.')

    if Turno.objects.filter(medico_id=turno.medico_id, estado=Turno.Estado.EN_ATENCION,
                            fecha__lt=turno.fecha).exists():
        return result('SIN_DATOS', 'El médico tiene una consulta anterior todavía en curso. No es posible estimar el tiempo de espera.')

    agenda = Turno.objects.filter(medico_id=turno.medico_id, fecha=turno.fecha).exclude(pk=turno.pk)
    en_atencion = list(agenda.filter(estado=Turno.Estado.EN_ATENCION).values(
        'fecha_hora_creacion', 'fecha_hora_arribo', 'fecha_hora_inicio')[:2])
    if len(en_atencion) > 1:
        return result('SIN_DATOS', 'Hay más de una atención en curso en esta agenda.')
    if en_atencion:
        current = en_atencion[0]
        if (current['fecha_hora_arribo'] is None or current['fecha_hora_inicio'] is None
                or not current['fecha_hora_creacion'] <= current['fecha_hora_arribo']
                <= current['fecha_hora_inicio'] <= now):
            return result('SIN_DATOS', 'La atención en curso tiene horas incompletas o inválidas.')

    # Match the operational agenda's existing (hora, pk) order; do not reprioritize.
    before = Q(hora__lt=turno.hora) | Q(hora=turno.hora, pk__lt=turno.pk)
    presentes = list(agenda.filter(estado=Turno.Estado.PRESENTE).filter(before).values(
        'fecha_hora_creacion', 'fecha_hora_arribo'))
    if any(row['fecha_hora_arribo'] is None or not row['fecha_hora_creacion']
           <= row['fecha_hora_arribo'] <= now for row in presentes):
        return result('SIN_DATOS', 'Hay pacientes anteriores sin una llegada válida.')

    remaining = timedelta(0)
    if en_atencion or presentes:
        if mean is None:
            return result('SIN_DATOS', 'No hay duraciones de atención observadas válidas para este médico.')
        if en_atencion:
            elapsed = now - en_atencion[0]['fecha_hora_inicio']
            if elapsed >= mean:
                return result('CONSULTA_DEMORADA', 'La consulta anterior alcanzó o superó el promedio histórico. El tiempo restante es indeterminado.')
            remaining = mean - elapsed
        remaining += len(presentes) * mean

    earliest = max(scheduled, now + remaining)
    minutes = max(0, ceil((earliest - scheduled).total_seconds() / 60))
    estimated_start = scheduled + timedelta(minutes=minutes)
    # Queue wait is independent of the scheduled time. Keep legacy delay fields compatible.
    wait_minutes = ceil(remaining.total_seconds() / 60) if mean is not None else None
    reason = ('No hay duraciones de atención observadas válidas para este médico.' if mean is None
              else 'Espera aproximada basada en los pacientes presentes y la consulta en curso. Estimación informativa sujeta a cambios.')
    return result('ESTIMADA' if minutes else 'SIN_DEMORA',
                  reason, minutes, estimated_start, espera=wait_minutes)
