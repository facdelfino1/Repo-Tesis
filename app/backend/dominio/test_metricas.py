from datetime import time, timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from . import test_api
from .models import Disponibilidad, Especialidad, Medico, PropuestaReprogramacion, Triaje, Turno, Usuario


class MetricasTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        test_api.IdentityAPITests.setUpTestData.__func__(cls)
        cls.doctor = cls.users['MEDICO'].medico
        cls.day = timezone.localdate()
        cls.base = timezone.now() - timedelta(hours=2)
        patient = cls.users['PACIENTE'].paciente
        cls.turns = []
        for index, state in enumerate(['RESERVADO', 'PENDIENTE', 'CANCELADO', 'COMPLETADO', 'COMPLETADO', 'EN_ATENCION', 'AUSENTE']):
            times = {}
            if index in [3, 4, 5]:
                wait = {3: 10, 4: 20, 5: 5}[index]
                times = {'fecha_hora_arribo': cls.base, 'fecha_hora_inicio': cls.base + timedelta(minutes=wait)}
                if index in [3, 4]:
                    times['fecha_hora_cierre'] = times['fecha_hora_inicio'] + timedelta(minutes=20 if index == 3 else 10)
            turn = Turno.objects.create(paciente=patient, medico=cls.doctor, fecha=cls.day,
                hora=time(9, index * 5), estado=state, duracion_turno=15,
                fecha_hora_creacion=cls.base-timedelta(hours=1), **times)
            cls.turns.append(turn)
            if index in [0, 3]:
                Triaje.objects.create(turno=turn, nivel_prioridad='ALTA', respuesta_sintomas={})
        origin = Disponibilidad.objects.create(medico=cls.doctor, fecha=cls.day, hora_inicio=time(10), hora_fin=time(10, 15), estado='BLOQUEADO')
        dest = Disponibilidad.objects.create(medico=cls.doctor, fecha=cls.day+timedelta(days=1), hora_inicio=time(10), hora_fin=time(10, 15))
        PropuestaReprogramacion.objects.create(turno=cls.turns[1], disponibilidad_origen=origin, fecha_origen=cls.day,
            hora_origen=time(10), duracion_origen=15, disponibilidad_destino=dest, fecha_destino=dest.fecha,
            hora_inicio_destino=dest.hora_inicio, hora_fin_destino=dest.hora_fin,
            creada_por=cls.users['SECRETARIA'], motivo='Prueba de métrica')

    def setUp(self):
        self.client.force_login(self.users['ADMINISTRADOR'], backend='dominio.authentication.CuentaBackend')

    def get(self, **filters):
        return self.client.get(reverse('admin-metricas'), filters)

    def test_counts_averages_and_definitions(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        data = response.data
        s = data['resumen']
        self.assertEqual((s['total'], s['reservas_activas'], s['completados'], s['cancelados'], s['ausentes']), (7, 2, 2, 1, 1))
        self.assertEqual((s['espera_promedio_minutos'], s['muestras_espera']), (11.67, 3))
        self.assertEqual((s['atencion_promedio_minutos'], s['muestras_atencion']), (15, 2))
        self.assertEqual(s['tasa_ausentismo_historico'], 33.33)
        self.assertEqual(s['propuestas_en_espera'], 1)
        self.assertEqual(data['prioridades'], {'ALTA': 2, 'MEDIA': 0, 'BAJA': 0})
        self.assertEqual(data['sin_triaje'], 5)
        self.assertEqual(data['medicos'][0]['total'], 7)
        self.assertEqual(data['medicos'][0]['atencion_promedio_minutos'], 15)

    def test_empty_counts_are_zero_but_measures_are_null(self):
        data = self.get(desde=self.day+timedelta(days=2)).data
        self.assertEqual(data['resumen']['total'], 0)
        for field in ['espera_promedio_minutos', 'atencion_promedio_minutos', 'prioridad_frecuente', 'tasa_ausentismo_historico']:
            self.assertIsNone(data['resumen'][field])
        self.assertEqual(data['medicos'], [])

    def test_zero_observed_wait_is_real_and_nulls_invalid_pairs_excluded(self):
        Turno.objects.update(fecha_hora_arribo=None, fecha_hora_inicio=None, fecha_hora_cierre=None)
        Turno.objects.filter(pk=self.turns[5].pk).update(fecha_hora_arribo=self.base, fecha_hora_inicio=self.base)
        s = self.get().data['resumen']
        self.assertEqual((s['espera_promedio_minutos'], s['muestras_espera']), (0, 1))
        self.assertIsNone(s['atencion_promedio_minutos'])
        Turno.objects.filter(pk=self.turns[5].pk).update(fecha_hora_inicio=self.base-timedelta(minutes=1))
        self.assertIsNone(self.get().data['resumen']['espera_promedio_minutos'])

    def test_canceled_pending_not_in_observed_wait_or_active_reservations(self):
        for state in ['CANCELADO', 'PENDIENTE']:
            data = self.get(estado=state).data
            self.assertEqual(data['resumen']['total'], 1)
            self.assertEqual(data['resumen']['reservas_activas'], 0)
            self.assertIsNone(data['resumen']['espera_promedio_minutos'])
            self.assertIsNone(data['resumen']['tasa_ausentismo_historico'])

    def test_filters_agendas_do_not_merge_and_updates_are_visible(self):
        u = Usuario.objects.create_user('metric-other@example.com', 'SafeMetric!372926', rol='MEDICO', nombre='Otra', apellido='Agenda', dni='777', telefono='123')
        d = Medico.objects.create(usuario=u, especialidad=Especialidad.objects.get(nombre='Cardiología'), matricula='METRIC')
        t = Turno.objects.create(paciente=self.users['PACIENTE'].paciente, medico=d, fecha=self.day, hora=time(15), estado='RESERVADO', duracion_turno=20)
        result = self.get(medico=d.pk).data
        self.assertEqual(result['resumen']['total'], 1)
        self.assertEqual(result['sin_triaje'], 1)
        self.assertEqual(result['medicos'][0]['sin_triaje'], 1)
        self.assertEqual(result['prioridades']['BAJA'], 0)
        self.assertEqual(self.get(especialidad=d.especialidad_id).data['resumen']['total'], 1)
        t.estado = 'CANCELADO'; t.save(update_fields=['estado'])
        self.assertEqual(self.get(medico=d.pk).data['resumen']['cancelados'], 1)
        self.assertEqual(self.get(medico=self.doctor.pk).data['resumen']['total'], 7)

    def test_permissions_no_patient_information_and_read_only(self):
        data = self.get().data
        self.assertNotIn('paciente', str(data).lower().replace('pacientes', ''))
        self.assertNotIn(self.users['PACIENTE'].email, str(data))
        self.assertNotIn('password', str(data))
        self.assertEqual(self.client.post(reverse('admin-metricas'), {}, format='json').status_code, 405)
        for role in ['MEDICO', 'SECRETARIA', 'PACIENTE']:
            self.client.force_login(self.users[role], backend='dominio.authentication.CuentaBackend')
            self.assertEqual(self.get().status_code, 403)
        self.client.logout()
        self.assertIn(self.get().status_code, [401, 403])

    def test_validation(self):
        for filters in [{'desde': 'invalid'}, {'desde': self.day, 'hasta': self.day-timedelta(days=1)}, {'medico': -1}, {'estado': 'Inventado'}, {'patient': 1}]:
            self.assertEqual(self.get(**filters).status_code, 400)
