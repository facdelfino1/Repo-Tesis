import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initPatientSearch } from '../assets/js/features/appointments/patient-search-ui.js';
import { bindPediatricCleanup } from '../assets/js/features/appointments/pediatric-form.js';
import { ApiError } from '../assets/js/core/api.js';

class Field extends EventTarget {
    value = ''; textContent = ''; attributes = new Map(); children = []; hidden = true;
    classes = new Set();
    classList = {
        add: name => this.classes.add(name), remove: name => this.classes.delete(name),
        toggle: (name, yes) => yes ? this.classes.add(name) : this.classes.delete(name)
    };
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    contains(node) { return this.children.includes(node); }
    focus() { this.focused = true; }
    scrollIntoView() {}
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const patient = { id: 82, nombre: 'Ana', apellido: 'Pérez', dni: '00123456', telefono: '5550100' };
const response = results => ({ count: results.length, results, next: null });
function fixture(search) {
    const fields = Object.fromEntries(['Dni', 'Sugerencias', 'Estado', 'Nombre', 'Apellido', 'Telefono'].map(s => [s, new Field()]));
    const form = new EventTarget(), modal = new EventTarget(), pediatric = { type: 'date', value: '' };
    form.querySelector = selector => fields[selector.replace('#asignarPaciente', '')] || null;
    form.querySelectorAll = () => [pediatric];
    form.ownerDocument = { createElement: () => new Field() };
    form.closest = () => modal;
    const controller = initPatientSearch(form, search);
    bindPediatricCleanup(form, new EventTarget());
    const input = (text, field = 'Nombre') => { fields[field].value = text; fields[field].dispatchEvent(new Event('input')); };
    const choose = (index = 0) => fields.Sugerencias.children[index].dispatchEvent(new Event('click'));
    const key = (key, field = 'Nombre') => {
        const event = new Event('keydown', { cancelable: true }); event.key = key;
        fields[field].dispatchEvent(event); return event;
    };
    return { fields, form, modal, pediatric, controller, input, choose, key };
}

test('each identification field searches its own normalized content after 300 ms, never autoselecting', async () => {
    const calls = [], f = fixture(async q => { calls.push(q); return response([patient]); });
    for (const field of ['Nombre', 'Apellido', 'Dni']) {
        f.input('An', field); f.input(' Ana   Pérez ', field);
        await wait(100); assert.equal(calls.length, ['Nombre', 'Apellido', 'Dni'].indexOf(field));
        await wait(250);
        assert.equal(calls.at(-1), 'Ana Pérez');
        assert.equal(f.controller.getSelectedPatient(), null);
        assert.equal(f.fields.Sugerencias.hidden, false);
    }
    assert.equal(calls.length, 3);
});

test('explicit selection fills all four fields, preserves leading zeroes and hides results, not ID', async () => {
    let signal;
    const f = fixture(async (_q, current) => { signal = current; return response([patient]); });
    f.input('0012', 'Dni'); await wait(340); f.choose();
    assert.deepEqual(['Nombre', 'Apellido', 'Dni', 'Telefono'].map(k => f.fields[k].value), ['Ana', 'Pérez', '00123456', '5550100']);
    assert.equal(f.controller.getSelectedPatient().id, 82);
    assert.equal(signal.aborted, true);
    assert.equal(f.fields.Sugerencias.hidden, true);
    assert.equal(f.fields.Dni.attributes.get('aria-expanded'), 'false');
    assert.match(f.fields.Estado.textContent, /Paciente seleccionado/);
});

test('empty, null or omitted phone does not prevent selection', async () => {
    for (const telefono of ['', ' ', null, undefined]) {
        const f = fixture(async () => response([{ ...patient, telefono }]));
        f.input('Ana'); await wait(340); f.choose();
        assert.equal(f.fields.Telefono.value, 'No registrado');
        assert.equal(f.controller.getSelectedPatient().id, 82);
    }
});

test('editing any identifying field invalidates ID, clears other data and pediatric answers, preserving typed text', async () => {
    for (const field of ['Nombre', 'Apellido', 'Dni']) {
        const f = fixture(async () => response([patient]));
        f.input('Ana'); await wait(340); f.choose(); f.pediatric.value = '2020-01-01';
        f.input('X', field);
        assert.equal(f.controller.getSelectedPatient(), null);
        for (const name of ['Nombre', 'Apellido', 'Dni', 'Telefono']) assert.equal(f.fields[name].value, name === field ? 'X' : '');
        assert.equal(f.pediatric.value, '');
        assert.equal(f.fields.Sugerencias.hidden, true);
    }
});

test('rapid switches between fields cancel timers and requests; obsolete successes cannot replace current matches', async () => {
    const old = deferred(), fresh = deferred(), calls = [], signals = [];
    const f = fixture((q, signal) => { calls.push(q); signals.push(signal); return q === 'Ana' ? old.promise : fresh.promise; });
    f.input('discard'); f.input('Ana', 'Apellido'); await wait(340);
    f.input('0012', 'Dni'); assert.equal(signals[0].aborted, true); await wait(340);
    fresh.resolve(response([{ ...patient, id: 90 }])); await wait(0);
    f.choose(); assert.equal(f.controller.getSelectedPatient().id, 90);
    old.resolve(response([patient])); await wait(0);
    assert.deepEqual(calls, ['Ana', '0012']);
    assert.equal(f.controller.getSelectedPatient().id, 90);
    assert.equal(f.fields.Sugerencias.hidden, true);
});

test('obsolete errors and cleanup cannot override newer loading or result states', async () => {
    const old = deferred(), fresh = deferred();
    const f = fixture(q => q === 'Ana' ? old.promise : fresh.promise);
    f.input('Ana'); await wait(340); f.input('Luis'); await wait(340);
    old.reject(new ApiError(500, null, 'failure')); await wait(0);
    assert.equal(f.fields.Estado.textContent, 'Buscando pacientes…');
    assert.equal(f.fields.Sugerencias.attributes.get('aria-busy'), 'true');
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
    assert.equal(f.fields.Sugerencias.hidden, true);
});

test('duplicates show IDs and paging prompts refinement; phone never appears in suggestions', async () => {
    const f = fixture(async () => ({ count: 40, next: '/api/pacientes/?page=2', results: [patient, { ...patient, id: 83 }] }));
    f.input('Ana'); await wait(340);
    assert.match(f.fields.Sugerencias.children[0].textContent, /ID 82/);
    assert.match(f.fields.Sugerencias.children[1].textContent, /ID 83/);
    assert.doesNotMatch(f.fields.Sugerencias.children[0].textContent, /5550100/);
    assert.match(f.fields.Estado.textContent, /refine la búsqueda/);
    f.choose(1); assert.equal(f.controller.getSelectedPatient().id, 83);
});

test('keyboard navigation selects explicitly and Enter never implicitly submits', async () => {
    const f = fixture(async () => response([patient, { ...patient, id: 83 }]));
    f.input('Ana'); await wait(340);
    assert.equal(f.key('Enter').defaultPrevented, true);
    assert.equal(f.controller.getSelectedPatient(), null);
    f.key('ArrowDown');
    assert.equal(f.fields.Nombre.attributes.get('aria-activedescendant'), 'asignarPacienteOpcion0');
    f.key('ArrowUp');
    assert.equal(f.fields.Sugerencias.children[1].attributes.get('aria-selected'), 'true');
    f.key('Enter'); assert.equal(f.controller.getSelectedPatient().id, 83);
    f.input('Ana'); await wait(340); f.key('Escape');
    assert.equal(f.fields.Sugerencias.hidden, true);
    assert.equal(f.controller.getSelectedPatient(), null);
});

test('selection change also clears pediatric answers', async () => {
    const f = fixture(async () => response([patient]));
    f.input('Ana'); await wait(340); f.pediatric.value = '2020-01-01'; f.choose();
    assert.equal(f.pediatric.value, '');
});

test('reset, modal close/reopen and explicit success cleanup clear selected patient and pending work', async () => {
    for (const clean of [f => f.form.dispatchEvent(new Event('reset')), f => f.modal.dispatchEvent(new Event('hidden.bs.modal')),
        f => f.modal.dispatchEvent(new Event('show.bs.modal')), f => f.controller.clear()]) {
        const f = fixture(async () => response([patient]));
        f.input('Ana'); await wait(340); f.choose(); clean(f); await wait(0);
        assert.equal(f.controller.getSelectedPatient(), null);
        assert.equal(f.fields.Telefono.value, '');
        assert.equal(f.fields.Nombre.value, '');
        assert.equal(f.fields.Sugerencias.hidden, true);
    }
    const pending = deferred(), f = fixture(() => pending.promise);
    f.input('Ana'); await wait(340); f.modal.dispatchEvent(new Event('hide.bs.modal'));
    f.modal.dispatchEvent(new Event('hidden.bs.modal')); f.modal.dispatchEvent(new Event('show.bs.modal'));
    pending.resolve(response([patient])); await wait(0);
    assert.equal(f.fields.Sugerencias.hidden, true);
    assert.doesNotMatch(f.fields.Estado.textContent, /coincidencia/);
    let calls = 0;
    const g = fixture(async () => { calls++; return response([]); });
    g.input('Ana'); g.controller.clear(); await wait(340); assert.equal(calls, 0);
});

test('invalid normalized lengths never query; programmatic identity mismatch cannot return selected ID', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; return response([patient]); });
    for (const text of ['', ' ', 'a', 'x'.repeat(201)]) { f.input(text); await wait(320); }
    assert.equal(calls, 0);
    f.input('Ana'); await wait(340); f.choose();
    f.fields.Dni.value = 'different';
    assert.equal(f.controller.getSelectedPatient(), null);
    assert.equal(f.fields.Telefono.value, '');
});
