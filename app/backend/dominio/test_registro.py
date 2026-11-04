from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth.hashers import identify_hasher
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from .models import Paciente, Usuario


def datos_registro(**changes):
    return {"nombre": "Lucia", "apellido": "Prueba", "dni": "45000123", "telefono": "3515551234",
            "email": "registro@example.com", "obra_social": "Particular", "password": "Riviera!7389Az",
            "password_confirmacion": "Riviera!7389Az", **changes}


class RegistroPacienteTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)
        self.token = self.client.get(reverse("auth-csrf")).data["csrfToken"]

    def registrar(self, data=None):
        return self.client.post(reverse("auth-registro-paciente"), datos_registro() if data is None else data,
                                format="json", HTTP_X_CSRFTOKEN=self.token)

    def test_crea_usuario_y_perfil_sin_autologin_y_permite_login_real(self):
        self.assertEqual(connection.vendor, "postgresql")
        response = self.registrar(datos_registro(email=" Registro@EXAMPLE.COM "))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(set(response.data), {"detail"})
        user = Usuario.objects.get(email="registro@example.com")
        self.assertEqual((user.rol, user.is_active, user.is_staff, user.is_superuser, user.intentos_fallidos),
                         ("PACIENTE", True, False, False, 0))
        self.assertEqual(user.paciente.obra_social, "Particular")
        self.assertEqual(Paciente.objects.count(), 1)
        self.assertFalse(hasattr(user, "medico"))
        self.assertFalse(hasattr(user, "secretaria"))
        self.assertNotEqual(user.password, datos_registro()["password"])
        self.assertTrue(user.check_password(datos_registro()["password"]))
        self.assertIsNotNone(identify_hasher(user.password))
        self.assertNotIn("sessionid", self.client.cookies)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 403)
        login = self.client.post(reverse("auth-login"), {"email": user.email, "password": datos_registro()["password"]},
                                 format="json", HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(login.status_code, 200, login.data)
        self.assertEqual(self.client.get(reverse("auth-me")).data["perfil"]["id"], user.paciente.pk)
        self.assertEqual(self.client.get(reverse("catalogo-especialidad-list")).status_code, 200)

    def test_obra_social_es_opcional(self):
        data = datos_registro()
        data.pop("obra_social")
        self.assertEqual(self.registrar(data).status_code, 201)
        self.assertEqual(Paciente.objects.get().obra_social, "")

    def test_rechaza_email_duplicado_sin_distinguir_mayusculas(self):
        self.assertEqual(self.registrar().status_code, 201)
        response = self.registrar(datos_registro(email="REGISTRO@EXAMPLE.COM", dni="45000456"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)
        self.assertEqual(Usuario.objects.count(), 1)
        self.assertEqual(Paciente.objects.count(), 1)

    def test_rechaza_dni_existente_incluso_de_otro_rol(self):
        Usuario.objects.create_user("interno@example.com", "Riviera!7389Az", rol="ADMINISTRADOR",
                                    nombre="Interno", apellido="Prueba", dni="45000123", telefono="123")
        response = self.registrar()
        self.assertEqual(response.status_code, 400)
        self.assertIn("dni", response.data)
        self.assertEqual(Usuario.objects.count(), 1)
        self.assertEqual(Paciente.objects.count(), 0)

    def test_rechaza_cada_componente_ausente_de_complejidad(self):
        for password in ("Aa1!x", "abcdefgh1!", "ABCDEFGH1!", "Abcdefghi!", "Abcdefgh12", "Abcdefg12 "):
            with self.subTest(password=password):
                response = self.registrar(datos_registro(password=password, password_confirmacion=password))
                self.assertEqual(response.status_code, 400)
                self.assertIn("password", response.data)
        self.assertFalse(Usuario.objects.exists())

    def test_conserva_validadores_nativos_de_contrasena(self):
        password = "Registro@example.com1!"
        response = self.registrar(datos_registro(password=password, password_confirmacion=password))
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)
        self.assertFalse(Usuario.objects.exists())

    def test_rechaza_confirmacion_distinta(self):
        response = self.registrar(datos_registro(password_confirmacion="Otra!7389Az"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("password_confirmacion", response.data)
        self.assertFalse(Usuario.objects.exists())

    def test_rechaza_campos_obligatorios_ausentes_o_vacios(self):
        for field in ("nombre", "apellido", "dni", "telefono", "email", "password", "password_confirmacion"):
            for value in (None, ""):
                with self.subTest(field=field, value=value):
                    cache.clear()
                    data = datos_registro()
                    if value is None:
                        data.pop(field)
                    else:
                        data[field] = value
                    response = self.registrar(data)
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.data)
        self.assertFalse(Usuario.objects.exists())

    def test_rechaza_formatos_y_longitudes_invalidos(self):
        cases = [("dni", "123A"), ("dni", "1" * 21), ("telefono", "abc"), ("telefono", "1" * 31),
                 ("email", "invalido"), ("nombre", "x" * 101), ("apellido", "x" * 101),
                 ("obra_social", "x" * 151)]
        for field, value in cases:
            with self.subTest(field=field):
                cache.clear()
                response = self.registrar(datos_registro(**{field: value}))
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)
        self.assertFalse(Usuario.objects.exists())

    def test_rechaza_roles_privilegios_ids_y_campos_ajenos(self):
        cases = {"rol": "ADMINISTRADOR", "is_staff": True, "is_superuser": True, "is_active": False,
                 "id": 99, "id_usuario": 99, "usuario": 99, "groups": [], "user_permissions": [],
                 "intentos_fallidos": 0, "matricula": "MP-1", "legajo": "SEC-1"}
        for field, value in cases.items():
            with self.subTest(field=field):
                cache.clear()
                response = self.registrar(datos_registro(**{field: value}))
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)
        self.assertFalse(Usuario.objects.exists())
        self.assertFalse(Paciente.objects.exists())

    def test_rechaza_body_que_no_es_objeto(self):
        self.assertEqual(self.registrar([]).status_code, 400)
        self.assertFalse(Usuario.objects.exists())

    def test_csrf_obligatorio_y_origen_ajeno_rechazado(self):
        url = reverse("auth-registro-paciente")
        self.assertEqual(self.client.post(url, datos_registro(), format="json").status_code, 403)
        self.assertEqual(self.client.post(url, datos_registro(), format="json", HTTP_X_CSRFTOKEN=self.token,
                                         HTTP_ORIGIN="https://otro.example").status_code, 403)
        self.assertFalse(Usuario.objects.exists())

    def test_fallo_de_perfil_revierte_usuario(self):
        with patch("dominio.serializers.Paciente.save", side_effect=ValidationError({"obra_social": "No válida."})):
            response = self.registrar()
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Usuario.objects.exists())
        self.assertFalse(Paciente.objects.exists())

    def test_limite_de_solicitudes_de_registro(self):
        for _ in range(10):
            self.assertEqual(self.registrar({}).status_code, 400)
        self.assertEqual(self.registrar({}).status_code, 429)
        self.assertFalse(Usuario.objects.exists())


class RegistroConcurrencyTests(TransactionTestCase):
    def test_altas_publicas_simultaneas_del_mismo_dni(self):
        cache.clear()
        barrier = Barrier(2)

        def register(index):
            close_old_connections()
            try:
                client = APIClient(enforce_csrf_checks=True)
                token = client.get(reverse("auth-csrf")).data["csrfToken"]
                barrier.wait(timeout=15)
                return client.post(reverse("auth-registro-paciente"),
                                   datos_registro(email=f"concurrente{index}@example.com"),
                                   format="json", HTTP_X_CSRFTOKEN=token).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(register, range(2)))
        self.assertEqual(sorted(results), [201, 400])
        self.assertEqual(Usuario.objects.filter(dni="45000123").count(), 1)
        self.assertEqual(Paciente.objects.count(), 1)
