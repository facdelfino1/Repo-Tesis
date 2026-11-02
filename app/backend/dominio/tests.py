import secrets
from datetime import date, time
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase

from .models import Disponibilidad, Especialidad, Medico, Paciente, Secretaria, Triaje, Turno, Usuario


class EstructuraTests(SimpleTestCase):
    def test_manager_hashes_password_and_normalizes_email(self):
        password = secrets.token_urlsafe(24)
        with patch.object(Usuario, "save"):
            user = Usuario.objects.create_user("Persona@EXAMPLE.COM", password, rol=Usuario.Rol.PACIENTE)
        self.assertEqual(user.email, "persona@example.com")
        self.assertNotEqual(user.password, password)
        self.assertTrue(user.check_password(password))
        self.assertFalse(user.check_password(secrets.token_urlsafe(24)))

    def test_manager_rejects_unknown_role(self):
        with self.assertRaises(ValueError):
            Usuario.objects.create_user("persona@example.com", rol="OTRO")

    def test_superuser_requires_admin_role(self):
        with self.assertRaises(ValueError):
            Usuario.objects.create_superuser("persona@example.com", secrets.token_urlsafe(24), rol=Usuario.Rol.MEDICO)

    def test_profile_rejects_wrong_role(self):
        user = Usuario(pk=1, rol=Usuario.Rol.MEDICO)
        with self.assertRaises(ValidationError):
            Paciente(usuario=user).clean()

    def test_structured_answers(self):
        with self.assertRaises(ValidationError):
            Triaje(respuesta_sintomas=[]).clean()
        Triaje(respuesta_sintomas={"fiebre": True, "edad_meses": 3}).clean()

    def test_nullable_and_one_to_one_relations(self):
        self.assertTrue(Turno._meta.get_field("secretaria").null)
        self.assertTrue(Turno._meta.get_field("disponibilidad").null)
        self.assertTrue(Triaje._meta.get_field("turno").one_to_one)
        for model in (Paciente, Medico, Secretaria):
            self.assertTrue(model._meta.get_field("usuario").one_to_one)

    def test_clinical_data_is_not_duplicated_in_turn(self):
        fields = {field.name for field in Turno._meta.fields}
        self.assertFalse(fields & {"nivel_prioridad", "score", "puntaje_prioridad", "color_prioridad"})
        self.assertNotIn("duracion_turno", {field.name for field in Triaje._meta.fields})

    def test_creation_time_is_not_auto_updated(self):
        field = Turno._meta.get_field("fecha_hora_creacion")
        self.assertFalse(field.auto_now)
        self.assertTrue(callable(field.default))


class IntegridadPostgreSQLTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        def user(email, role):
            return Usuario.objects.create_user(email, secrets.token_urlsafe(24), rol=role,
                                               nombre="Prueba", apellido="Modelo", dni="100", telefono="100")

        cls.paciente = Paciente.objects.create(usuario=user("paciente@example.com", Usuario.Rol.PACIENTE))
        cls.especialidad = Especialidad.objects.create(nombre="Cardiologia")
        cls.medico = Medico.objects.create(usuario=user("medico@example.com", Usuario.Rol.MEDICO),
                                           matricula="TEST-1", especialidad=cls.especialidad)
        cls.secretaria = Secretaria.objects.create(usuario=user("secretaria@example.com", Usuario.Rol.SECRETARIA), legajo="TEST-1")

    def turno(self, **extra):
        return Turno.objects.create(paciente=self.paciente, medico=self.medico, fecha=date(2026, 11, 2),
                                    hora=time(9), duracion_turno=20, **extra)

    def test_unique_email_case_insensitive(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Usuario.objects.create(email="PACIENTE@EXAMPLE.COM", rol=Usuario.Rol.PACIENTE)

    def test_database_rejects_invalid_role(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Usuario.objects.create(email="otro@example.com", rol="OTRO")

    def test_profiles_and_specialty(self):
        self.assertEqual(self.paciente.usuario.paciente, self.paciente)
        self.assertEqual(self.medico.usuario.medico, self.medico)
        self.assertEqual(self.secretaria.usuario.secretaria, self.secretaria)
        self.assertEqual(self.medico.especialidad, self.especialidad)

    def test_profile_one_to_one(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Paciente.objects.create(usuario=self.paciente.usuario)

    def test_cardiology_without_triage_and_optional_links(self):
        turno = self.turno()
        self.assertIsNone(turno.secretaria_id)
        self.assertIsNone(turno.disponibilidad_id)
        self.assertFalse(Triaje.objects.filter(turno=turno).exists())

    def test_creation_timestamp_survives_update(self):
        turno = self.turno()
        created = turno.fecha_hora_creacion
        turno.estado = Turno.Estado.PENDIENTE
        turno.save()
        turno.refresh_from_db()
        self.assertEqual(turno.fecha_hora_creacion, created)

    def test_triage_one_to_one(self):
        turno = self.turno()
        values = {"turno": turno, "respuesta_sintomas": {"fiebre": True}, "nivel_prioridad": Triaje.Prioridad.MEDIA}
        Triaje.objects.create(**values)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Triaje.objects.create(**values)

    def test_positive_duration(self):
        turno = self.turno()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Turno.objects.filter(pk=turno.pk).update(duracion_turno=0)

    def test_availability_states(self):
        for hour, state in enumerate(Disponibilidad.Estado.values, start=9):
            slot = Disponibilidad.objects.create(medico=self.medico, fecha=date(2026, 11, 2),
                                                  hora_inicio=time(hour), hora_fin=time(hour, 20), estado=state)
            self.assertEqual(slot.estado, state)

    def test_reversed_interval_rejected(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Disponibilidad.objects.create(medico=self.medico, fecha=date(2026, 11, 2),
                                           hora_inicio=time(10), hora_fin=time(9))
