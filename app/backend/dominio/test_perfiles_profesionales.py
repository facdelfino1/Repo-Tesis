from datetime import date

from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from . import test_api
from .models import Usuario


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class PerfilesProfesionalesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_api.IdentityAPITests.setUpTestData.__func__(cls)
        for role in ['MEDICO', 'SECRETARIA']:
            user = cls.users[role]
            user.fecha_nacimiento = date(1987, 3, 12)
            user.save(update_fields=['fecha_nacimiento'])

    setUp = test_api.IdentityAPITests.setUp
    csrf = test_api.IdentityAPITests.csrf
    post = test_api.IdentityAPITests.post
    login = test_api.IdentityAPITests.login

    def patch(self, data, url=None, csrf=True):
        kwargs = {'HTTP_X_CSRFTOKEN': self.client.cookies['csrftoken'].value} if csrf else {}
        return self.client.patch(url or reverse('auth-me'), data, format='json', **kwargs)

    def test_both_roles_update_only_personal_data_and_get_persisted_profile(self):
        for role in ['MEDICO', 'SECRETARIA']:
            with self.subTest(role=role):
                self.login(role)
                user = self.users[role]
                before = Usuario.objects.filter(pk=user.pk).values().get()
                profile = user.medico if role == 'MEDICO' else user.secretaria
                profile_before = type(profile).objects.filter(pk=profile.pk).values().get()
                data = {'nombre': 'Nuevo', 'apellido': 'Nombre', 'telefono': '3511234567'}
                response = self.patch(data)
                self.assertEqual(response.status_code, 200, response.data)
                user.refresh_from_db()
                for key, value in data.items():
                    self.assertEqual(getattr(user, key), value)
                after = Usuario.objects.filter(pk=user.pk).values().get()
                self.assertEqual({key: value for key, value in after.items() if key not in data},
                                 {key: value for key, value in before.items() if key not in data})
                self.assertEqual(type(profile).objects.filter(pk=profile.pk).values().get(), profile_before)
                self.assertEqual(self.client.get(reverse('auth-me')).data, response.data)
                self.assertEqual(response.data['fecha_nacimiento'], '1987-03-12')

    def test_protected_and_unknown_fields_rejected_atomically_for_both_roles(self):
        for role in ['MEDICO', 'SECRETARIA']:
            self.login(role)
            user = self.users[role]
            before = Usuario.objects.filter(pk=user.pk).values().get()
            profile = user.medico if role == 'MEDICO' else user.secretaria
            profile_before = type(profile).objects.filter(pk=profile.pk).values().get()
            for key, value in {'email': 'otro@example.test', 'dni': '999', 'fecha_nacimiento': None,
                               'matricula': 'OTRA', 'especialidad': self.especialidad.pk, 'legajo': 'OTRO',
                               'id': self.users['PACIENTE'].pk, 'usuario': self.users['PACIENTE'].pk,
                               'perfil': {}, 'rol': 'ADMINISTRADOR', 'is_active': False,
                               'password': 'Valid!123Az', 'obra_social': 'No permitida'}.items():
                with self.subTest(role=role, key=key):
                    response = self.patch({'nombre': 'No guardar', key: value})
                    self.assertEqual(response.status_code, 400, response.data)
                    self.assertIn(key, response.data)
                    self.assertEqual(Usuario.objects.filter(pk=user.pk).values().get(), before)
                    self.assertEqual(type(profile).objects.filter(pk=profile.pk).values().get(), profile_before)

    def test_invalid_input_does_not_partially_update(self):
        for role in ['MEDICO', 'SECRETARIA']:
            self.login(role)
            user = self.users[role]
            before = Usuario.objects.filter(pk=user.pk).values().get()
            for data in [{'nombre': ''}, {'nombre': ' '}, {'apellido': None}, {'apellido': 'x' * 101},
                         {'nombre': 'No guardar', 'telefono': 'abc'}, {'telefono': '１２３'},
                         {'telefono': ''}, {'telefono': '1' * 31}, []]:
                with self.subTest(role=role, data=data):
                    self.assertEqual(self.patch(data).status_code, 400)
                    self.assertEqual(Usuario.objects.filter(pk=user.pk).values().get(), before)

    def test_self_only_no_other_account_url_no_admin_edit_and_csrf_required(self):
        for role in ['MEDICO', 'SECRETARIA']:
            self.login(role)
            target = self.users['SECRETARIA' if role == 'MEDICO' else 'MEDICO']
            before = Usuario.objects.filter(pk=target.pk).values().get()
            self.assertEqual(self.patch({'nombre': 'No guardar'}, f'/api/auth/me/{target.pk}/').status_code, 404)
            self.assertEqual(self.patch({'nombre': 'No guardar'}, reverse('usuario-interno-detail', args=[target.pk])).status_code, 403)
            self.assertEqual(self.patch({'nombre': 'No guardar'}, csrf=False).status_code, 403)
            self.assertEqual(Usuario.objects.filter(pk=target.pk).values().get(), before)

    def test_anonymous_administrator_and_inactive_accounts_cannot_edit(self):
        self.assertEqual(self.client.patch(reverse('auth-me'), {}, format='json').status_code, 403)
        self.login('ADMINISTRADOR')
        self.assertEqual(self.patch({'nombre': 'No guardar'}).status_code, 403)
        for role in ['MEDICO', 'SECRETARIA']:
            self.login(role)
            user = self.users[role]
            Usuario.objects.filter(pk=user.pk).update(is_active=False)
            self.assertEqual(self.patch({'nombre': 'No guardar'}).status_code, 403)
            user.refresh_from_db()
            self.assertEqual(user.nombre, 'Persona')

    def test_password_change_remains_independent_for_both_roles(self):
        for role in ['MEDICO', 'SECRETARIA']:
            self.login(role)
            self.assertEqual(self.patch({'nombre': 'Guardado'}).status_code, 200)
            new_password = 'Nueva!Clave4827Az'
            response = self.post('auth-password', {'password_actual': self.password,
                'password_nueva': new_password, 'password_confirmacion': new_password})
            self.assertEqual(response.status_code, 200, response.data)
            user = Usuario.objects.get(pk=self.users[role].pk)
            self.assertEqual(user.nombre, 'Guardado')
            self.assertTrue(user.check_password(new_password))
            self.assertEqual(self.client.get(reverse('auth-me')).status_code, 200)
            self.assertEqual(self.post('auth-login', {'email': user.email, 'password': new_password}).status_code, 200)

    def test_profile_update_preserves_email_and_recovery_token(self):
        for role in ['MEDICO', 'SECRETARIA']:
            self.login(role)
            user = Usuario.objects.get(pk=self.users[role].pk)
            token = default_token_generator.make_token(user)
            original_email = user.email
            self.assertEqual(self.patch({'apellido': 'Editado', 'telefono': '1234567'}).status_code, 200)
            user.refresh_from_db()
            self.assertEqual(user.email, original_email)
            self.assertTrue(default_token_generator.check_token(user, token))
            self.assertEqual(self.post('auth-password-reset', {'email': original_email}).status_code, 200)
            self.assertEqual(mail.outbox[-1].to, [original_email])
