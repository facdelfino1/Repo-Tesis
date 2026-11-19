"""Single active consultation: API lifecycle plus actual PostgreSQL row-lock races."""
from concurrent.futures import ThreadPoolExecutor
from datetime import time, timedelta
from queue import Queue
from threading import Barrier, Event
from time import monotonic, sleep
from unittest import skipUnless
from unittest.mock import patch

from django.db import close_old_connections, connection, connections, transaction
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase, APIRequestFactory, force_authenticate

from . import turnos
from .models import Disponibilidad, Especialidad, Medico, Paciente, Secretaria, Turno, Usuario
from .views import TurnoAgendaViewSet


class ConsultationFixtures:
    def setUp(self):
        super().setUp()
        self.specialty, _ = Especialidad.objects.get_or_create(nombre='Cardiología')
        self.serial = 0
        self.doctor = self.make_doctor('first')
        self.patient_user = self.user('patient', 'PACIENTE')
        self.patient = Paciente.objects.create(usuario=self.patient_user)
        self.secretary = self.user('secretary', 'SECRETARIA')
        Secretaria.objects.create(usuario=self.secretary, legajo='SC')

    def user(self, name, role):
        return Usuario.objects.create_user(name + '@single-consultation.example', password=None,
            rol=role, nombre=name, apellido='Test', dni=name, telefono='123')

    def make_doctor(self, name):
        return Medico.objects.create(usuario=self.user(name, 'MEDICO'), especialidad=self.specialty, matricula=name)

    def turn(self, *, doctor=None, state='PRESENTE', day=None):
        self.serial += 1
        start = 9 * 60 + self.serial * 20
        now = timezone.now()
        block = Disponibilidad.objects.create(medico=doctor or self.doctor, fecha=day or timezone.localdate(),
            hora_inicio=time(start // 60, start % 60), hora_fin=time((start + 20) // 60, (start + 20) % 60), estado='OCUPADO')
        return Turno.objects.create(paciente=self.patient, medico=block.medico, disponibilidad=block,
            fecha=block.fecha, hora=block.hora_inicio, duracion_turno=20, estado=state,
            fecha_hora_creacion=now-timedelta(days=2),
            fecha_hora_arribo=now-timedelta(minutes=10) if state != 'RESERVADO' else None,
            fecha_hora_inicio=now-timedelta(minutes=5) if state in ('EN_ATENCION', 'COMPLETADO') else None,
            fecha_hora_cierre=now-timedelta(minutes=1) if state == 'COMPLETADO' else None)

    def url(self, turn, action='iniciar'):
        return reverse('turno-agenda-' + action, kwargs={'medico_pk': turn.medico_id, 'pk': turn.pk})

    def snapshot(self, turn):
        return Turno.objects.filter(pk=turn.pk).values('estado', 'fecha_hora_arribo', 'fecha_hora_inicio',
            'fecha_hora_cierre', 'duracion_turno', 'medico_id', 'disponibilidad_id').get()


class SingleConsultationAPITests(ConsultationFixtures, APITestCase):
    def call(self, turn, action='iniciar', actor=None):
        self.client.force_authenticate(user=actor or turn.medico.usuario)
        return self.client.post(self.url(turn, action), {}, format='json')

    def test_start_without_active_consultation_records_real_start(self):
        turn = self.turn()
        response = self.call(turn)
        self.assertEqual(response.status_code, 200, response.data)
        turn.refresh_from_db()
        self.assertEqual(turn.estado, 'EN_ATENCION')
        self.assertLessEqual(turn.fecha_hora_arribo, turn.fecha_hora_inicio)
        self.assertIsNone(turn.fecha_hora_cierre)
        self.assertEqual(turn.duracion_turno, 20)

    def test_direct_api_rejects_other_active_without_changing_either_turn(self):
        active, target = self.turn(state='EN_ATENCION'), self.turn()
        before = [self.snapshot(active), self.snapshot(target)]
        response = self.call(target)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(str(response.data['detail']), turnos.CONSULTA_ACTIVA_MESSAGE)
        self.assertEqual([self.snapshot(active), self.snapshot(target)], before)
        target.refresh_from_db()
        self.assertEqual(target.estado, 'PRESENTE')
        self.assertIsNone(target.fecha_hora_inicio)

    def test_an_active_consultation_from_another_scheduled_date_also_blocks(self):
        active = self.turn(state='EN_ATENCION', day=timezone.localdate()-timedelta(days=1))
        target = self.turn()
        self.assertNotEqual(active.fecha, target.fecha)
        self.assertEqual(self.call(target).status_code, 409)
        self.assertIsNone(self.snapshot(target)['fecha_hora_inicio'])

    def test_finishing_active_allows_next_consultation(self):
        active, target = self.turn(state='EN_ATENCION'), self.turn()
        self.assertEqual(self.call(target).status_code, 409)
        self.assertEqual(self.call(active, 'finalizar').status_code, 200)
        self.assertEqual(self.call(target).status_code, 200)
        active.refresh_from_db(); target.refresh_from_db()
        self.assertEqual((active.estado, target.estado), ('COMPLETADO', 'EN_ATENCION'))
        self.assertIsNotNone(active.fecha_hora_cierre)
        self.assertIsNotNone(target.fecha_hora_inicio)

    def test_different_doctors_can_each_start_a_consultation(self):
        first, second = self.turn(), self.turn(doctor=self.make_doctor('other'))
        self.assertEqual(self.call(first).status_code, 200)
        self.assertEqual(self.call(second).status_code, 200)
        self.assertEqual(Turno.objects.filter(estado='EN_ATENCION').count(), 2)

    def test_completed_history_does_not_block_start(self):
        completed, target = self.turn(state='COMPLETADO'), self.turn()
        before = self.snapshot(completed)
        self.assertEqual(self.call(target).status_code, 200)
        self.assertEqual(self.snapshot(completed), before)

    def test_existing_transitions_permissions_and_repeated_start_are_preserved(self):
        turn = self.turn()
        for actor in (self.secretary, self.patient_user):
            self.assertEqual(self.call(turn, actor=actor).status_code, 403)
        self.assertEqual(self.call(turn, actor=self.make_doctor('unauthorized').usuario).status_code, 404)
        self.assertEqual(self.call(turn).status_code, 200)
        before = self.snapshot(turn)
        repeated = self.call(turn)
        self.assertEqual(repeated.status_code, 409)
        self.assertNotEqual(str(repeated.data['detail']), turnos.CONSULTA_ACTIVA_MESSAGE)
        self.assertEqual(self.snapshot(turn), before)
        self.assertEqual(self.call(turn, 'finalizar').status_code, 200)
        self.assertEqual(self.call(turn).status_code, 409)


@skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL row locks; SQLite cannot validate this guarantee.')
class SingleConsultationConcurrencyTests(ConsultationFixtures, TransactionTestCase):
    def start_api(self, turn):
        close_old_connections()
        try:
            request = APIRequestFactory().post(self.url(turn), {}, format='json')
            force_authenticate(request, user=turn.medico.usuario)
            return TurnoAgendaViewSet.as_view({'post':'iniciar'})(request, medico_pk=turn.medico_id, pk=turn.pk).status_code
        finally:
            connections['default'].close()

    def test_concurrent_distinct_turns_for_same_doctor_have_one_winner(self):
        first, second = self.turn(), self.turn()
        barrier, original = Barrier(2), turnos.lock_medico
        def simultaneous_lock(pk):
            barrier.wait(timeout=10)
            return original(pk)
        with patch('dominio.turnos.lock_medico', side_effect=simultaneous_lock), ThreadPoolExecutor(max_workers=2) as pool:
            results = [pool.submit(self.start_api, turn) for turn in (first, second)]
            self.assertEqual(sorted(future.result(timeout=20) for future in results), [200, 409])
        self.assertEqual(Turno.objects.filter(medico=self.doctor, estado='EN_ATENCION').count(), 1)
        rejected = Turno.objects.get(medico=self.doctor, estado='PRESENTE')
        self.assertIsNone(rejected.fecha_hora_inicio)

    def test_parent_lock_really_blocks_another_turn_until_first_start_commits(self):
        first, second = self.turn(), self.turn()
        attempted, pids, original = Event(), Queue(), turnos.lock_medico
        def observe_lock(pk):
            with connections['default'].cursor() as cursor:
                cursor.execute('SELECT pg_backend_pid()')
                pids.put(cursor.fetchone()[0])
            attempted.set()
            return original(pk)
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                turnos.iniciar_consulta(first.medico.usuario, first.pk, medico_id=first.medico_id)
                with patch('dominio.turnos.lock_medico', side_effect=observe_lock):
                    future = pool.submit(self.start_api, second)
                    self.assertTrue(attempted.wait(timeout=10))
                    pid, waiting, deadline = pids.get(timeout=1), False, monotonic()+5
                    while monotonic() < deadline:
                        with connection.cursor() as cursor:
                            cursor.execute('SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=%s AND NOT granted)', [pid])
                            waiting = cursor.fetchone()[0]
                        if waiting: break
                        sleep(0.02)
                    self.assertTrue(waiting, 'Second request must wait on the real PostgreSQL parent row lock.')
                    self.assertFalse(future.done())
            self.assertEqual(future.result(timeout=10), 409)
        self.assertEqual(Turno.objects.filter(medico=self.doctor, estado='EN_ATENCION').count(), 1)
