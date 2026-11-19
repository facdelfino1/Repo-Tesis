"""Original booking source is server-owned and survives subsequent operations."""
from datetime import datetime, time, timedelta
from unittest.mock import patch

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from . import test_turnos, test_operaciones_turno
from .models import Disponibilidad, Turno
from .reprogramacion import reprogramar, responder, reasignar_pendiente
from .serializers import TurnoConsultaSerializer
from .turnos import modificar_turno, cancelar_turno, registrar_presencia, iniciar_consulta, finalizar_consulta


class OrigenTurnoTests(APITestCase):
    setUpTestData = classmethod(test_turnos.ReservaAPITests.setUpTestData.__func__)
    setUp = test_turnos.ReservaAPITests.setUp
    payload = test_turnos.ReservaAPITests.payload
    url = test_turnos.ReservaAPITests.url
    reserve = test_turnos.ReservaAPITests.reserve
    login = test_operaciones_turno.OperacionesTests.login

    def booking(self, role):
        self.login(role)
        data = self.payload()
        if role == 'SECRETARIA':
            data['paciente'] = self.users['PACIENTE'].paciente.pk
        response = self.reserve(data)
        self.assertEqual(response.status_code, 201, response.data)
        turn = Turno.objects.get(pk=response.data['id_turno'])
        self.assertEqual(turn.origen, role)
        self.assertEqual(response.data['origen'], role)
        self.assertEqual(turn.secretaria_id, self.users[role].secretaria.pk if role == 'SECRETARIA' else None)
        return turn

    def destination(self):
        return Disponibilidad.objects.create(medico=self.doctor, fecha=self.day+timedelta(days=2),
                                             hora_inicio=time(10), hora_fin=time(10, 30))

    def assert_origin(self, turn, origin):
        turn.refresh_from_db()
        self.assertEqual(turn.origen, origin)
        self.assertEqual(turn.secretaria_id,
                         self.users['SECRETARIA'].secretaria.pk if origin == 'SECRETARIA' else None)

    def test_patient_origin_is_persisted_and_returned_by_consultation_api(self):
        turn = self.booking('PACIENTE')
        response = self.client.get(reverse('turno-detail', args=[turn.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['origen'], 'PACIENTE')

    def test_secretary_origin_and_creator_are_persisted_and_returned_by_agenda_api(self):
        turn = self.booking('SECRETARIA')
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, 200)
        rows = response.data['results'] if isinstance(response.data, dict) else response.data
        self.assertEqual(next(row for row in rows if row['id_turno'] == turn.pk)['origen'], 'SECRETARIA')

    def test_neither_role_can_inject_origin_in_reservation(self):
        for role in ('PACIENTE', 'SECRETARIA'):
            self.login(role)
            data = self.payload() | ({'paciente': self.users['PACIENTE'].paciente.pk} if role == 'SECRETARIA' else {})
            for origin in ('PACIENTE', 'SECRETARIA', 'SISTEMA', None):
                with self.subTest(role=role, origin=origin):
                    response = self.reserve(data | {'origen': origin})
                    self.assertEqual(response.status_code, 400)
                    self.assertIn('origen', response.data)
                    self.assertFalse(Turno.objects.exists())
        self.block.refresh_from_db()
        self.assertEqual(self.block.estado, 'DISPONIBLE')

    def test_serializer_is_read_only_and_historical_null_is_not_inferred_from_secretary(self):
        turn = self.booking('SECRETARIA')
        field = Turno._meta.get_field('origen')
        self.assertTrue(field.null)
        self.assertFalse(field.has_default())
        for origin in ('PACIENTE', 'SECRETARIA', 'SISTEMA', None):
            turn.origen = origin
            turn.save(update_fields=['origen'])  # isolated fixture for each persisted representation
            serializer = TurnoConsultaSerializer(turn, data={'origen': 'SISTEMA'}, partial=True)
            self.assertTrue(serializer.fields['origen'].read_only)
            self.assertTrue(serializer.is_valid(), serializer.errors)
            self.assertNotIn('origen', serializer.validated_data)
            self.assertEqual(TurnoConsultaSerializer(turn).data['origen'], origin)
        self.assertIsNotNone(turn.secretaria_id)  # historical NULL must still remain NULL

    def test_modification_and_cancel_preserve_patient_origin_when_secretary_operates(self):
        turn = self.booking('PACIENTE')
        modificar_turno(self.users['SECRETARIA'], turn.pk, self.destination().pk, medico_id=self.doctor.pk)
        self.assert_origin(turn, 'PACIENTE')
        cancelar_turno(self.users['SECRETARIA'], turn.pk, medico_id=self.doctor.pk)
        self.assert_origin(turn, 'PACIENTE')

    def test_state_transitions_preserve_secretary_origin(self):
        turn = self.booking('SECRETARIA')
        now = timezone.make_aware(datetime.combine(turn.fecha, time(9)))
        with patch('dominio.turnos.timezone.now', return_value=now):
            registrar_presencia(self.users['SECRETARIA'], turn.pk, medico_id=self.doctor.pk)
            self.assert_origin(turn, 'SECRETARIA')
            iniciar_consulta(self.users['MEDICO'], turn.pk, medico_id=self.doctor.pk)
            self.assert_origin(turn, 'SECRETARIA')
            finalizar_consulta(self.users['MEDICO'], turn.pk, medico_id=self.doctor.pk)
            self.assert_origin(turn, 'SECRETARIA')

    def propose(self, turn):
        destination = self.destination()
        result = reprogramar(self.users['SECRETARIA'], self.doctor.pk, fecha_original=turn.fecha,
            hora_inicio=time(9), hora_fin=time(10), nueva_fecha=destination.fecha,
            turnos=[turn.pk], motivo='Prueba de conservación del origen')
        proposal = result['propuestas'][0]
        self.assertEqual(proposal.creada_por_id, self.users['SECRETARIA'].pk)
        return proposal

    def test_mass_rescheduling_and_acceptance_preserve_patient_origin(self):
        turn = self.booking('PACIENTE')
        proposal = self.propose(turn)
        self.assert_origin(turn, 'PACIENTE')
        _, conflict = responder(self.users['PACIENTE'], proposal.pk, aceptar=True)
        self.assertFalse(conflict)
        self.assert_origin(turn, 'PACIENTE')

    def test_patient_acceptance_preserves_secretary_origin(self):
        turn = self.booking('SECRETARIA')
        proposal = self.propose(turn)
        self.assert_origin(turn, 'SECRETARIA')
        _, conflict = responder(self.users['PACIENTE'], proposal.pk, aceptar=True)
        self.assertFalse(conflict)
        self.assert_origin(turn, 'SECRETARIA')

    def test_rejection_and_pending_reassignment_preserve_patient_origin(self):
        turn = self.booking('PACIENTE')
        proposal = self.propose(turn)
        responder(self.users['PACIENTE'], proposal.pk, aceptar=False)
        self.assert_origin(turn, 'PACIENTE')
        reasignar_pendiente(self.users['SECRETARIA'], turn.pk, proposal.disponibilidad_destino_id,
                            medico_id=self.doctor.pk)
        self.assert_origin(turn, 'PACIENTE')

    def test_update_actions_cannot_modify_origin(self):
        turn = self.booking('PACIENTE')
        self.login('SECRETARIA')
        url = reverse('turno-agenda-modificar', kwargs={'medico_pk': self.doctor.pk, 'pk': turn.pk})
        response = self.client.post(url, {'disponibilidad': self.destination().pk, 'origen': 'SISTEMA'},
            format='json', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
        self.assertEqual(response.status_code, 400)
        detail = reverse('turno-agenda-detail', kwargs={'medico_pk': self.doctor.pk, 'pk': turn.pk})
        self.assertEqual(self.client.patch(detail, {'origen': 'SISTEMA'}, format='json',
            HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value).status_code, 405)
        self.assert_origin(turn, 'PACIENTE')


class OrigenMigrationTests(TransactionTestCase):
    def test_add_field_preserves_existing_rows_and_does_not_infer_origins(self):
        # Only the test database is migrated. No default connection outside the test runner.
        before = [('dominio', '0005_turno_cerrado_por')]
        after = [('dominio', '0006_turno_origen')]
        def restore_schema():
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
        self.addCleanup(restore_schema)
        executor = MigrationExecutor(connection)
        executor.migrate(before)
        apps = executor.loader.project_state(before).apps
        User = apps.get_model('dominio', 'Usuario')
        patient_user = User.objects.create(email='historico-paciente@example.invalid', rol='PACIENTE')
        doctor_user = User.objects.create(email='historico-medico@example.invalid', rol='MEDICO')
        secretary_user = User.objects.create(email='historico-secretaria@example.invalid', rol='SECRETARIA')
        patient = apps.get_model('dominio', 'Paciente').objects.create(usuario=patient_user)
        specialty = apps.get_model('dominio', 'Especialidad').objects.create(nombre='Especialidad histórica')
        doctor = apps.get_model('dominio', 'Medico').objects.create(usuario=doctor_user, especialidad=specialty, matricula='HIST')
        secretary = apps.get_model('dominio', 'Secretaria').objects.create(usuario=secretary_user, legajo='HIST')
        OldTurn = apps.get_model('dominio', 'Turno')
        for creator in (None, secretary):
            OldTurn.objects.create(paciente=patient, medico=doctor, secretaria=creator,
                fecha=timezone.localdate(), hora=time(9 if creator is None else 10), duracion_turno=20)
        original = list(OldTurn.objects.order_by('pk').values())
        executor = MigrationExecutor(connection)
        executor.migrate(after)
        NewTurn = executor.loader.project_state(after).apps.get_model('dominio', 'Turno')
        updated = list(NewTurn.objects.order_by('pk').values())
        self.assertEqual(len(updated), len(original))
        for old, new in zip(original, updated):
            self.assertIsNone(new.pop('origen'))
            self.assertEqual(new, old)
