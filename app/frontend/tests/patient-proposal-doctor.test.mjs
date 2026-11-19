import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { escapeHtml } from '../assets/js/core/helpers.js';
import { proposalStateLabel } from '../assets/js/features/rescheduling/state-labels.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const doctors = [1, 2, 3].map(id => ({ id, nombre: 'Andrea', apellido: 'Pérez', especialidad: { id, nombre: `Especialidad ${id}` } }));
const turns = doctors.map((medico, index) => ({ id_turno: index + 10, medico }));
const proposal = (id, turno, estado = 'EN_ESPERA') => ({ id, turno, estado, motivo: `Motivo ${id}`, vigente: estado === 'EN_ESPERA',
    fecha_origen: '2026-10-01', hora_origen: '09:00:00', fecha_destino: '2026-11-20',
    hora_inicio_destino: '10:00:00', hora_fin_destino: '10:20:00', fecha_hora_creacion: '2026-11-01T12:00:00Z',
    fecha_hora_resolucion: estado === 'EN_ESPERA' ? null : '2026-11-02T12:00:00Z', motivo_cierre: '' });
const fixtures = () => ['EN_ESPERA', 'ACEPTADA', 'RECHAZADA', 'ANULADA', 'INVALIDADA']
    .map((state, index) => proposal(index + 1, 10, state)).concat(proposal(6, 11));

class Element extends EventTarget {
    value = ''; disabled = false; innerHTML = ''; textContent = ''; className = ''; options = []; children = new Map();
    querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Element()); return this.children.get(selector); }
    querySelectorAll() { return []; }
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
}

async function setup({ filterByDoctor = true, initialProposals = fixtures(), responseFailure = null } = {}) {
    const section = new Element(), queue = [], calls = { proposals: 0, turns: 0, writes: [], updates: 0 };
    let data = initialProposals;
    const context = vm.createContext({ document: { createElement: () => section, querySelector: () => ({ append() {} }) },
        Option: class { constructor(text, value) { this.text = text; this.value = String(value); } },
        formatDate: String, esc: escapeHtml, proposalStateLabel, errorMessage: error => error.message,
        window: { confirm: () => true },
        getPatientTurns: async () => { calls.turns++; return structuredClone(turns); },
        api: {
            getPatientProposals: async () => { calls.proposals++; return structuredClone(queue.length ? await queue.shift() : data); },
            getProposal: async id => structuredClone(data.find(p => p.id === Number(id))),
            respondProposal: async (id, decision) => {
                calls.writes.push({ id, decision });
                if (responseFailure) throw responseFailure;
                const p = data.find(p => p.id === id); p.estado = decision === 'aceptar' ? 'ACEPTADA' : 'RECHAZADA';
                return structuredClone(p);
            }
        }
    });
    const source = await readFile(new URL('../assets/js/features/rescheduling/rescheduling-ui.js', import.meta.url), 'utf8');
    const ui = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await ui.link(() => { throw Error('Unexpected import'); }); await ui.evaluate();
    const controller = await ui.namespace.initPatientProposals({ filterByDoctor, initialTurns: structuredClone(turns),
        onUpdated: async () => { calls.updates++; } });
    const select = section.querySelector('[data-doctor]'), list = section.querySelector('[data-proposals]');
    return { section, select, list, calls, controller,
        choose: (value, type = 'change') => { select.value = String(value); select.dispatchEvent(new Event(type)); },
        queue: promise => queue.push(promise), data: value => { data = value; },
        action: async (id, decision) => {
            const event = new Event('click');
            Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset: { proposal: String(id), decision } }) } });
            list.dispatchEvent(event); await tick(); await tick();
        }
    };
}
const prompt = /Seleccione un médico para consultar sus propuestas de reprogramación/;
const proposalIds = page => [...new Set([...page.list.innerHTML.matchAll(/data-proposal="(\d+)"/g)].map(([, id]) => Number(id)))];

test('initial proposals stay hidden and doctor options come only from associated proposals, not all appointments', async () => {
    const page = await setup();
    assert.equal(page.select.value, ''); assert.match(page.list.innerHTML, prompt);
    assert.deepEqual(proposalIds(page), []);
    assert.deepEqual(page.select.options.map(option => option.value), ['', '1', '2']);
    assert.equal(page.calls.turns, 0); assert.equal(page.calls.proposals, 1); // reuse initial dashboard snapshot
    assert.equal(page.section.innerHTML.includes('data-specialty'), false);
});

test('filters by real doctor ID despite identical names, preserves every state/detail and makes no filtering requests', async () => {
    const page = await setup();
    page.choose('1'); assert.deepEqual(proposalIds(page), [1, 2, 3, 4, 5]);
    for (const state of ['EN_ESPERA', 'ACEPTADA', 'RECHAZADA', 'ANULADA', 'INVALIDADA']) {
        assert.ok(page.list.innerHTML.includes(proposalStateLabel(state)));
    }
    for (const text of ['2026-10-01', '2026-11-20', '09:00', '10:00', 'Motivo 1', 'Generada:', 'Resolución:']) {
        assert.ok(page.list.innerHTML.includes(text));
    }
    page.choose('2', 'input'); assert.deepEqual(proposalIds(page), [6]);
    page.choose(''); assert.deepEqual(proposalIds(page), []); assert.match(page.list.innerHTML, prompt);
    assert.equal(page.calls.proposals, 1); assert.equal(page.calls.turns, 0);
    assert.equal(page.calls.updates, 0); assert.deepEqual(page.calls.writes, []);
});

test('refresh preserves the current valid doctor, including changes or clearing while the response is pending', async () => {
    const page = await setup(); page.choose('1');
    await page.controller.refresh(); assert.equal(page.select.value, '1'); assert.deepEqual(proposalIds(page), [1,2,3,4,5]);
    const pending = deferred(); page.queue(pending.promise); const updating = page.controller.refresh();
    page.choose('2'); pending.resolve(fixtures()); await updating;
    assert.equal(page.select.value, '2'); assert.deepEqual(proposalIds(page), [6]);
    const cleared = deferred(); page.queue(cleared.promise); const refreshing = page.controller.refresh();
    page.choose(''); cleared.resolve(fixtures()); await refreshing;
    assert.equal(page.select.value, ''); assert.deepEqual(proposalIds(page), []); assert.match(page.list.innerHTML, prompt);
});

test('obsolete responses cannot replace newer data and removed doctors clear the selection', async () => {
    const page = await setup(); page.choose('1');
    const old = deferred(), current = deferred();
    page.queue(old.promise); const first = page.controller.refresh();
    page.queue(current.promise); const second = page.controller.refresh();
    current.resolve([proposal(6,11)]); await second;
    old.resolve(fixtures()); await first;
    assert.deepEqual(page.select.options.map(option => option.value), ['', '2']);
    assert.equal(page.select.value, ''); assert.match(page.list.innerHTML, prompt);
});

test('acceptance and rejection update state normally and keep the selected doctor', async () => {
    for (const [decision, label] of [['aceptar', 'Aceptada'], ['rechazar', 'Rechazada']]) {
        const page = await setup(); page.choose('2');
        await page.action(6, decision);
        assert.deepEqual(page.calls.writes, [{ id: 6, decision }]);
        assert.equal(page.calls.updates, 1);
        assert.equal(page.select.value, '2'); assert.deepEqual(proposalIds(page), [6]);
        assert.ok(page.list.innerHTML.includes(label));
        assert.doesNotMatch(page.list.innerHTML, /data-decision="aceptar"|data-decision="rechazar"/);
    }
});

test('errors keep their message and selection; default unfiltered mode retains Mis turnos behavior', async () => {
    const page = await setup({ responseFailure: { status: 409, message: 'La propuesta ya no está vigente.' } });
    page.choose('2'); await page.action(6, 'aceptar');
    assert.equal(page.section.querySelector('[data-feedback]').textContent, 'La propuesta ya no está vigente.');
    assert.equal(page.select.value, '2'); assert.deepEqual(proposalIds(page), [6]);
    const unfiltered = await setup({ filterByDoctor: false });
    assert.deepEqual(proposalIds(unfiltered), [1,2,3,4,5,6]);
    assert.equal(unfiltered.section.innerHTML.includes('data-doctor'), false);
    const empty = await setup({ initialProposals: [] });
    assert.equal(empty.select.disabled, true); assert.match(empty.list.innerHTML, prompt);
    page.choose('99'); assert.match(page.list.innerHTML, /No hay propuestas de reprogramación para el médico seleccionado/);
});
