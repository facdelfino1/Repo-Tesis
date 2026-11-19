from datetime import date, time, timedelta

from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient, APITestCase

from .models import Disponibilidad, Paciente, Triaje, Turno, Usuario
from . import test_api
from .turnos import reservar_turno


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class GestionPacientesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_api.IdentityAPITests.setUpTestData.__func__(cls)
        cls.patient = cls.users['PACIENTE']
        cls.patient.fecha_nacimiento = date(1987, 3, 12)
        cls.patient.save(update_fields=['fecha_nacimiento'])

    setUp = test_api.IdentityAPITests.setUp
    csrf = test_api.IdentityAPITests.csrf
    post = test_api.IdentityAPITests.post
    login = test_api.IdentityAPITests.login

    def patch(self, url, data, client=None):
        client = client or self.client
        return client.patch(url, data, format='json', HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)

    def profile(self, data):
        return self.patch(reverse('auth-me'), data)

    def state_url(self, user=None):
        return reverse('paciente-administracion-detail', args=[(user or self.patient).pk])

    def test_edit_own_profile_persists_and_preserves_identity_security_fields(self):
        self.login('PACIENTE')
        before = Usuario.objects.get(pk=self.patient.pk)
        payload = dict(nombre='Ana', apellido='Nueva', telefono='3511234567', obra_social='Nueva cobertura')
        result = self.profile(payload)
        self.assertEqual(result.status_code, 200, result.data)
        user = Usuario.objects.get(pk=self.patient.pk)
        self.assertEqual((user.nombre, user.apellido, user.email, user.telefono), ('Ana', 'Nueva', before.email, '3511234567'))
        self.assertEqual(user.paciente.obra_social, 'Nueva cobertura')
        for key in ['dni', 'fecha_nacimiento', 'rol', 'password', 'is_active', 'intentos_fallidos', 'last_login']:
            self.assertEqual(getattr(user, key), getattr(before, key), key)
        self.assertEqual(result.data['perfil']['obra_social'], 'Nueva cobertura')
        self.assertEqual(result.data['fecha_nacimiento'], '1987-03-12')
        self.assertEqual(self.client.get(reverse('auth-me')).data, result.data)

    def test_add_change_remove_and_omit_optional_obra_social(self):
        self.login('PACIENTE')
        for value in ['Cobertura A', 'Cobertura B', '']:
            self.assertEqual(self.profile({'obra_social': value}).status_code, 200)
            self.assertEqual(Paciente.objects.get(usuario=self.patient).obra_social, value)
        self.assertEqual(self.profile({'nombre': 'Cambio'}).status_code, 200)
        self.assertEqual(Paciente.objects.get(usuario=self.patient).obra_social, '')

    def test_any_email_in_profile_payload_is_rejected_without_modifying_any_data(self):
        self.login('PACIENTE')
        before = Usuario.objects.filter(pk=self.patient.pk).values().get()
        profile_before = Paciente.objects.filter(usuario=self.patient).values().get()
        for email in ['nuevo@example.test', self.patient.email, self.patient.email.upper(),
                      self.users['MEDICO'].email, '', None, 'invalid']:
            with self.subTest(email=email):
                result = self.profile({'nombre': 'No guardar', 'email': email, 'obra_social': 'No guardar'})
                self.assertEqual(result.status_code, 400)
                self.assertIn('email', result.data)
                self.assertEqual(Usuario.objects.filter(pk=self.patient.pk).values().get(), before)
                self.assertEqual(Paciente.objects.filter(usuario=self.patient).values().get(), profile_before)

    def test_read_only_and_extra_fields_rejected_without_partial_writes(self):
        self.login('PACIENTE')
        for key, value in {'dni': self.patient.dni, 'fecha_nacimiento': None, 'rol': 'ADMINISTRADOR',
                           'id': self.users['MEDICO'].pk, 'is_active': False, 'password': 'Valid!123Az',
                           'perfil': {}, 'paciente': 99, 'intentos_fallidos': 0}.items():
            with self.subTest(key=key):
                result = self.profile({'nombre': 'No guardar', key: value})
                self.assertEqual(result.status_code, 400, result.data)
                self.assertIn(key, result.data)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.nombre, 'Persona')
        self.assertEqual(self.patient.fecha_nacimiento, date(1987, 3, 12))

    def test_profile_validation_and_object_input(self):
        self.login('PACIENTE')
        for data in [{'nombre': ''}, {'apellido': None}, {'email': 'invalid'}, {'telefono': 'abc'},
                     {'telefono': ''}, {'nombre': 'x' * 101}, {'telefono': '1' * 31}, {'obra_social': 'x' * 151},
                     {'obra_social': None}, []]:
            with self.subTest(data=data):
                self.assertEqual(self.profile(data).status_code, 400)

    def test_administrator_cannot_patch_me_and_patient_cannot_address_another_profile(self):
        self.assertEqual(self.client.patch(reverse('auth-me'), {}, format='json').status_code, 403)
        for role in ['ADMINISTRADOR']:
            self.login(role)
            self.assertEqual(self.profile({'nombre': 'No guardar'}).status_code, 403)
            self.assertEqual(self.client.get(reverse('auth-me')).status_code, 200)
        self.login('PACIENTE')
        other = self.users['MEDICO']
        self.assertEqual(self.patch(f'/api/auth/me/{other.pk}/', {'nombre': 'No guardar'}).status_code, 404)
        other.refresh_from_db()
        self.assertEqual(other.nombre, 'Persona')
        self.assertEqual(self.client.patch(reverse('auth-me'), {'nombre': 'Cambio'}, format='json').status_code, 403)

    def test_profile_edits_keep_login_recovery_and_existing_reset_token_unchanged(self):
        self.login('PACIENTE')
        old_email = self.patient.email
        old_token = default_token_generator.make_token(Usuario.objects.get(pk=self.patient.pk))
        self.assertEqual(self.profile({'nombre': 'Nuevo nombre', 'telefono': '1234567', 'obra_social': ''}).status_code, 200)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.email, old_email)
        self.assertTrue(default_token_generator.check_token(self.patient, old_token))
        self.assertEqual(self.post('auth-password-reset', {'email': old_email}).status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[-1].to, [old_email])
        anonymous = APIClient(enforce_csrf_checks=True)
        self.assertEqual(self.post('auth-login', {'email': old_email, 'password': self.password}, anonymous).status_code, 200)

    def test_admin_lists_active_and_inactive_patients_only(self):
        other = Usuario.objects.create_user('inactive@example.test', self.password, rol='PACIENTE', nombre='Otro', apellido='Paciente', dni='99', telefono='123', is_active=False)
        Paciente.objects.create(usuario=other)
        self.login()
        result = self.client.get(reverse('paciente-administracion-list'))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['count'], 2)
        self.assertEqual({row['rol'] for row in result.data['results']}, {'PACIENTE'})
        self.assertEqual({row['is_active'] for row in result.data['results']}, {True, False})
        self.assertNotIn('password', result.data['results'][0])
        self.assertEqual(self.client.get(self.state_url(self.users['MEDICO'])).status_code, 404)

    def test_admin_only_patient_state_api(self):
        self.assertEqual(self.client.get(reverse('paciente-administracion-list')).status_code, 403)
        for role in ['PACIENTE', 'MEDICO', 'SECRETARIA']:
            self.login(role)
            self.assertEqual(self.client.get(reverse('paciente-administracion-list')).status_code, 403)
            self.assertEqual(self.patch(self.state_url(), {'is_active': False}).status_code, 403)
        self.patient.refresh_from_db()
        self.assertTrue(self.patient.is_active)

    def test_admin_patient_api_cannot_create_delete_or_edit_other_fields(self):
        self.login()
        for data in [{'email': 'another@example.test'}, {'nombre': 'Cambio', 'is_active': False}, {'dni': '5'}, {}, []]:
            self.assertEqual(self.patch(self.state_url(), data).status_code, 400)
        self.assertEqual(self.client.post(reverse('paciente-administracion-list'), {}, format='json', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value).status_code, 405)
        self.assertEqual(self.client.put(self.state_url(), {'is_active': False}, format='json', HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value).status_code, 405)
        self.assertEqual(self.client.delete(self.state_url(), HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value).status_code, 405)
        self.assertEqual(self.client.patch(self.state_url(), {'is_active': False}, format='json').status_code, 403)
        self.patient.refresh_from_db()
        self.assertTrue(self.patient.is_active)

    def test_deactivation_blocks_existing_sessions_login_operations_and_recovery(self):
        patient_client = APIClient(enforce_csrf_checks=True)
        self.login('PACIENTE', patient_client)
        token = default_token_generator.make_token(Usuario.objects.get(pk=self.patient.pk))
        self.login()
        before = Usuario.objects.get(pk=self.patient.pk)
        result = self.patch(self.state_url(), {'is_active': False})
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.data['is_active'])
        for url in [reverse('auth-me'), reverse('turno-list')]:
            self.assertEqual(patient_client.get(url).status_code, 403)
        self.assertEqual(self.patch(reverse('auth-me'), {'nombre': 'No guardar'}, patient_client).status_code, 403)
        self.assertEqual(self.post('auth-password', {'password_actual': self.password, 'password_nueva': 'Valid!123Az', 'password_confirmacion': 'Valid!123Az'}, patient_client).status_code, 403)
        self.assertEqual(self.post('auth-login', {'email': self.patient.email, 'password': self.password}, patient_client).status_code, 401)
        self.assertEqual(self.post('auth-password-reset', {'email': self.patient.email}, patient_client).status_code, 200)
        self.assertEqual(len(mail.outbox), 0)
        result = self.post('auth-password-reset-confirm', {'uid': urlsafe_base64_encode(force_bytes(self.patient.pk)), 'token': token, 'password_nueva': 'Valid!123Az', 'password_confirmacion': 'Valid!123Az'}, patient_client)
        self.assertEqual(result.status_code, 400)
        self.patient.refresh_from_db()
        self.assertFalse(self.patient.is_active)
        self.assertEqual(self.patient.password, before.password)

    def test_reactivation_preserves_profile_and_restores_recovery(self):
        self.login()
        before = Usuario.objects.get(pk=self.patient.pk)
        self.assertEqual(self.patch(self.state_url(), {'is_active': False}).status_code, 200)
        self.assertEqual(self.patch(self.state_url(), {'is_active': True}).status_code, 200)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.password, before.password)
        self.assertEqual(self.patient.paciente.pk, before.paciente.pk)
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(self.post('auth-password-reset', {'email': self.patient.email}, client).status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        user = Usuario.objects.get(pk=self.patient.pk)
        result = self.post('auth-password-reset-confirm', {'uid': urlsafe_base64_encode(force_bytes(user.pk)), 'token': default_token_generator.make_token(user), 'password_nueva': 'Valid!123Az', 'password_confirmacion': 'Valid!123Az'}, client)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.post('auth-login', {'email': user.email, 'password': 'Valid!123Az'}, client).status_code, 200)

    def test_future_turn_and_triage_are_preserved_and_still_visible_to_professionals(self):
        doctor = self.users['MEDICO'].medico
        block = Disponibilidad.objects.create(medico=doctor, fecha=timezone.localdate() + timedelta(days=2), hora_inicio=time(9), hora_fin=time(9, 25))
        turn = reservar_turno(self.patient, doctor.pk, block.pk, {'fiebre': False, 'dificultadRespirar': False, 'dolor': 4})
        snapshot = Turno.objects.filter(pk=turn.pk).values().get()
        triage = Triaje.objects.filter(turno=turn).values().get()
        self.login()
        self.assertEqual(self.patch(self.state_url(), {'is_active': False}).status_code, 200)
        self.assertEqual(Turno.objects.filter(pk=turn.pk).values().get(), snapshot)
        self.assertEqual(Triaje.objects.filter(turno=turn).values().get(), triage)
        block.refresh_from_db()
        self.assertEqual(block.estado, 'OCUPADO')
        for role in ['MEDICO', 'SECRETARIA']:
            self.login(role)
            result = self.client.get(reverse('turno-agenda-detail', kwargs={'medico_pk': doctor.pk, 'pk': turn.pk}))
            self.assertEqual(result.status_code, 200, result.data)
        self.assertTrue(Paciente.objects.filter(usuario=self.patient).exists())
