from datetime import date, datetime, time, timedelta
from unittest.mock import patch

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from . import test_triaje_preliminar as preview_tests
from .models import Disponibilidad, Especialidad, Triaje, Turno
from .reprogramacion import reprogramar, responder, reasignar_pendiente
from .turnos import modificar_turno, reservar_turno


class EdadFechaAtencionTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        preview_tests.TriajePreliminarAPITests.setUpTestData.__func__(cls)

    def setUp(self):
        preview_tests.TriajePreliminarAPITests.setUp(self)
        self.pediatric_doctor()

    pediatric_doctor = preview_tests.TriajePreliminarAPITests.pediatric_doctor
    ped = preview_tests.TriajePreliminarAPITests.ped
    cm = preview_tests.TriajePreliminarAPITests.cm
    url = preview_tests.TriajePreliminarAPITests.url
    evaluate = preview_tests.TriajePreliminarAPITests.evaluate
    reserve = preview_tests.TriajePreliminarAPITests.reserve

    def block_for(self, day, hour=10):
        return Disponibilidad.objects.create(medico=self.doctor, fecha=day,
                                             hora_inicio=time(hour), hora_fin=time(hour, 20))

    def now_on(self, day):
        return patch('django.utils.timezone.now', return_value=timezone.make_aware(
            datetime.combine(day, time(8))))

    def fever(self, birth='2026-08-09', **changes):
        return self.ped(fechaNacimiento=birth, fiebre=True, duracionFiebreHoras=12) | changes

    def pair(self, before=date(2026, 11, 8), after=date(2026, 11, 9)):
        return self.block_for(before), self.block_for(after)

    def make_turn(self, block, answers):
        turno = reservar_turno(self.users['PACIENTE'], self.doctor.pk, block.pk, answers)
        # The model default captured timezone.now before the test clock was patched.
        turno.fecha_hora_creacion = timezone.now()
        turno.save(update_fields=['fecha_hora_creacion'])
        return turno

    def test_before_exact_and_after_three_months_use_appointment_date(self):
        with self.now_on(date(2026, 11, 1)):
            for day, expected in [(date(2026, 11, 8), 'ALTA'), (date(2026, 11, 9), 'MEDIA'),
                                  (date(2026, 11, 10), 'MEDIA')]:
                with self.subTest(day=day):
                    block = self.block_for(day)
                    preview = self.evaluate({'respuestas': self.fever()}, block=block)
                    self.assertEqual(preview.status_code, 200, preview.data)
                    self.assertEqual(preview.data['fecha_atencion'], day.isoformat())
                    self.assertEqual(preview.data['prioridad'], expected)
                    self.assertEqual(Turno.objects.filter(disponibilidad=block).count(), 0)
                    result = self.reserve(self.fever(), block)
                    self.assertEqual(result.status_code, 201, result.data)
                    self.assertEqual(result.data['prioridad'], expected)
                    triage = Turno.objects.get(pk=result.data['id_turno']).triaje
                    self.assertEqual(timezone.localdate(triage.fecha_hora_evaluacion), date(2026, 11, 1))

    def test_calendar_month_end_and_leap_year_match_reservation(self):
        cases = [('2023-11-30', date(2024, 2, 29)), ('2024-11-30', date(2025, 2, 28)),
                 ('2024-02-29', date(2024, 5, 29))]
        for birth, anniversary in cases:
            with self.subTest(birth=birth), self.now_on(anniversary - timedelta(days=3)):
                for offset, priority in [(-1, 'ALTA'), (0, 'MEDIA'), (1, 'MEDIA')]:
                    block = self.block_for(anniversary + timedelta(days=offset))
                    answers = self.fever(birth)
                    preview = self.evaluate({'respuestas': answers}, block=block)
                    result = self.reserve(answers, block)
                    self.assertEqual(preview.status_code, 200, preview.data)
                    self.assertEqual(result.status_code, 201, result.data)
                    self.assertEqual((preview.data['prioridad'], result.data['prioridad']), (priority, priority))

    def test_different_times_on_same_day_have_identical_age_priority(self):
        with self.now_on(date(2026, 11, 1)):
            for hour in (10, 18):
                block = self.block_for(date(2026, 11, 9), hour)
                self.assertEqual(self.evaluate({'respuestas': self.fever()}, block=block).data['prioridad'], 'MEDIA')

    def test_request_clock_does_not_change_preview_for_same_slot(self):
        block = self.block_for(date(2026, 11, 9))
        for request_day in (date(2026, 11, 1), date(2026, 11, 8), date(2026, 11, 9)):
            with self.now_on(request_day):
                response = self.evaluate({'respuestas': self.fever()}, block=block)
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data['prioridad'], 'MEDIA')
                self.assertEqual(response.data['fecha_atencion'], '2026-11-09')

    def test_future_birth_validation_is_not_relaxed_by_future_appointment(self):
        with self.now_on(date(2026, 11, 1)):
            block = self.block_for(date(2026, 11, 10))
            answers = self.fever('2026-11-02')
            self.assertEqual(self.evaluate({'respuestas': answers}, block=block).status_code, 400)
            self.assertEqual(self.reserve(answers, block).status_code, 400)
            self.assertEqual((Turno.objects.count(), Triaje.objects.count()), (0, 0))

    def test_preview_requires_real_slot_and_cannot_override_appointment_date(self):
        token = self.client.cookies['csrftoken'].value
        for value in (None, True, '1', 1.0, -1):
            response = self.evaluate({'disponibilidad': value, 'respuestas': self.fever()})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.post(self.url(), {'respuestas': self.fever()}, format='json',
                                         HTTP_X_CSRFTOKEN=token).status_code, 400)
        self.assertEqual(self.evaluate({'disponibilidad': 999999, 'respuestas': self.fever()}).status_code, 404)
        foreign = Disponibilidad.objects.create(medico=self.other_doctor, fecha=self.day,
                                                 hora_inicio=time(10), hora_fin=time(10, 20))
        self.assertEqual(self.evaluate({'respuestas': self.fever()}, block=foreign).status_code, 404)
        self.assertEqual(self.evaluate({'respuestas': self.fever(), 'fecha_atencion': '2026-11-09'}).status_code, 400)
        self.assertEqual((Turno.objects.count(), Triaje.objects.count()), (0, 0))

    def test_changing_selection_across_boundary_then_reserving_is_coherent(self):
        with self.now_on(date(2026, 11, 1)):
            before, after = self.pair()
            self.assertEqual(self.evaluate({'respuestas': self.fever()}, block=before).data['prioridad'], 'ALTA')
            self.assertEqual(self.evaluate({'respuestas': self.fever()}, block=after).data['prioridad'], 'MEDIA')
            self.assertEqual((Turno.objects.count(), Triaje.objects.count()), (0, 0))
            result = self.reserve(self.fever(), after)
            self.assertEqual(result.status_code, 201, result.data)
            self.assertEqual(result.data['prioridad'], 'MEDIA')

    def test_patient_modification_recalculates_priority_both_directions(self):
        with self.now_on(date(2026, 11, 1)):
            before, after = self.pair()
            turno = self.make_turn(before, self.fever())
            triaje_id, answers, created = turno.triaje.pk, turno.triaje.respuesta_sintomas, turno.fecha_hora_creacion
            for target, expected in [(after, 'MEDIA'), (before, 'ALTA')]:
                response = self.client.post(reverse('turno-modificar', args=[turno.pk]),
                                             {'disponibilidad': target.pk}, format='json',
                                             HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data['prioridad'], expected)
                turno.refresh_from_db()
                self.assertEqual((turno.triaje.pk, turno.triaje.respuesta_sintomas, turno.fecha_hora_creacion),
                                 (triaje_id, answers, created))

    def test_time_only_change_preserves_priority_and_evaluation_timestamp(self):
        with self.now_on(date(2026, 11, 1)):
            before, _ = self.pair()
            target = self.block_for(before.fecha, 18)
            turno = self.make_turn(before, self.fever())
            snapshot = list(Triaje.objects.values())
            modificar_turno(self.users['PACIENTE'], turno.pk, target.pk)
            self.assertEqual(list(Triaje.objects.values()), snapshot)

    def test_existing_high_criteria_remain_high_after_age_boundary(self):
        with self.now_on(date(2026, 11, 1)):
            before, after = self.pair()
            answers = self.fever(dificultadRespirar=True)
            turno = self.make_turn(before, answers)
            snapshot = list(Triaje.objects.values())
            result = modificar_turno(self.users['PACIENTE'], turno.pk, after.pk)
            self.assertEqual(result.triaje.nivel_prioridad, 'ALTA')
            self.assertEqual(list(Triaje.objects.values()), snapshot)

    def pending(self, turno, target):
        result = reprogramar(self.users['SECRETARIA'], self.doctor.pk, fecha_original=turno.fecha,
                              hora_inicio=time(10), hora_fin=time(10, 20), nueva_fecha=target.fecha,
                              turnos=[turno.pk], motivo='Cambio sintetico de fecha')
        proposal = result['propuestas'][0]
        proposal.fecha_hora_creacion = timezone.now()
        proposal.save(update_fields=['fecha_hora_creacion'])
        return proposal

    def test_accepting_new_date_recalculates_without_changing_pending_priority(self):
        with self.now_on(date(2026, 11, 1)):
            before, after = self.pair()
            turno = self.make_turn(before, self.fever())
            proposal = self.pending(turno, after)
            turno.refresh_from_db()
            self.assertEqual((turno.estado, turno.triaje.nivel_prioridad), ('PENDIENTE', 'ALTA'))
            responder(self.users['PACIENTE'], proposal.pk, aceptar=True)
            turno.refresh_from_db()
            self.assertEqual((turno.fecha, turno.triaje.nivel_prioridad, turno.estado),
                             (after.fecha, 'MEDIA', 'RESERVADO'))
            responder(self.users['PACIENTE'], proposal.pk, aceptar=True)
            self.assertEqual(Triaje.objects.count(), 1)

    def test_reassigning_pending_recalculates_for_actual_destination(self):
        with self.now_on(date(2026, 11, 1)):
            before, after = self.pair()
            turno = self.make_turn(before, self.fever())
            self.pending(turno, after)
            result = reasignar_pendiente(self.users['PACIENTE'], turno.pk, after.pk)
            self.assertEqual(result.triaje.nivel_prioridad, 'MEDIA')
            self.assertEqual(result.fecha, after.fecha)

    def test_clinical_medicine_is_unchanged_on_date_change(self):
        self.doctor.especialidad = Especialidad.objects.get(nombre='Clínica Médica')
        self.doctor.save(update_fields=['especialidad'])
        with self.now_on(date(2026, 11, 1)):
            before, after = self.pair()
            turno = self.make_turn(before, self.cm(dolor=4))
            snapshot = list(Triaje.objects.values())
            modificar_turno(self.users['PACIENTE'], turno.pk, after.pk)
            self.assertEqual(list(Triaje.objects.values()), snapshot)
