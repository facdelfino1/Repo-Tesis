import re
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from smtplib import SMTPException
from threading import Barrier
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.hashers import make_password
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.cache import cache
from django.db import IntegrityError, close_old_connections, connections, transaction
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient, APIRequestFactory, APITestCase

from .models import Paciente, Usuario
from .serializers import UsuarioInternoSerializer
from . import test_api
from .views import PasswordResetConfirmView


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
                   PASSWORD_RESET_BASE_URL="https://api.example.test")
class PasswordRecoveryTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_api.IdentityAPITests.setUpTestData.__func__(cls)

    setUp = test_api.IdentityAPITests.setUp
    csrf = test_api.IdentityAPITests.csrf
    post = test_api.IdentityAPITests.post
    login = test_api.IdentityAPITests.login
    admin_patch = test_api.IdentityAPITests.admin_patch

    @property
    def user(self):
        return self.users[Usuario.Rol.PACIENTE]

    def credentials(self, password=None):
        return {"email": self.user.email.upper(), "password": self.password if password is None else password}

    def set_failures(self, count):
        Usuario.objects.filter(pk=self.user.pk).update(intentos_fallidos=count)

    def failures(self):
        return Usuario.objects.get(pk=self.user.pk).intentos_fallidos

    def request_reset(self, email=None):
        return self.post("auth-password-reset", {"email": email or self.user.email})

    def email_token(self):
        body = mail.outbox[-1].body
        return {"uid": re.search(r"Identificador: (\S+)", body).group(1),
                "token": re.search(r"Token: (\S+)", body).group(1)}

    def confirm_reset(self, data, password=None):
        password = password or secrets.token_urlsafe(24)
        return self.post("auth-password-reset-confirm", {
            **data, "password_nueva": password, "password_confirmacion": password,
        })

    def test_first_five_failures_lock_and_correct_password_cannot_unlock(self):
        response_data = None
        for count in range(1, 6):
            response = self.post("auth-login", self.credentials("incorrecta"))
            self.assertEqual(response.status_code, 401)
            self.assertEqual(self.failures(), count)
            response_data = response.data
        self.assertTrue(Usuario.objects.get(pk=self.user.pk).bloqueado_por_intentos)
        for password in (self.password, "otra incorrecta"):
            response = self.post("auth-login", self.credentials(password))
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.data, response_data)
            self.assertEqual(self.failures(), 5)
        self.assertNotIn("sessionid", self.client.cookies)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_success_before_five_resets_consecutive_failures(self):
        for _ in range(4):
            self.assertEqual(self.post("auth-login", self.credentials("incorrecta")).status_code, 401)
        self.assertEqual(self.failures(), 4)
        self.assertEqual(self.post("auth-login", self.credentials()).status_code, 200)
        self.assertEqual(self.failures(), 0)
        self.assertEqual(self.post("auth-login", self.credentials("incorrecta")).status_code, 401)
        self.assertEqual(self.failures(), 1)

    def test_counter_is_shared_between_clients_and_ips(self):
        for count in range(1, 6):
            client = APIClient(enforce_csrf_checks=True)
            token = self.csrf(client)
            response = client.post(reverse("auth-login"), self.credentials("incorrecta"), format="json",
                                   REMOTE_ADDR=f"192.0.2.{count}", HTTP_X_CSRFTOKEN=token)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(self.failures(), count)

    def test_bad_input_csrf_and_throttle_do_not_count_as_bad_passwords(self):
        self.assertEqual(self.client.post(reverse("auth-login"), self.credentials(), format="json").status_code, 403)
        for _ in range(10):
            self.assertEqual(self.post("auth-login", {"email": self.user.email}).status_code, 400)
        self.assertEqual(self.post("auth-login", self.credentials("incorrecta")).status_code, 429)
        self.assertEqual(self.failures(), 0)

    def test_locked_login_remains_blocked_after_time_passes(self):
        self.set_failures(5)
        with patch("time.time", return_value=9999999999):
            self.assertEqual(self.post("auth-login", self.credentials()).status_code, 401)
        self.assertEqual(self.failures(), 5)

    def test_request_reset_sends_native_token_without_modifying_account(self):
        self.set_failures(5)
        before = Usuario.objects.get(pk=self.user.pk)
        response = self.request_reset()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.user.email])
        token = self.email_token()
        self.assertTrue(default_token_generator.check_token(before, token["token"]))
        self.assertNotIn(token["token"], str(response.data))
        self.assertEqual(self.failures(), 5)
        self.user.refresh_from_db()
        self.assertEqual(self.user.password, before.password)
        self.assertTrue(self.user.is_active)

    def test_recovery_responses_are_generic_for_unknown_inactive_and_locked(self):
        responses = [self.request_reset("inexistente@example.com")]
        self.set_failures(5)
        responses.append(self.request_reset())
        Usuario.objects.filter(pk=self.user.pk).update(is_active=False)
        responses.append(self.request_reset())
        self.assertEqual([response.status_code for response in responses], [200, 200, 200])
        self.assertEqual(responses[0].data, responses[1].data)
        self.assertEqual(responses[0].data, responses[2].data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.failures(), 5)

    def test_unusable_password_does_not_receive_recovery_email(self):
        self.user.set_unusable_password()
        self.user.save(update_fields=["password"])
        self.assertEqual(self.request_reset().status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_hashes_unlocks_and_allows_login_without_automatic_session(self):
        self.set_failures(5)
        self.request_reset()
        new_password = secrets.token_urlsafe(24)
        response = self.confirm_reset(self.email_token(), new_password)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("sessionid", self.client.cookies)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 403)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(new_password))
        self.assertNotEqual(self.user.password, new_password)
        self.assertEqual(self.user.intentos_fallidos, 0)
        self.assertFalse(self.user.bloqueado_por_intentos)
        self.assertTrue(self.user.is_active)
        self.assertEqual(self.post("auth-login", self.credentials(new_password)).status_code, 200)

    def test_invalid_expired_and_used_tokens_do_not_reset_counter(self):
        self.set_failures(5)
        self.request_reset()
        data = self.email_token()
        for bad in ({**data, "token": "incorrecto"}, {**data, "uid": "!"},
                    {**data, "uid": urlsafe_base64_encode(force_bytes(self.users[Usuario.Rol.ADMINISTRADOR].pk))},
                    {**data, "uid": urlsafe_base64_encode(b"99999999")}):
            self.assertEqual(self.confirm_reset(bad).status_code, 400)
            self.assertEqual(self.failures(), 5)
        self.assertEqual(self.confirm_reset(data).status_code, 200)
        self.set_failures(3)
        self.assertEqual(self.confirm_reset(data).status_code, 400)
        self.assertEqual(self.failures(), 3)

    def test_one_hour_expiry_new_request_does_not_unlock_and_new_token_works(self):
        self.assertEqual(settings.PASSWORD_RESET_TIMEOUT, 3600)
        self.set_failures(5)
        issued = datetime(2026, 11, 2, 12)
        with patch.object(default_token_generator, "_now", return_value=issued):
            self.request_reset()
        old = self.email_token()
        with patch.object(default_token_generator, "_now", return_value=issued + timedelta(seconds=3601)):
            self.assertEqual(self.confirm_reset(old).status_code, 400)
            self.assertEqual(self.failures(), 5)
            self.assertEqual(self.post("auth-login", self.credentials()).status_code, 401)
            self.assertEqual(self.request_reset().status_code, 200)
            new = self.email_token()
            self.assertNotEqual(new["token"], old["token"])
            self.assertEqual(self.failures(), 5)
            self.assertEqual(self.confirm_reset(new).status_code, 200)
        self.assertEqual(self.failures(), 0)

    def test_bad_new_password_and_confirmation_do_not_unlock_or_change_password(self):
        self.set_failures(5)
        self.request_reset()
        data = self.email_token()
        old = Usuario.objects.get(pk=self.user.pk).password
        for password, confirmation in (("123", "123"), (secrets.token_urlsafe(24), "distinta")):
            response = self.post("auth-password-reset-confirm", {**data, "password_nueva": password,
                                                                 "password_confirmacion": confirmation})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(self.failures(), 5)
            self.assertEqual(Usuario.objects.get(pk=self.user.pk).password, old)

    def test_recovery_never_reactivates_administratively_disabled_account(self):
        self.set_failures(5)
        self.request_reset()
        data = self.email_token()
        Usuario.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.confirm_reset(data).status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertEqual(self.user.intentos_fallidos, 5)

    def test_recovery_invalidates_existing_sessions(self):
        self.login(Usuario.Rol.PACIENTE)
        other = APIClient(enforce_csrf_checks=True)
        self.login(Usuario.Rol.PACIENTE, other)
        self.set_failures(5)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 200)
        self.request_reset()
        self.assertEqual(self.confirm_reset(self.email_token()).status_code, 200)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 403)
        self.assertEqual(other.get(reverse("auth-me")).status_code, 403)

    def test_existing_session_cannot_bypass_recovery_using_password_change(self):
        self.login(Usuario.Rol.PACIENTE)
        self.set_failures(5)
        new_password = secrets.token_urlsafe(24)
        response = self.post("auth-password", {"password_actual": self.password, "password_nueva": new_password,
                                               "password_confirmacion": new_password})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.failures(), 5)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.password))

    def test_recovery_endpoints_require_csrf(self):
        self.assertEqual(self.client.post(reverse("auth-password-reset"), {"email": self.user.email}, format="json").status_code, 403)
        self.request_reset()
        self.assertEqual(self.client.post(reverse("auth-password-reset-confirm"), {
            **self.email_token(), "password_nueva": "no-importa", "password_confirmacion": "no-importa",
        }, format="json").status_code, 403)

    def test_reset_requests_and_confirmation_have_complementary_throttle(self):
        for _ in range(10):
            self.assertEqual(self.request_reset("inexistente@example.com").status_code, 200)
        self.assertEqual(self.request_reset().status_code, 429)
        self.assertEqual(self.confirm_reset({"uid": "!", "token": "!"}).status_code, 429)
        self.assertEqual(self.failures(), 0)

    def test_delivery_error_does_not_expose_email_existence(self):
        with patch("django.core.mail.EmailMultiAlternatives.send", side_effect=SMTPException("SMTP unavailable")):
            with self.assertLogs("django.contrib.auth", level="ERROR"):
                known = self.request_reset()
        unknown = self.request_reset("inexistente@example.com")
        self.assertEqual(known.status_code, 200)
        self.assertEqual(known.data, unknown.data)

    @override_settings(ALLOWED_HOSTS=["testserver", "attacker.test"])
    def test_email_origin_is_configured_not_taken_from_host_header(self):
        token = self.csrf()
        response = self.client.post(reverse("auth-password-reset"), {"email": self.user.email}, format="json",
                                    HTTP_X_CSRFTOKEN=token, HTTP_HOST="attacker.test")
        self.assertEqual(response.status_code, 200)
        self.assertIn("https://api.example.test/api/auth/password-reset/confirm/", mail.outbox[-1].body)
        self.assertNotIn("attacker.test", mail.outbox[-1].body)

    def test_admin_cannot_edit_lockout_and_stale_edit_preserves_security_fields(self):
        self.login()
        target = self.users[Usuario.Rol.MEDICO]
        self.assertEqual(self.admin_patch(target, {"intentos_fallidos": 0}).status_code, 400)
        stale = Usuario.objects.get(pk=target.pk)
        password_hash = make_password(secrets.token_urlsafe(24))
        last_login = timezone.now()
        Usuario.objects.filter(pk=target.pk).update(intentos_fallidos=5, password=password_hash, last_login=last_login)
        serializer = UsuarioInternoSerializer(stale, data={"nombre": "Editado"}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        target.refresh_from_db()
        self.assertEqual(target.intentos_fallidos, 5)
        self.assertEqual(target.password, password_hash)
        self.assertEqual(target.last_login, last_login)

    def test_counter_database_constraint(self):
        for value in (-1, 6):
            with self.assertRaises(IntegrityError), transaction.atomic():
                Usuario.objects.filter(pk=self.user.pk).update(intentos_fallidos=value)


class PasswordConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.password = secrets.token_urlsafe(24)
        self.user = Usuario.objects.create_user("concurrente@example.com", self.password, rol="PACIENTE",
                                                nombre="Concurrente", apellido="Prueba", dni="123", telefono="3515551234")
        Paciente.objects.create(usuario=self.user)

    def parallel(self, actions):
        barrier = Barrier(len(actions))

        def run(action):
            close_old_connections()
            try:
                barrier.wait(timeout=30)
                return action()
            finally:
                connections["default"].close()

        with ThreadPoolExecutor(max_workers=len(actions)) as executor:
            futures = [executor.submit(run, action) for action in actions]
            return [future.result(timeout=60) for future in futures]

    def authenticate(self, password):
        return authenticate(email=self.user.email, password=password) is not None

    def reset(self, data):
        request = APIRequestFactory().post(reverse("auth-password-reset-confirm"), data, format="json")
        return PasswordResetConfirmView.as_view()(request).status_code

    def reset_data(self):
        password = secrets.token_urlsafe(24)
        return {"uid": urlsafe_base64_encode(force_bytes(self.user.pk)),
                "token": default_token_generator.make_token(self.user),
                "password_nueva": password, "password_confirmacion": password}

    def test_five_parallel_failures_are_not_lost(self):
        self.assertEqual(self.parallel([lambda: self.authenticate("incorrecta")] * 5), [False] * 5)
        self.user.refresh_from_db()
        self.assertEqual(self.user.intentos_fallidos, 5)
        self.assertFalse(self.authenticate(self.password))

    def test_correct_login_racing_with_fifth_failure_is_serializable(self):
        Usuario.objects.filter(pk=self.user.pk).update(intentos_fallidos=4)
        correct, wrong = self.parallel([lambda: self.authenticate(self.password), lambda: self.authenticate("incorrecta")])
        self.user.refresh_from_db()
        self.assertFalse(wrong)
        self.assertIn(self.user.intentos_fallidos, (1, 5))
        self.assertEqual(correct, self.user.intentos_fallidos == 1)

    def test_same_token_cannot_be_consumed_twice_concurrently(self):
        Usuario.objects.filter(pk=self.user.pk).update(intentos_fallidos=5)
        data = self.reset_data()
        self.assertEqual(sorted(self.parallel([lambda: self.reset(data)] * 2)), [200, 400])
        self.user.refresh_from_db()
        self.assertEqual(self.user.intentos_fallidos, 0)
        self.assertTrue(self.user.check_password(data["password_nueva"]))

    def test_reset_racing_with_failed_login_is_serializable(self):
        Usuario.objects.filter(pk=self.user.pk).update(intentos_fallidos=4)
        data = self.reset_data()
        reset_status, authenticated = self.parallel([lambda: self.reset(data), lambda: self.authenticate("incorrecta")])
        self.assertEqual(reset_status, 200)
        self.assertFalse(authenticated)
        self.user.refresh_from_db()
        self.assertIn(self.user.intentos_fallidos, (0, 1))
        self.assertTrue(self.user.check_password(data["password_nueva"]))
