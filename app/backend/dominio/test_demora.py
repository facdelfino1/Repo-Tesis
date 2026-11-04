"""Focused PostgreSQL checks for the patient-facing operational delay estimate."""
from datetime import datetime, time, timedelta
from unittest.mock import patch

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from . import test_api
from .demora import estimar_demora
from .models import Medico, Turno, Usuario


class DemoraTests(APITestCase):
    setUpTestData = classmethod(test_api.IdentityAPITests.setUpTestData.__func__)

    def setUp(self):
        self.now = timezone.make_aware(datetime.combine(timezone.localdate(), time(12)))
        self.doctor = self.users['MEDICO'].medico
        self.patient = self.users['PACIENTE'].paciente
        self.target = self.turn(time(12, 30))

    def turn(self, hour, state='RESERVADO', doctor=None, **timestamps):
        return Turno.objects.create(
            paciente=self.patient, medico=doctor or self.doctor,
            fecha=self.now.date(), hora=hour, estado=state, duracion_turno=20,
            fecha_hora_creacion=self.now-timedelta(days=1), **timestamps,
        )

    def completed(self, minutes=20, doctor=None, **timestamps):
        values = dict(fecha_hora_arribo=self.now-timedelta(hours=2),
                      fecha_hora_inicio=self.now-timedelta(hours=2),
                      fecha_hora_cierre=self.now-timedelta(hours=2)+timedelta(minutes=minutes))
        values.update(timestamps)
        return self.turn(time(9), 'COMPLETADO', doctor, **values)

    def estimate(self):
        return estimar_demora(self.target, self.now)

    def test_no_observable_backlog_is_zero_even_with_earlier_reservations(self):
        self.turn(time(11), 'RESERVADO')
        result = self.estimate()
        self.assertEqual((result['demora_estimada_minutos'], result['estado_estimacion']), (0, 'SIN_DEMORA'))
        self.assertEqual(result['inicio_estimado'], timezone.make_aware(
            datetime.combine(self.now.date(), time(12, 30))).isoformat())

    def test_active_consultation_uses_valid_observed_duration(self):
        self.completed(20)
        self.turn(time(11, 30), 'EN_ATENCION',
                  fecha_hora_arribo=self.now-timedelta(minutes=15),
                  fecha_hora_inicio=self.now-timedelta(minutes=10))
        self.target.hora = time(12, 5)
        self.assertEqual(self.estimate()['demora_estimada_minutos'], 5)

    def test_multiple_earlier_present_use_duration_observed_for_same_doctor(self):
        self.completed(20)
        self.completed(40)
        for hour in (time(11), time(11, 30)):
            self.turn(hour, 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=20))
        result = self.estimate()
        self.assertEqual(result['demora_estimada_minutos'], 30)
        self.assertEqual(result['inicio_estimado'], (self.now + timedelta(minutes=60)).isoformat())

    def test_completed_cancelled_absent_pending_and_later_present_not_backlog(self):
        self.completed(20)
        for state in ('CANCELADO', 'AUSENTE', 'PENDIENTE'):
            self.turn(time(11), state)
        self.turn(time(13), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=5))
        self.assertEqual(self.estimate()['demora_estimada_minutos'], 0)

    def test_other_doctor_does_not_supply_work_or_duration(self):
        user = Usuario.objects.create_user('otra-demora@example.com', 'SafePass!38490',
            rol='MEDICO', nombre='Otra', apellido='Agenda', dni='888', telefono='123')
        other = Medico.objects.create(usuario=user, especialidad=self.doctor.especialidad, matricula='DEM-2')
        self.completed(20, doctor=other)
        self.turn(time(11), 'PRESENTE', doctor=other, fecha_hora_arribo=self.now-timedelta(minutes=5))
        self.assertEqual(self.estimate()['demora_estimada_minutos'], 0)
        self.turn(time(11), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=5))
        self.assertEqual(self.estimate()['estado_estimacion'], 'SIN_DATOS')

    def test_future_and_no_history_with_backlog_are_unknown(self):
        self.target.fecha += timedelta(days=1)
        self.assertEqual(self.estimate()['estado_estimacion'], 'SIN_DATOS')
        self.target.fecha = self.now.date()
        self.turn(time(11), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=5))
        self.assertIsNone(self.estimate()['demora_estimada_minutos'])

    def test_invalid_historical_durations_are_excluded(self):
        self.completed(20, fecha_hora_cierre=None)
        self.completed(20, fecha_hora_cierre=self.now-timedelta(hours=3))
        self.turn(time(11), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=5))
        self.assertIsNone(self.estimate()['demora_estimada_minutos'])

    def test_incomplete_queue_or_active_timestamps_are_unknown(self):
        self.completed(20)
        previous = self.turn(time(11), 'PRESENTE')
        self.assertEqual(self.estimate()['estado_estimacion'], 'SIN_DATOS')
        previous.fecha_hora_arribo = self.now-timedelta(minutes=5)
        previous.save(update_fields=['fecha_hora_arribo'])
        self.turn(time(11, 30), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(minutes=10))
        self.assertEqual(self.estimate()['estado_estimacion'], 'SIN_DATOS')

    def test_overlong_current_consultation_returns_unknown_not_negative(self):
        self.completed(20)
        self.turn(time(11, 30), 'EN_ATENCION',
                  fecha_hora_arribo=self.now-timedelta(minutes=30),
                  fecha_hora_inicio=self.now-timedelta(minutes=25))
        self.assertIsNone(self.estimate()['demora_estimada_minutos'])

    def test_present_after_scheduled_time_has_nonnegative_delay(self):
        self.target.hora = time(11, 50)
        self.target.estado = 'PRESENTE'
        self.target.fecha_hora_arribo = self.now-timedelta(minutes=5)
        self.assertEqual(self.estimate()['demora_estimada_minutos'], 10)
        self.target.estado = 'RESERVADO'
        self.assertIsNone(self.estimate()['demora_estimada_minutos'])

    def test_not_applicable_state_is_distinct_from_zero(self):
        self.target.estado = 'PENDIENTE'
        result = self.estimate()
        self.assertEqual(result['estado_estimacion'], 'NO_APLICA')
        self.assertIsNone(result['demora_estimada_minutos'])

    def test_api_own_turn_only_and_safe_payload(self):
        self.client.force_login(self.users['PACIENTE'], backend='dominio.authentication.CuentaBackend')
        url = reverse('turno-demora', args=[self.target.pk])
        with patch('dominio.demora.timezone.now', return_value=self.now):
            response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['demora_estimada_minutos'], 0)
        self.assertEqual(response.data['calculado_en'], self.now.isoformat())
        self.assertEqual(set(response.data), {'demora_estimada_minutos', 'inicio_estimado',
            'estado_estimacion', 'motivo', 'calculado_en'})
        self.assertNotIn(self.patient.usuario.email, str(response.data))
        user = Usuario.objects.create_user('paciente-otro-demora@example.com', 'SafePass!38490',
            rol='PACIENTE', nombre='Otro', apellido='Paciente', dni='889', telefono='123')
        from .models import Paciente
        Paciente.objects.create(usuario=user)
        self.client.force_login(user, backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.client.get(url).status_code, 404)
        for role in ('MEDICO', 'SECRETARIA', 'ADMINISTRADOR'):
            self.client.force_login(self.users[role], backend='dominio.authentication.CuentaBackend')
            self.assertEqual(self.client.get(url).status_code, 403)
        self.client.logout()
        self.assertIn(self.client.get(url).status_code, (401, 403))
