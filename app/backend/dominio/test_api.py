import secrets
from unittest.mock import patch

from django.contrib.auth.hashers import identify_hasher
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase, APIRequestFactory

from .models import Especialidad, Medico, Paciente, Secretaria, Usuario
from .permissions import IsAdministrador, IsMedico, IsPaciente, IsSecretaria, has_valid_role_profile


class IdentityAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.password = secrets.token_urlsafe(24)
        cls.especialidad, _ = Especialidad.objects.get_or_create(nombre="Clínica Médica")
        cls.users = {}
        for role in Usuario.Rol.values:
            user = Usuario.objects.create_user(
                email=f"{role.lower()}@example.com", password=cls.password, rol=role,
                nombre="Persona", apellido="Prueba", dni=str(len(cls.users) + 100), telefono="3515551234",
            )
            if role == Usuario.Rol.PACIENTE:
                Paciente.objects.create(usuario=user, obra_social="Particular")
            elif role == Usuario.Rol.MEDICO:
                Medico.objects.create(usuario=user, matricula="MP-1", especialidad=cls.especialidad)
            elif role == Usuario.Rol.SECRETARIA:
                Secretaria.objects.create(usuario=user, legajo="SEC-1")
            cls.users[role] = user

    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)

    def csrf(self, client=None):
        client = client or self.client
        response = client.get(reverse("auth-csrf"))
        self.assertEqual(response.status_code, 200)
        return response.data["csrfToken"]

    def post(self, name, data=None, client=None, **kwargs):
        client = client or self.client
        token = client.cookies.get("csrftoken")
        token = token.value if token else self.csrf(client)
        return client.post(reverse(name, kwargs=kwargs), data or {}, format="json", HTTP_X_CSRFTOKEN=token)

    def login(self, role=Usuario.Rol.ADMINISTRADOR, client=None):
        user = self.users[role]
        response = self.post("auth-login", {"email": user.email, "password": self.password}, client=client)
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def admin_patch(self, user, data):
        return self.client.patch(reverse("usuario-interno-detail", args=[user.pk]), data, format="json",
                                 HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value)

    def payload(self, role=Usuario.Rol.MEDICO):
        data = {"email": "nueva@example.com", "password": "Aa1!" + secrets.token_urlsafe(24), "nombre": "Nueva",
                "apellido": "Cuenta", "dni": "99999999", "telefono": "3515559999", "rol": role}
        if role == Usuario.Rol.MEDICO:
            data.update(matricula="MP-NEW", especialidad=self.especialidad.pk)
        else:
            data["legajo"] = "SEC-NEW"
        return data

    def assert_safe(self, value):
        if isinstance(value, dict):
            self.assertFalse(set(value) & {"password", "is_superuser", "is_staff", "groups", "user_permissions"})
            for item in value.values():
                self.assert_safe(item)
        elif isinstance(value, list):
            for item in value:
                self.assert_safe(item)

    def test_all_roles_login_me_and_safe_profiles(self):
        for role in Usuario.Rol.values:
            with self.subTest(role=role):
                client = APIClient(enforce_csrf_checks=True)
                response = self.login(role, client)
                self.assert_safe(response.data)
                self.assertTrue(client.cookies["sessionid"]["httponly"])
                me = client.get(reverse("auth-me"))
                self.assertEqual(me.status_code, 200)
                self.assertEqual(me.data["rol"], role)
                self.assert_safe(me.data)
                if role == Usuario.Rol.ADMINISTRADOR:
                    self.assertIsNone(me.data["perfil"])
                else:
                    self.assertIsNotNone(me.data["perfil"])

    def test_email_is_case_insensitive_even_for_existing_mixed_case_row(self):
        user = self.users[Usuario.Rol.PACIENTE]
        Usuario.objects.filter(pk=user.pk).update(email="Paciente@Example.COM")
        response = self.post("auth-login", {"email": " PACIENTE@EXAMPLE.COM ", "password": self.password})
        self.assertEqual(response.status_code, 200)

    def test_invalid_unknown_and_inactive_credentials_are_indistinguishable(self):
        user = self.users[Usuario.Rol.PACIENTE]
        wrong = self.post("auth-login", {"email": user.email, "password": "incorrecta"})
        unknown = self.post("auth-login", {"email": "inexistente@example.com", "password": self.password})
        Usuario.objects.filter(pk=user.pk).update(is_active=False)
        inactive = self.post("auth-login", {"email": user.email, "password": self.password})
        self.assertEqual([r.status_code for r in (wrong, unknown, inactive)], [401, 401, 401])
        self.assertEqual(wrong.data, unknown.data)
        self.assertEqual(wrong.data, inactive.data)
        self.assertNotIn("sessionid", self.client.cookies)

    def test_anonymous_endpoints_denied(self):
        for name in ("auth-me", "usuario-interno-list", "especialidad-list"):
            self.assertEqual(self.client.get(reverse(name)).status_code, 403)
        for name in ("auth-logout", "auth-password"):
            self.assertEqual(self.post(name).status_code, 403)

    def test_login_requires_csrf_and_rejects_foreign_origin(self):
        data = {"email": self.users[Usuario.Rol.ADMINISTRADOR].email, "password": self.password}
        self.assertEqual(self.client.post(reverse("auth-login"), data, format="json").status_code, 403)
        token = self.csrf()
        self.assertEqual(self.client.post(reverse("auth-login"), data, format="json",
                                         HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://otro.example").status_code, 403)

    def test_login_missing_fields_is_bad_request(self):
        response = self.post("auth-login", {"email": "persona@example.com"})
        self.assertEqual(response.status_code, 400)

    def test_login_rate_limit(self):
        for _ in range(10):
            self.assertEqual(self.post("auth-login").status_code, 400)
        self.assertEqual(self.post("auth-login").status_code, 429)

    def test_logout_requires_csrf_and_invalidates_session(self):
        self.login()
        self.assertEqual(self.client.post(reverse("auth-logout"), {}, format="json").status_code, 403)
        self.assertEqual(self.post("auth-logout").status_code, 204)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 403)

    def test_disabling_an_account_blocks_existing_session(self):
        self.login(Usuario.Rol.MEDICO)
        Usuario.objects.filter(pk=self.users[Usuario.Rol.MEDICO].pk).update(is_active=False)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 403)
        self.assertEqual(self.post("auth-password", {}).status_code, 403)

    def test_corrupt_profiles_cannot_login(self):
        user = self.users[Usuario.Rol.MEDICO]
        Medico.objects.filter(usuario=user).delete()
        response = self.post("auth-login", {"email": user.email, "password": self.password})
        self.assertEqual(response.status_code, 401)
        Secretaria.objects.create(usuario=user, legajo="INCORRECTO")
        self.assertFalse(has_valid_role_profile(Usuario.objects.get(pk=user.pk)))

    def test_admin_with_profile_is_rejected(self):
        admin = self.users[Usuario.Rol.ADMINISTRADOR]
        Paciente.objects.create(usuario=admin)
        self.assertEqual(self.post("auth-login", {"email": admin.email, "password": self.password}).status_code, 401)

    def test_profile_becoming_inconsistent_blocks_existing_session(self):
        self.login(Usuario.Rol.MEDICO)
        Secretaria.objects.create(usuario=self.users[Usuario.Rol.MEDICO], legajo="EXTRA")
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 403)

    def test_role_permissions_are_reusable_and_do_not_trust_technical_flags(self):
        factory = APIRequestFactory()
        permissions = {Usuario.Rol.PACIENTE: IsPaciente, Usuario.Rol.MEDICO: IsMedico,
                       Usuario.Rol.SECRETARIA: IsSecretaria, Usuario.Rol.ADMINISTRADOR: IsAdministrador}
        for role, user in self.users.items():
            user.is_staff = True
            user.is_superuser = True
            for allowed_role, permission in permissions.items():
                request = factory.get("/")
                request.user = user
                self.assertEqual(permission().has_permission(request, None), role == allowed_role)
            user.is_active = False
            self.assertFalse(permissions[role]().has_permission(request, None))

    def test_only_admin_can_manage_internal_accounts(self):
        for role in (Usuario.Rol.PACIENTE, Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA):
            client = APIClient(enforce_csrf_checks=True)
            self.login(role, client)
            self.assertEqual(client.get(reverse("usuario-interno-list")).status_code, 403)
            self.assertEqual(client.get(reverse("usuario-interno-detail", args=[self.users[Usuario.Rol.MEDICO].pk])).status_code, 403)
            self.assertEqual(self.post("usuario-interno-list", self.payload(), client).status_code, 403)
            self.assertEqual(client.patch(reverse("usuario-interno-detail", args=[self.users[Usuario.Rol.MEDICO].pk]),
                                          {"is_active": False}, format="json", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value).status_code, 403)
            self.assertEqual(client.get(reverse("especialidad-list")).status_code, 403)

    def test_admin_creates_internal_accounts_with_hashed_password_and_profile(self):
        self.login()  # ADMINISTRADOR is not staff/superuser in this fixture.
        for role in (Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA):
            data = self.payload(role)
            data["email"] = f"nuevo-{role.lower()}@example.com"
            response = self.post("usuario-interno-list", data)
            self.assertEqual(response.status_code, 201, response.data)
            user = Usuario.objects.get(pk=response.data["id"])
            self.assertTrue(user.check_password(data["password"]))
            self.assertNotEqual(user.password, data["password"])
            self.assertEqual(identify_hasher(user.password).algorithm, "pbkdf2_sha256")
            self.assertTrue(has_valid_role_profile(user))
            self.assertFalse(user.is_staff)
            self.assertFalse(user.is_superuser)
            self.assert_safe(response.data)
            client = APIClient(enforce_csrf_checks=True)
            self.assertEqual(self.post("auth-login", {"email": data["email"], "password": data["password"]}, client).status_code, 200)

    def test_admin_lists_only_internal_accounts_and_specialties(self):
        self.login()
        response = self.client.get(reverse("usuario-interno-list"))
        self.assertEqual(response.data["count"], 2)
        self.assertEqual({row["rol"] for row in response.data["results"]}, {"MEDICO", "SECRETARIA"})
        self.assert_safe(response.data)
        response = self.client.get(reverse("especialidad-list"))
        self.assertEqual(response.status_code, 200)
        self.assertIn(self.especialidad.pk, [row["id"] for row in response.data["results"]])
        for role in (Usuario.Rol.ADMINISTRADOR, Usuario.Rol.PACIENTE):
            self.assertEqual(self.client.get(reverse("usuario-interno-detail", args=[self.users[role].pk])).status_code, 404)

    def test_admin_edits_activates_and_deactivates_without_changing_identity(self):
        self.login()
        user = self.users[Usuario.Rol.MEDICO]
        profile_id, password = user.medico.pk, user.password
        response = self.admin_patch(user, {"nombre": "Editado", "matricula": "MP-EDIT", "is_active": False})
        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertEqual(user.medico.pk, profile_id)
        self.assertEqual(user.password, password)
        self.assertEqual(user.medico.matricula, "MP-EDIT")
        self.assertEqual(self.admin_patch(user, {"is_active": True}).status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.is_active)

    def test_admin_cannot_change_role_dni_password_or_grant_privileges(self):
        self.login()
        user = self.users[Usuario.Rol.MEDICO]
        for data in ({"rol": "SECRETARIA"}, {"dni": "otro"}, {"password": secrets.token_urlsafe(24)},
                     {"is_superuser": True}, {"is_staff": True}, {"groups": [1]}, {"id": 99}, {"perfil": {}}):
            with self.subTest(data=list(data)):
                self.assertEqual(self.admin_patch(user, data).status_code, 400)
        user.refresh_from_db()
        self.assertEqual(user.rol, Usuario.Rol.MEDICO)
        self.assertFalse(user.is_superuser)

    def test_creation_rejects_other_roles_and_inconsistent_profile_fields(self):
        self.login()
        for role in (Usuario.Rol.PACIENTE, Usuario.Rol.ADMINISTRADOR, "OTRO"):
            self.assertEqual(self.post("usuario-interno-list", self.payload(role)).status_code, 400)
        data = self.payload()
        data["legajo"] = "NO-CORRESPONDE"
        self.assertEqual(self.post("usuario-interno-list", data).status_code, 400)
        data = self.payload(Usuario.Rol.SECRETARIA)
        data["especialidad"] = self.especialidad.pk
        self.assertEqual(self.post("usuario-interno-list", data).status_code, 400)

    def test_creation_requires_password_profile_and_required_identity_fields(self):
        self.login()
        for field in ("password", "matricula", "especialidad", "email", "nombre", "apellido", "dni", "telefono"):
            data = self.payload()
            del data[field]
            self.assertEqual(self.post("usuario-interno-list", data).status_code, 400, field)
        data = self.payload(Usuario.Rol.SECRETARIA)
        del data["legajo"]
        self.assertEqual(self.post("usuario-interno-list", data).status_code, 400)

    def test_creation_validates_email_specialty_and_uniqueness(self):
        self.login()
        for values in ({"email": "invalido"}, {"especialidad": 999999}, {"matricula": "MP-1"},
                       {"email": self.users[Usuario.Rol.PACIENTE].email.upper()}):
            self.assertEqual(self.post("usuario-interno-list", {**self.payload(), **values}).status_code, 400)
        self.assertEqual(self.post("usuario-interno-list", {**self.payload(Usuario.Rol.SECRETARIA), "legajo": "SEC-1"}).status_code, 400)

    def test_weak_password_rejected_without_creating_user(self):
        self.login()
        response = self.post("usuario-interno-list", {**self.payload(), "password": "123"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Usuario.objects.filter(email="nueva@example.com").exists())

    def test_profile_failure_rolls_back_user_and_edit(self):
        self.login()
        with patch.object(Medico, "full_clean", side_effect=ValidationError({"matricula": "Dato inválido."})):
            self.assertEqual(self.post("usuario-interno-list", self.payload()).status_code, 400)
            user = self.users[Usuario.Rol.MEDICO]
            self.assertEqual(self.admin_patch(user, {"nombre": "No persistir"}).status_code, 400)
        self.assertFalse(Usuario.objects.filter(email="nueva@example.com").exists())
        user.refresh_from_db()
        self.assertEqual(user.nombre, "Persona")

    def test_malformed_body_and_delete_are_rejected(self):
        self.login()
        token = self.client.cookies["csrftoken"].value
        self.assertEqual(self.client.post(reverse("usuario-interno-list"), [], format="json", HTTP_X_CSRFTOKEN=token).status_code, 400)
        self.assertEqual(self.client.delete(reverse("usuario-interno-detail", args=[self.users[Usuario.Rol.MEDICO].pk]),
                                            HTTP_X_CSRFTOKEN=token).status_code, 405)

    def test_admin_writes_require_csrf(self):
        self.login()
        self.assertEqual(self.client.post(reverse("usuario-interno-list"), self.payload(), format="json").status_code, 403)
        self.assertEqual(self.client.patch(reverse("usuario-interno-detail", args=[self.users[Usuario.Rol.MEDICO].pk]),
                                           {"is_active": False}, format="json").status_code, 403)

    def test_password_change_preserves_current_session_invalidates_others_and_hashes(self):
        self.login(Usuario.Rol.PACIENTE)
        other = APIClient(enforce_csrf_checks=True)
        self.login(Usuario.Rol.PACIENTE, other)
        new_password = "Aa1!" + secrets.token_urlsafe(24)
        response = self.post("auth-password", {"password_actual": self.password, "password_nueva": new_password,
                                               "password_confirmacion": new_password})
        self.assertEqual(response.status_code, 200, response.data)
        user = Usuario.objects.get(pk=self.users[Usuario.Rol.PACIENTE].pk)
        self.assertTrue(user.check_password(new_password))
        self.assertFalse(user.check_password(self.password))
        self.assertEqual(identify_hasher(user.password).algorithm, "pbkdf2_sha256")
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 200)
        self.assertEqual(other.get(reverse("auth-me")).status_code, 403)
        self.assert_safe(response.data)

    def test_password_change_rejects_wrong_current_mismatch_weak_and_no_csrf(self):
        self.login()
        valid = "Aa1!" + secrets.token_urlsafe(24)
        data = {"password_actual": self.password, "password_nueva": valid, "password_confirmacion": valid}
        for extra in ({"password_actual": "incorrecta"}, {"password_confirmacion": "distinta"},
                      {"password_nueva": "123", "password_confirmacion": "123"}):
            self.assertEqual(self.post("auth-password", {**data, **extra}).status_code, 400)
        self.assertEqual(self.client.post(reverse("auth-password"), data, format="json").status_code, 403)
        self.users[Usuario.Rol.ADMINISTRADOR].refresh_from_db()
        self.assertTrue(self.users[Usuario.Rol.ADMINISTRADOR].check_password(self.password))
