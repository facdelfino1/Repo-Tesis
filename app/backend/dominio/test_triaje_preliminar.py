from datetime import datetime, time, timedelta
from unittest.mock import patch

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from . import test_turnos
from .models import Disponibilidad, Especialidad, Secretaria, Triaje, Turno


class TriajePreliminarAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_turnos.ReservaAPITests.setUpTestData.__func__(cls)

    setUp = test_turnos.ReservaAPITests.setUp

    def url(self, doctor=None):
        return reverse('triaje-preliminar', kwargs={'medico_pk': (doctor or self.doctor).pk})

    def evaluate(self, body=None, doctor=None, block=None):
        body = {'respuestas': self.cm()} if body is None else body
        if isinstance(body, dict):
            body = {'disponibilidad': (block or self.block).pk} | body
        return self.client.post(self.url(doctor), body, format='json',
                                HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def reserve(self, answers, block=None):
        body = {'disponibilidad': (block or self.block).pk}
        if answers is not None:
            body['respuestas'] = answers
        return self.client.post(reverse('turno-agenda-list', kwargs={'medico_pk': self.doctor.pk}),
                                body, format='json', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def cm(self, **changes):
        return dict(fiebre=False, dificultadRespirar=False, dolor=0) | changes

    def ped(self, **changes):
        return dict(fechaNacimiento='2020-01-01', fiebre=False, duracionFiebreHoras=None,
                    dificultadRespirar=False, muyAgitado=False, estadoGeneral='alerta_normal',
                    vomitosRepetidos=False) | changes

    def pediatric_doctor(self):
        self.doctor.especialidad = Especialidad.objects.get(nombre='Pediatría')
        self.doctor.save(update_fields=['especialidad'])

    def assert_empty(self):
        self.assertFalse(Turno.objects.exists())
        self.assertFalse(Triaje.objects.exists())
        self.block.refresh_from_db()
        self.assertEqual(self.block.estado, 'DISPONIBLE')

    def test_evaluation_is_read_only_and_has_no_store_header(self):
        with CaptureQueriesContext(connection) as queries, \
                patch.object(Turno, 'save', side_effect=AssertionError('No turn writes')), \
                patch.object(Triaje, 'save', side_effect=AssertionError('No triage writes')):
            for _ in range(3):
                response = self.evaluate()
                self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(set(response.data), {'prioridad', 'fecha_evaluacion', 'fecha_atencion'})
        self.assertEqual(response.data['fecha_atencion'], self.block.fecha.isoformat())
        self.assertEqual(response.data['prioridad'], 'BAJA')
        self.assertEqual(response.data['fecha_evaluacion'], timezone.localdate().isoformat())
        self.assertEqual(response['Cache-Control'], 'no-store')
        for query in queries:
            self.assertFalse(query['sql'].lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE')),
                             query['sql'])
        self.assert_empty()

    def test_preview_does_not_change_existing_reservation_or_triage(self):
        self.assertEqual(self.reserve(self.cm(dolor=4)).status_code, 201)
        before = (list(Turno.objects.values()), list(Triaje.objects.values()),
                  list(Disponibilidad.objects.values()))
        self.assertEqual(self.evaluate({'respuestas': self.cm(dolor=8)}).data['prioridad'], 'ALTA')
        self.assertEqual(before, (list(Turno.objects.values()), list(Triaje.objects.values()),
                                  list(Disponibilidad.objects.values())))

    def test_clinical_medicine_matches_definitive_for_all_priorities(self):
        for i, (pain, expected) in enumerate(((0, 'BAJA'), (4, 'MEDIA'), (8, 'ALTA'))):
            with self.subTest(priority=expected):
                answers = self.cm(dolor=pain)
                preview = self.evaluate({'respuestas': answers})
                self.assertEqual(preview.status_code, 200, preview.data)
                block = self.block if not i else Disponibilidad.objects.create(
                    medico=self.doctor, fecha=self.day + timedelta(days=i),
                    hora_inicio=time(9), hora_fin=time(9, 25))
                result = self.reserve(answers, block)
                self.assertEqual(result.status_code, 201, result.data)
                self.assertEqual((preview.data['prioridad'], result.data['prioridad']), (expected, expected))

    def test_pediatrics_matches_definitive_for_all_priorities(self):
        self.pediatric_doctor()
        cases = [(self.ped(), 'BAJA'), (self.ped(vomitosRepetidos=True), 'MEDIA'),
                 (self.ped(fechaNacimiento=(timezone.localdate() - timedelta(days=55)).isoformat(),
                           fiebre=True, duracionFiebreHoras=12, vomitosRepetidos=True), 'ALTA')]
        for i, (answers, expected) in enumerate(cases):
            with self.subTest(priority=expected):
                preview = self.evaluate({'respuestas': answers})
                block = self.block if not i else Disponibilidad.objects.create(
                    medico=self.doctor, fecha=self.day + timedelta(days=i),
                    hora_inicio=time(9), hora_fin=time(9, 25))
                result = self.reserve(answers, block)
                self.assertEqual(preview.status_code, 200, preview.data)
                self.assertEqual(result.status_code, 201, result.data)
                self.assertEqual((preview.data['prioridad'], result.data['prioridad']), (expected, expected))

    def test_definitive_classification_uses_current_answers(self):
        self.assertEqual(self.evaluate().data['prioridad'], 'BAJA')
        response = self.reserve(self.cm(dolor=8))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['prioridad'], 'ALTA')
        self.assertEqual(Turno.objects.get().triaje.respuesta_sintomas['dolor'], 8)

    def test_appointment_date_is_independent_of_server_midnight(self):
        self.pediatric_doctor()
        answers = self.ped(fechaNacimiento='2026-08-09', fiebre=True, duracionFiebreHoras=12)
        with patch('django.utils.timezone.now', return_value=timezone.make_aware(datetime(2026, 11, 8, 23, 59))):
            preview = self.evaluate({'respuestas': answers})
        with patch('django.utils.timezone.now', return_value=timezone.make_aware(datetime(2026, 11, 9, 0, 1))):
            response = self.reserve(answers)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data, {'prioridad': 'MEDIA', 'fecha_evaluacion': '2026-11-08',
                                        'fecha_atencion': self.block.fecha.isoformat()})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['prioridad'], 'MEDIA')

    def test_missing_invalid_and_injected_answers_do_not_write(self):
        for body in ({}, [], 'not-an-object', 7, {'respuestas': None}, {'respuestas': []}, {'respuestas': {}},
                     {'respuestas': self.cm(dolor=True)}, {'respuestas': self.cm(dolor=11)},
                     {'respuestas': self.cm(fiebre='si')}, {'respuestas': self.cm() | {'prioridad': 'ALTA'}}):
            with self.subTest(body=body):
                self.assertEqual(self.evaluate(body).status_code, 400)
                self.assert_empty()

    def test_incomplete_pediatric_answers_are_not_classified_early(self):
        self.pediatric_doctor()
        for answers in ({'dificultadRespirar': True}, self.ped(fechaNacimiento='2999-01-01'),
                        self.ped(fiebre=True, duracionFiebreHoras=-1)):
            self.assertEqual(self.evaluate({'respuestas': answers}).status_code, 400)
        self.assert_empty()

    def test_rejects_client_priority_ids_and_evaluation_date(self):
        for field in ('prioridad', 'paciente', 'fecha_atencion', 'medico', 'fecha_evaluacion'):
            with self.subTest(field=field):
                self.assertEqual(self.evaluate({'respuestas': self.cm(), field: 1}).status_code, 400)
        self.assert_empty()

    def test_without_algorithm_remains_unclassified(self):
        self.doctor.especialidad = Especialidad.objects.get(nombre='Cardiología')
        self.doctor.save(update_fields=['especialidad'])
        self.assertIsNone(self.evaluate({}).data['prioridad'])
        self.assertEqual(self.evaluate().status_code, 400)
        self.assert_empty()
        response = self.reserve(None)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data['prioridad'])
        self.assertFalse(Triaje.objects.exists())

    def test_active_patient_with_valid_profile_is_required(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(self.client.post(self.url(), {}, format='json').status_code, 403)
        for role in ('MEDICO', 'SECRETARIA', 'ADMINISTRADOR'):
            self.client.force_login(self.users[role], backend='dominio.authentication.CuentaBackend')
            self.client.get(reverse('auth-csrf'))
            self.assertEqual(self.evaluate().status_code, 403)
        patient = self.users['PACIENTE']
        self.client.force_login(patient, backend='dominio.authentication.CuentaBackend')
        self.client.get(reverse('auth-csrf'))
        patient.is_active = False
        patient.save(update_fields=['is_active'])
        self.assertEqual(self.evaluate().status_code, 403)
        patient.is_active = True
        patient.save(update_fields=['is_active'])
        Secretaria.objects.create(usuario=patient, legajo='INVALID-PATIENT')
        self.assertEqual(self.evaluate().status_code, 403)
        self.assert_empty()

    def test_csrf_origin_and_http_method(self):
        body = {'respuestas': self.cm()}
        self.assertEqual(self.client.post(self.url(), body, format='json').status_code, 403)
        self.assertEqual(self.client.post(self.url(), body, format='json',
                         HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value,
                         HTTP_ORIGIN='https://other.example.test').status_code, 403)
        self.assertEqual(self.client.get(self.url()).status_code, 405)
        self.assert_empty()

    def test_unknown_inactive_or_inconsistent_doctor_is_rejected(self):
        missing = reverse('triaje-preliminar', kwargs={'medico_pk': 999999})
        self.assertEqual(self.client.post(missing, {}, format='json',
                         HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value).status_code, 404)
        user = self.doctor.usuario
        user.is_active = False
        user.save(update_fields=['is_active'])
        self.assertEqual(self.evaluate().status_code, 404)
        user.is_active = True
        user.save(update_fields=['is_active'])
        Secretaria.objects.create(usuario=user, legajo='INVALID-PROFILE')
        self.assertEqual(self.evaluate().status_code, 404)
        self.assert_empty()

    def test_evaluation_does_not_reserve_or_change_block_state(self):
        self.block.estado = 'BLOQUEADO'
        self.block.save(update_fields=['estado'])
        response = self.evaluate()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('disponibilidad', response.data)
        self.assertFalse(Turno.objects.exists())
        self.assertFalse(Triaje.objects.exists())
        self.block.refresh_from_db()
        self.assertEqual(self.block.estado, 'BLOQUEADO')
