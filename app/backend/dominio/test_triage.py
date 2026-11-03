from datetime import date
from unittest import TestCase

from .triage import clasificar_triaje, menor_tres_meses, TriajeInvalido


class TriajeTests(TestCase):
    today = date(2026, 11, 2)

    def cm(self, **changes):
        return clasificar_triaje('Clínica Médica', dict(fiebre=False, dificultadRespirar=False, dolor=0, **{}) | changes, self.today)

    def ped(self, **changes):
        answers = dict(fechaNacimiento='2025-01-01', fiebre=False, duracionFiebreHoras=None,
                       dificultadRespirar=False, muyAgitado=False, estadoGeneral='alerta_normal', vomitosRepetidos=False)
        return clasificar_triaje('Pediatría', answers | changes, self.today)

    def test_cm_rules_and_boundaries(self):
        for changes, expected in [({'dificultadRespirar': True}, 'ALTA'), ({'dolor': 7}, 'ALTA'),
                ({'fiebre': True}, 'MEDIA'), ({'dolor': 4}, 'MEDIA'), ({'dolor': 6}, 'MEDIA'),
                ({'dolor': 3}, 'BAJA'), ({'dolor': 0}, 'BAJA'), ({'dolor': 10}, 'ALTA')]:
            with self.subTest(changes=changes):
                self.assertEqual(self.cm(**changes), expected)

    def test_cm_precedence(self):
        self.assertEqual(self.cm(fiebre=True, dolor=8), 'ALTA')
        self.assertEqual(self.cm(fiebre=True, dificultadRespirar=True), 'ALTA')

    def test_cm_invalid_types_and_missing(self):
        for field, values in {'fiebre': [None, 1, 'si'], 'dificultadRespirar': [None, 0, 'false'],
                              'dolor': [None, True, 1.0, '7', -1, 11]}.items():
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises(TriajeInvalido):
                    self.cm(**{field: value})
        for answers in ({}, [], None, {'dificultadRespirar': True}):
            with self.assertRaises(TriajeInvalido):
                clasificar_triaje('Clínica Médica', answers, self.today)

    def test_ped_rules(self):
        for changes, expected in [
            ({'fechaNacimiento': '2026-09-01', 'fiebre': True, 'duracionFiebreHoras': 1}, 'ALTA'),
            ({'dificultadRespirar': True}, 'ALTA'), ({'muyAgitado': True}, 'ALTA'),
            ({'estadoGeneral': 'pobre_respuesta_estimulos'}, 'ALTA'),
            ({'estadoGeneral': 'dificultad_despertar'}, 'ALTA'),
            ({'estadoGeneral': 'letargico_muy_somnoliento'}, 'ALTA'),
            ({'fiebre': True, 'duracionFiebreHoras': 48.1}, 'MEDIA'),
            ({'estadoGeneral': 'decaido_responde_normalmente'}, 'MEDIA'),
            ({'vomitosRepetidos': True}, 'MEDIA'),
            ({'fiebre': True, 'duracionFiebreHoras': 48}, 'MEDIA'),
            ({'fiebre': True, 'duracionFiebreHoras': 0}, 'MEDIA'), ({}, 'BAJA')]:
            with self.subTest(changes=changes):
                self.assertEqual(self.ped(**changes), expected)

    def test_ped_three_month_boundary(self):
        self.assertEqual(self.ped(fechaNacimiento='2026-08-02', fiebre=True, duracionFiebreHoras=1), 'MEDIA')
        self.assertEqual(self.ped(fechaNacimiento='2026-08-03', fiebre=True, duracionFiebreHoras=1), 'ALTA')

    def test_calendar_end_of_month_and_leap(self):
        for birth, before, anniversary in [(date(2023, 11, 30), date(2024, 2, 28), date(2024, 2, 29)),
                (date(2024, 11, 30), date(2025, 2, 27), date(2025, 2, 28)),
                (date(2024, 2, 29), date(2024, 5, 28), date(2024, 5, 29))]:
            self.assertTrue(menor_tres_meses(birth, before))
            self.assertFalse(menor_tres_meses(birth, anniversary))

    def test_ped_precedence(self):
        self.assertEqual(self.ped(muyAgitado=True, vomitosRepetidos=True), 'ALTA')

    def test_ped_invalid_and_complete_before_classification(self):
        for changes in [{'fechaNacimiento': '2026-11-03'}, {'fechaNacimiento': '2025-02-29'},
                {'fechaNacimiento': '20260101'}, {'estadoGeneral': None}, {'muyAgitado': 1},
                {'vomitosRepetidos': 'no'}, {'fiebre': True, 'duracionFiebreHoras': True},
                {'fiebre': True, 'duracionFiebreHoras': float('inf')},
                {'fiebre': True, 'duracionFiebreHoras': -1}, {'duracionFiebreHoras': 0},
                {'dificultadRespirar': True, 'estadoGeneral': 'desconocido'}, {'dolorIntenso': True}]:
            with self.subTest(changes=changes), self.assertRaises(TriajeInvalido):
                self.ped(**changes)

    def test_unsupported_and_invalid_evaluation(self):
        for specialty, evaluation in [('Cardiología', self.today), ('Clínica Médica', None)]:
            with self.assertRaises(TriajeInvalido):
                clasificar_triaje(specialty, {}, evaluation)
