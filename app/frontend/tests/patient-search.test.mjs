import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initPatientSearch } from '../assets/js/features/appointments/patient-search-ui.js';
import { ApiError } from '../assets/js/core/api.js';

// Minimal DOM adapter; the same controller is also exercised in real Chrome.
globalThis.Option = class { constructor(text, value) { this.text = text; this.value = String(value); } };
class Field extends EventTarget {
    value = ''; textContent = ''; attributes = new Map(); options = [];
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    focus() { this.focused = true; }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const patient = { id: 82, nombre: 'Ana', apellido: 'Pérez', dni: '00123456' };
const response = results => ({ count: results.length, results, next: null });
function fixture(search) {
    const fields = Object.fromEntries(['Dni', 'Seleccion', 'Estado', 'Nombre', 'Apellido'].map(s => [s, new Field()]));
    const form = new EventTarget();
    form.querySelector = selector => fields[selector.replace('#asignarPaciente', '')];
    const controller = initPatientSearch(form, search);
    const input = text => { fields.Dni.value = text; fields.Dni.dispatchEvent(new Event('input')); };
    const choose = id => { fields.Seleccion.value = String(id); fields.Seleccion.dispatchEvent(new Event('change')); };
    return { fields, form, controller, input, choose };
}

test('debounce coalesces typing, normalizes whitespace and never autoselects', async () => {
    const calls = [];
    const f = fixture(async q => { calls.push(q); return response([patient]); });
    f.input('An'); f.input('Ana'); f.input(' Ana   Pérez ');
    await wait(100); assert.equal(calls.length, 0);
    await wait(250); assert.deepEqual(calls, ['Ana Pérez']);
    assert.equal(f.controller.getSelectedPatient(), null);
    f.choose(patient.id);
    assert.equal(f.controller.getSelectedPatient().id, 82);
    assert.equal(f.fields.Nombre.value, 'Ana');
    assert.match(f.fields.Estado.textContent, /Seleccionado: Ana Pérez/);
});

test('editing or clearing text immediately invalidates selected ID and names', async () => {
    const f = fixture(async () => response([patient]));
    f.input('Ana'); await wait(340); f.choose(patient.id);
    f.input('A');
    assert.equal(f.controller.getSelectedPatient(), null);
    assert.equal(f.fields.Nombre.value, ''); assert.equal(f.fields.Apellido.value, '');
    await wait(340); assert.equal(f.fields.Seleccion.options.length, 1);
    f.input(''); assert.equal(f.controller.getSelectedPatient(), null);
});

test('obsolete success ignored even if underlying search ignores AbortSignal', async () => {
    const old = deferred(), fresh = deferred(), signals = [];
    const f = fixture((q, signal) => { signals.push(signal); return q === 'Ana' ? old.promise : fresh.promise; });
    f.input('Ana'); await wait(340); f.input('Luis');
    assert.equal(signals[0].aborted, true);
    await wait(340); fresh.resolve(response([{ ...patient, id: 90, nombre: 'Luis' }])); await wait(0);
    old.resolve(response([patient])); await wait(0);
    assert.match(f.fields.Seleccion.options[1].text, /Luis/);
    assert.equal(f.fields.Seleccion.attributes.has('aria-busy'), false);
});

test('obsolete errors and cleanup cannot override a newer loading or result state', async () => {
    const old = deferred(), fresh = deferred();
    const f = fixture(q => q === 'Ana' ? old.promise : fresh.promise);
    f.input('Ana'); await wait(340); f.input('Luis'); await wait(340);
    old.reject(new ApiError(500, null, 'failure')); await wait(0);
    assert.equal(f.fields.Estado.textContent, 'Buscando pacientes…');
    assert.equal(f.fields.Seleccion.attributes.get('aria-busy'), 'true');
    fresh.resolve(response([patient])); await wait(0);
    assert.match(f.fields.Estado.textContent, /Seleccione un paciente/);
});

test('current failures and empty results are visible without selecting a patient', async () => {
    let fail = true;
    const f = fixture(async () => { if (fail) throw new ApiError(0, null, 'network'); return response([]); });
    f.input('Ana'); await wait(340);
    assert.match(f.fields.Estado.textContent, /conectar/);
    assert.equal(f.controller.getSelectedPatient(), null);
    fail = false; f.input('Nada'); await wait(340);
    assert.match(f.fields.Estado.textContent, /No se encontraron/);
    assert.equal(f.controller.getSelectedPatient(), null);
});

test('ambiguous records show IDs; next page only prompts refinement', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; return { count: 40, next: '/api/pacientes/?page=2', results: [patient, { ...patient, id: 83 }] }; });
    f.input('Ana'); await wait(340);
    assert.equal(calls, 1);
    assert.match(f.fields.Seleccion.options[1].text, /ID 82/);
    assert.match(f.fields.Seleccion.options[2].text, /ID 83/);
    assert.match(f.fields.Estado.textContent, /refine la búsqueda/);
    f.choose(83); assert.equal(f.controller.getSelectedPatient().id, 83);
    f.choose(''); assert.equal(f.fields.Nombre.value, '');
});

test('Enter focuses native selector without implicitly reserving; reset cancels pending search', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; return response([patient]); });
    f.input('Ana');
    const key = new Event('keydown', { cancelable: true }); key.key = 'Enter';
    f.fields.Dni.dispatchEvent(key);
    assert.equal(key.defaultPrevented, true); assert.equal(f.fields.Seleccion.focused, true);
    f.form.dispatchEvent(new Event('reset'));
    await wait(340); assert.equal(calls, 0); assert.equal(f.controller.getSelectedPatient(), null);
});

test('invalid normalized lengths never query and remain unselected', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; return response([patient]); });
    for (const text of ['', ' ', 'a', 'x'.repeat(201)]) { f.input(text); await wait(320); }
    assert.equal(calls, 0); assert.equal(f.controller.getSelectedPatient(), null);
});
