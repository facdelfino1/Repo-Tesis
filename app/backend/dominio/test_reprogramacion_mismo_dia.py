"""No-database checks: real validators and views with in-memory repository doubles."""
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory, force_authenticate

from . import reprogramacion as service
from .agenda import AgendaConflict
from .views import ReprogramacionFechasView


class SameDayWithoutDatabaseTests(SimpleTestCase):
    def setUp(self):
        self.day = date(2030, 1, 10)
        self.now = timezone.make_aware(datetime.combine(self.day, time(8, 30)))
        self.clock = patch('django.utils.timezone.now', return_value=self.now)
        self.clock.start(); self.addCleanup(self.clock.stop)
        self.doctor = SimpleNamespace(pk=2, usuario_id=10, usuario=Mock())
        self.scope = dict(fecha_original=self.day, hora_inicio=time(9), hora_fin=time(10))

    def block(self, pk, start=time(10), end=time(10, 40), *, day=None, state='DISPONIBLE', assigned=False, doctor=2):
        block = SimpleNamespace(pk=pk, fecha=day or self.day, hora_inicio=start, hora_fin=end,
            estado=state, medico_id=doctor, turnos=Mock(), save=Mock())
        block.turnos.exclude.return_value.exists.return_value = assigned
        return block

    def valid(self, blocks, offered=()):
        return list(service._destinos_utilizables(self.doctor, blocks, set(offered), **self.scope))

    def test_real_validator_excludes_unusable_free_blocks_and_preserves_duration_rules(self):
        blocks = [self.block(1, time(9, 30), time(9, 50)), self.block(2),
            self.block(3, time(8), time(8, 20)), self.block(4, time(8, 20), time(8, 40)),
            self.block(5, state='OCUPADO'), self.block(6, state='BLOQUEADO'),
            self.block(7), self.block(8, assigned=True), self.block(9, doctor=3),
            self.block(10, time(11), time(11)), self.block(11, time(10, 0, 30)),
            self.block(12, day=self.day - timedelta(days=1)), self.block(13, day=self.day + timedelta(days=1))]
        self.assertEqual([b.pk for b in self.valid(blocks, offered=[7])], [2, 13])
        # Existing behavior uses the destination block duration, even if the origin was 25 min.
        self.assertEqual(service._duration(blocks[1]), 40)

    def test_interval_boundaries_and_time_advancement_are_revalidated(self):
        before = self.block(1, time(8, 40), time(9))
        after = self.block(2, time(10), time(10, 20))
        self.assertEqual([b.pk for b in self.valid([before, after])], [1, 2])
        with patch('django.utils.timezone.now', return_value=self.now + timedelta(hours=2)):
            self.assertEqual(self.valid([before, after]), [])
        after.estado = 'BLOQUEADO'
        self.assertEqual(self.valid([after]), [])

    def test_past_destination_rejected_while_today_is_allowed(self):
        service._fecha(self.day)
        with self.assertRaises(ValidationError):
            service._fecha(self.day - timedelta(days=1))

    def test_preview_uses_same_validator_without_writes(self):
        with patch.object(service, '_valid_user', return_value=True), \
                patch.object(service.Disponibilidad.objects, 'filter') as slots, \
                patch.object(service.Propuesta.objects, 'filter') as proposals:
            slots.return_value.order_by.return_value = [self.block(1, time(9), time(9, 20)), self.block(2),
                self.block(3, day=self.day + timedelta(days=1)), self.block(4, assigned=True)]
            proposals.return_value.values_list.return_value = []
            self.assertEqual(service.fechas_destino(self.doctor, **self.scope), [self.day, self.day + timedelta(days=1)])
            self.assertEqual(slots.call_args.kwargs['medico'], self.doctor)
            self.assertEqual(slots.call_args.kwargs['fecha__gte'], self.day)
        with patch.object(service, '_valid_user', return_value=False), \
                patch.object(service.Disponibilidad.objects, 'filter') as slots:
            self.assertEqual(service.fechas_destino(self.doctor, **self.scope), [])
            slots.assert_not_called()

    def test_execution_revalidates_locked_blocks_and_never_proposes_inside_affected_scope(self):
        origin = self.block(1, time(9), time(9, 25), state='OCUPADO')
        inside = self.block(2, time(9, 30), time(9, 50))
        destination = self.block(3)
        stale = self.block(4, time(11), time(11, 20))
        locked_stale = self.block(4, time(11), time(11, 20), state='BLOQUEADO')
        turn = SimpleNamespace(pk=1, disponibilidad_id=1, estado='RESERVADO', fecha=self.day, save=Mock())
        with patch.object(service, '_gestor', return_value=self.doctor), patch.object(service, '_cuentas'), \
                patch.object(service, '_timeline'), patch.object(service, '_occupied'), \
                patch.object(service, '_slots', return_value=[inside, destination, stale]), \
                patch.object(service, '_lock_block', side_effect=lambda _doctor, pk: {1:origin, 2:inside, 3:destination, 4:locked_stale}[pk]) as lock, \
                patch.object(service.Turno.objects, 'filter') as turns, \
                patch.object(service.Disponibilidad.objects, 'filter') as slots, \
                patch.object(service.Propuesta.objects, 'select_for_update') as proposals, \
                patch.object(service.Propuesta.objects, 'filter') as offered, \
                patch.object(service, 'proyeccion', return_value={'id':1}), \
                patch.object(service, 'ordenar_turnos', side_effect=lambda items: items), \
                patch.object(service, '_crear', return_value='proposal') as create:
            rows = turns.return_value.select_related.return_value
            rows.order_by.return_value = [turn]
            rows.select_for_update.return_value.order_by.return_value = [turn]
            slots.return_value.order_by.return_value = [origin, inside]
            proposals.return_value.filter.return_value.order_by.return_value = []
            offered.return_value.values_list.return_value = []
            # Bypass only transaction.atomic; ORM/storage are doubles and SimpleTestCase forbids DB access.
            result = service.reprogramar.__wrapped__(Mock(), 2, **self.scope, nueva_fecha=self.day, turnos=[1], motivo='Cambio')
            self.assertEqual(result['propuestas'], ['proposal'])
            self.assertEqual(create.call_args.args[2], destination)
            self.assertEqual((origin.estado, inside.estado, destination.estado), ('BLOQUEADO', 'BLOQUEADO', 'DISPONIBLE'))
            self.assertEqual(turn.estado, 'PENDIENTE')
            self.assertEqual([call.args[1] for call in lock.call_args_list], [1,2,3,4])

    def test_read_only_endpoint_keeps_roles_scope_validation_and_doctor_ownership(self):
        factory = APIRequestFactory()
        scope = dict(fecha_original=self.day.isoformat(), hora_inicio='09:00', hora_fin='10:00')
        view = ReprogramacionFechasView.as_view()
        for role in ('MEDICO', 'SECRETARIA', 'PACIENTE', 'ADMINISTRADOR'):
            user = SimpleNamespace(pk=10, rol=role, is_active=True, is_authenticated=True)
            if role != 'ADMINISTRADOR':
                setattr(user, {'MEDICO':'medico', 'SECRETARIA':'secretaria', 'PACIENTE':'paciente'}[role], SimpleNamespace())
            request = factory.get('/api/medicos/2/reprogramacion/fechas/', scope)
            force_authenticate(request, user=user)
            with patch('dominio.views.get_object_or_404', return_value=self.doctor), \
                    patch.object(service, 'fechas_destino', return_value=[self.day]) as preview:
                response = view(request, medico_pk=2)
                self.assertEqual(response.status_code, 200 if role in ('MEDICO', 'SECRETARIA') else 403)
                if response.status_code == 200:
                    self.assertEqual(response.data, {'fechas_disponibles':[self.day.isoformat()]})
                    self.assertEqual(preview.call_args.kwargs, self.scope)
        user = SimpleNamespace(pk=99, rol='MEDICO', is_active=True, is_authenticated=True, medico=SimpleNamespace())
        request = factory.get('/', scope); force_authenticate(request, user=user)
        with patch('dominio.views.get_object_or_404', return_value=self.doctor):
            self.assertEqual(view(request, medico_pk=2).status_code, 404)
        user.pk = 10
        request = factory.get('/', scope | {'hora_fin':'08:00'}); force_authenticate(request, user=user)
        with patch('dominio.views.get_object_or_404', return_value=self.doctor):
            self.assertEqual(view(request, medico_pk=2).status_code, 400)
