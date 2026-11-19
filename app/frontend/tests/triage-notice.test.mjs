import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindTriageNotice } from '../assets/js/features/triage/triage-ui.js';

function setup(modalMode) {
    const hidden = new Set(['d-none']);
    const notice = { classList: { toggle(name, force) { if (force) hidden.add(name); else hidden.delete(name); } } };
    const specialty = new EventTarget();
    specialty.value = ''; specialty.selectedOptions = [];
    const modal = new EventTarget(), form = new EventTarget();
    form.querySelector = () => notice;
    form.closest = () => modalMode ? modal : null;
    const update = bindTriageNotice(form, specialty);
    const select = (id, label, notify = true) => {
        specialty.value = id;
        specialty.selectedOptions = [{ textContent: label }];
        if (notify) specialty.dispatchEvent(new Event('change'));
    };
    return { form, modal, update, select, isHidden: () => hidden.has('d-none') };
}

for (const [profile, modalMode] of [['Paciente', false], ['Secretaría', true]]) {
    test(`${profile}: specialty alone controls notice, including changes and clearing`, () => {
        const page = setup(modalMode);
        assert.equal(page.isHidden(), true);
        // IDs are catalog identifiers; the shared triage service interprets the specialty name.
        for (const [id, name, hidden] of [
            ['21', 'Clínica Médica', false], ['87', 'Cardiología', true],
            ['33', 'Pediatría', false], ['', 'Seleccione una especialidad', true],
            ['87', 'Cardiología', true], ['21', 'Clínica Médica', false]
        ]) {
            page.select(id, name);
            assert.equal(page.isHidden(), hidden, name);
        }
        // A doctor selector may synchronize the specialty programmatically.
        page.select('87', 'Cardiología', false); page.update();
        assert.equal(page.isHidden(), true);
    });

    test(`${profile}: form reset hides the notice after native values reset`, async () => {
        const page = setup(modalMode);
        page.select('21', 'Clínica Médica');
        page.form.dispatchEvent(new Event('reset'));
        page.select('', 'Seleccione una especialidad', false);
        await new Promise(resolve => queueMicrotask(resolve));
        assert.equal(page.isHidden(), true);
    });
}

test('Secretaría: reopening modal rechecks current specialty instead of retaining stale visibility', () => {
    const page = setup(true);
    page.select('21', 'Clínica Médica');
    assert.equal(page.isHidden(), false);
    page.modal.dispatchEvent(new Event('hidden.bs.modal'));
    page.select('', 'Seleccione una especialidad', false);
    page.modal.dispatchEvent(new Event('show.bs.modal'));
    assert.equal(page.isHidden(), true);
    page.select('33', 'Pediatría', false);
    page.modal.dispatchEvent(new Event('show.bs.modal'));
    assert.equal(page.isHidden(), false);
});

test('both original notices start hidden in HTML, before JavaScript or catalogs load', async () => {
    const pages = [
        ['paciente/solicitar-turno.html', '<strong>Importante:</strong> Este cuestionario tiene como finalidad establecer una prioridad preliminar para la gestión de solicitudes de turnos. No constituye un diagnóstico médico ni reemplaza la evaluación de un profesional de la salud. Ante una situación que considere una emergencia, diríjase a un servicio de urgencias.'],
        ['secretaria/gestion-turnos.html', 'Priorización preliminar ambulatoria basada en síntomas autoinformados. No constituye diagnóstico ni reemplaza una evaluación médica.']
    ];
    for (const [path, originalText] of pages) {
        const html = await readFile(new URL('../pages/' + path, import.meta.url), 'utf8');
        const notices = [...html.matchAll(/<p\b([^>]*\bdata-triage-notice[^>]*)>(.*?)<\/p>/gs)];
        assert.equal(notices.length, 1, path);
        assert.match(notices[0][1], /class="[^"]*\bd-none\b/);
        assert.equal(notices[0][2], originalText);
    }
});
