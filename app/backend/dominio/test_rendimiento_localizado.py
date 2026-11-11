"""Query and authorization regressions; run only against an isolated test database."""
from datetime import time, timedelta
from itertools import combinations

from django.contrib.auth.backends import ModelBackend
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIRequestFactory, APITestCase, force_authenticate

from .authentication import CuentaBackend
from .models import Disponibilidad, Medico, Paciente, Secretaria, Triaje, Turno, Usuario
from .permissions import IsActiveUser, has_valid_role_profile
from .serializers import TurnoConsultaSerializer, UsuarioSerializer
from . import test_api
from .views import ReprogramacionView


class RendimientoLocalizadoTests(APITestCase):
    setUpTestData = classmethod(test_api.IdentityAPITests.setUpTestData.__func__)

    def test_session_user_same_payload_with_one_query_for_every_role(self):
        for user in self.users.values():
            with self.subTest(role=user.rol):
                with CaptureQueriesContext(connection) as before:
                    old = ModelBackend().get_user(user.pk)
                    self.assertTrue(has_valid_role_profile(old))
                    expected = UsuarioSerializer(old).data
                with self.assertNumQueries(1):
                    loaded = CuentaBackend().get_user(user.pk)
                    self.assertTrue(has_valid_role_profile(loaded))
                    self.assertEqual(UsuarioSerializer(loaded).data, expected)
                self.assertEqual(len(before), 5 if user.rol == 'MEDICO' else 4)

    def test_missing_incompatible_multiple_and_inactive_profiles_still_rejected(self):
        specialty = self.especialidad
        names = ('paciente', 'medico', 'secretaria')
        for role in Usuario.Rol.values:
            for size in range(4):
                for profiles in combinations(names, size):
                    key = f'{role}-{size}-{"-".join(profiles)}'
                    user = Usuario.objects.create_user(
                        email=key + '@example.com', rol=role, nombre='Prueba',
                        apellido='Perfiles', dni='1000', telefono='0')
                    if 'paciente' in profiles:
                        Paciente.objects.create(usuario=user)
                    if 'medico' in profiles:
                        Medico.objects.create(usuario=user, especialidad=specialty, matricula=key)
                    if 'secretaria' in profiles:
                        Secretaria.objects.create(usuario=user, legajo=key)
                    old = ModelBackend().get_user(user.pk)
                    expected = has_valid_role_profile(old)
                    required = {'PACIENTE': ('paciente',), 'MEDICO': ('medico',),
                                'SECRETARIA': ('secretaria',), 'ADMINISTRADOR': ()}[role]
                    self.assertEqual(expected, profiles == required, key)
                    loaded = CuentaBackend().get_user(user.pk)
                    self.assertEqual(has_valid_role_profile(loaded), expected, key)
                    request = type('Request', (), {'user': loaded})()
                    self.assertEqual(IsActiveUser().has_permission(request, None), expected, key)
                    Usuario.objects.filter(pk=user.pk).update(is_active=False)
                    self.assertIsNone(CuentaBackend().get_user(user.pk))
                    loaded.is_active = False
                    self.assertFalse(IsActiveUser().has_permission(request, None))
        self.assertIsNone(CuentaBackend().get_user(-1))

    def test_affected_payload_and_query_count_constant_for_one_and_six_turns(self):
        doctor = self.users['MEDICO'].medico
        patient = self.users['PACIENTE'].paciente
        day = timezone.localdate() + timedelta(days=2)
        counts = []
        for index in range(6):
            block = Disponibilidad.objects.create(
                medico=doctor, fecha=day, hora_inicio=time(9, index * 5),
                hora_fin=time(9, index * 5 + 5))
            turn = Turno.objects.create(medico=doctor, paciente=patient, disponibilidad=block,
                                        fecha=day, hora=block.hora_inicio, duracion_turno=5)
            if index in (0, 5):
                Triaje.objects.create(turno=turn, nivel_prioridad='ALTA' if index == 0 else 'BAJA',
                                      respuesta_sintomas={'fixture': index})
            if index not in (0, 5):
                continue
            user = CuentaBackend().get_user(self.users['SECRETARIA'].pk)
            request = APIRequestFactory().get('/', {
                'fecha_original': str(day), 'hora_inicio': '09:00', 'hora_fin': '10:00'})
            force_authenticate(request, user=user)
            with CaptureQueriesContext(connection) as baseline:
                expected = TurnoConsultaSerializer(
                    Turno.objects.filter(medico=doctor).order_by('hora', 'pk'), many=True).data
            self.assertEqual(len(baseline), 1 + 6 * (index + 1))
            with CaptureQueriesContext(connection) as queries:
                response = ReprogramacionView.as_view()(request, medico_pk=doctor.pk)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, expected)
            counts.append(len(queries))
        self.assertEqual(counts, [2, 2])
