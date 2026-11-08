from types import SimpleNamespace

from django.contrib.auth.forms import SetPasswordForm
from django.contrib.auth.password_validation import get_default_password_validators, validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.test import SimpleTestCase
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APITestCase

from . import test_api
from .models import Usuario
from .serializers import PasswordChangeSerializer
from .test_registro import datos_registro


# Each sample omits one requirement; whitespace cannot supply the special character.
INVALID_PASSWORDS = {
    "length": "Aa1!x",
    "uppercase": "abcdefgh1!",
    "lowercase": "ABCDEFGH1!",
    "number": "Abcdefghi!",
    "special": "Abcdefgh12",
    "space_only_special": "Abcdefg12 ",
}
VALID_PASSWORD = "Riviera!7389Az"


class PasswordPolicyTests(SimpleTestCase):
    def test_each_missing_requirement_is_rejected_by_configured_validators(self):
        for requirement, password in INVALID_PASSWORDS.items():
            with self.subTest(requirement=requirement):
                with self.assertRaises(ValidationError) as caught:
                    validate_password(password)
                self.assertIn("password_complexity", [error.code for error in caught.exception.error_list])
                self.assertNotIn(password, " ".join(caught.exception.messages))

    def test_valid_passwords_preserve_unicode_policy(self):
        for password in (VALID_PASSWORD, "Árboles!234", "Árboles!٢٣٤", "Aa1!bcde"):
            with self.subTest():
                validate_password(password)

    def test_native_validators_are_preserved(self):
        self.assertEqual({type(validator).__name__ for validator in get_default_password_validators()}, {
            "PasswordComplexityValidator", "UserAttributeSimilarityValidator", "MinimumLengthValidator",
            "CommonPasswordValidator", "NumericPasswordValidator",
        })
        for password, user, code in (
            ("12345678", None, "password_entirely_numeric"),
            ("password", None, "password_too_common"),
            ("Registro@example.com1!", Usuario(email="registro@example.com"), "password_too_similar"),
        ):
            with self.subTest(code=code):
                with self.assertRaises(ValidationError) as caught:
                    validate_password(password, user)
                self.assertIn(code, [error.code for error in caught.exception.error_list])

    def test_change_serializer_uses_shared_policy_without_writing_existing_password(self):
        user = Usuario(email="existing@example.com", nombre="Existing", apellido="Account")
        user.set_password("Legacy4827Q")
        old_hash = user.password
        for requirement, password in INVALID_PASSWORDS.items():
            with self.subTest(requirement=requirement):
                serializer = PasswordChangeSerializer(data={
                    "password_actual": "Legacy4827Q", "password_nueva": password,
                    "password_confirmacion": password,
                }, context={"request": SimpleNamespace(user=user)})
                self.assertFalse(serializer.is_valid())
                self.assertIn("password_nueva", serializer.errors)
                self.assertEqual(user.password, old_hash)
        serializer = PasswordChangeSerializer(data={
            "password_actual": "Legacy4827Q", "password_nueva": VALID_PASSWORD,
            "password_confirmacion": VALID_PASSWORD,
        }, context={"request": SimpleNamespace(user=user)})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_reset_form_uses_shared_policy_without_writing_existing_password(self):
        user = Usuario(email="existing@example.com", nombre="Existing", apellido="Account")
        user.set_password("Legacy4827Q")
        old_hash = user.password
        for requirement, password in INVALID_PASSWORDS.items():
            with self.subTest(requirement=requirement):
                form = SetPasswordForm(user, {"new_password1": password, "new_password2": password})
                self.assertFalse(form.is_valid())
                self.assertIn("new_password2", form.errors)
                self.assertEqual(user.password, old_hash)
        form = SetPasswordForm(user, {"new_password1": VALID_PASSWORD, "new_password2": VALID_PASSWORD})
        self.assertTrue(form.is_valid(), form.errors)


class PasswordPolicyAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_api.IdentityAPITests.setUpTestData.__func__(cls)

    setUp = test_api.IdentityAPITests.setUp
    csrf = test_api.IdentityAPITests.csrf
    post = test_api.IdentityAPITests.post
    login = test_api.IdentityAPITests.login
    payload = test_api.IdentityAPITests.payload

    def assert_policy_error(self, response, field, password):
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn(field, response.data)
        self.assertNotIn(password, str(response.data))

    def test_public_registration_rejects_each_missing_requirement(self):
        before = Usuario.objects.count()
        for requirement, password in INVALID_PASSWORDS.items():
            with self.subTest(requirement=requirement):
                response = self.post("auth-registro-paciente", datos_registro(
                    password=password, password_confirmacion=password))
                self.assert_policy_error(response, "password", password)
                self.assertEqual(Usuario.objects.count(), before)
        self.assertEqual(self.post("auth-registro-paciente", datos_registro()).status_code, 201)

    def test_internal_creation_rejects_each_missing_requirement_for_both_roles(self):
        self.login()
        before = Usuario.objects.count()
        for role in (Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA):
            for requirement, password in INVALID_PASSWORDS.items():
                with self.subTest(role=role, requirement=requirement):
                    response = self.post("usuario-interno-list", {**self.payload(role), "password": password})
                    self.assert_policy_error(response, "password", password)
                    self.assertEqual(Usuario.objects.count(), before)
            data = {**self.payload(role), "password": VALID_PASSWORD, "email": f"new-{role.lower()}@example.com"}
            self.assertEqual(self.post("usuario-interno-list", data).status_code, 201)
            before += 1

    def test_password_change_rejects_each_missing_requirement_without_changing_hash(self):
        self.login(Usuario.Rol.PACIENTE)
        user = self.users[Usuario.Rol.PACIENTE]
        old_hash = user.password
        for requirement, password in INVALID_PASSWORDS.items():
            with self.subTest(requirement=requirement):
                response = self.post("auth-password", {
                    "password_actual": self.password, "password_nueva": password,
                    "password_confirmacion": password,
                })
                self.assert_policy_error(response, "password_nueva", password)
                user.refresh_from_db()
                self.assertEqual(user.password, old_hash)
                self.assertEqual(self.client.get(reverse("auth-me")).status_code, 200)
        response = self.post("auth-password", {
            "password_actual": self.password, "password_nueva": VALID_PASSWORD,
            "password_confirmacion": VALID_PASSWORD,
        })
        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertTrue(user.check_password(VALID_PASSWORD))

    def test_recovery_rejects_each_missing_requirement_and_keeps_token_usable(self):
        user = self.users[Usuario.Rol.PACIENTE]
        old_hash = user.password
        token = default_token_generator.make_token(user)
        data = {"uid": urlsafe_base64_encode(force_bytes(user.pk)), "token": token}
        for requirement, password in INVALID_PASSWORDS.items():
            with self.subTest(requirement=requirement):
                response = self.post("auth-password-reset-confirm", {
                    **data, "password_nueva": password, "password_confirmacion": password,
                })
                self.assert_policy_error(response, "password_confirmacion", password)
                user.refresh_from_db()
                self.assertEqual(user.password, old_hash)
                self.assertTrue(default_token_generator.check_token(user, token))
        response = self.post("auth-password-reset-confirm", {
            **data, "password_nueva": VALID_PASSWORD, "password_confirmacion": VALID_PASSWORD,
        })
        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertTrue(user.check_password(VALID_PASSWORD))
        self.assertFalse(default_token_generator.check_token(user, token))

    def test_existing_password_without_complexity_still_allows_login(self):
        user = self.users[Usuario.Rol.PACIENTE]
        legacy_password = "Legacy4827Q"
        user.set_password(legacy_password)
        user.save(update_fields=["password"])
        old_hash = user.password
        response = self.post("auth-login", {"email": user.email, "password": legacy_password})
        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertEqual(user.password, old_hash)
