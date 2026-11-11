"""Read-only evaluation using the same classifier and calendar as reservation."""
from collections.abc import Mapping

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Disponibilidad, Medico, Usuario
from .permissions import IsPaciente, has_valid_role_profile
from .triage import TriajeInvalido, clasificar_triaje, tiene_triaje


class EvaluacionPreliminarSerializer(serializers.Serializer):
    disponibilidad = serializers.IntegerField(min_value=1)
    respuestas = serializers.JSONField(required=False)

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({'non_field_errors': ['Envíe el cuestionario como un objeto.']})
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({key: 'Campo no permitido.' for key in sorted(unknown)})
        if type(data.get('disponibilidad')) is not int:
            raise serializers.ValidationError({'disponibilidad': 'Seleccione un identificador entero de disponibilidad.'})
        if 'respuestas' in data and type(data['respuestas']) is not dict:
            raise serializers.ValidationError({'respuestas': 'Envíe un cuestionario completo como objeto.'})
        return super().to_internal_value(data)


class TriajePreliminarView(APIView):
    permission_classes = [IsPaciente]
    http_method_names = ['post', 'options']

    def post(self, request, medico_pk):
        medico = get_object_or_404(Medico.objects.select_related('usuario', 'especialidad'),
                                   pk=medico_pk, usuario__rol=Usuario.Rol.MEDICO, usuario__is_active=True)
        if not has_valid_role_profile(medico.usuario):
            raise NotFound()
        serializer = EvaluacionPreliminarSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        answers = serializer.validated_data.get('respuestas')
        block = get_object_or_404(Disponibilidad, pk=serializer.validated_data['disponibilidad'], medico=medico)
        evaluated_on = timezone.localdate(timezone.now())
        priority = None
        if tiene_triaje(medico.especialidad.nombre):
            try:
                priority = clasificar_triaje(medico.especialidad.nombre, answers, evaluated_on,
                                             fecha_atencion=block.fecha)
            except TriajeInvalido as error:
                raise ValidationError({'respuestas': error.errores}) from error
        elif answers is not None:
            raise ValidationError({'respuestas': 'Esta especialidad no utiliza cuestionario de triaje.'})
        return Response({'prioridad': priority, 'fecha_evaluacion': evaluated_on.isoformat(),
                         'fecha_atencion': block.fecha.isoformat()},
                        headers={'Cache-Control': 'no-store'})
