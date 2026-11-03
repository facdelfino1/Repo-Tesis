"""Pure preliminary outpatient prioritization; never a diagnosis."""
from calendar import monthrange
from datetime import date
from math import isfinite


class TriajeInvalido(ValueError):
    def __init__(self, errores):
        self.errores = errores
        super().__init__('Complete correctamente el cuestionario de triaje.')


ALGORITMOS = {'Clínica Médica': 'clinica_medica', 'Pediatría': 'pediatria'}


def tiene_triaje(especialidad):
    return especialidad in ALGORITMOS


def menor_tres_meses(nacimiento, evaluacion):
    month_index = nacimiento.year * 12 + nacimiento.month - 1 + 3
    year, month = divmod(month_index, 12)
    month += 1
    aniversario = date(year, month, min(nacimiento.day, monthrange(year, month)[1]))
    return evaluacion < aniversario


def clasificar_triaje(especialidad, respuestas, fecha_evaluacion):
    errors = {}
    if not tiene_triaje(especialidad):
        raise TriajeInvalido({'especialidad': 'Esta especialidad no tiene cuestionario de triaje.'})
    if type(fecha_evaluacion) is not date:
        raise TriajeInvalido({'fecha_evaluacion': 'Fecha de evaluación inválida.'})
    if type(respuestas) is not dict:
        raise TriajeInvalido({'respuestas': 'Complete todas las preguntas del cuestionario.'})
    pediatric = ALGORITMOS[especialidad] == 'pediatria'
    booleans = ['fiebre', 'dificultadRespirar'] + (['muyAgitado', 'vomitosRepetidos'] if pediatric else [])
    fields = set(booleans) | ({'fechaNacimiento', 'duracionFiebreHoras', 'estadoGeneral'} if pediatric else {'dolor'})
    for field in set(respuestas) - fields:
        errors[field] = 'Campo no permitido.'
    for field in fields - set(respuestas):
        errors[field] = 'Complete todas las preguntas del cuestionario.'
    for field in booleans:
        if type(respuestas.get(field)) is not bool:
            errors[field] = 'Indique Sí o No.'
    if not pediatric:
        pain = respuestas.get('dolor')
        if type(pain) is not int or not 0 <= pain <= 10:
            errors['dolor'] = 'Indique un valor entero de dolor entre 0 y 10.'
    else:
        value = respuestas.get('fechaNacimiento')
        try:
            birth = date.fromisoformat(value) if type(value) is str else None
            if birth is None or birth.isoformat() != value or birth > fecha_evaluacion:
                raise ValueError
        except (ValueError, TypeError):
            errors['fechaNacimiento'] = 'Ingrese una fecha de nacimiento válida, no futura.'
        hours = respuestas.get('duracionFiebreHoras')
        if respuestas.get('fiebre') is True:
            try:
                valid_hours = type(hours) in (int, float) and isfinite(hours) and hours >= 0
            except OverflowError:
                valid_hours = False
            if not valid_hours:
                errors['duracionFiebreHoras'] = 'Indique la duración de la fiebre en horas, mayor o igual a cero.'
        elif respuestas.get('fiebre') is False and hours is not None:
            errors['duracionFiebreHoras'] = 'Sin fiebre, no indique una duración.'
        if respuestas.get('estadoGeneral') not in ('alerta_normal', 'decaido_responde_normalmente',
                'letargico_muy_somnoliento', 'pobre_respuesta_estimulos', 'dificultad_despertar'):
            errors['estadoGeneral'] = 'Seleccione un estado general válido.'
    if errors:
        raise TriajeInvalido(errors)
    if not pediatric:
        if respuestas['dificultadRespirar'] or respuestas['dolor'] >= 7:
            return 'ALTA'  # CM-01, CM-02
        if respuestas['fiebre'] or respuestas['dolor'] >= 4:
            return 'MEDIA'  # CM-03, CM-04
        return 'BAJA'  # CM-05
    if ((respuestas['fiebre'] and menor_tres_meses(birth, fecha_evaluacion))
            or respuestas['dificultadRespirar'] or respuestas['muyAgitado']
            or respuestas['estadoGeneral'] in ('pobre_respuesta_estimulos', 'dificultad_despertar', 'letargico_muy_somnoliento')):
        return 'ALTA'  # PED-01..04
    if respuestas['fiebre'] and respuestas['duracionFiebreHoras'] > 48:
        return 'MEDIA'  # PED-05
    if respuestas['estadoGeneral'] == 'decaido_responde_normalmente' or respuestas['vomitosRepetidos']:
        return 'MEDIA'  # PED-06, PED-07
    if respuestas['fiebre'] and respuestas['duracionFiebreHoras'] <= 48:
        return 'MEDIA'  # PED-08
    return 'BAJA'  # PED-09
