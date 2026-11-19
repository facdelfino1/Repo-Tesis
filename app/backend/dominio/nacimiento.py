"""Demographic dates for appointment details; independent of clinical triage."""
from calendar import monthrange
from datetime import date

from django.utils import timezone


def fecha_valida(value):
    if type(value) is date:
        return value
    if type(value) is not str:
        return None
    try:
        parsed = date.fromisoformat(value)
        return parsed if parsed.isoformat() == value else None
    except ValueError:
        return None


def edad_cumplida(nacimiento, referencia):
    """A February 29 anniversary falls on February 28 in non-leap years."""
    aniversario = (nacimiento.month, min(nacimiento.day, monthrange(referencia.year, nacimiento.month)[1]))
    return referencia.year - nacimiento.year - ((referencia.month, referencia.day) < aniversario)


def nacimiento_atendido(turno):
    menor = turno.medico.especialidad.nombre == 'Pediatría'
    if menor:
        triaje = getattr(turno, 'triaje', None)
        respuestas = triaje.respuesta_sintomas if triaje else None
        value = respuestas.get('fechaNacimiento') if isinstance(respuestas, dict) else None
    else:
        value = turno.paciente.usuario.fecha_nacimiento
    nacimiento = fecha_valida(value)
    if nacimiento and (nacimiento > timezone.localdate() or nacimiento > turno.fecha):
        nacimiento = None
    return {'fecha_nacimiento': nacimiento.isoformat() if nacimiento else None,
            'edad': edad_cumplida(nacimiento, turno.fecha) if nacimiento else None,
            'fecha_referencia': turno.fecha.isoformat(), 'es_menor_atendido': menor}
