"""Read-only aggregates for the existing administrative indicators."""
from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import PropuestaReprogramacion, Triaje, Turno, Usuario
from .permissions import IsAdministrador


class FiltrosMetricas(serializers.Serializer):
    desde = serializers.DateField(required=False)
    hasta = serializers.DateField(required=False)
    medico = serializers.IntegerField(min_value=1, required=False)
    especialidad = serializers.IntegerField(min_value=1, required=False)
    estado = serializers.ChoiceField(choices=Turno.Estado.choices, required=False)

    def validate(self, attrs):
        if set(self.initial_data) - set(self.fields):
            raise serializers.ValidationError('Se recibieron filtros no permitidos.')
        if 'desde' in attrs and 'hasta' in attrs and attrs['desde'] > attrs['hasta']:
            raise serializers.ValidationError({'hasta': 'Debe ser igual o posterior a desde.'})
        return attrs


WAIT = (Q(estado__in=['EN_ATENCION', 'COMPLETADO'], fecha_hora_arribo__isnull=False,
          fecha_hora_inicio__isnull=False, fecha_hora_arribo__gte=F('fecha_hora_creacion'),
          fecha_hora_inicio__gte=F('fecha_hora_arribo')))
ATTENTION = Q(estado='COMPLETADO', fecha_hora_inicio__isnull=False,
              fecha_hora_cierre__isnull=False, fecha_hora_inicio__gte=F('fecha_hora_creacion'),
              fecha_hora_cierre__gte=F('fecha_hora_inicio'))


def aggregates():
    wait = ExpressionWrapper(F('fecha_hora_inicio') - F('fecha_hora_arribo'), output_field=DurationField())
    attention = ExpressionWrapper(F('fecha_hora_cierre') - F('fecha_hora_inicio'), output_field=DurationField())
    return {
        'total': Count('pk'),
        'reservas_activas': Count('pk', filter=Q(estado__in=['RESERVADO', 'PRESENTE', 'EN_ATENCION'])),
        'completados': Count('pk', filter=Q(estado='COMPLETADO')),
        'cancelados': Count('pk', filter=Q(estado='CANCELADO')),
        'ausentes': Count('pk', filter=Q(estado='AUSENTE')),
        'espera_promedio_minutos': Avg(wait, filter=WAIT),
        'muestras_espera': Count('pk', filter=WAIT),
        'atencion_promedio_minutos': Avg(attention, filter=ATTENTION),
        'muestras_atencion': Count('pk', filter=ATTENTION),
    }


def minutes(row):
    for field in ('espera_promedio_minutos', 'atencion_promedio_minutos'):
        value = row[field]
        row[field] = round(value.total_seconds() / 60, 2) if value is not None else None
    return row


class MetricasAdminView(APIView):
    permission_classes = [IsAdministrador]
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        filters = FiltrosMetricas(data=request.query_params)
        filters.is_valid(raise_exception=True)
        query = Turno.objects.all()
        lookups = {'desde': 'fecha__gte', 'hasta': 'fecha__lte', 'medico': 'medico_id',
                   'especialidad': 'medico__especialidad_id', 'estado': 'estado'}
        for field, value in filters.validated_data.items():
            query = query.filter(**{lookups[field]: value})
        summary = minutes(query.aggregate(**aggregates()))
        states = dict(query.values('estado').annotate(cantidad=Count('pk')).values_list('estado', 'cantidad'))
        priorities = dict(Triaje.objects.filter(turno__in=query).values('nivel_prioridad')
                          .annotate(cantidad=Count('pk')).values_list('nivel_prioridad', 'cantidad'))
        maximum = max(priorities.values(), default=0)
        summary['prioridad_frecuente'] = ' / '.join(p for p in Triaje.Prioridad.values if priorities.get(p, 0) == maximum) if maximum else None
        closed = summary['ausentes'] + summary['completados']
        summary['tasa_ausentismo_historico'] = round(100 * summary['ausentes'] / closed, 2) if closed else None
        summary['propuestas_en_espera'] = PropuestaReprogramacion.objects.filter(turno__in=query, estado='EN_ESPERA').count()
        doctors = list(query.values('medico_id', 'medico__usuario__nombre', 'medico__usuario__apellido', 'medico__especialidad__nombre')
                       .annotate(**aggregates(),
                                 alta=Count('pk', filter=Q(triaje__nivel_prioridad='ALTA')),
                                 media=Count('pk', filter=Q(triaje__nivel_prioridad='MEDIA')),
                                 baja=Count('pk', filter=Q(triaje__nivel_prioridad='BAJA')),
                                 sin_triaje=Count('pk', filter=Q(triaje__isnull=True)))
                       .order_by('medico__usuario__apellido', 'medico__usuario__nombre', 'medico_id'))
        users = Usuario.objects.aggregate(
            total=Count('pk'), pacientes=Count('pk', filter=Q(rol='PACIENTE')),
            medicos_activos=Count('pk', filter=Q(rol='MEDICO', is_active=True)),
            secretarias_activas=Count('pk', filter=Q(rol='SECRETARIA', is_active=True)))
        return Response({'filtros': filters.data, 'usuarios': users, 'resumen': summary,
                         'estados': {state: states.get(state, 0) for state in Turno.Estado.values},
                         'prioridades': {p: priorities.get(p, 0) for p in Triaje.Prioridad.values},
                         'sin_triaje': summary['total'] - sum(priorities.values()),
                         'medicos': [minutes(row) for row in doctors]})
