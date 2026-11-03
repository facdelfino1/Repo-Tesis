from datetime import timedelta, time
from unittest import TestCase
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import APIException
from rest_framework.test import APITestCase

from . import test_operaciones_turno as b5, test_turnos, test_password_reset
from .agenda import set_blocked, update_block
from .models import Disponibilidad, Especialidad, PropuestaReprogramacion as Propuesta, Turno, Usuario
from .reprogramacion import ordenar_turnos, reprogramar, responder, proponer_pendiente, reasignar_pendiente
from .turnos import cancelar_turno, reservar_turno


class OrdenTests(TestCase):
    def items(self):
        from datetime import datetime, timezone as tz
        base = dict(medico=1, especialidad='Clínica Médica', tiene_triaje=True,
                    fecha=timezone.localdate(), hora=time(9))
        return [base | dict(id=10, prioridad='ALTA', creacion=datetime(2026,1,1,10,tzinfo=tz.utc)),
                base | dict(id=2, prioridad='ALTA', creacion=datetime(2026,1,1,11,tzinfo=tz.utc)),
                base | dict(id=3, prioridad='MEDIA', creacion=datetime(2026,1,1,9,tzinfo=tz.utc)),
                base | dict(id=4, prioridad='BAJA', creacion=datetime(2025,1,1,tzinfo=tz.utc))]

    def test_priority_before_age(self):
        items = self.items()
        self.assertEqual([i['id'] for i in ordenar_turnos(items[::-1])], [10,2,3,4])
        self.assertEqual(items[0]['id'], 10)

    def test_age_then_numeric_identity(self):
        items = self.items()[:2]
        items[1]['creacion'] = items[0]['creacion']
        self.assertEqual([i['id'] for i in ordenar_turnos(items)], [2,10])

    def test_conventional_null(self):
        items = [i | dict(especialidad='Cardiología', prioridad=None, tiene_triaje=False) for i in self.items()]
        items[0]['hora'] = time(10)
        self.assertEqual([i['id'] for i in ordenar_turnos(items)], [2,3,4,10])

    def test_inconsistent_context_and_missing_data(self):
        for changes in ({'medico':2}, {'especialidad':'Pediatría'}, {'prioridad':None},
                        {'prioridad':'OTRA'}, {'creacion':None}, {'tiene_triaje':False}):
            items=self.items(); items[1].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                ordenar_turnos(items)
        items=[self.items()[0] | dict(especialidad='Cardiología')]
        with self.assertRaises(ValueError):
            ordenar_turnos(items)
        self.assertEqual(ordenar_turnos([]), [])


class ReprogramacionAPITests(APITestCase):
    setUpTestData = classmethod(test_turnos.ReservaAPITests.setUpTestData.__func__)
    payload = test_turnos.ReservaAPITests.payload
    url = test_turnos.ReservaAPITests.url
    reserve = test_turnos.ReservaAPITests.reserve
    login = b5.OperacionesTests.login

    def setUp(self):
        test_turnos.ReservaAPITests.setUp(self)
        self.assertEqual(self.reserve().status_code,201)
        self.turn=Turno.objects.get()
        self.new_day=self.day+timedelta(days=2)
        self.destination=Disponibilidad.objects.create(medico=self.doctor, fecha=self.new_day,
                                                       hora_inicio=time(10), hora_fin=time(10,40))
        self.login('SECRETARIA')

    def data(self, **changes):
        return dict(fecha_original=self.day.isoformat(),hora_inicio='09:00',hora_fin='10:00',
                    nueva_fecha=self.new_day.isoformat(),turnos=[self.turn.pk],motivo='Cambio de jornada') | changes

    def post(self, url, data):
        return self.client.post(url,data,format='json',HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)

    def process(self, data=None, doctor=None):
        return self.post(reverse('reprogramacion',kwargs={'medico_pk':(doctor or self.doctor).pk}), self.data() if data is None else data)

    def proposal(self):
        response=self.process()
        self.assertEqual(response.status_code,201,response.data)
        return Propuesta.objects.get()

    def answer(self, proposal, action='aceptar'):
        self.login('PACIENTE')
        return self.post(reverse('propuesta-'+action,args=[proposal.pk]),{})

    def snapshot(self):
        self.turn.refresh_from_db()
        triaje=self.turn.triaje
        return (self.turn.pk,self.turn.paciente_id,self.turn.medico_id,self.turn.fecha_hora_creacion,
                triaje.pk,triaje.nivel_prioridad,triaje.respuesta_sintomas,triaje.fecha_hora_evaluacion)

    def test_generation_snapshots_and_no_hold(self):
        before=self.snapshot(); p=self.proposal()
        self.turn.refresh_from_db(); self.block.refresh_from_db(); self.destination.refresh_from_db()
        self.assertEqual((self.turn.estado,self.block.estado,self.destination.estado),('PENDIENTE','BLOQUEADO','DISPONIBLE'))
        self.assertEqual(self.turn.disponibilidad_id,self.block.pk)
        self.assertEqual((p.fecha_origen,p.hora_origen,p.duracion_origen),(self.day,time(9),25))
        self.assertEqual((p.fecha_destino,p.hora_inicio_destino,p.hora_fin_destino),(self.new_day,time(10),time(10,40)))
        self.assertEqual(p.creada_por_id,self.users['SECRETARIA'].pk)
        self.assertEqual(self.snapshot(),before)
        self.login('PACIENTE')
        own=self.client.get(reverse('turno-detail',args=[self.turn.pk]))
        self.assertFalse(own.data['asignacion_vigente'])
        detail=self.client.get(reverse('propuesta-detail',args=[p.pk]))
        self.assertTrue(detail.data['vigente']); self.assertFalse(detail.data['reserva_garantizada'])

    def test_new_date_required_strict_and_no_arbitrary_limit(self):
        for changes in ({'nueva_fecha':None},{'nueva_fecha':self.day.isoformat()}, {'turnos':[]},
                        {'turnos':[True]},{'turnos':[str(self.turn.pk)]},{'turnos':[self.turn.pk,self.turn.pk]},
                        {'prioridad':'ALTA'},{'hora_fin':'08:00'},{'estado':'PENDIENTE'}):
            self.assertEqual(self.process(self.data(**changes)).status_code,400)
        data=self.data(); del data['nueva_fecha']
        self.assertEqual(self.process(data).status_code,400)
        from .serializers import ReprogramacionSerializer
        self.assertTrue(ReprogramacionSerializer(data=self.data(turnos=list(range(1,102)))).is_valid())

    def test_only_exact_date_no_fallback_with_zero_capacity(self):
        self.destination.fecha=self.new_day+timedelta(days=1); self.destination.save()
        result=self.process()
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['requiere_revision'],[self.turn.pk])
        self.assertFalse(Propuesta.objects.exists())
        self.turn.refresh_from_db(); self.block.refresh_from_db()
        self.assertEqual((self.turn.estado,self.block.estado),('PENDIENTE','BLOQUEADO'))

    def test_capacity_order_and_clinical_precedence(self):
        # The older MEDIA loses capacity to the newer ALTA.
        block=Disponibilidad.objects.create(medico=self.doctor,fecha=self.day,hora_inicio=time(9,30),hora_fin=time(9,50))
        second=reservar_turno(self.users['PACIENTE'],self.doctor.pk,block.pk,{'fiebre':True,'dolor':9,'dificultadRespirar':False})
        self.turn.fecha_hora_creacion=second.fecha_hora_creacion-timedelta(days=1); self.turn.save(update_fields=['fecha_hora_creacion'])
        result=self.process(self.data(turnos=[self.turn.pk,second.pk]))
        self.assertEqual(result.status_code,201,result.data)
        self.assertEqual(result.data['propuestas'][0]['turno'],second.pk)
        self.assertEqual(result.data['requiere_revision'],[self.turn.pk])
        self.assertEqual(Turno.objects.filter(estado='PENDIENTE').count(),2)

    def test_full_capacity_earliest_block_to_highest_priority(self):
        block=Disponibilidad.objects.create(medico=self.doctor,fecha=self.day,hora_inicio=time(9,30),hora_fin=time(9,50))
        second=reservar_turno(self.users['PACIENTE'],self.doctor.pk,block.pk,{'fiebre':False,'dolor':9,'dificultadRespirar':False})
        early=Disponibilidad.objects.create(medico=self.doctor,fecha=self.new_day,hora_inicio=time(9),hora_fin=time(9,20))
        result=self.process(self.data(turnos=[self.turn.pk,second.pk]))
        self.assertEqual(result.data['requiere_revision'],[])
        self.assertEqual([(p['turno'],p['disponibilidad_destino']) for p in result.data['propuestas']],[(second.pk,early.pk),(self.turn.pk,self.destination.pk)])

    def test_real_free_scope_blocks_only(self):
        inside=Disponibilidad.objects.create(medico=self.doctor,fecha=self.day,hora_inicio=time(9,30),hora_fin=time(9,50))
        outside=Disponibilidad.objects.create(medico=self.doctor,fecha=self.day,hora_inicio=time(10),hora_fin=time(10,20))
        self.proposal(); inside.refresh_from_db(); outside.refresh_from_db()
        self.assertEqual((inside.estado,outside.estado),('BLOQUEADO','DISPONIBLE'))

    def test_inconsistent_selection_atomic_no_partial_change(self):
        other=Disponibilidad.objects.create(medico=self.doctor,fecha=self.day,hora_inicio=time(10),hora_fin=time(10,20))
        second=reservar_turno(self.users['PACIENTE'],self.doctor.pk,other.pk,{'fiebre':False,'dolor':0,'dificultadRespirar':False})
        result=self.process(self.data(turnos=[self.turn.pk,second.pk]))
        self.assertEqual(result.status_code,409)
        self.assertIn(second.pk,result.data['turnos_rechazados'])
        self.turn.refresh_from_db(); self.block.refresh_from_db()
        self.assertEqual((self.turn.estado,self.block.estado),('RESERVADO','OCUPADO'))
        self.assertFalse(Propuesta.objects.exists())

    def test_reject_non_reserved_or_arrival_or_missing_priority(self):
        for state in ('PRESENTE','EN_ATENCION','COMPLETADO','CANCELADO','AUSENTE','PENDIENTE'):
            self.turn.estado=state; self.turn.save(update_fields=['estado'])
            self.assertEqual(self.process().status_code,409)
        self.turn.estado='RESERVADO'; self.turn.fecha_hora_arribo=timezone.now(); self.turn.save()
        self.assertEqual(self.process().status_code,409)
        self.turn.fecha_hora_arribo=None; self.turn.save()
        self.turn.triaje.delete()
        self.assertEqual(self.process().status_code,409)

    def test_conventional_without_triage_and_unexpected_triage(self):
        self.doctor.especialidad=Especialidad.objects.get(nombre='Cardiología'); self.doctor.save()
        self.assertEqual(self.process().status_code,409)
        self.turn.triaje.delete()
        p=self.proposal()
        response=self.answer(p)
        self.assertEqual(response.status_code,200,response.data)
        self.turn.refresh_from_db()
        self.assertFalse(hasattr(self.turn,'triaje'))

    def test_acceptance_identity_duration_origin_preserved_and_idempotence(self):
        before=self.snapshot(); p=self.proposal()
        self.assertEqual(self.answer(p).status_code,200)
        self.turn.refresh_from_db(); self.block.refresh_from_db(); self.destination.refresh_from_db(); p.refresh_from_db()
        self.assertEqual((self.turn.estado,self.turn.disponibilidad_id,self.turn.duracion_turno),('RESERVADO',self.destination.pk,40))
        self.assertEqual((self.block.estado,self.destination.estado),('BLOQUEADO','OCUPADO'))
        self.assertEqual(self.snapshot(),before)
        resolved=p.fecha_hora_resolucion
        self.assertEqual(self.answer(p).status_code,200)
        p.refresh_from_db(); self.assertEqual(p.fecha_hora_resolucion,resolved)
        self.assertEqual(self.answer(p,'rechazar').status_code,409)

    def test_rejection_and_repeat_do_not_touch_slots(self):
        p=self.proposal(); before=self.snapshot()
        self.assertEqual(self.answer(p,'rechazar').status_code,200)
        self.assertEqual(self.answer(p,'rechazar').status_code,200)
        self.assertEqual(self.answer(p).status_code,409)
        self.turn.refresh_from_db(); self.block.refresh_from_db(); self.destination.refresh_from_db()
        self.assertEqual((self.turn.estado,self.block.estado,self.destination.estado),('PENDIENTE','BLOQUEADO','DISPONIBLE'))
        self.assertEqual(self.snapshot(),before)

    def test_destination_invalidations_persist_and_do_not_search(self):
        p=self.proposal()
        self.destination.estado='BLOQUEADO'; self.destination.save()
        response=self.answer(p)
        self.assertEqual(response.status_code,409,response.data)
        p.refresh_from_db(); self.turn.refresh_from_db()
        self.assertEqual((p.estado,self.turn.estado),('INVALIDADA','PENDIENTE'))
        self.assertIsNotNone(p.fecha_hora_resolucion)
        self.assertEqual(self.answer(p).status_code,409)

    def test_interval_change_invalidates_get_does_not_write(self):
        p=self.proposal()
        update_block(self.users['SECRETARIA'],self.doctor.pk,self.destination.pk,{'hora_fin':time(10,50)})
        self.login('PACIENTE')
        self.assertFalse(self.client.get(reverse('propuesta-detail',args=[p.pk])).data['vigente'])
        p.refresh_from_db(); self.assertEqual(p.estado,'EN_ESPERA')
        self.assertEqual(self.answer(p).status_code,409)
        p.refresh_from_db(); self.assertEqual(p.estado,'INVALIDADA')

    def test_destination_date_expired_or_changed_invalidates(self):
        p=self.proposal()
        self.destination.fecha=self.new_day+timedelta(days=1); self.destination.save()
        self.assertEqual(self.answer(p).status_code,409)
        p.refresh_from_db(); self.assertEqual(p.estado,'INVALIDADA')

    def test_origin_already_altered_rejected(self):
        self.block.estado='DISPONIBLE'; self.block.save()
        self.assertEqual(self.process().status_code,409)
        self.turn.refresh_from_db(); self.assertEqual(self.turn.estado,'RESERVADO')

    def test_normal_reservation_can_take_offered_destination(self):
        p=self.proposal()
        reservar_turno(self.other_patient.usuario,self.doctor.pk,self.destination.pk,{'fiebre':False,'dolor':0,'dificultadRespirar':False})
        self.assertEqual(self.answer(p).status_code,409)
        p.refresh_from_db(); self.assertEqual(p.estado,'INVALIDADA')

    def test_cancel_pending_annuls_and_never_frees_origin_or_destination(self):
        p=self.proposal()
        self.login('PACIENTE')
        response=self.post(reverse('turno-cancelar',args=[self.turn.pk]),{})
        self.assertEqual(response.status_code,200,response.data)
        p.refresh_from_db(); self.block.refresh_from_db(); self.destination.refresh_from_db()
        self.assertEqual((p.estado,self.block.estado,self.destination.estado),('ANULADA','BLOQUEADO','DISPONIBLE'))
        self.assertEqual(self.answer(p).status_code,409)

    def test_direct_reassignment_annuls_and_preserves_origin(self):
        p=self.proposal(); before=self.snapshot()
        self.login('PACIENTE')
        response=self.post(reverse('turno-reasignar',args=[self.turn.pk]),{'disponibilidad':self.destination.pk})
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(self.snapshot(),before)
        p.refresh_from_db(); self.block.refresh_from_db()
        self.assertEqual((p.estado,self.block.estado),('ANULADA','BLOQUEADO'))
        self.assertEqual(self.answer(p).status_code,409)

    def test_regenerate_requires_date_and_closes_invalid_previous(self):
        p=self.proposal()
        url=reverse('turno-agenda-propuestas',kwargs={'medico_pk':self.doctor.pk,'pk':self.turn.pk})
        self.assertEqual(self.post(url,{'motivo':'Otro'}).status_code,400)
        self.assertEqual(self.post(url,{'motivo':'Otro','nueva_fecha':self.new_day.isoformat()}).status_code,409)
        self.destination.estado='BLOQUEADO'; self.destination.save()
        result=self.post(url,{'motivo':'Otro','nueva_fecha':(self.new_day+timedelta(days=1)).isoformat()})
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['requiere_revision'],[self.turn.pk])
        p.refresh_from_db(); self.assertEqual(p.estado,'INVALIDADA')

    def test_proposal_uniqueness_constraints(self):
        p=self.proposal()
        data={field.name:getattr(p,field.name) for field in Propuesta._meta.fields if field.name not in ('id',)}
        with self.assertRaises(IntegrityError),transaction.atomic():
            Propuesta.objects.create(**data)
        data['estado']='ACEPTADA'
        with self.assertRaises(IntegrityError),transaction.atomic():
            Propuesta.objects.create(**data)

    def test_roles_foreign_ownership_and_csrf(self):
        self.login('MEDICO'); self.assertEqual(self.process(doctor=self.other_doctor).status_code,404)
        self.client.force_login(self.other_doctor.usuario,backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.process().status_code,404)
        for role in ('PACIENTE','ADMINISTRADOR'):
            self.login(role); self.assertEqual(self.process().status_code,403)
        self.login('SECRETARIA'); p=self.proposal()
        for role in ('SECRETARIA','MEDICO','ADMINISTRADOR'):
            self.login(role); self.assertEqual(self.post(reverse('propuesta-aceptar',args=[p.pk]),{}).status_code,403)
        self.client.force_login(self.other_patient.usuario,backend='dominio.authentication.CuentaBackend')
        self.assertEqual(self.post(reverse('propuesta-aceptar',args=[p.pk]),{}).status_code,404)
        self.login('PACIENTE')
        self.assertEqual(self.client.post(reverse('propuesta-aceptar',args=[p.pk]),{},format='json').status_code,403)

    def test_inactive_accounts_block_generation_and_acceptance(self):
        p=self.proposal()
        self.users['MEDICO'].is_active=False; self.users['MEDICO'].save(update_fields=['is_active'])
        self.assertEqual(self.answer(p).status_code,409)
        p.refresh_from_db(); self.assertEqual(p.estado,'INVALIDADA')

    def test_preview_and_pending_collections(self):
        url=reverse('reprogramacion-afectados',kwargs={'medico_pk':self.doctor.pk})
        response=self.client.get(url,{k:self.data()[k] for k in ('fecha_original','hora_inicio','hora_fin')})
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(len(response.data),1)
        self.proposal()
        pending=self.client.get(reverse('pendiente-agenda-list',kwargs={'medico_pk':self.doctor.pk}))
        self.assertEqual(pending.status_code,200,pending.data)
        self.assertEqual(pending.data['count'],1)
        self.assertFalse(pending.data['results'][0]['asignacion_vigente'])
        self.assertEqual(self.client.get(reverse('propuesta-agenda-list',kwargs={'medico_pk':self.doctor.pk})).data['count'],1)

    def test_batch_rollback_if_proposal_write_fails(self):
        with patch('dominio.reprogramacion._crear',side_effect=RuntimeError('failure')):
            with self.assertRaises(RuntimeError):
                self.process()
        self.turn.refresh_from_db(); self.block.refresh_from_db()
        self.assertEqual((self.turn.estado,self.block.estado),('RESERVADO','OCUPADO'))
        self.assertFalse(Propuesta.objects.exists())

    def test_acceptance_rollback(self):
        p=self.proposal()
        with patch('dominio.reprogramacion._cerrar',side_effect=RuntimeError('failure')):
            with self.assertRaises(RuntimeError):
                self.answer(p)
        p.refresh_from_db(); self.turn.refresh_from_db(); self.destination.refresh_from_db()
        self.assertEqual((p.estado,self.turn.estado,self.destination.estado),('EN_ESPERA','PENDIENTE','DISPONIBLE'))


    def test_expired_destination_invalidates_persistently(self):
        p=self.proposal()
        end=timezone.make_aware(__import__('datetime').datetime.combine(self.destination.fecha,self.destination.hora_fin))
        with patch('dominio.reprogramacion.timezone.now',return_value=end):
            self.assertEqual(self.answer(p).status_code,409)
        p.refresh_from_db(); self.turn.refresh_from_db()
        self.assertEqual((p.estado,self.turn.estado),('INVALIDADA','PENDIENTE'))

    def test_inactive_patient_rejects_generation_without_changes(self):
        user=self.users['PACIENTE']; user.is_active=False; user.save(update_fields=['is_active'])
        self.assertEqual(self.process().status_code,409)
        self.turn.refresh_from_db(); self.block.refresh_from_db()
        self.assertEqual((self.turn.estado,self.block.estado),('RESERVADO','OCUPADO'))

    def test_other_doctor_capacity_never_used(self):
        self.destination.medico=self.other_doctor; self.destination.save()
        result=self.process()
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.data['requiere_revision'],[self.turn.pk])
        self.assertFalse(Propuesta.objects.exists())

    def test_dest_unique_and_snapshot_resolution_constraints(self):
        p=self.proposal()
        other=Turno.objects.create(paciente=self.other_patient,medico=self.doctor,estado='PENDIENTE',
                                    disponibilidad=self.block,fecha=self.day,hora=time(9),duracion_turno=25)
        data={f.name:getattr(p,f.name) for f in Propuesta._meta.fields if f.name!='id'}
        for changes in ({'turno':other}, {'disponibilidad_origen':self.destination},
                        {'hora_fin_destino':time(8)}, {'estado':'INVALID'},
                        {'estado':'ANULADA','fecha_hora_resolucion':p.fecha_hora_creacion-timedelta(seconds=1)}):
            with self.subTest(changes=changes),self.assertRaises(IntegrityError),transaction.atomic():
                Propuesta.objects.create(**(data | changes))

    def test_secretary_direct_reassign_and_cancel_rollback(self):
        p=self.proposal()
        self.login('SECRETARIA')
        url=reverse('turno-agenda-reasignar',kwargs={'medico_pk':self.doctor.pk,'pk':self.turn.pk})
        with patch('dominio.reprogramacion.Disponibilidad.save',side_effect=RuntimeError('failure')):
            with self.assertRaises(RuntimeError):
                self.post(url,{'disponibilidad':self.destination.pk})
        p.refresh_from_db(); self.turn.refresh_from_db()
        self.assertEqual((p.estado,self.turn.estado),('EN_ESPERA','PENDIENTE'))
        with patch('dominio.turnos.Turno.save',side_effect=RuntimeError('failure')):
            with self.assertRaises(RuntimeError):
                cancelar_turno(self.users['SECRETARIA'],self.turn.pk,medico_id=self.doctor.pk)
        p.refresh_from_db(); self.assertEqual(p.estado,'EN_ESPERA')
        self.assertEqual(self.post(url,{'disponibilidad':self.destination.pk}).status_code,200)


    def test_offered_block_delete_returns_conflict(self):
        self.proposal()
        url=reverse('disponibilidad-detail',kwargs={'medico_pk':self.doctor.pk,'pk':self.destination.pk})
        response=self.client.delete(url,HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value)
        self.assertEqual(response.status_code,409)
        self.assertTrue(Disponibilidad.objects.filter(pk=self.destination.pk).exists())


class ReprogramacionConcurrencyTests(TransactionTestCase):
    parallel = test_password_reset.PasswordConcurrencyTests.parallel

    def setUp(self):
        b5.OperacionesConcurrencyTests.setUp(self)
        self.new_day=self.destination.fecha

    def result(self, fn, *args, **kwargs):
        try:
            value=fn(*args,**kwargs)
            if fn is responder:
                return 409 if value[1] else 200
            return 200
        except APIException as error:
            return error.status_code

    def process(self, doctor=0, turno=None, date=None):
        return reprogramar(self.secretary,self.doctors[doctor].pk,fecha_original=self.day,
            hora_inicio=time(8),hora_fin=time(12),nueva_fecha=date or self.new_day,
            turnos=[(turno or self.turn).pk],motivo='Cambio')

    def setup_proposal(self):
        self.process()
        return Propuesta.objects.get()

    def answer(self, proposal, accept=True):
        return self.result(responder,self.patients[0],proposal.pk,aceptar=accept)

    def test_same_turn_concurrent_process(self):
        action=lambda:self.result(self.process)
        self.assertEqual(sorted(self.parallel([action,action])),[200,409])
        self.assertEqual(Propuesta.objects.filter(estado='EN_ESPERA').count(),1)
        self.turn.refresh_from_db(); self.assertEqual(self.turn.estado,'PENDIENTE')

    def test_two_open_proposals_for_same_turn_rejected(self):
        self.setup_proposal()
        action=lambda:self.result(proponer_pendiente,self.secretary,self.doctors[0].pk,self.turn.pk,
                                   nueva_fecha=self.new_day,motivo='Nueva')
        self.assertEqual(self.parallel([action,action]),[409,409])
        self.assertEqual(Propuesta.objects.filter(estado='EN_ESPERA').count(),1)

    def test_same_destination_proposed_once(self):
        other_block=Disponibilidad.objects.create(medico=self.doctors[0],fecha=self.day,hora_inicio=time(10),hora_fin=time(10,20))
        other=reservar_turno(self.patients[1],self.doctors[0].pk,other_block.pk,{'fiebre':False,'dolor':0,'dificultadRespirar':False})
        results=self.parallel([lambda:self.process(),lambda:self.process(turno=other)])
        self.assertEqual(sum(len(r['propuestas']) for r in results),1)
        self.assertEqual(sum(len(r['requiere_revision']) for r in results),1)
        self.assertEqual(Propuesta.objects.filter(estado='EN_ESPERA').count(),1)
        self.assertEqual(Turno.objects.filter(estado='PENDIENTE').count(),2)

    def test_simultaneous_acceptance_idempotent(self):
        p=self.setup_proposal()
        self.assertEqual(self.parallel([lambda:self.answer(p),lambda:self.answer(p)]),[200,200])
        self.turn.refresh_from_db(); self.destination.refresh_from_db()
        self.assertEqual((self.turn.estado,self.destination.estado),('RESERVADO','OCUPADO'))

    def test_accept_vs_reject(self):
        p=self.setup_proposal()
        self.assertEqual(sorted(self.parallel([lambda:self.answer(p),lambda:self.answer(p,False)])),[200,409])
        p.refresh_from_db(); self.turn.refresh_from_db()
        self.assertIn((p.estado,self.turn.estado),(('ACEPTADA','RESERVADO'),('RECHAZADA','PENDIENTE')))

    def test_accept_vs_normal_reservation(self):
        p=self.setup_proposal()
        reserve=lambda:self.result(reservar_turno,self.patients[1],self.doctors[0].pk,self.destination.pk,
                                    {'fiebre':False,'dolor':0,'dificultadRespirar':False})
        self.assertEqual(sorted(self.parallel([lambda:self.answer(p),reserve])),[200,409])
        self.assertEqual(self.destination.turnos.exclude(estado__in=['PENDIENTE','CANCELADO']).count(),1)

    def test_accept_vs_block(self):
        p=self.setup_proposal()
        block=lambda:self.result(set_blocked,self.doctors[0].usuario,self.doctors[0].pk,self.destination.pk,blocked=True)
        self.assertEqual(sorted(self.parallel([lambda:self.answer(p),block])),[200,409])
        p.refresh_from_db(); self.destination.refresh_from_db()
        self.assertEqual(self.destination.estado,'OCUPADO' if p.estado=='ACEPTADA' else 'BLOQUEADO')

    def test_accept_vs_interval_edit(self):
        p=self.setup_proposal()
        edit=lambda:self.result(update_block,self.doctors[0].usuario,self.doctors[0].pk,self.destination.pk,{'hora_fin':time(9,50)})
        self.assertEqual(sorted(self.parallel([lambda:self.answer(p),edit])),[200,409])
        p.refresh_from_db(); self.turn.refresh_from_db()
        self.assertIn((p.estado,self.turn.estado),(('ACEPTADA','RESERVADO'),('INVALIDADA','PENDIENTE')))

    def test_accept_vs_pending_cancel(self):
        p=self.setup_proposal()
        cancel=lambda:self.result(cancelar_turno,self.secretary,self.turn.pk,medico_id=self.doctors[0].pk)
        accepted,canceled=self.parallel([lambda:self.answer(p),cancel])
        self.assertEqual(canceled,200)
        self.assertIn(accepted,(200,409))
        self.turn.refresh_from_db(); self.blocks[0].refresh_from_db()
        self.assertEqual(self.turn.estado,'CANCELADO'); self.assertEqual(self.blocks[0].estado,'BLOQUEADO')

    def test_accept_vs_direct_reassignment(self):
        p=self.setup_proposal()
        other=Disponibilidad.objects.create(medico=self.doctors[0],fecha=self.new_day,hora_inicio=time(10),hora_fin=time(10,20))
        move=lambda:self.result(reasignar_pendiente,self.secretary,self.turn.pk,other.pk,medico_id=self.doctors[0].pk)
        self.assertEqual(sorted(self.parallel([lambda:self.answer(p),move])),[200,409])
        p.refresh_from_db(); self.turn.refresh_from_db()
        self.assertEqual(self.turn.estado,'RESERVADO')
        self.assertIn(p.estado,('ACEPTADA','ANULADA'))

    def test_different_doctors_independent(self):
        other=reservar_turno(self.patients[1],self.doctors[1].pk,self.blocks[1].pk,
                            {'fiebre':False,'dolor':0,'dificultadRespirar':False})
        Disponibilidad.objects.create(medico=self.doctors[1],fecha=self.new_day,hora_inicio=time(9),hora_fin=time(9,20))
        results=self.parallel([lambda:self.process(),lambda:self.process(doctor=1,turno=other)])
        self.assertEqual([len(r['propuestas']) for r in results],[1,1])
        for p in Propuesta.objects.select_related('turno','disponibilidad_destino'):
            self.assertEqual(p.turno.medico_id,p.disponibilidad_destino.medico_id)

    def test_accept_vs_doctor_deactivation(self):
        from .serializers import UsuarioInternoSerializer
        p=self.setup_proposal()
        def deactivate():
            user=Usuario.objects.get(pk=self.doctors[0].usuario_id)
            serializer=UsuarioInternoSerializer(user,data={'is_active':False},partial=True)
            serializer.is_valid(raise_exception=True); serializer.save()
            return 200
        accepted,disabled=self.parallel([lambda:self.answer(p),deactivate])
        self.assertEqual(disabled,200); self.assertIn(accepted,(200,409))
        p.refresh_from_db(); self.turn.refresh_from_db()
        self.assertIn((p.estado,self.turn.estado),(('ACEPTADA','RESERVADO'),('INVALIDADA','PENDIENTE')))

    def test_accept_vs_patient_deactivation(self):
        p=self.setup_proposal()
        def deactivate():
            # Simulate administrative account change taking the same account row lock.
            with transaction.atomic():
                user=Usuario.objects.select_for_update().get(pk=self.patients[0].pk)
                user.is_active=False; user.save(update_fields=['is_active'])
            return 200
        accepted,disabled=self.parallel([lambda:self.answer(p),deactivate])
        self.assertEqual(disabled,200); self.assertIn(accepted,(200,403))
        self.turn.refresh_from_db()
        self.assertEqual(self.turn.estado,'RESERVADO' if accepted==200 else 'PENDIENTE')
