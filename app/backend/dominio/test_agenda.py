import importlib
import secrets
from datetime import datetime, time, timedelta
from unittest.mock import patch

from django.apps import apps
from django.core.cache import cache
from django.db import connection
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import APIException
from rest_framework.test import APIClient, APITestCase

from . import test_api, test_password_reset
from .agenda import create_blocks, set_blocked, update_block
from .models import Disponibilidad, Especialidad, Medico, Paciente, Turno, Usuario
from .serializers import UsuarioInternoSerializer


class AgendaAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_api.IdentityAPITests.setUpTestData.__func__(cls)
        cls.doctor = cls.users[Usuario.Rol.MEDICO].medico
        other = Usuario.objects.create_user("otro-medico@example.com", secrets.token_urlsafe(24), rol="MEDICO",
                                            nombre="Otro", apellido="Médico", dni="999", telefono="3515551234")
        cls.other_doctor = Medico.objects.create(usuario=other, matricula="MP-OTHER", especialidad=cls.especialidad)
        cls.pediatria = Especialidad.objects.get(nombre="Pediatría")
        cls.day = timezone.localdate() + timedelta(days=2)

    csrf = test_api.IdentityAPITests.csrf

    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)
        self.as_role("SECRETARIA")

    def as_role(self, role):
        self.client.force_login(self.users[role], backend="dominio.authentication.CuentaBackend")
        self.csrf()

    def url(self, action="list", doctor=None, block=None):
        kwargs = {"medico_pk": (doctor or self.doctor).pk}
        if block is not None:
            kwargs["pk"] = block.pk
        return reverse("disponibilidad-" + action, kwargs=kwargs)

    def write(self, method, url, data=None):
        return getattr(self.client, method)(url, data or {}, format="json",
                                            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)

    def data(self, start="09:00", end="09:20", day=None):
        return {"fecha": (day or self.day).isoformat(), "hora_inicio": start, "hora_fin": end}

    def slot(self, doctor=None, start=time(9), end=time(9, 20), state="DISPONIBLE", day=None):
        return Disponibilidad.objects.create(medico=doctor or self.doctor, fecha=day or self.day,
                                              hora_inicio=start, hora_fin=end, estado=state)

    def historical_turn(self, block=None, state="CANCELADO"):
        return Turno.objects.create(paciente=self.users["PACIENTE"].paciente, medico=self.doctor,
                                    disponibilidad=block, fecha=block.fecha if block else self.day,
                                    hora=block.hora_inicio if block else time(9), duracion_turno=20, estado=state)

    def test_initial_catalog_is_present_idempotent_and_read_only(self):
        required = {"Clínica Médica", "Pediatría", "Cardiología"}
        before = dict(Especialidad.objects.filter(nombre__in=required).values_list("nombre", "pk"))
        self.assertEqual(set(before), required)
        migration = importlib.import_module("dominio.migrations.0003_catalogo_especialidades")
        with connection.schema_editor(atomic=False) as editor:
            migration.provisionar_especialidades(apps, editor)
            migration.provisionar_especialidades(apps, editor)
        self.assertEqual(before, dict(Especialidad.objects.filter(nombre__in=required).values_list("nombre", "pk")))
        for role in Usuario.Rol.values:
            self.as_role(role)
            response = self.client.get(reverse("catalogo-especialidad-list"))
            self.assertEqual(response.status_code, 200)
            self.assertTrue(required <= {row["nombre"] for row in response.data["results"]})
            self.assertIn(self.write("post", reverse("catalogo-especialidad-list"), {"nombre": "Otra"}).status_code, (403, 405))

    def test_anonymous_and_administrative_catalog_compatibility(self):
        self.client.logout()
        for url in (reverse("catalogo-especialidad-list"), reverse("medico-list"), self.url()):
            self.assertEqual(self.client.get(url).status_code, 403)
        self.as_role("ADMINISTRADOR")
        self.assertEqual(self.client.get(reverse("especialidad-list")).status_code, 200)
        self.as_role("PACIENTE")
        self.assertEqual(self.client.get(reverse("especialidad-list")).status_code, 403)

    def test_doctor_directory_filter_and_safe_serialization(self):
        for role in Usuario.Rol.values:
            self.as_role(role)
            response = self.client.get(reverse("medico-list"), {"especialidad": self.especialidad.pk})
            self.assertEqual(response.status_code, 200)
            self.assertEqual({row["id"] for row in response.data["results"]}, {self.doctor.pk, self.other_doctor.pk})
            for row in response.data["results"]:
                self.assertEqual(set(row), {"id", "nombre", "apellido", "matricula", "especialidad"})
            self.assertEqual(self.client.get(reverse("medico-detail", args=[self.doctor.pk])).status_code, 200)
        self.assertEqual(self.client.get(reverse("medico-list"), {"especialidad": "inválida"}).status_code, 400)

    def test_inactive_doctors_are_hidden_from_patient(self):
        Usuario.objects.filter(pk=self.other_doctor.usuario_id).update(is_active=False)
        self.as_role("PACIENTE")
        response = self.client.get(reverse("medico-list"))
        self.assertNotIn(self.other_doctor.pk, [row["id"] for row in response.data["results"]])
        self.assertEqual(self.client.get(reverse("medico-list"), {"incluir_inactivos": "true"}).status_code, 403)
        self.assertEqual(self.client.get(reverse("medico-detail", args=[self.other_doctor.pk])).status_code, 404)
        self.as_role("SECRETARIA")
        response = self.client.get(reverse("medico-list"), {"incluir_inactivos": "true"})
        self.assertIn(self.other_doctor.pk, [row["id"] for row in response.data["results"]])

    def test_role_matrix_for_reading_and_creating_availability(self):
        block = self.slot()
        for role, readable, writable in (("PACIENTE", 200, 403), ("MEDICO", 200, 201),
                                          ("SECRETARIA", 200, 201), ("ADMINISTRADOR", 403, 403)):
            self.as_role(role)
            self.assertEqual(self.client.get(self.url()).status_code, readable)
            self.assertEqual(self.client.get(self.url("detail", block=block)).status_code, readable)
            data = self.data("10:00", "10:20") if role == "MEDICO" else self.data("11:00", "11:20")
            self.assertEqual(self.write("post", self.url(), data).status_code, writable)

    def test_patient_and_admin_cannot_write_any_agenda_action(self):
        block = self.slot()
        for role in ("PACIENTE", "ADMINISTRADOR"):
            self.as_role(role)
            for action in ("bloquear", "desbloquear"):
                self.assertEqual(self.write("post", self.url(action, block=block)).status_code, 403)
            self.assertEqual(self.write("patch", self.url("detail", block=block), {"hora_fin": "10:00"}).status_code, 403)
            self.assertEqual(self.write("delete", self.url("detail", block=block)).status_code, 403)
            self.assertEqual(self.write("post", self.url("lote"), {"bloques": [self.data("10:00", "10:20")]}).status_code, 403)
        block.refresh_from_db()
        self.assertEqual(block.estado, "DISPONIBLE")

    def test_doctor_cannot_access_other_agenda_or_confuse_user_id_with_doctor_id(self):
        block = self.slot(doctor=self.other_doctor)
        self.as_role("MEDICO")
        self.assertNotEqual(self.doctor.pk, self.doctor.usuario_id)
        self.assertEqual(self.client.get(self.url(doctor=self.other_doctor)).status_code, 404)
        self.assertEqual(self.write("post", self.url(doctor=self.other_doctor), self.data()).status_code, 404)
        for action in ("bloquear", "desbloquear"):
            self.assertEqual(self.write("post", self.url(action, doctor=self.other_doctor, block=block)).status_code, 404)
        self.assertEqual(self.write("patch", self.url("detail", doctor=self.other_doctor, block=block), {"hora_fin": "10:00"}).status_code, 404)
        self.assertEqual(self.write("delete", self.url("detail", doctor=self.other_doctor, block=block)).status_code, 404)

    def test_nested_foreign_block_id_is_rejected_even_for_secretary(self):
        block = self.slot(doctor=self.other_doctor)
        self.assertEqual(self.client.get(self.url("detail", block=block)).status_code, 404)
        self.assertEqual(self.write("patch", self.url("detail", block=block), {"hora_fin": "10:00"}).status_code, 404)
        self.assertEqual(self.write("post", self.url("bloquear", block=block)).status_code, 404)
        self.assertEqual(self.write("delete", self.url("detail", block=block)).status_code, 404)
        invalid = f"/api/medicos/{self.doctor.pk}/disponibilidades/invalido/"
        self.assertEqual(self.write("patch", invalid, {"hora_fin": "10:00"}).status_code, 404)
        self.assertEqual(self.write("post", invalid + "bloquear/").status_code, 404)
        self.assertEqual(self.client.get("/api/medicos/invalido/").status_code, 404)

    def test_creation_calculates_duration_without_clinical_fields(self):
        response = self.write("post", self.url(), self.data("09:00", "09:35"))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["duracion_minutos"], 35)
        self.assertEqual(response.data["medico"], self.doctor.pk)
        self.assertEqual(response.data["estado"], "DISPONIBLE")
        self.assertEqual(set(response.data), {"id", "medico", "fecha", "hora_inicio", "hora_fin", "estado", "duracion_minutos"})

    def test_duplicates_partial_overlap_and_both_containments_are_rejected(self):
        self.slot(start=time(9), end=time(10))
        for start, end in (("09:00", "10:00"), ("09:30", "10:30"), ("09:10", "09:20"), ("08:30", "10:30")):
            self.assertEqual(self.write("post", self.url(), self.data(start, end)).status_code, 409)
        self.assertEqual(Disponibilidad.objects.count(), 1)

    def test_adjacent_blocks_and_same_interval_on_another_doctor_are_allowed(self):
        self.slot()
        for data in (self.data("08:40", "09:00"), self.data("09:20", "09:40")):
            self.assertEqual(self.write("post", self.url(), data).status_code, 201)
        self.assertEqual(self.write("post", self.url(doctor=self.other_doctor), self.data()).status_code, 201)

    def test_all_existing_states_participate_in_overlap_check(self):
        block = self.slot()
        for state in Disponibilidad.Estado.values:
            Disponibilidad.objects.filter(pk=block.pk).update(estado=state)
            self.assertEqual(self.write("post", self.url(), self.data("09:10", "09:30")).status_code, 409)

    def test_invalid_intervals_precision_and_past_are_rejected(self):
        for data in (self.data("09:20", "09:00"), self.data("09:00", "09:00"),
                     self.data("23:00", "01:00"), self.data("09:00:30", "09:20"),
                     self.data(day=timezone.localdate() - timedelta(days=1)), self.data("invalida", "09:20")):
            self.assertEqual(self.write("post", self.url(), data).status_code, 400)
        self.assertFalse(Disponibilidad.objects.exists())

    def test_identity_state_and_duration_cannot_be_written(self):
        for field, value in (("medico", self.other_doctor.pk), ("especialidad", self.pediatria.pk),
                             ("estado", "OCUPADO"), ("estado", "BLOQUEADO"), ("duracion_minutos", 20), ("id", 99)):
            self.assertEqual(self.write("post", self.url(), {**self.data(), field: value}).status_code, 400)
        block = self.slot()
        for field, value in (("medico", self.other_doctor.pk), ("estado", "OCUPADO"), ("especialidad", self.pediatria.pk)):
            self.assertEqual(self.write("patch", self.url("detail", block=block), {field: value}).status_code, 400)

    def test_patch_uses_current_fields_and_preserves_identity_and_state(self):
        block = self.slot(state="BLOQUEADO")
        response = self.write("patch", self.url("detail", block=block), {"hora_fin": "09:40"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["duracion_minutos"], 40)
        block.refresh_from_db()
        self.assertEqual(block.hora_inicio, time(9))
        self.assertEqual(block.hora_fin, time(9, 40))
        self.assertEqual(block.estado, "BLOQUEADO")
        self.assertEqual(block.medico_id, self.doctor.pk)
        self.assertEqual(self.write("patch", self.url("detail", block=block), {"hora_inicio": "10:00"}).status_code, 400)
        self.assertEqual(self.client.put(self.url("detail", block=block), {}, format="json",
                                         HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value).status_code, 405)

    def test_patch_cannot_overlap_another_block(self):
        block = self.slot()
        self.slot(start=time(9, 40), end=time(10))
        self.assertEqual(self.write("patch", self.url("detail", block=block), {"hora_fin": "09:50"}).status_code, 409)
        block.refresh_from_db()
        self.assertEqual(block.hora_fin, time(9, 20))

    def test_block_unblock_is_explicit_and_idempotent(self):
        block = self.slot()
        for action, expected in (("bloquear", "BLOQUEADO"), ("bloquear", "BLOQUEADO"), ("desbloquear", "DISPONIBLE")):
            response = self.write("post", self.url(action, block=block))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["estado"], expected)
        self.assertEqual(self.write("post", self.url("bloquear", block=block), {"estado": "OCUPADO"}).status_code, 400)

    def test_occupied_block_cannot_be_edited_blocked_unblocked_or_deleted(self):
        block = self.slot(state="OCUPADO")
        for action in ("bloquear", "desbloquear"):
            self.assertEqual(self.write("post", self.url(action, block=block)).status_code, 409)
        self.assertEqual(self.write("patch", self.url("detail", block=block), {"hora_fin": "09:40"}).status_code, 409)
        self.assertEqual(self.write("delete", self.url("detail", block=block)).status_code, 409)

    def test_any_turn_history_prevents_date_time_changes_and_deletion(self):
        block = self.slot()
        turn = self.historical_turn(block)
        for state in Turno.Estado.values:
            Turno.objects.filter(pk=turn.pk).update(estado=state)
            self.assertEqual(self.write("patch", self.url("detail", block=block), {"hora_fin": "09:40"}).status_code, 409)
            self.assertEqual(self.write("delete", self.url("detail", block=block)).status_code, 409)
        self.assertTrue(Turno.objects.filter(pk=turn.pk).exists())

    def test_blocking_free_configuration_preserves_cancelled_history(self):
        block = self.slot()
        turn = self.historical_turn(block)
        self.assertEqual(self.write("post", self.url("bloquear", block=block)).status_code, 200)
        turn.refresh_from_db()
        self.assertEqual(turn.estado, "CANCELADO")
        self.assertEqual(turn.disponibilidad_id, block.pk)

    def test_delete_only_unused_future_blocks_and_no_implicit_creation(self):
        for state in ("DISPONIBLE", "BLOQUEADO"):
            block = self.slot(state=state)
            self.assertEqual(self.write("delete", self.url("detail", block=block)).status_code, 204)
        self.assertEqual(self.client.get(self.url()).data["count"], 0)
        self.assertEqual(Disponibilidad.objects.count(), 0)

    def test_professionals_can_read_history_without_mutating_it(self):
        block = self.slot(day=timezone.localdate() - timedelta(days=2))
        self.assertEqual(self.client.get(self.url("detail", block=block)).status_code, 200)
        self.assertEqual(self.write("delete", self.url("detail", block=block)).status_code, 400)
        self.assertEqual(self.write("patch", self.url("detail", block=block), self.data()).status_code, 400)
        self.assertEqual(self.write("post", self.url("bloquear", block=block)).status_code, 400)

    def test_patient_sees_only_future_available_blocks_and_cannot_expand_filter(self):
        free = self.slot()
        hidden = [self.slot(start=time(10), end=time(10, 20), state="BLOQUEADO"),
                  self.slot(start=time(11), end=time(11, 20), state="OCUPADO"),
                  self.slot(day=timezone.localdate() - timedelta(days=1))]
        self.as_role("PACIENTE")
        self.assertEqual([row["id"] for row in self.client.get(self.url()).data["results"]], [free.pk])
        for block in hidden:
            self.assertEqual(self.client.get(self.url("detail", block=block)).status_code, 404)
        self.assertEqual(self.client.get(self.url(), {"estado": "OCUPADO"}).data["count"], 0)
        self.assertEqual(self.client.get(self.url(), {"fecha": hidden[-1].fecha.isoformat()}).data["count"], 0)

    def test_futuros_filter_uses_server_time_for_assignable_blocks(self):
        today = timezone.localdate()
        now = timezone.make_aware(datetime.combine(today, time(10)))
        past = self.slot(day=today, start=time(9), end=time(9, 20))
        future = self.slot(day=today, start=time(11), end=time(11, 20))
        tomorrow = self.slot(day=today + timedelta(days=1), start=time(9), end=time(9, 20))
        blocked = self.slot(day=today, start=time(12), end=time(12, 20), state='BLOQUEADO')
        with patch('dominio.views.timezone.localtime', return_value=now):
            for role in ('SECRETARIA', 'MEDICO', 'PACIENTE'):
                self.as_role(role)
                response = self.client.get(self.url(), {'estado': 'DISPONIBLE', 'futuros': 'true'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual([row['id'] for row in response.data['results']], [future.pk, tomorrow.pk])
                self.assertNotIn(past.pk, [row['id'] for row in response.data['results']])
                self.assertNotIn(blocked.pk, [row['id'] for row in response.data['results']])
            self.assertEqual(self.client.get(self.url(), {'futuros': 'invalid'}).status_code, 400)

    def test_turn_listing_marks_future_by_server_time_without_changing_state(self):
        today = timezone.localdate()
        now = timezone.make_aware(datetime.combine(today, time(10)))
        overdue = Turno.objects.create(paciente=self.users['PACIENTE'].paciente, medico=self.doctor,
            fecha=today-timedelta(days=1), hora=time(9), duracion_turno=20, estado='RESERVADO')
        upcoming = Turno.objects.create(paciente=self.users['PACIENTE'].paciente, medico=self.doctor,
            fecha=today, hora=time(11), duracion_turno=20, estado='RESERVADO')
        self.as_role('PACIENTE')
        with patch('dominio.serializers.timezone.localtime', return_value=now):
            response = self.client.get(reverse('turno-list'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual([(row['id_turno'], row['horario_futuro']) for row in response.data['results']],
                         [(overdue.pk, False), (upcoming.pk, True)])
        self.assertEqual([row['estado'] for row in response.data['results']], ['RESERVADO', 'RESERVADO'])

    def test_patient_cannot_query_inactive_doctor_but_secretary_can_read_history(self):
        self.slot(doctor=self.other_doctor)
        Usuario.objects.filter(pk=self.other_doctor.usuario_id).update(is_active=False)
        self.as_role("PACIENTE")
        self.assertEqual(self.client.get(self.url(doctor=self.other_doctor)).status_code, 404)
        self.as_role("SECRETARIA")
        self.assertEqual(self.client.get(self.url(doctor=self.other_doctor)).status_code, 200)
        self.assertEqual(self.write("post", self.url(doctor=self.other_doctor), self.data("10:00", "10:20")).status_code, 400)

    def test_date_and_state_filters_are_validated(self):
        self.slot()
        for filters in ({"fecha": "inválida"}, {"estado": "OTRO"},
                        {"desde": self.day.isoformat(), "hasta": "2000-01-01"},
                        {"fecha": self.day.isoformat(), "desde": self.day.isoformat()}):
            self.assertEqual(self.client.get(self.url(), filters).status_code, 400)
        response = self.client.get(self.url(), {"desde": self.day.isoformat(), "hasta": self.day.isoformat(), "estado": "DISPONIBLE"})
        self.assertEqual(response.data["count"], 1)

    def test_batch_is_atomic_and_returns_explicit_blocks(self):
        response = self.write("post", self.url("lote"), {"bloques": [self.data(), self.data("09:20", "09:40")]})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(Disponibilidad.objects.count(), 2)

    def test_batch_conflict_with_existing_or_own_entries_rolls_back_everything(self):
        existing = self.slot(start=time(10), end=time(10, 20))
        response = self.write("post", self.url("lote"), {"bloques": [self.data(), self.data("10:10", "10:30")]})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(list(Disponibilidad.objects.values_list("pk", flat=True)), [existing.pk])
        response = self.write("post", self.url("lote"), {"bloques": [self.data(), self.data("09:10", "09:30")]})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Disponibilidad.objects.count(), 1)

    def test_empty_invalid_and_identity_bearing_batches_are_rejected(self):
        for data in ({"bloques": []}, {"bloques": [self.data(), self.data("09:30", "09:00")]},
                     {"bloques": [{**self.data(), "estado": "OCUPADO"}]}, {"bloques": [self.data()], "medico": 99}):
            self.assertEqual(self.write("post", self.url("lote"), data).status_code, 400)
        self.assertEqual(Disponibilidad.objects.count(), 0)

    def test_specialty_can_change_only_without_availability_or_turn_history(self):
        self.as_role("ADMINISTRADOR")
        user = self.users["MEDICO"]
        url = reverse("usuario-interno-detail", args=[user.pk])
        response = self.write("patch", url, {"especialidad": self.pediatria.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["perfil"]["especialidad"]["id"], self.pediatria.pk)
        block = self.slot(day=timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.write("patch", url, {"especialidad": self.especialidad.pk}).status_code, 400)
        self.assertEqual(self.write("patch", url, {"especialidad": self.pediatria.pk}).status_code, 200)
        self.assertEqual(self.write("patch", url, {"nombre": "Editado"}).status_code, 200)
        block.delete()  # Fixture only; an API never deletes a historical block.
        self.historical_turn()
        self.assertEqual(self.write("patch", url, {"especialidad": self.especialidad.pk}).status_code, 400)

    def test_csrf_is_required_for_agenda_writes(self):
        self.assertEqual(self.client.post(self.url(), self.data(), format="json").status_code, 403)
        block = self.slot()
        self.assertEqual(self.client.patch(self.url("detail", block=block), {"hora_fin": "10:00"}, format="json").status_code, 403)
        self.assertEqual(self.client.post(self.url("bloquear", block=block), {}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(self.url("detail", block=block)).status_code, 403)


class AgendaConcurrencyTests(TransactionTestCase):
    parallel = test_password_reset.PasswordConcurrencyTests.parallel

    def setUp(self):
        cache.clear()
        self.specialty, _ = Especialidad.objects.get_or_create(nombre="Clínica Médica")
        self.other_specialty, _ = Especialidad.objects.get_or_create(nombre="Pediatría")
        self.user = Usuario.objects.create_user("agenda@example.com", secrets.token_urlsafe(24), rol="MEDICO",
                                                nombre="Agenda", apellido="Prueba", dni="1", telefono="123")
        self.doctor = Medico.objects.create(usuario=self.user, matricula="CONCURRENT", especialidad=self.specialty)
        self.day = timezone.localdate() + timedelta(days=2)

    def data(self, start=time(9), end=time(9, 20)):
        return {"fecha": self.day, "hora_inicio": start, "hora_fin": end}

    def create(self, blocks):
        try:
            create_blocks(self.user, self.doctor.pk, blocks)
            return 201
        except APIException as error:
            return error.status_code

    def test_overlap_racing_on_initially_empty_agenda(self):
        result = self.parallel([lambda: self.create([self.data()]),
                                lambda: self.create([self.data(time(9, 10), time(9, 30))])])
        self.assertEqual(sorted(result), [201, 409])
        self.assertEqual(Disponibilidad.objects.count(), 1)

    def test_duplicate_racing_on_empty_agenda(self):
        self.assertEqual(sorted(self.parallel([lambda: self.create([self.data()])] * 2)), [201, 409])
        self.assertEqual(Disponibilidad.objects.count(), 1)

    def test_overlapping_batches_cannot_be_partially_committed(self):
        first = [self.data(), self.data(time(9, 20), time(9, 40))]
        second = [self.data(time(9, 30), time(9, 50)), self.data(time(9, 50), time(10, 10))]
        self.assertEqual(sorted(self.parallel([lambda: self.create(first), lambda: self.create(second)])), [201, 409])
        self.assertEqual(Disponibilidad.objects.count(), 2)

    def test_specialty_change_racing_with_first_block_rechecks_under_lock(self):
        def change_specialty():
            user = Usuario.objects.get(pk=self.user.pk)
            serializer = UsuarioInternoSerializer(user, data={"especialidad": self.other_specialty.pk}, partial=True)
            try:
                serializer.is_valid(raise_exception=True)
                serializer.save()
                return 200
            except APIException as error:
                return error.status_code

        create_status, edit_status = self.parallel([lambda: self.create([self.data()]), change_specialty])
        self.assertEqual(create_status, 201)
        self.assertIn(edit_status, (200, 400))
        self.doctor.refresh_from_db()
        self.assertEqual(self.doctor.especialidad_id, self.other_specialty.pk if edit_status == 200 else self.specialty.pk)
        self.assertEqual(Disponibilidad.objects.get().medico_id, self.doctor.pk)

    def test_patch_and_block_do_not_restore_stale_state(self):
        block = Disponibilidad.objects.create(medico=self.doctor, **self.data())

        def patch():
            update_block(self.user, self.doctor.pk, block.pk, {"hora_fin": time(9, 40)})

        def block_it():
            set_blocked(self.user, self.doctor.pk, block.pk, blocked=True)

        self.parallel([patch, block_it])
        block.refresh_from_db()
        self.assertEqual(block.estado, "BLOQUEADO")
        self.assertEqual(block.hora_fin, time(9, 40))
