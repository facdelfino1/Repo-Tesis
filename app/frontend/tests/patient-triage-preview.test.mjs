import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as patientHistory from '../assets/js/features/appointments/patient-history-service.js';
import { readAnswers, updateTriageQuestionnaire, bindTriageNotice } from '../assets/js/features/triage/triage-ui.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const doctors = {
    clinical: { id: 1, especialidad: { nombre: 'Clínica Médica' } },
    pediatric: { id: 2, especialidad: { nombre: 'Pediatría' } },
    conventional: { id: 3, especialidad: { nombre: 'Cardiología' } }
};
const blocks = [
    { id: 1, fecha: '2026-11-20', hora_inicio: '09:00:00', hora_fin: '09:20:00' },
    { id: 2, fecha: '2026-11-20', hora_inicio: '10:00:00', hora_fin: '10:20:00' },
    { id: 3, fecha: '2026-11-21', hora_inicio: '09:00:00', hora_fin: '09:20:00' }
];

async function setup({ evaluate, availability, notice = false } = {}) {
    const nodes = new Map(), timers = new Map(), evaluations = [], availabilityCalls = [], reservations = [], priorities = [], navigation = [];
    let selectedId = '', selectorChanged, nextTimer = 0;
    class Element extends EventTarget {
        id = ''; value = ''; disabled = false; required = false; className = ''; attrs = new Map(); _html = ''; _text = '';
        set textContent(value) { this._text = value; if (this.id === 'resultadoPrioridad') priorities.push(value); }
        get textContent() { return this._text; }
        set innerHTML(value) { this._html = value; if (this.id === 'disponibilidadLista') selectedId = ''; }
        get innerHTML() { return this._html; }
        classList = {
            add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
            remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
            contains: name => this.className.split(' ').includes(name),
            toggle: (name, force) => { if (force) this.classList.add(name); else this.classList.remove(name); }
        };
        setAttribute(name, value) { this.attrs.set(name, value); }
        replaceChildren() { this.innerHTML = ''; }
        querySelectorAll() { return []; }
        querySelector(selector) {
            if (this.id === 'form') {
                if (notice && selector === '[data-triage-notice]') return node('triageNotice');
                if (selector === '[type="submit"]') return node('consult');
                const radio = selector.match(/^input\[name="([^"]+)"\]:checked$/);
                if (radio) return node(radio[1]).value ? node(radio[1]) : null;
                return null;
            }
            if (this.id === 'disponibilidadLista' && selector === 'input:checked') return selectedId ? { value: selectedId } : null;
            return null;
        }
    }
    const node = id => { if (!nodes.has(id)) { const element = new Element(); element.id = id; nodes.set(id, element); } return nodes.get(id); };
    const form = node('form');
    form.closest = () => null;
    form.elements = { namedItem: node };
    for (const [key, value] of Object.entries({ fiebre: 'no', dificultadRespirar: 'no', rangoDolor: '2',
        fechaNacimiento: '2026-08-21', duracionFiebreHoras: '', muyAgitado: 'no', estadoGeneral: 'alerta_normal', vomitosRepetidos: 'no' })) node(key).value = value;
    const context = vm.createContext({ patientHistory, readAnswers, updateTriageQuestionnaire, bindTriageNotice,
        document: { querySelector: () => form, getElementById: node, querySelectorAll: () => [] },
        getCurrentUser: () => ({ id: 7 }), formatDate: String, priorityClass: value => value,
        escapeHtml: String, getBootstrapModal: () => null, errorMessage: error => error.message,
        pageMessage() {}, window: { location: { assign: path => navigation.push(path) } },
        setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id),
        bindDoctorSelectors: async (_specialty, _doctor, changed) => { selectorChanged = changed; },
        getAvailability: async doctorId => {
            availabilityCalls.push(doctorId);
            return availability ? availability(availabilityCalls.length, doctorId) : blocks;
        },
        evaluatePatientTriage: async (doctorId, answers, blockId) => {
            evaluations.push({ doctorId, answers: structuredClone(answers), blockId });
            const result = evaluate ? await evaluate(evaluations.length, doctorId, answers, blockId) : { prioridad: 'BAJA' };
            return { fecha_atencion: blocks.find(row => row.id === blockId).fecha, fecha_evaluacion: '2026-11-16', ...result };
        },
        reservePatientTurn: async (...args) => { reservations.push(args); return { id_turno: 42, prioridad: 'MEDIA' }; }
    });
    const source = await readFile(new URL('../assets/js/features/appointments/patient-ui.js', import.meta.url), 'utf8');
    const ui = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await ui.link(() => { throw Error('Unexpected import'); }); await ui.evaluate();
    await ui.namespace.initPatientRequest();
    return { node, evaluations, availabilityCalls, reservations, priorities, navigation,
        doctor: async doctor => { await selectorChanged(null); await selectorChanged(doctor); },
        runScheduled: async () => { const jobs = [...timers.values()]; timers.clear(); await Promise.all(jobs.map(callback => callback())); await tick(); },
        consult: async () => { form.dispatchEvent(new Event('submit')); await tick(); },
        slot: async id => { selectedId = String(id); node('disponibilidadLista').dispatchEvent(new Event('change')); await tick(); },
        answer: (name, value, eventType = 'input') => {
            node(name).value = value;
            const event = new Event(eventType);
            Object.defineProperty(event, 'target', { value: { closest: () => ({}) } }); form.dispatchEvent(event);
        },
        reserve: async () => { node('confirmarTurnoBtn').dispatchEvent(new Event('click')); await tick(); }
    };
}

test('completed clinical priority survives consultation and slot/date changes, without loading flashes or repeated evaluations', async () => {
    const page = await setup(); await page.doctor(doctors.clinical); await page.runScheduled();
    assert.equal(page.node('resultadoPrioridad').textContent, 'BAJA'); assert.equal(page.evaluations.length, 1);
    page.priorities.length = 0;
    await page.consult(); await page.slot(1); await page.slot(2); await page.slot(3);
    assert.equal(page.evaluations.length, 1); assert.equal(page.node('resultadoPrioridad').textContent, 'BAJA');
    assert.equal(page.node('resultadoFechaAtencion').textContent, 'Fecha de atención: 2026-11-21');
    assert.equal(page.node('confirmarTurnoBtn').disabled, false);
    await page.consult(); await page.slot(3);
    assert.equal(page.evaluations.length, 1);
    assert.ok(!page.priorities.includes('Evaluando…')); assert.ok(!page.priorities.includes('—'));
    await page.reserve();
    assert.equal(page.reservations.length, 1);
    assert.deepEqual(page.reservations[0], [1, 3, { fiebre: false, dificultadRespirar: false, dolor: 2 }]);
    assert.deepEqual(page.navigation, ['turno-reservado.html?id=42']); // server identity, no cached priority sent or persisted
});

test('pediatric date changes re-evaluate, while different times on the same date reuse the evaluation', async () => {
    const page = await setup({ evaluate: async (_count, _doctor, _answers, block) => ({ prioridad: block === 3 ? 'MEDIA' : 'ALTA' }) });
    page.node('fiebre').value = 'si'; page.node('duracionFiebreHoras').value = '1';
    await page.doctor(doctors.pediatric); await page.runScheduled();
    await page.consult(); await page.slot(1); await page.slot(2);
    assert.equal(page.evaluations.length, 1); assert.equal(page.node('resultadoPrioridad').textContent, 'ALTA');
    await page.slot(3);
    assert.equal(page.evaluations.length, 2); assert.equal(page.node('resultadoPrioridad').textContent, 'MEDIA');
    assert.equal(page.evaluations[1].answers.fechaNacimiento, '2026-08-21');
    assert.equal(page.node('resultadoFechaAtencion').textContent, 'Fecha de atención: 2026-11-21');
});

test('real answer changes invalidate the priority, while the matching change event does not invalidate it again', async () => {
    const page = await setup({ evaluate: async count => ({ prioridad: count === 1 ? 'BAJA' : 'ALTA' }) });
    await page.doctor(doctors.clinical); await page.runScheduled();
    page.answer('rangoDolor', '8'); await page.runScheduled();
    assert.equal(page.evaluations.length, 2); assert.equal(page.node('resultadoPrioridad').textContent, 'ALTA');
    page.priorities.length = 0;
    page.answer('rangoDolor', '8', 'change'); await page.runScheduled();
    assert.equal(page.evaluations.length, 2); assert.deepEqual(page.priorities, []);
    page.answer('rangoDolor', ''); await page.runScheduled();
    assert.equal(page.evaluations.length, 2); assert.ok(page.node('triajeResultado').classList.contains('d-none'));
});

test('concurrent automatic and manual consultations share the same in-flight evaluation', async () => {
    const pending = deferred(), page = await setup({ evaluate: () => pending.promise });
    await page.doctor(doctors.clinical);
    const automatic = page.runScheduled(); await tick();
    await page.consult(); await page.consult();
    assert.equal(page.evaluations.length, 1);
    pending.resolve({ prioridad: 'MEDIA' }); await automatic; await tick();
    assert.equal(page.node('resultadoPrioridad').textContent, 'MEDIA');
    await page.slot(2); assert.equal(page.evaluations.length, 1);
});

test('obsolete evaluation success or failure cannot overwrite a newer priority or its errors', async () => {
    for (const failOld of [false, true]) {
        const pending = deferred();
        const page = await setup({ evaluate: count => count === 1 ? pending.promise : { prioridad: 'ALTA' } });
        await page.doctor(doctors.clinical);
        const old = page.runScheduled(); await tick();
        page.answer('rangoDolor', '8'); await page.runScheduled();
        if (failOld) pending.reject(new Error('Error de una evaluación antigua')); else pending.resolve({ prioridad: 'BAJA' });
        await old;
        assert.equal(page.node('resultadoPrioridad').textContent, 'ALTA');
        assert.equal(page.node('triajeError').textContent, '');
        assert.equal(page.node('triajeResultado').attrs.get('aria-busy'), 'false');
    }
});

test('manual consultation invalidates a stale automatic availability response without discarding a valid priority', async () => {
    const available = deferred();
    const page = await setup({ availability: count => count === 1 ? available.promise : [blocks[2]],
        evaluate: () => ({ prioridad: 'MEDIA' }) });
    await page.doctor(doctors.pediatric); const automatic = page.runScheduled(); await tick();
    await page.consult(); assert.equal(page.evaluations.length, 1);
    available.resolve([blocks[0]]); await automatic;
    assert.equal(page.evaluations.length, 1); assert.equal(page.node('resultadoPrioridad').textContent, 'MEDIA');
});

test('failed evaluations are reported, not cached, and can be retried normally', async () => {
    const page = await setup({ evaluate: count => { if (count === 1) throw new Error('Cuestionario inválido'); return { prioridad: 'BAJA' }; } });
    await page.doctor(doctors.clinical); await page.runScheduled();
    assert.equal(page.node('triajeError').textContent, 'Cuestionario inválido');
    assert.equal(page.node('triajeResultado').attrs.get('aria-busy'), 'false');
    await page.consult();
    assert.equal(page.evaluations.length, 2); assert.equal(page.node('resultadoPrioridad').textContent, 'BAJA');
    assert.equal(page.node('triajeError').textContent, '');
});

test('availability errors preserve the valid clinical result while leaving reservation disabled', async () => {
    const page = await setup({ availability: count => { if (count === 2) throw new Error('No se pudo consultar la disponibilidad'); return blocks; } });
    await page.doctor(doctors.clinical); await page.runScheduled();
    page.priorities.length = 0;
    await page.consult();
    assert.equal(page.evaluations.length, 1);
    assert.equal(page.node('resultadoPrioridad').textContent, 'BAJA');
    assert.equal(page.node('disponibilidadError').textContent, 'No se pudo consultar la disponibilidad');
    assert.equal(page.node('confirmarTurnoBtn').disabled, true);
    assert.deepEqual(page.priorities, []);
});

test('patient notice responds to specialty changes before a doctor is selected', async () => {
    const page = await setup({ notice: true });
    const specialty = page.node('especialidad'), notice = page.node('triageNotice');
    assert.equal(notice.classList.contains('d-none'), true);
    for (const [value, label, hidden] of [
        ['1', 'Clínica Médica', false], ['2', 'Cardiología', true],
        ['3', 'Pediatría', false], ['', 'Seleccione una especialidad', true]
    ]) {
        specialty.value = value;
        specialty.selectedOptions = [{ textContent: label }];
        specialty.dispatchEvent(new Event('change'));
        assert.equal(notice.classList.contains('d-none'), hidden);
    }
    assert.equal(page.evaluations.length, 0);
    assert.equal(page.reservations.length, 0);
});

test('specialty changes invalidate context, and conventional specialties never evaluate or display priority', async () => {
    const page = await setup(); await page.doctor(doctors.clinical); await page.runScheduled();
    await page.doctor(doctors.pediatric); await page.runScheduled(); assert.equal(page.evaluations.length, 2);
    await page.doctor(doctors.conventional); await page.runScheduled();
    await page.consult(); await page.slot(2); await page.reserve();
    assert.equal(page.evaluations.length, 2); assert.ok(page.node('triajeResultado').classList.contains('d-none'));
    assert.deepEqual(page.reservations[0], [3, 2, undefined]);
});
