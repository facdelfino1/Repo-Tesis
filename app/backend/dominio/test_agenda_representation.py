from django.urls import reverse
from rest_framework.test import APITestCase

from . import test_operaciones_turno


class AgendaRepresentationTests(APITestCase):
    setUpTestData = classmethod(test_operaciones_turno.OperacionesTests.setUpTestData.__func__)
    setUp = test_operaciones_turno.OperacionesTests.setUp
    payload = test_operaciones_turno.OperacionesTests.payload
    url = test_operaciones_turno.OperacionesTests.url
    reserve = test_operaciones_turno.OperacionesTests.reserve
    turn = test_operaciones_turno.OperacionesTests.turn
    login = test_operaciones_turno.OperacionesTests.login

    def test_patient_identity_minimal_in_authorized_agenda(self):
        turn = self.turn()
        self.login('MEDICO')
        url = reverse('turno-agenda-detail', kwargs={'medico_pk': self.doctor.pk, 'pk': turn.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        patient = self.users['PACIENTE']
        self.assertEqual(response.data['paciente'], patient.paciente.pk)
        self.assertEqual(response.data['paciente_detalle'], {
            'id': patient.paciente.pk, 'nombre': patient.nombre,
            'apellido': patient.apellido, 'dni': patient.dni})
        self.assertFalse({'email', 'password', 'telefono', 'obra_social'} & set(response.data['paciente_detalle']))
        self.login('SECRETARIA')
        listing = self.client.get(reverse('turno-agenda-list', kwargs={'medico_pk': self.doctor.pk}))
        self.assertEqual(listing.data['results'][0]['paciente_detalle'], response.data['paciente_detalle'])
        self.client.force_login(self.other_patient.usuario, backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.client.get(reverse('turno-detail', kwargs={'pk': turn.pk})).status_code, 404)
        self.login('ADMINISTRADOR')
        self.assertEqual(self.client.get(url).status_code, 403)
