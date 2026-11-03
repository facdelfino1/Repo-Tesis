import secrets
from datetime import time, timedelta
from unittest.mock import patch

from django.db import connection
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import APIException
from rest_framework.test import APIClient, APITestCase

from . import test_api, test_password_reset
from .agenda import set_blocked, update_block
from .models import Disponibilidad, Especialidad, Medico, Paciente, Triaje, Turno, Usuario
from .turnos import reservar_turno


class ReservaAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_api.IdentityAPITests.setUpTestData.__func__(cls)
        cls.doctor = cls.users['MEDICO'].medico
        cls.day = timezone.localdate() + timedelta(days=2)
        user = Usuario.objects.create_user('other-patient@example.com', secrets.token_urlsafe(24),
            rol='PACIENTE', nombre='Otro', apellido='Paciente', dni='99', telefono='123')
        cls.other_patient = Paciente.objects.create(usuario=user)
        other = Usuario.objects.create_user('other-doctor@example.com', secrets.token_urlsafe(24),
            rol='MEDICO', nombre='Otro', apellido='Medico', dni='98', telefono='123')
        cls.other_doctor = Medico.objects.create(usuario=other, matricula='OTHER', especialidad=cls.especialidad)

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(self.users['PACIENTE'], backend='dominio.authentication.CuentaBackend')
        self.client.get(reverse('auth-csrf'))
        self.block = Disponibilidad.objects.create(medico=self.doctor, fecha=self.day,
                                                  hora_inicio=time(9), hora_fin=time(9, 25))

    def url(self, doctor=None):
        return reverse('turno-agenda-list', kwargs={'medico_pk': (doctor or self.doctor).pk})

    def payload(self):
        return {'disponibilidad': self.block.pk, 'respuestas': {'fiebre': False, 'dificultadRespirar': False, 'dolor': 4}}

    def reserve(self, data=None, doctor=None):
        return self.client.post(self.url(doctor), self.payload() if data is None else data, format='json',
                                HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def test_reservation_derives_values_and_occupies(self):
        before = timezone.now()
        response = self.reserve()
        self.assertEqual(response.status_code, 201, response.data)
        turn = Turno.objects.get()
        self.assertEqual((turn.paciente_id, turn.medico_id, turn.disponibilidad_id),
                         (self.users['PACIENTE'].paciente.pk, self.doctor.pk, self.block.pk))
        self.assertEqual((turn.estado, turn.fecha, turn.hora, turn.duracion_turno), ('RESERVADO', self.day, time(9), 25))
        self.assertGreaterEqual(turn.fecha_hora_creacion, before)
        self.assertLessEqual(turn.fecha_hora_creacion, timezone.now())
        self.assertEqual(Triaje.objects.count(), 1)
        self.assertEqual(turn.triaje.nivel_prioridad, 'MEDIA')
        self.block.refresh_from_db()
        self.assertEqual(self.block.estado, 'OCUPADO')
        self.assertNotIn('password', str(response.data))

    def test_pediatrics_creates_one_triage(self):
        self.doctor.especialidad = Especialidad.objects.get(nombre='Pediatría')
        self.doctor.save(update_fields=['especialidad'])
        data = {'disponibilidad': self.block.pk, 'respuestas': {'fechaNacimiento': '2020-01-01', 'fiebre': False,
            'duracionFiebreHoras': None, 'dificultadRespirar': False, 'muyAgitado': True,
            'estadoGeneral': 'alerta_normal', 'vomitosRepetidos': False}}
        response = self.reserve(data)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['prioridad'], 'ALTA')
        self.assertEqual(Triaje.objects.count(), 1)
        self.assertEqual(Turno.objects.get().duracion_turno, 25)

    def test_without_algorithm_no_triage(self):
        for name in ['Cardiología', 'Otra especialidad']:
            with self.subTest(name=name):
                self.doctor.especialidad, _ = Especialidad.objects.get_or_create(nombre=name)
                self.doctor.save(update_fields=['especialidad'])
                block = Disponibilidad.objects.create(medico=self.doctor, fecha=self.day + timedelta(days=1 if name == 'Cardiología' else 2), hora_inicio=time(9), hora_fin=time(9, 20))
                response = self.reserve({'disponibilidad': block.pk})
                self.assertEqual(response.status_code, 201, response.data)
                self.assertIsNone(response.data['prioridad'])
                self.assertIsNone(response.data['triaje'])
        self.assertEqual(Triaje.objects.count(), 0)

    def test_without_algorithm_rejects_answers(self):
        self.doctor.especialidad = Especialidad.objects.get(nombre='Cardiología')
        self.doctor.save(update_fields=['especialidad'])
        self.assertEqual(self.reserve().status_code, 400)
        self.assertEqual(Turno.objects.count(), 0)

    def test_rejects_injected_fields_and_ambiguous_ids(self):
        for field in ['id_paciente', 'paciente', 'prioridad', 'estado', 'duracion_turno', 'fecha_hora_creacion',
                      'medico', 'fecha', 'hora', 'fecha_hora_inicio']:
            with self.subTest(field=field):
                self.assertEqual(self.reserve(self.payload() | {field: 1}).status_code, 400)
        for value in [True, '1', 1.0, None, -1]:
            self.assertEqual(self.reserve(self.payload() | {'disponibilidad': value}).status_code, 400)

    def test_invalid_questionnaire_does_not_persist(self):
        for answers in [{}, {'fiebre': True}, [], None]:
            self.assertEqual(self.reserve(self.payload() | {'respuestas': answers}).status_code, 400)
        self.assertFalse(Turno.objects.exists())
        self.block.refresh_from_db()
        self.assertEqual(self.block.estado, 'DISPONIBLE')

    def test_blocked_occupied_expired_and_inactive(self):
        for state in ['BLOQUEADO', 'OCUPADO']:
            self.block.estado = state
            self.block.save(update_fields=['estado'])
            self.assertEqual(self.reserve().status_code, 409)
        self.block.estado = 'DISPONIBLE'
        self.block.fecha = timezone.localdate() - timedelta(days=1)
        self.block.save()
        self.assertEqual(self.reserve().status_code, 409)
        self.block.fecha = self.day
        self.block.save()
        user = self.users['MEDICO']
        user.is_active = False
        user.save(update_fields=['is_active'])
        self.assertEqual(self.reserve().status_code, 409)
        self.assertFalse(Turno.objects.exists())

    def test_foreign_missing_and_manipulated_ids(self):
        self.assertEqual(self.reserve(doctor=self.other_doctor).status_code, 404)
        self.assertEqual(self.reserve(self.payload() | {'disponibilidad': 9223372036854775808}).status_code, 404)
        self.assertEqual(self.client.post('/api/medicos/no/turnos/', {}, format='json').status_code, 404)

    def test_only_patient_can_reserve_and_csrf(self):
        self.assertEqual(self.client.post(self.url(), self.payload(), format='json').status_code, 403)
        for role in ['MEDICO', 'SECRETARIA', 'ADMINISTRADOR']:
            self.client.force_login(self.users[role], backend='dominio.authentication.CuentaBackend')
            self.assertEqual(self.reserve().status_code, 403)
        self.client.logout()
        self.assertEqual(self.client.get(reverse('turno-list')).status_code, 403)

    def test_rollback_turn_triage_and_occupancy(self):
        for target in ['dominio.turnos.Turno.objects.create', 'dominio.turnos.Triaje.objects.create',
                       'dominio.turnos.Disponibilidad.save']:
            with self.subTest(target=target), patch(target, side_effect=RuntimeError('simulated')):
                with self.assertRaises(RuntimeError):
                    reservar_turno(self.users['PACIENTE'], self.doctor.pk, self.block.pk, self.payload()['respuestas'])
            self.assertFalse(Turno.objects.exists())
            self.assertFalse(Triaje.objects.exists())
            self.block.refresh_from_db()
            self.assertEqual(self.block.estado, 'DISPONIBLE')

    def test_patient_and_professional_read_scoping(self):
        self.assertEqual(self.reserve().status_code, 201)
        turn = Turno.objects.get()
        own = reverse('turno-detail', args=[turn.pk])
        nested = reverse('turno-agenda-detail', kwargs={'medico_pk': self.doctor.pk, 'pk': turn.pk})
        self.assertEqual(self.client.get(own).status_code, 200)
        self.assertEqual(self.client.get(self.url()).status_code, 403)
        self.client.force_login(self.other_patient.usuario, backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.client.get(own).status_code, 404)
        self.assertEqual(self.client.get(reverse('turno-list')).data['count'], 0)
        for role in ['MEDICO', 'SECRETARIA']:
            self.client.force_login(self.users[role], backend='dominio.authentication.CuentaBackend')
            self.assertEqual(self.client.get(nested).status_code, 200)
            self.assertEqual(self.client.get(self.url()).data['count'], 1)
            self.assertEqual(self.client.get(own).status_code, 403)
        self.client.force_login(self.other_doctor.usuario, backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.client.get(nested).status_code, 404)
        self.client.force_login(self.users['ADMINISTRADOR'], backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.client.get(nested).status_code, 403)

    def test_reads_cannot_update_creation_or_state(self):
        self.reserve()
        turn = Turno.objects.get()
        created = turn.fecha_hora_creacion
        response = self.client.patch(reverse('turno-detail', args=[turn.pk]), {'fecha_hora_creacion': '2000-01-01'},
            format='json', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
        self.assertEqual(response.status_code, 405)
        turn.refresh_from_db()
        self.assertEqual(turn.fecha_hora_creacion, created)

    def test_available_with_active_association_is_rejected(self):
        Turno.objects.create(paciente=self.other_patient, medico=self.doctor, disponibilidad=self.block,
                            fecha=self.day, hora=time(9), duracion_turno=25)
        self.assertEqual(self.reserve().status_code, 409)

    def test_cancelled_history_does_not_prevent_reservation(self):
        Turno.objects.create(paciente=self.other_patient, medico=self.doctor, disponibilidad=self.block,
                            fecha=self.day, hora=time(9), duracion_turno=25, estado='CANCELADO')
        self.assertEqual(self.reserve().status_code, 201)
        self.assertEqual(Turno.objects.count(), 2)


class ReservaConcurrencyTests(TransactionTestCase):
    parallel = test_password_reset.PasswordConcurrencyTests.parallel

    def setUp(self):
        self.specialty, _ = Especialidad.objects.get_or_create(nombre='Clínica Médica')
        self.day = timezone.localdate() + timedelta(days=2)
        self.patients = []
        self.doctors = []
        self.blocks = []
        for n in range(2):
            patient = Usuario.objects.create_user(f'p{n}@example.com', secrets.token_urlsafe(24), rol='PACIENTE',
                nombre='P', apellido='Test', dni=str(n), telefono='1')
            Paciente.objects.create(usuario=patient)
            self.patients.append(patient)
            user = Usuario.objects.create_user(f'm{n}@example.com', secrets.token_urlsafe(24), rol='MEDICO',
                nombre='M', apellido='Test', dni=str(n+2), telefono='1')
            doctor = Medico.objects.create(usuario=user, matricula=str(n), especialidad=self.specialty)
            self.doctors.append(doctor)
            self.blocks.append(Disponibilidad.objects.create(medico=doctor, fecha=self.day, hora_inicio=time(9), hora_fin=time(9, 20)))

    def reserve(self, patient=0, doctor=0):
        try:
            reservar_turno(self.patients[patient], self.doctors[doctor].pk, self.blocks[doctor].pk,
                          {'fiebre': False, 'dificultadRespirar': False, 'dolor': 0})
            return 201
        except APIException as error:
            return error.status_code

    def test_same_block_exactly_one_reservation(self):
        self.assertEqual(connection.vendor, 'postgresql')
        self.assertEqual(sorted(self.parallel([lambda: self.reserve(0), lambda: self.reserve(1)])), [201, 409])
        self.assertEqual(Turno.objects.count(), 1)
        self.assertEqual(Triaje.objects.count(), 1)
        self.blocks[0].refresh_from_db()
        self.assertEqual(self.blocks[0].estado, 'OCUPADO')

    def test_different_agendas_both_reserve(self):
        self.assertEqual(self.parallel([lambda: self.reserve(0, 0), lambda: self.reserve(1, 1)]), [201, 201])
        self.assertEqual(Turno.objects.count(), 2)

    def test_reservation_racing_with_block(self):
        def block():
            try:
                set_blocked(self.doctors[0].usuario, self.doctors[0].pk, self.blocks[0].pk, blocked=True)
                return 200
            except APIException as error:
                return error.status_code
        result = self.parallel([self.reserve, block])
        self.assertIn(result, ([201, 409], [409, 200]))
        self.blocks[0].refresh_from_db()
        self.assertEqual(self.blocks[0].estado, 'OCUPADO' if result[0] == 201 else 'BLOQUEADO')

    def test_reservation_racing_with_interval_update(self):
        def update():
            try:
                update_block(self.doctors[0].usuario, self.doctors[0].pk, self.blocks[0].pk, {'hora_fin': time(9, 40)})
                return 200
            except APIException as error:
                return error.status_code
        reserved, updated = self.parallel([self.reserve, update])
        self.assertEqual(reserved, 201)
        self.assertIn(updated, (200, 409))
        self.assertEqual(Turno.objects.get().duracion_turno, 40 if updated == 200 else 20)

    def test_reservation_racing_with_administrative_deactivation(self):
        from .serializers import UsuarioInternoSerializer
        def deactivate():
            user = Usuario.objects.get(pk=self.doctors[0].usuario_id)
            serializer = UsuarioInternoSerializer(user, data={'is_active': False}, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return 200
        reserved, deactivated = self.parallel([self.reserve, deactivate])
        self.assertEqual(deactivated, 200)
        self.assertIn(reserved, (201, 409))
        self.assertEqual(Turno.objects.count(), int(reserved == 201))
