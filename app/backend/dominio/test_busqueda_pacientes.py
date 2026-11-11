from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from . import test_api
from .models import Medico, Paciente, Secretaria, Usuario


class BusquedaPacientesTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_api.IdentityAPITests.setUpTestData.__func__(cls)
        cls.patients = []
        for i, (nombre, apellido, dni) in enumerate([
            ('Ana María', 'Pérez Gómez', '00123456'),
            ('Ana María', 'Pérez Gómez', '00123456'),
            ('Ana', 'Alvarez', '55443322'),
            ('Luis', 'Zapata', '99887766'),
        ]):
            u = Usuario.objects.create_user(f'search{i}@example.test', None, rol='PACIENTE',
                nombre=nombre, apellido=apellido, dni=dni, telefono='1')
            cls.patients.append(Paciente.objects.create(usuario=u))

    def setUp(self):
        cache.clear()
        self.client.force_login(self.users['SECRETARIA'], backend='dominio.authentication.CuentaBackend')
        self.url = reverse('paciente-busqueda-list')

    def get(self, **params):
        return self.client.get(self.url, params)

    def ids(self, **params):
        response = self.get(**params)
        self.assertEqual(response.status_code, 200, response.data)
        return [p['id'] for p in response.data['results']]

    def test_exact_dni_preserved_duplicates_order_and_minimal_payload(self):
        result = self.get(dni='00123456')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['count'], 2)
        self.assertEqual([p['id'] for p in result.data['results']], [p.pk for p in self.patients[:2]])
        self.assertEqual(set(result.data), {'count', 'next', 'previous', 'results'})
        self.assertEqual(set(result.data['results'][0]), {'id', 'nombre', 'apellido', 'dni'})
        self.assertEqual(self.ids(dni='1234'), [])
        self.assertEqual(self.ids(dni=' 00123456 '), [p.pk for p in self.patients[:2]])

    def test_partial_dni_keeps_leading_zeroes(self):
        self.assertEqual(self.ids(q='0012'), [p.pk for p in self.patients[:2]])
        self.assertEqual(self.ids(q='4433'), [self.patients[2].pk])

    def test_partial_names_and_surnames_ignore_case(self):
        self.assertEqual(self.ids(q='aNa'), [self.patients[2].pk, *[p.pk for p in self.patients[:2]]])
        self.assertEqual(self.ids(q='ZAP'), [self.patients[3].pk])
        self.assertEqual(self.ids(q='ARÍ'), [p.pk for p in self.patients[:2]])

    def test_multiple_words_across_compound_names_and_surnames(self):
        for query in ('ana PÉREZ', 'maría GÓMEZ', 'Gómez ana', 'Ana María Pérez Gómez'):
            with self.subTest(q=query):
                self.assertEqual(self.ids(q=query), [p.pk for p in self.patients[:2]])
        self.assertEqual(self.ids(q='ana zapata'), [])

    def test_spaces_normalized_before_validation(self):
        self.assertEqual(self.ids(q=' \t Ana   María\nPérez  '), [p.pk for p in self.patients[:2]])
        self.assertEqual(self.ids(q=' ' * 220 + 'Ana' + ' ' * 220),
                         [self.patients[2].pk, *[p.pk for p in self.patients[:2]]])

    def test_bad_queries_rejected(self):
        for params in ({}, {'q': ''}, {'q': ' '}, {'q': 'a'}, {'q': 'x' * 201},
                       {'q': 'Ana', 'dni': '00123456'}, {'q': 'Ana', 'dni': ''},
                       {'dni': ''}, {'dni': '1' * 21}, {'q': 'Ana', 'extra': '1'}, {'nombre': 'Ana'}):
            with self.subTest(params=params):
                self.assertEqual(self.get(**params).status_code, 400)
        self.assertEqual(self.get(q='x' * 200).status_code, 200)

    def test_no_results_and_special_characters_are_literal(self):
        for text in ('noexistent', '%_', "' OR 1=1 --", '<script>'):
            result = self.get(q=text)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.data['count'], 0)
            self.assertEqual(result.data['results'], [])

    def test_eligibility_filters_unchanged(self):
        a, b, c, d = self.patients
        a.usuario.is_active = False; a.usuario.save(update_fields=['is_active'])
        Medico.objects.create(usuario=b.usuario, especialidad=self.especialidad, matricula='INVALIDSEARCH')
        Secretaria.objects.create(usuario=c.usuario, legajo='INVALIDSEARCH')
        d.usuario.rol = 'ADMINISTRADOR'; d.usuario.save(update_fields=['rol'])
        for params in ({'q': 'Ana'}, {'dni': '00123456'}, {'q': 'Zapata'}):
            self.assertEqual(self.ids(**params), [])

    def test_permissions_four_roles_anonymous_and_inactive(self):
        for role in ('PACIENTE', 'MEDICO', 'ADMINISTRADOR'):
            self.client.force_login(self.users[role], backend='dominio.authentication.CuentaBackend')
            for params in ({'q': 'Ana'}, {'dni': '00123456'}):
                self.assertEqual(self.get(**params).status_code, 403)
        self.client.logout()
        self.assertEqual(self.get(q='Ana').status_code, 403)
        secretary = self.users['SECRETARIA']
        secretary.is_active = False; secretary.save(update_fields=['is_active'])
        self.client.force_login(secretary, backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.get(q='Ana').status_code, 403)

    def test_pagination_stable_by_surname_name_id(self):
        for i in range(30):
            u = Usuario.objects.create_user(f'page{i}@example.test', None, rol='PACIENTE',
                nombre=f'Paginado {i:02d}', apellido='Orden', dni='777', telefono='1')
            Paciente.objects.create(usuario=u)
        first, second = self.get(q='Paginado'), self.get(q='Paginado', page=2)
        self.assertEqual(first.data['count'], 30)
        self.assertEqual(len(first.data['results']), 25)
        self.assertEqual(len(second.data['results']), 5)
        self.assertIn('q=Paginado', first.data['next'])
        self.assertIn('page=2', first.data['next'])
        merged = first.data['results'] + second.data['results']
        self.assertEqual([p['nombre'] for p in merged], [f'Paginado {i:02d}' for i in range(30)])
        exact = self.get(dni='777')
        self.assertEqual(exact.data['count'], 30)
        self.assertEqual(len(exact.data['results']), 25)
        self.assertEqual(self.get(q='Paginado', page=99).status_code, 404)
        self.assertEqual(self.get(q='Paginado', page='invalid').status_code, 404)

    def test_lookup_is_read_only(self):
        before = Paciente.objects.count()
        self.get(q='Ana')
        self.assertEqual(self.client.post(self.url, {'q': 'Ana'}, format='json').status_code, 405)
        self.assertEqual(Paciente.objects.count(), before)
