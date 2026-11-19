from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from . import test_operaciones_turno
from .models import Especialidad, Turno
from .nacimiento import edad_cumplida, nacimiento_atendido


class EdadDetalleTests(SimpleTestCase):
    def test_cumpleanios_y_bisiestos(self):
        for birth, reference, expected in [
            (date(2000, 11, 17), date(2026, 11, 16), 25),
            (date(2000, 11, 17), date(2026, 11, 17), 26),
            (date(2000, 11, 17), date(2026, 11, 18), 26),
            (date(2000, 2, 29), date(2025, 2, 27), 24),
            (date(2000, 2, 29), date(2025, 2, 28), 25),
            (date(2000, 2, 29), date(2024, 2, 28), 23),
            (date(2000, 2, 29), date(2024, 2, 29), 24),
            (date(2026, 10, 1), date(2026, 11, 17), 0),
        ]:
            with self.subTest(birth=birth, reference=reference):
                self.assertEqual(edad_cumplida(birth, reference), expected)

    def test_json_historico_invalido_sin_fallback_al_titular(self):
        for answers in [None, [], 'texto', {}, {'fechaNacimiento': '2025-02-29'},
                        {'fechaNacimiento': '20200101'}, {'fechaNacimiento': True},
                        {'fechaNacimiento': '2999-01-01'}, {'fechaNacimiento': '2026-11-18'}]:
            turn = SimpleNamespace(fecha=date(2026, 11, 17),
                medico=SimpleNamespace(especialidad=SimpleNamespace(nombre='Pediatría')),
                paciente=SimpleNamespace(usuario=SimpleNamespace(fecha_nacimiento=date(1980, 1, 1))),
                triaje=SimpleNamespace(respuesta_sintomas=answers))
            with self.subTest(answers=answers), patch('dominio.nacimiento.timezone.localdate', return_value=date(2026, 12, 1)):
                block = nacimiento_atendido(turn)
                self.assertIsNone(block['fecha_nacimiento'])
                self.assertIsNone(block['edad'])


class NacimientoAPITests(APITestCase):
    setUpTestData = classmethod(test_operaciones_turno.OperacionesTests.setUpTestData.__func__)
    setUp = test_operaciones_turno.OperacionesTests.setUp
    payload = test_operaciones_turno.OperacionesTests.payload
    url = test_operaciones_turno.OperacionesTests.url
    reserve = test_operaciones_turno.OperacionesTests.reserve
    turn = test_operaciones_turno.OperacionesTests.turn
    login = test_operaciones_turno.OperacionesTests.login
    call = test_operaciones_turno.OperacionesTests.call
    target = test_operaciones_turno.OperacionesTests.target

    def detail_url(self, turn, doctor=None):
        return reverse('turno-agenda-detail', kwargs={'medico_pk': (doctor or self.doctor).pk, 'pk': turn.pk})

    def pediatric(self):
        self.doctor.especialidad = Especialidad.objects.get(nombre='Pediatría')
        self.doctor.save(update_fields=['especialidad'])
        return {'disponibilidad': self.block.pk, 'respuestas': {
            'fechaNacimiento': '2020-02-29', 'fiebre': False, 'duracionFiebreHoras': None,
            'dificultadRespirar': False, 'muyAgitado': False, 'estadoGeneral': 'alerta_normal', 'vomitosRepetidos': False}}

    def test_fecha_general_y_edad_solo_en_detalle_profesional(self):
        user = self.users['PACIENTE']
        user.fecha_nacimiento = date(1990, 12, 31)
        user.save(update_fields=['fecha_nacimiento'])
        turn = self.turn()
        for role in ['MEDICO', 'SECRETARIA']:
            self.login(role)
            result = self.client.get(self.detail_url(turn))
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.data['nacimiento_atendido'], {
                'fecha_nacimiento': '1990-12-31', 'edad': edad_cumplida(user.fecha_nacimiento, turn.fecha),
                'fecha_referencia': turn.fecha.isoformat(), 'es_menor_atendido': False})
            listing = self.client.get(self.url())
            self.assertNotIn('nacimiento_atendido', listing.data['results'][0])
        self.login('PACIENTE')
        self.assertNotIn('nacimiento_atendido', self.client.get(reverse('turno-detail', kwargs={'pk': turn.pk})).data)
        self.assertEqual(self.client.get(reverse('auth-me')).data['fecha_nacimiento'], '1990-12-31')

    def test_pediatria_ambos_reservantes_no_modifican_titular(self):
        user = self.users['PACIENTE']
        user.fecha_nacimiento = date(1980, 1, 1)
        user.save(update_fields=['fecha_nacimiento'])
        data = self.pediatric()
        for role in ['PACIENTE', 'SECRETARIA']:
            with self.subTest(role=role):
                self.login(role)
                if role == 'SECRETARIA':
                    data = data | {'disponibilidad': self.target().pk, 'paciente': user.paciente.pk}
                response = self.reserve(data)
                self.assertEqual(response.status_code, 201, response.data)
                turn = Turno.objects.get(pk=response.data['id_turno'])
                self.assertEqual(turn.triaje.respuesta_sintomas['fechaNacimiento'], '2020-02-29')
                for reader in ['MEDICO', 'SECRETARIA']:
                    self.login(reader)
                    block = self.client.get(self.detail_url(turn)).data['nacimiento_atendido']
                    self.assertEqual(block['fecha_nacimiento'], '2020-02-29')
                    self.assertTrue(block['es_menor_atendido'])
                user.refresh_from_db()
                self.assertEqual(user.fecha_nacimiento, date(1980, 1, 1))

    def test_historicos_generales_y_pediatricos_sin_fecha(self):
        turn = self.turn()
        self.login('SECRETARIA')
        for specialty in ['Clínica Médica', 'Pediatría']:
            self.doctor.especialidad = Especialidad.objects.get(nombre=specialty)
            self.doctor.save(update_fields=['especialidad'])
            for state in ['CANCELADO', 'COMPLETADO', 'PENDIENTE', 'AUSENTE']:
                turn.estado = state
                turn.save(update_fields=['estado'])
                block = self.client.get(self.detail_url(turn)).data['nacimiento_atendido']
                self.assertIsNone(block['fecha_nacimiento'])
                self.assertIsNone(block['edad'])

    def test_pediatria_rechaza_fecha_futura_invalida_o_ausente_ambos_perfiles(self):
        data = self.pediatric()
        for role in ['PACIENTE', 'SECRETARIA']:
            self.login(role)
            for value in [None, '', '2025-02-29', '2999-01-01']:
                answers = data['respuestas'] | {'fechaNacimiento': value}
                if value is None:
                    answers.pop('fechaNacimiento')
                payload = data | {'respuestas': answers}
                if role == 'SECRETARIA':
                    payload['paciente'] = self.users['PACIENTE'].paciente.pk
                with self.subTest(role=role, value=value):
                    self.assertEqual(self.reserve(payload).status_code, 400)
                    self.assertFalse(Turno.objects.exists())

    def test_modificacion_preserva_fecha_y_actualiza_referencia(self):
        response = self.reserve(self.pediatric())
        turn = Turno.objects.get(pk=response.data['id_turno'])
        before = dict(turn.triaje.respuesta_sintomas)
        target = self.target()
        result = self.call('modificar', turn, {'disponibilidad': target.pk}, nested=False)
        self.assertEqual(result.status_code, 200, result.data)
        turn.refresh_from_db()
        self.assertEqual(turn.triaje.respuesta_sintomas, before)
        self.login('MEDICO')
        block = self.client.get(self.detail_url(turn)).data['nacimiento_atendido']
        self.assertEqual(block['fecha_referencia'], target.fecha.isoformat())
        self.assertEqual(block['edad'], edad_cumplida(date(2020, 2, 29), target.fecha))

    def test_permisos_y_campos_inyectados(self):
        turn = self.turn()
        self.assertEqual(self.client.get(self.detail_url(turn)).status_code, 403)
        self.client.force_login(self.other_patient.usuario, backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.client.get(reverse('turno-detail', kwargs={'pk': turn.pk})).status_code, 404)
        self.client.force_login(self.other_doctor.usuario, backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.client.get(self.detail_url(turn)).status_code, 404)
        self.login('ADMINISTRADOR')
        self.assertEqual(self.client.get(self.detail_url(turn)).status_code, 403)
        self.client.logout()
        self.assertEqual(self.client.get(self.detail_url(turn)).status_code, 403)
        self.login('PACIENTE')
        self.client.get(reverse('auth-csrf'))
        self.assertEqual(self.reserve(self.payload() | {'fecha_nacimiento': '1980-01-01'}).status_code, 400)
