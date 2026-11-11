import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element extends EventTarget {
    value = ''; disabled = false; innerHTML = ''; textContent = ''; children = new Map();
    classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
    querySelector(selector) {
        if (!this.children.has(selector)) this.children.set(selector, new Element());
        return this.children.get(selector);
    }
    querySelectorAll() { return []; }
    append() {} prepend() {} setAttribute() {}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function clickWithTarget(element, dataset) {
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset }) } });
    element.dispatchEvent(event);
}
const deferred = () => {
    let resolve; const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
function dom() {
    const root = new Element();
    return { getElementById: id => root.querySelector(id),
        querySelector: selector => root.querySelector(selector), querySelectorAll: () => [],
        createElement: () => new Element() };
}
async function load(path, globals = {}) {
    const source = await readFile(new URL('../assets/js/features/' + path, import.meta.url), 'utf8');
    const context = vm.createContext({ console, URL, Map, Set, Date, document: dom(),
        Option: class { constructor(text, value) { this.text = text; this.value = String(value); } },
        getBootstrapModal: () => null, getCurrentUser: () => ({ nombre: 'Test', apellido: 'User' }),
        formatDate: value => value, escapeHtml: value => value, esc: value => value,
        errorMessage: () => 'Error', priorityClass: () => '', pageMessage() {}, ...globals });
    // Execute the actual module functions with controlled API/DOM dependencies.
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await module.link(() => { throw new Error('Unexpected import'); });
    await module.evaluate();
    return module.namespace;
}

test('two secretary selectors share one initialization snapshot and later changes fetch fresh data', async () => {
    const calls = [], specialty = deferred(), doctors = deferred();
    const catalog = await load('catalog/catalog-service.js', {
        listAll: path => {
            calls.push(path);
            return path === 'especialidades/' ? specialty.promise : doctors.promise;
        }
    });
    const pending = catalog.loadDoctorCatalog();
    assert.deepEqual(calls, ['especialidades/', 'medicos/']); // independent requests already started
    specialty.resolve([{ id: 1, nombre: 'Test' }]); doctors.resolve([]);
    const snapshot = await pending;
    const first = [new Element(), new Element()], second = [new Element(), new Element()];
    await catalog.bindDoctorSelectors(...first, () => {}, snapshot);
    await catalog.bindDoctorSelectors(...second, () => {}, snapshot);
    assert.equal(calls.length, 2); // formerly four list requests
    first[0].value = '1'; first[0].dispatchEvent(new Event('change')); await tick();
    assert.equal(calls.at(-1), 'medicos/?especialidad=1');
    assert.equal(calls.length, 3);
    calls.length = 0;
    await catalog.bindDoctorSelectors(new Element(), new Element());
    await catalog.bindDoctorSelectors(new Element(), new Element());
    assert.equal(calls.length, 4); // measured baseline without the initialization snapshot
});

test('secretary management wires both selectors to the shared catalog', async () => {
    let loads = 0;
    const snapshots = [], snapshot = { specialties: [], doctors: [] };
    const agenda = await load('appointments/agenda-ui.js', {
        getCurrentUser: () => ({ rol: 'SECRETARIA' }),
        loadDoctorCatalog: async () => { loads++; return snapshot; },
        bindDoctorSelectors: async (_specialty, _doctor, _callback, initial) => { snapshots.push(initial); },
        initPatientSearch: () => ({}), updateTriageQuestionnaire() {},
        todayInputValue: () => '2030-01-01'
    });
    await agenda.initOperationalAgenda('management');
    assert.equal(loads, 1); assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0], snapshot); assert.equal(snapshots[1], snapshot);
});

test('patient proposals reuse even an empty initial snapshot, then refresh and writes fetch again', async () => {
    let reads = 0, proposalReads = 0, writes = 0, updates = 0;
    const document = dom();
    const section = new Element(); document.createElement = () => section;
    const proposals = await load('rescheduling/rescheduling-ui.js', {
        document, getPatientTurns: async () => { reads++; return []; },
        window: { confirm: () => true },
        api: { getPatientProposals: async () => { proposalReads++; return []; },
            getProposal: async () => ({ id: 1, estado: 'EN_ESPERA' }),
            respondProposal: async () => { writes++; return { id: 1, estado: 'ACEPTADA' }; } },
        proposalStateLabel: value => value
    });
    const controller = await proposals.initPatientProposals({ initialTurns: [], onUpdated: async () => { updates++; } });
    assert.equal(reads, 0); assert.equal(proposalReads, 1);
    await controller.refresh(); assert.equal(reads, 1);
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset: { proposal: '1', decision: 'aceptar' } }) } });
    section.querySelector('[data-proposals]').dispatchEvent(event); await tick(); await tick();
    assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(updates, 1);
});

for (const [name, initializer] of [['Dashboard', 'initPatientDashboard'], ['Mis turnos', 'initPatientTurns']]) {
    test(`patient ${name} passes its only initial turns request to proposals`, async () => {
        let reads = 0, shared;
        const patient = await load('appointments/patient-ui.js', {
            getPatientTurns: async () => { reads++; return []; },
            initPatientProposals: async options => { shared = options.initialTurns; return { refresh: async () => {} }; }
        });
        await patient[initializer]();
        assert.equal(reads, 1); assert.ok(Array.isArray(shared)); assert.equal(shared.length, 0);
    });
}

test('admin catalogs and users start together without a duplicate initial read', async () => {
    const calls = [], specialties = deferred(), users = deferred();
    const module = await load('users/users-ui.js', {
        getAdminSpecialties: () => { calls.push('specialties'); return specialties.promise; },
        listInternalUsers: () => { calls.push('users'); return users.promise; }
    });
    const initialization = module.initUserManagement();
    assert.deepEqual(calls, ['specialties', 'users']);
    specialties.resolve([]); users.resolve([]); await initialization;
    assert.deepEqual(calls, ['specialties', 'users']);
});

test('patient cancellation still reloads turns and proposals after initialization reuse', async () => {
    const document = dom(); let reads = 0, writes = 0, proposalRefreshes = 0;
    const patient = await load('appointments/patient-ui.js', {
        document, getBootstrapModal: () => ({}), showModal() {}, hideModal() {},
        getPatientTurns: async () => { reads++; return []; },
        getPatientTurn: async () => ({ id_turno: 1, estado: 'RESERVADO' }),
        cancelPatientTurn: async () => { writes++; return { id_turno: 1, estado: 'CANCELADO' }; },
        initPatientProposals: async () => ({ refresh: async () => { proposalRefreshes++; } })
    });
    await patient.initPatientTurns();
    clickWithTarget(document.getElementById('turnosReservadosLista'), { turn: '1', action: 'cancel' });
    await tick();
    document.getElementById('confirmarCancelacionBtn').dispatchEvent(new Event('click'));
    await tick(); await tick();
    assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(proposalRefreshes, 1);
});

test('admin activation change still reloads users from the API', async () => {
    const document = dom(); let reads = 0, writes = 0;
    const module = await load('users/users-ui.js', {
        document, showModal() {}, hideModal() {},
        getAdminSpecialties: async () => [],
        listInternalUsers: async () => { reads++; return []; },
        getInternalUser: async () => ({ id: 1, nombre: 'Test', apellido: 'User', is_active: true }),
        updateInternalUser: async () => { writes++; }
    });
    await module.initUserManagement();
    clickWithTarget(document.getElementById('adminGestionUsuariosTabla'), { user: '1', action: 'status' });
    await tick();
    document.getElementById('adminUsuarioConfirmarEstadoBtn').dispatchEvent(new Event('click'));
    await tick(); await tick();
    assert.equal(writes, 1); assert.equal(reads, 2);
});
