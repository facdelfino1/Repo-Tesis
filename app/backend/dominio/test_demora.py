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
        self.turn(time(11, 30), 'EN_ATENCION', doctor=other,
            fecha_hora_arribo=self.now-timedelta(hours=2), fecha_hora_inicio=self.now-timedelta(hours=1))
        self.assertEqual(self.estimate()['demora_estimada_minutos'], 0)
        self.turn(time(11), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=5))
        self.assertEqual(self.estimate()['estado_estimacion'], 'SIN_DATOS')
        self.assertIsNone(self.estimate()['promedio_consulta_minutos'])

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
        result = self.estimate()
        self.assertIsNone(result['demora_estimada_minutos'])
        self.assertIsNone(result['inicio_estimado'])
        self.assertEqual(result['estado_estimacion'], 'CONSULTA_DEMORADA')

    def test_active_consultation_below_equal_and_above_mean_uses_real_duration_and_ceil(self):
        self.completed(12)
        self.target.hora = time(12)
        active = self.turn(time(11), 'EN_ATENCION',
            fecha_hora_arribo=self.now-timedelta(minutes=30), fecha_hora_inicio=self.now-timedelta(minutes=7))
        for elapsed, minutes in ((timedelta(minutes=7), 5), (timedelta(minutes=11, seconds=59), 1),
                                 (timedelta(minutes=12), None), (timedelta(minutes=15), None)):
            with self.subTest(elapsed=elapsed):
                active.fecha_hora_inicio = self.now-elapsed
                active.save(update_fields=['fecha_hora_inicio'])
                result = self.estimate()
                self.assertEqual(result['demora_estimada_minutos'], minutes)
                if minutes is None:
                    self.assertEqual(result['estado_estimacion'], 'CONSULTA_DEMORADA')
                    self.assertIsNone(result['inicio_estimado'])
                else:
                    self.assertEqual(result['estado_estimacion'], 'ESTIMADA')
        active.refresh_from_db()
        self.assertEqual(active.duracion_turno, 20)  # late at 12 minutes, not at the scheduled 20-minute block

    def test_no_history_is_not_classified_as_an_overlong_consultation(self):
        self.turn(time(11), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(hours=2),
            fecha_hora_inicio=self.now-timedelta(hours=1))
        result = self.estimate()
        self.assertEqual(result['estado_estimacion'], 'SIN_DATOS')
        self.assertIsNone(result['demora_estimada_minutos'])

    def test_long_consultation_enters_mean_only_after_completion_and_restores_waiting_estimate(self):
        history = self.completed(12)
        active = self.turn(time(11), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(minutes=30),
            fecha_hora_inicio=self.now-timedelta(minutes=15))
        self.turn(time(11, 30), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=10))
        self.target.hora = time(12)
        before = (history.fecha_hora_inicio, history.fecha_hora_cierre, history.duracion_turno)
        result = self.estimate()
        self.assertEqual(result['estado_estimacion'], 'CONSULTA_DEMORADA')
        self.assertEqual(result['promedio_consulta_minutos'], 12)
        self.assertIsNone(result['demora_estimada_minutos'])  # no artificial total for the waiting patient
        active.estado, active.fecha_hora_cierre = 'COMPLETADO', self.now
        active.save(update_fields=['estado', 'fecha_hora_cierre'])
        result = self.estimate()  # mean of 12 and 15 = 13.5 minutes; one earlier present patient
        self.assertEqual(result['demora_estimada_minutos'], 14)
        self.assertEqual(result['espera_estimada_minutos'], 14)
        self.assertEqual(result['promedio_consulta_minutos'], 14)
        self.assertEqual(result['estado_estimacion'], 'ESTIMADA')
        history.refresh_from_db(); active.refresh_from_db()
        self.assertEqual((history.fecha_hora_inicio, history.fecha_hora_cierre, history.duracion_turno), before)
        self.assertEqual(active.duracion_turno, 20)

    def test_api_exposes_late_consultation_with_null_times_and_compatible_payload(self):
        self.completed(12)
        self.turn(time(11), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(minutes=30),
            fecha_hora_inicio=self.now-timedelta(minutes=15))
        self.client.force_login(self.users['PACIENTE'], backend='dominio.authentication.CuentaBackend')
        with patch('dominio.demora.timezone.now', return_value=self.now):
            response = self.client.get(reverse('turno-demora', args=[self.target.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['estado_estimacion'], 'CONSULTA_DEMORADA')
        self.assertIsNone(response.data['demora_estimada_minutos'])
        self.assertIsNone(response.data['inicio_estimado'])
        self.assertEqual(set(response.data), {'demora_estimada_minutos', 'inicio_estimado',
            'estado_estimacion', 'motivo', 'calculado_en', 'promedio_consulta_minutos', 'espera_estimada_minutos'})

    def test_present_after_scheduled_time_has_nonnegative_delay(self):
        self.target.hora = time(11, 50)
        self.target.estado = 'PRESENTE'
        self.target.fecha_hora_arribo = self.now-timedelta(minutes=5)
        self.completed(10)
        self.assertEqual(self.estimate()['demora_estimada_minutos'], 10)
        self.assertEqual(self.estimate()['espera_estimada_minutos'], 0)
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
            'estado_estimacion', 'motivo', 'calculado_en', 'promedio_consulta_minutos', 'espera_estimada_minutos'})
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

    def test_mean_is_independent_of_delay_eligibility(self):
        for minutes in (12, 12, 12, 18):
            self.completed(minutes)
        for state, day in (('RESERVADO', 0), ('PRESENTE', 0), ('RESERVADO', 1)):
            with self.subTest(state=state, day=day):
                self.target.estado = state
                self.target.fecha = self.now.date() + timedelta(days=day)
                result = self.estimate()
                self.assertEqual(result['promedio_consulta_minutos'], 14)

    def test_mean_rounds_only_final_average(self):
        # Averaging rounded individual minutes would give 14 instead of 13.
        self.completed(12.1)
        self.completed(13.1)
        self.assertEqual(self.estimate()['promedio_consulta_minutos'], 13)

    def test_wait_message_is_identical_for_reserved_and_present(self):
        self.completed(10)
        expected = ('Espera aproximada basada en los pacientes presentes y la consulta en curso. '
                    'Estimación informativa sujeta a cambios.')
        for state in ('RESERVADO', 'PRESENTE'):
            with self.subTest(state=state):
                self.target.estado = state
                self.target.fecha_hora_arribo = self.now-timedelta(minutes=5) if state == 'PRESENTE' else None
                self.assertEqual(self.estimate()['motivo'], expected)

    def test_mean_excludes_invalid_and_incomplete_history(self):
        self.completed(20, fecha_hora_inicio=None)
        self.completed(20, fecha_hora_cierre=None)
        self.completed(0)
        self.completed(-1)
        self.completed(20, fecha_hora_inicio=self.now-timedelta(days=2))
        self.completed(20, fecha_hora_cierre=self.now+timedelta(minutes=1))
        self.turn(time(11), 'EN_ATENCION', fecha_hora_inicio=self.now-timedelta(minutes=30),
                  fecha_hora_cierre=self.now)
        self.assertIsNone(self.estimate()['promedio_consulta_minutos'])
        self.completed(12)
        self.assertEqual(self.estimate()['promedio_consulta_minutos'], 12)

    def test_mean_uses_one_shared_query_and_preserves_history(self):
        history = self.completed(12)
        self.target.fecha += timedelta(days=1)  # delay exits before looking at today's queue
        with self.assertNumQueries(1):
            result = self.estimate()
        self.assertEqual(result['promedio_consulta_minutos'], 12)
        history.refresh_from_db()
        self.assertEqual(history.duracion_turno, 20)
        self.assertEqual(history.fecha_hora_cierre-history.fecha_hora_inicio, timedelta(minutes=12))

    def test_wait_counts_down_from_real_start_without_changing_mean_or_using_schedule(self):
        self.completed(10)
        self.turn(time(11), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(minutes=20),
                  fecha_hora_inicio=self.now-timedelta(minutes=4))
        for offset, expected in ((0, 6), (1, 5), (4, 2), (6, None), (11, None)):
            with self.subTest(offset=offset):
                result = estimar_demora(self.target, self.now+timedelta(minutes=offset))
                self.assertEqual(result['promedio_consulta_minutos'], 10)
                self.assertEqual(result['espera_estimada_minutos'], expected)
                if expected is not None:
                    self.assertEqual(result['demora_estimada_minutos'], 0)  # future scheduled time
                else:
                    self.assertEqual(result['estado_estimacion'], 'CONSULTA_DEMORADA')
                    self.assertIsNone(result['inicio_estimado'])

    def test_wait_adds_present_queue_and_rounds_only_the_final_total(self):
        self.completed(10.25)
        self.completed(10.75)  # unrounded mean = 10.5
        self.turn(time(10), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(minutes=20),
                  fecha_hora_inicio=self.now-timedelta(minutes=4, seconds=15))
        self.turn(time(11), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=10))
        result = self.estimate()
        self.assertEqual(result['promedio_consulta_minutos'], 11)
        self.assertEqual(result['espera_estimada_minutos'], 17)  # ceil(6.25 + 10.5), not 7 + 11

    def test_late_threshold_uses_unrounded_mean(self):
        self.completed(10.5)
        self.turn(time(11), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(minutes=20),
                  fecha_hora_inicio=self.now-timedelta(minutes=10, seconds=29))
        result = self.estimate()
        self.assertEqual(result['espera_estimada_minutos'], 1)
        self.assertEqual(result['promedio_consulta_minutos'], 11)
        at_threshold = estimar_demora(self.target, self.now+timedelta(seconds=1))
        self.assertEqual(at_threshold['estado_estimacion'], 'CONSULTA_DEMORADA')
        self.assertIsNone(at_threshold['espera_estimada_minutos'])

    def test_wait_without_active_consultation_counts_only_prior_present_patients(self):
        self.completed(10)
        self.turn(time(11), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=10))
        same_hour_later_id = self.turn(self.target.hora, 'PRESENTE',
            fecha_hora_arribo=self.now-timedelta(minutes=5))
        self.turn(time(11, 15), 'RESERVADO')  # no observed arrival
        self.turn(time(11, 20), 'CANCELADO')
        self.turn(time(13), 'PRESENTE', fecha_hora_arribo=self.now-timedelta(minutes=5))
        self.assertEqual(self.estimate()['espera_estimada_minutos'], 10)
        self.target = self.turn(self.target.hora)  # same-hour present patient now precedes this pk
        self.assertEqual(self.estimate()['espera_estimada_minutos'], 20)
        same_hour_later_id.refresh_from_db()
        self.assertEqual(same_hour_later_id.estado, 'PRESENTE')

    def test_missing_history_never_invents_wait_even_without_backlog(self):
        result = self.estimate()
        self.assertIsNone(result['promedio_consulta_minutos'])
        self.assertIsNone(result['espera_estimada_minutos'])
        self.assertEqual(result['demora_estimada_minutos'], 0)  # compatibility only

    def test_wait_keeps_date_and_arrival_eligibility_while_mean_remains_available(self):
        self.completed(10)
        for state, day, hour in (('RESERVADO', 1, time(12, 30)),
                                 ('RESERVADO', 0, time(11, 30)), ('PRESENTE', 0, time(12, 30))):
            with self.subTest(state=state, day=day):
                self.target.estado, self.target.hora = state, hour
                self.target.fecha = self.now.date()+timedelta(days=day)
                result = self.estimate()
                self.assertEqual(result['promedio_consulta_minutos'], 10)
                self.assertIsNone(result['espera_estimada_minutos'])

    def test_api_wait_is_distinct_from_legacy_delay(self):
        self.completed(10)
        self.turn(time(11), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(minutes=20),
                  fecha_hora_inicio=self.now-timedelta(minutes=4))
        self.client.force_login(self.users['PACIENTE'], backend='dominio.authentication.CuentaBackend')
        with patch('dominio.demora.timezone.now', return_value=self.now):
            response = self.client.get(reverse('turno-demora', args=[self.target.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['espera_estimada_minutos'], 6)
        self.assertEqual(response.data['demora_estimada_minutos'], 0)

    def another_doctor(self):
        user = Usuario.objects.create_user('independent-agenda@example.invalid', 'SafePass!38490',
            rol='MEDICO', nombre='Otra', apellido='Agenda', dni='8899', telefono='123')
        return Medico.objects.create(usuario=user, especialidad=self.doctor.especialidad, matricula='ISOLATED')

    def test_same_specialty_doctors_have_independent_means_and_simultaneous_active_waits(self):
        other = self.another_doctor()
        self.completed(10)
        self.completed(18, doctor=other)
        other_target = self.turn(time(12, 30), doctor=other)
        active = self.turn(time(11), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(minutes=20),
                           fecha_hora_inicio=self.now-timedelta(minutes=4))
        self.turn(time(11), 'EN_ATENCION', doctor=other, fecha_hora_arribo=self.now-timedelta(minutes=20),
                  fecha_hora_inicio=self.now-timedelta(minutes=3))
        first, second = self.estimate(), estimar_demora(other_target, self.now)
        self.assertEqual((first['promedio_consulta_minutos'], first['espera_estimada_minutos']), (10, 6))
        self.assertEqual((second['promedio_consulta_minutos'], second['espera_estimada_minutos']), (18, 15))
        active.fecha_hora_inicio = self.now-timedelta(minutes=15)
        active.save(update_fields=['fecha_hora_inicio'])
        self.assertEqual(self.estimate()['estado_estimacion'], 'CONSULTA_DEMORADA')
        self.assertEqual(estimar_demora(other_target, self.now), second)
        active.estado, active.fecha_hora_cierre = 'COMPLETADO', self.now
        active.save(update_fields=['estado', 'fecha_hora_cierre'])
        self.assertEqual(self.estimate()['promedio_consulta_minutos'], 13)
        self.assertEqual(estimar_demora(other_target, self.now), second)

    def test_starting_another_doctors_consultation_does_not_change_wait(self):
        other = self.another_doctor()
        self.completed(18)
        self.completed(10, doctor=other)
        before = self.estimate()
        self.turn(time(11), 'EN_ATENCION', doctor=other, fecha_hora_arribo=self.now-timedelta(minutes=20),
                  fecha_hora_inicio=self.now-timedelta(minutes=4))
        self.assertEqual(self.estimate(), before)

    def test_previous_day_open_consultation_returns_unknown_and_preserves_history(self):
        self.completed(10)
        self.target.estado = 'PRESENTE'
        self.target.fecha_hora_arribo = self.now-timedelta(minutes=5)
        active = self.turn(time(11), 'EN_ATENCION', fecha_hora_arribo=self.now-timedelta(hours=23),
                           fecha_hora_inicio=self.now-timedelta(hours=22))
        active.fecha -= timedelta(days=1)
        active.save(update_fields=['fecha'])
        before = (active.estado, active.fecha_hora_inicio, active.fecha_hora_cierre)
        result = self.estimate()
        self.assertEqual(result['promedio_consulta_minutos'], 10)
        self.assertIsNone(result['espera_estimada_minutos'])
        self.assertIsNone(result['demora_estimada_minutos'])
        self.assertIsNone(result['inicio_estimado'])
        self.assertEqual(result['estado_estimacion'], 'SIN_DATOS')
        self.assertIn('consulta anterior todavía en curso', result['motivo'])
        active.refresh_from_db()
        self.assertEqual((active.estado, active.fecha_hora_inicio, active.fecha_hora_cierre), before)
        self.client.force_login(self.users['PACIENTE'], backend='dominio.authentication.CuentaBackend')
        self.target.save(update_fields=['estado', 'fecha_hora_arribo'])
        with patch('dominio.demora.timezone.now', return_value=self.now):
            response = self.client.get(reverse('turno-demora', args=[self.target.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['espera_estimada_minutos'])
        self.assertEqual(response.data['promedio_consulta_minutos'], 10)

    def test_other_doctors_previous_day_active_consultation_is_ignored(self):
        other = self.another_doctor()
        self.completed(10)
        before = self.estimate()
        active = self.turn(time(11), 'EN_ATENCION', doctor=other,
            fecha_hora_arribo=self.now-timedelta(hours=23), fecha_hora_inicio=self.now-timedelta(hours=22))
        active.fecha -= timedelta(days=1)
        active.save(update_fields=['fecha'])
        self.assertEqual(self.estimate(), before)
        self.assertEqual(before['espera_estimada_minutos'], 0)
