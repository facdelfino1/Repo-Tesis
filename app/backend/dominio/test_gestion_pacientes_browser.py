import json
import os
from pathlib import Path
import subprocess
from datetime import time, timedelta
from unittest import skipUnless

from django.core import mail
from django.test import LiveServerTestCase, override_settings
from django.utils import timezone

from . import test_api
from .models import Disponibilidad, Triaje, Turno, Usuario
from .turnos import reservar_turno


@skipUnless(os.environ.get('RUN_PATIENT_BROWSER_TESTS') == '1', 'Opt-in Chrome integration against an isolated local PostgreSQL database')
@override_settings(DEBUG=True, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class GestionPacientesBrowserTests(LiveServerTestCase):
    host = '127.0.0.1'

    def test_real_browser_profile_edit_and_patient_activation(self):
        test_api.IdentityAPITests.setUpTestData.__func__(type(self))
        patient = self.users['PACIENTE']
        patient.fecha_nacimiento = '1987-03-12'
        patient.save(update_fields=['fecha_nacimiento'])
        professional_before = {}
        for role in ['MEDICO', 'SECRETARIA']:
            user = self.users[role]
            user.fecha_nacimiento = '1987-03-12'
            user.save(update_fields=['fecha_nacimiento'])
            profile = user.medico if role == 'MEDICO' else user.secretaria
            professional_before[role] = type(profile).objects.filter(pk=profile.pk).values().get()
        block = Disponibilidad.objects.create(medico=self.users['MEDICO'].medico,
            fecha=timezone.localdate() + timedelta(days=2), hora_inicio=time(9), hora_fin=time(9, 25))
        turn = reservar_turno(patient, self.users['MEDICO'].medico.pk, block.pk,
            {'fiebre': False, 'dificultadRespirar': False, 'dolor': 4})
        turn_before = Turno.objects.filter(pk=turn.pk).values().get()
        triage_before = Triaje.objects.filter(turno=turn).values().get()
        workspace = Path(__file__).resolve().parents[3]
        env = dict(os.environ, PATIENT_TEST_ORIGIN=self.live_server_url, PATIENT_TEST_PASSWORD=self.password,
            PATIENT_TEST_ID=str(patient.pk), PATIENT_TEST_EMAIL=patient.email,
            PATIENT_TEST_ADMIN_EMAIL=self.users['ADMINISTRADOR'].email,
            PROFESSIONAL_TEST_DOCTOR_EMAIL=self.users['MEDICO'].email,
            PROFESSIONAL_TEST_SECRETARY_EMAIL=self.users['SECRETARIA'].email)
        result = subprocess.run(['node', 'app/frontend/tests/patient-management.browser.mjs'], cwd=workspace,
            env=env, capture_output=True, text=True, timeout=180)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        summary = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(summary['result'], 'PASS')
        patient.refresh_from_db()
        self.assertEqual(patient.email, env['PATIENT_TEST_EMAIL'])
        self.assertEqual(patient.nombre, 'Editado')
        self.assertEqual(patient.paciente.obra_social, '')
        self.assertTrue(patient.is_active)
        self.assertEqual(Turno.objects.filter(pk=turn.pk).values().get(), turn_before)
        self.assertEqual(Triaje.objects.filter(turno=turn).values().get(), triage_before)
        self.assertEqual(len(mail.outbox), 1)  # Only the active-patient recovery sent mail, in memory.
        self.assertEqual(mail.outbox[0].to, [env['PATIENT_TEST_EMAIL']])
        for role, expected_name in [('MEDICO', 'Medico editado'), ('SECRETARIA', 'Secretaria editada')]:
            user = self.users[role]
            original_email = user.email
            original_dni = user.dni
            user.refresh_from_db()
            self.assertEqual((user.nombre, user.apellido, user.telefono), (expected_name, 'Perfil actualizado', '3514445566'))
            self.assertEqual(user.email, original_email)
            self.assertEqual(user.dni, original_dni)
            self.assertEqual(user.fecha_nacimiento.isoformat(), '1987-03-12')
            self.assertTrue(user.check_password('Nueva!Clave4827Az'))
            profile = user.medico if role == 'MEDICO' else user.secretaria
            self.assertEqual(type(profile).objects.filter(pk=profile.pk).values().get(), professional_before[role])
