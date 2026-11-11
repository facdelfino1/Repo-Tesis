"""Administrative closure shares the doctor's transition, clock and locking."""
from datetime import timedelta
from unittest.mock import patch

from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from . import test_operaciones_turno as operations
from .metricas import aggregates, minutes
from .models import Turno
from .turnos import finalizar_consulta


class CierreSecretariaTests(APITestCase):
    setUpTestData = classmethod(operations.OperacionesTests.setUpTestData.__func__)
    setUp = operations.OperacionesTests.setUp
    payload = operations.OperacionesTests.payload
    url = operations.OperacionesTests.url
    reserve = operations.OperacionesTests.reserve
    turn = operations.OperacionesTests.turn
    login = operations.OperacionesTests.login
    call = operations.OperacionesTests.call

    def started(self):
        turn = self.turn(today=True)
        self.login('SECRETARIA')
        self.assertEqual(self.call('presencia', turn).status_code, 200)
        self.login('MEDICO')
        self.assertEqual(self.call('iniciar', turn).status_code, 200)
        turn.refresh_from_db()
        self.assertIsNone(turn.cerrado_por_id)
        return turn

    def test_both_roles_record_actor_and_preserve_booking_author(self):
        turn = self.started()
        turn.secretaria = self.users['SECRETARIA'].secretaria
        turn.save(update_fields=['secretaria'])
        for role in ('MEDICO', 'SECRETARIA'):
            with self.subTest(role=role):
                self.login(role)
                now = timezone.now()
                before = (turn.fecha_hora_arribo, turn.fecha_hora_inicio, turn.secretaria_id)
                with patch('dominio.turnos.timezone.now', return_value=now):
                    result = self.call('finalizar', turn)
                self.assertEqual(result.status_code, 200)
                turn.refresh_from_db()
                self.assertEqual((turn.estado, turn.fecha_hora_cierre, turn.cerrado_por_id),
                                 ('COMPLETADO', now, self.users[role].pk))
                self.assertEqual((turn.fecha_hora_arribo, turn.fecha_hora_inicio, turn.secretaria_id), before)
                self.assertEqual(result.data['cerrado_por'], {'id': self.users[role].pk,
                    'nombre': self.users[role].nombre, 'apellido': self.users[role].apellido, 'rol': role})
                self.assertNotIn('email', result.data['cerrado_por'])
                self.assertFalse(result.data['asignacion_vigente'])
                self.block.refresh_from_db()
                self.assertEqual(self.block.estado, 'OCUPADO')
                # Reset only the synthetic fixture to exercise the other authorized role.
                turn.estado, turn.fecha_hora_cierre, turn.cerrado_por = 'EN_ATENCION', None, None
                turn.save(update_fields=['estado', 'fecha_hora_cierre', 'cerrado_por'])

    def test_secretary_cannot_start_or_close_any_unstarted_state(self):
        turn = self.turn(today=True)
        self.login('SECRETARIA')
        self.assertEqual(self.call('iniciar', turn).status_code, 403)
        for state in Turno.Estado.values:
            turn.estado = state
            turn.save(update_fields=['estado'])
            self.assertEqual(self.call('finalizar', turn).status_code, 409)
            turn.refresh_from_db()
            self.assertIsNone(turn.cerrado_por_id)
            self.assertIsNone(turn.fecha_hora_cierre)

    def test_patient_admin_anonymous_and_foreign_doctor_denied(self):
        turn = self.started()
        for role in ('PACIENTE', 'ADMINISTRADOR'):
            self.login(role)
            self.assertEqual(self.call('finalizar', turn).status_code, 403)
        self.client.force_login(self.other_doctor.usuario, backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.call('finalizar', turn).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.post(reverse('turno-agenda-finalizar', kwargs={
            'medico_pk': self.doctor.pk, 'pk': turn.pk}), {}, format='json').status_code, 403)
        turn.refresh_from_db()
        self.assertEqual(turn.estado, 'EN_ATENCION')
        self.assertIsNone(turn.cerrado_por_id)

    def test_duplicate_cannot_overwrite_actor_or_clock(self):
        turn = self.started()
        self.login('SECRETARIA')
        self.assertEqual(self.call('finalizar', turn).status_code, 200)
        turn.refresh_from_db()
        saved = (turn.fecha_hora_cierre, turn.cerrado_por_id)
        for role in ('SECRETARIA', 'MEDICO'):
            self.login(role)
            self.assertEqual(self.call('finalizar', turn).status_code, 409)
            turn.refresh_from_db()
            self.assertEqual((turn.fecha_hora_cierre, turn.cerrado_por_id), saved)

    def test_request_cannot_supply_actor_time_state_and_requires_csrf(self):
        turn = self.started()
        self.login('SECRETARIA')
        for field in ('cerrado_por', 'secretaria', 'fecha_hora_cierre', 'estado'):
            self.assertEqual(self.call('finalizar', turn, {field: 'invalid'}).status_code, 400)
        url = reverse('turno-agenda-finalizar', kwargs={'medico_pk': self.doctor.pk, 'pk': turn.pk})
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 403)
        turn.refresh_from_db()
        self.assertIsNone(turn.cerrado_por_id)

    def test_atomic_rollback_if_save_fails(self):
        turn = self.started()
        with patch.object(Turno, 'save', side_effect=RuntimeError('synthetic failure')):
            with self.assertRaises(RuntimeError), transaction.atomic():
                finalizar_consulta(self.users['SECRETARIA'], turn.pk, medico_id=self.doctor.pk)
        turn.refresh_from_db()
        self.assertEqual(turn.estado, 'EN_ATENCION')
        self.assertIsNone(turn.fecha_hora_cierre)
        self.assertIsNone(turn.cerrado_por_id)

    def test_late_close_metrics_keep_actual_duration_and_wait(self):
        turn = self.started()
        now = timezone.now()
        turn.fecha_hora_creacion = now - timedelta(days=2)
        turn.fecha_hora_arribo = now - timedelta(days=1, minutes=15)
        turn.fecha_hora_inicio = now - timedelta(days=1)
        turn.save()
        before = minutes(Turno.objects.filter(pk=turn.pk).aggregate(**aggregates()))
        with patch('dominio.turnos.timezone.now', return_value=now):
            finalizar_consulta(self.users['SECRETARIA'], turn.pk, medico_id=self.doctor.pk)
        after = minutes(Turno.objects.filter(pk=turn.pk).aggregate(**aggregates()))
        self.assertEqual(before['espera_promedio_minutos'], after['espera_promedio_minutos'])
        self.assertEqual(after['espera_promedio_minutos'], 15)
        self.assertEqual(after['atencion_promedio_minutos'], 1440)
        self.assertEqual(after['muestras_atencion'], 1)
        self.assertEqual(after['completados'], 1)

    def test_actor_is_protected_and_agenda_detail_persists_actor(self):
        turn = self.started()
        finalizar_consulta(self.users['SECRETARIA'], turn.pk, medico_id=self.doctor.pk)
        self.login('SECRETARIA')
        url = reverse('turno-agenda-list', kwargs={'medico_pk': self.doctor.pk})
        rows = self.client.get(url, {'fecha': turn.fecha.isoformat()}).data['results']
        self.assertEqual(rows[0]['cerrado_por']['id'], self.users['SECRETARIA'].pk)
        with self.assertRaises(ProtectedError):
            self.users['SECRETARIA'].delete()


class CierreConcurrenteTests(TransactionTestCase):
    setUp = operations.OperacionesConcurrencyTests.setUp
    parallel = operations.OperacionesConcurrencyTests.parallel

    def race(self, actors):
        from .turnos import registrar_presencia, iniciar_consulta
        from rest_framework.exceptions import APIException
        operations.OperacionesConcurrencyTests.prepare_today(self)
        registrar_presencia(self.secretary, self.turn.pk, medico_id=self.doctors[0].pk)
        iniciar_consulta(self.doctors[0].usuario, self.turn.pk, medico_id=self.doctors[0].pk)

        def close(actor):
            try:
                turn = finalizar_consulta(actor, self.turn.pk, medico_id=self.doctors[0].pk)
                return 200, actor.pk, turn.fecha_hora_cierre
            except APIException as error:
                return error.status_code, actor.pk, None

        results = self.parallel([lambda actor=actor: close(actor) for actor in actors])
        self.assertEqual(sorted(row[0] for row in results), [200, 409])
        winner = next(row for row in results if row[0] == 200)
        self.turn.refresh_from_db()
        self.assertEqual((self.turn.estado, self.turn.cerrado_por_id, self.turn.fecha_hora_cierre),
                         ('COMPLETADO', winner[1], winner[2]))

    def test_doctor_vs_secretary(self):
        self.race([self.doctors[0].usuario, self.secretary])

    def test_two_secretary_requests(self):
        self.race([self.secretary, self.secretary])


class MigracionCierreTests(TransactionTestCase):
    def test_existing_turn_preserved_with_null_actor(self):
        old = [('dominio', '0004_propuesta_reprogramacion')]
        new = [('dominio', '0005_turno_cerrado_por')]
        executor = MigrationExecutor(connection)
        try:
            executor.migrate(old)
            apps = executor.loader.project_state(old).apps
            user = apps.get_model('dominio', 'Usuario')
            patient_user = user.objects.create(email='historical-patient@example.test', rol='PACIENTE', dni='991')
            doctor_user = user.objects.create(email='historical-doctor@example.test', rol='MEDICO', dni='992')
            patient = apps.get_model('dominio', 'Paciente').objects.create(usuario=patient_user)
            specialty, _ = apps.get_model('dominio', 'Especialidad').objects.get_or_create(nombre='Clínica Médica')
            doctor = apps.get_model('dominio', 'Medico').objects.create(usuario=doctor_user,
                especialidad=specialty, matricula='HIST')
            closed = timezone.now() - timedelta(days=1)
            historical = apps.get_model('dominio', 'Turno').objects.create(paciente=patient, medico=doctor,
                fecha=closed.date(), hora='09:00', duracion_turno=25, estado='COMPLETADO', fecha_hora_cierre=closed)
            pk = historical.pk
            executor = MigrationExecutor(connection)
            executor.migrate(new)
            migrated = executor.loader.project_state(new).apps.get_model('dominio', 'Turno').objects.get(pk=pk)
            self.assertIsNone(migrated.cerrado_por_id)
            self.assertEqual((migrated.estado, migrated.fecha_hora_cierre), ('COMPLETADO', closed))
        finally:
            MigrationExecutor(connection).migrate(new)
