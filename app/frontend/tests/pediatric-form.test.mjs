import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPediatricCleanup } from '../assets/js/features/appointments/pediatric-form.js';
import { renderTriageResponses } from '../assets/js/features/triage/triage-ui.js';

function setup() {
    const form = new EventTarget(), specialty = new EventTarget(), patient = new EventTarget(), modal = new EventTarget();
    const controls = [{ type: 'date', value: '' }, { type: 'number', value: '' },
        { type: 'radio', checked: false }, { type: 'select-one', value: '' }];
    form.querySelectorAll = selector => {
        assert.match(selector, /data-triage-specialty="pediatria"/);
        return controls;
    };
    form.querySelector = () => patient;
    form.closest = () => modal;
    const clear = bindPediatricCleanup(form, specialty);
    function fill() { controls[0].value = '2020-01-01'; controls[1].value = '3'; controls[2].checked = true; controls[3].value = 'alerta_normal'; }
    function empty() { assert.equal(controls[0].value, ''); assert.equal(controls[1].value, ''); assert.equal(controls[2].checked, false); assert.equal(controls[3].value, ''); }
    return { form, specialty, patient, modal, clear, fill, empty, controls };
}

test('specialty change, modal closing and patient change clear previous pediatric data', () => {
    const page = setup();
    for (const [target, event] of [[page.specialty, 'change'], [page.modal, 'hidden.bs.modal'], [page.form, 'patient-selection-change']]) {
        page.fill(); target.dispatchEvent(new Event(event)); page.empty();
        page.fill(); target.dispatchEvent(new Event(event)); page.empty();
    }
});

test('native reset clears pediatric values after the browser restores defaults', async () => {
    const page = setup();
    page.form.dispatchEvent(new Event('reset'));
    page.fill(); // native reset may restore non-empty default values after the event
    await new Promise(resolve => queueMicrotask(resolve));
    page.empty();
});

test('successful reservation cleanup prevents reuse while ordinary input does not erase birth', () => {
    const page = setup();
    page.fill(); page.form.dispatchEvent(new Event('input'));
    assert.equal(page.controls[0].value, '2020-01-01');
    page.clear(); page.empty();
});

test('professional detail can omit raw birth from symptoms without changing saved answers', () => {
    const answers = { fechaNacimiento: '2020-01-01', fiebre: false };
    const html = renderTriageResponses(answers, 'pediatria', { includeBirth: false });
    assert.doesNotMatch(html, /2020-01-01|Fecha de nacimiento/);
    assert.match(html, /Fiebre/);
    assert.equal(answers.fechaNacimiento, '2020-01-01');
    assert.match(renderTriageResponses(answers, 'pediatria'), /01-01-2020/);
    assert.match(renderTriageResponses({ fechaNacimiento: null }, 'pediatria'), /No registrada/);
});
