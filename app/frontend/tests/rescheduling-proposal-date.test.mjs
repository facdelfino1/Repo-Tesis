import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { proposalStateLabel } from '../assets/js/features/rescheduling/state-labels.js';

class Element extends EventTarget {
    value = ''; tagName = 'INPUT'; disabled = false; checked = false; textContent = '';
    classList = { add() {}, toggle() {} };
    _html = ''; inputs = [];
    set innerHTML(value) {
        this._html = value;
        this.inputs = [...value.matchAll(/<input\b[^>]*value="(\d+)"[^>]*>/g)].map(([, id]) => {
            const input = new Element(); input.value = id; return input;
        });
    }
    get innerHTML() { return this._html; }
    querySelectorAll(selector) { return this.inputs.filter(input => !selector.includes(':not(:disabled)') || !input.disabled); }
    querySelector() { return new Element(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const doctor = { id: 2, nombre: 'Médico', apellido: 'Prueba', especialidad: { nombre: 'Clínica Médica' } };
const turn = { id_turno: 1, paciente_detalle: { nombre: 'Paciente', apellido: 'Prueba', dni: '123' },
    medico: doctor, fecha: '2030-01-10', hora: '09:00:00', prioridad: 'MEDIA', estado: 'RESERVADO' };
const proposal = (id, fecha_destino, estado = 'EN_ESPERA') => ({ id, turno: 1, fecha_destino, estado,
    fecha_origen: '2020-01-01', hora_origen: '09:00:00', hora_inicio_destino: '10:00:00', hora_fin_destino: '10:20:00',
    fecha_hora_creacion: '2021-01-01T00:30:00Z', fecha_hora_resolucion: estado === 'EN_ESPERA' ? null : '2021-01-02T00:30:00Z',
    motivo: `Motivo ${id}`, motivo_cierre: estado === 'EN_ESPERA' ? '' : `Cierre ${id}`, vigente: estado === 'EN_ESPERA' });
const fixtures = () => ['EN_ESPERA', 'ACEPTADA', 'RECHAZADA', 'ANULADA', 'INVALIDADA']
    .map((state, index) => proposal(index + 1, '2019-05-02', state))
    .concat(proposal(6, '2030-01-11'), proposal(7, '2026-11-16'));

async function setup(role, load, options = {}) {
    const prefix = role === 'MEDICO' ? 'reprogramacionMedico' : 'reprogramacion';
    const nodes = new Map(), rows = fixtures(), writes = [], alerts = [], confirmations = [];
    const alert = text => alerts.push(text);
    const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
    node(`${prefix}NuevaFecha`).tagName = 'SELECT'; node(`${prefix}NuevaFecha`).value = '2030-01-11';
    node(`${prefix}Fecha`).value = '2030-01-10'; node(`${prefix}HoraInicio`).value = '09:00';
    node(`${prefix}HoraFin`).value = '10:00'; node(`${prefix}Motivo`).value = 'Motivo operativo';
    let changeDoctor, reads = 0;
    const context = vm.createContext({ document: { getElementById: node },
        getCurrentUser: () => ({ rol: role, perfil: { id: 2 } }), getDoctor: async () => doctor,
        getAgendaTurns: async () => [turn],
        bindDoctorSelectors: async (_specialty, _doctor, callback) => { changeDoctor = callback; },
        getBootstrapModal: () => ({}), hideModal() {}, showModal: () => confirmations.push('confirm'),
        alert, window: { alert }, esc: String, formatDate: String,
        proposalStateLabel, appointmentStateLabel: String, errorMessage: error => error.message || 'Error',
        initDestinationDateSelector: () => ({ isValid: () => true, reset() {}, refresh: async () => true }),
        api: { getAffectedTurns: async () => [turn], getPendingTurns: async () => [],
            getAgendaProposals: async id => {
                reads++;
                if (options.reloadError && writes.length) throw options.reloadError;
                return load ? load(id) : rows;
            },
            generateRescheduling: async (id, body) => {
                writes.push({ id, body });
                if (options.failure) throw options.failure;
                const created = proposal(8, body.nueva_fecha); rows.push(created);
                return { nueva_fecha: body.nueva_fecha, propuestas: [created], requiere_revision: [], turnos_rechazados: [], ...options.result };
            }
        }
    });
    const source = await readFile(new URL('../assets/js/features/rescheduling/rescheduling-ui.js', import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await module.link(() => { throw Error('Unexpected import'); }); await module.evaluate();
    const ready = module.namespace.initManagerRescheduling();
    await tick();
    const activate = async () => { await ready; if (role === 'SECRETARIA') await changeDoctor(doctor); };
    const date = node(`${prefix}PropuestasFiltroFecha`), table = node(`${prefix}PropuestasTabla`);
    return { prefix, node, date, table, ready, activate, rows, writes, alerts, confirmations, reads: () => reads,
        filter: (value, event = 'input') => { date.value = value; date.dispatchEvent(new Event(event)); },
        clear: () => node(`${prefix}LimpiarPropuestasFecha`).dispatchEvent(new Event('click')),
        changeDoctor: value => changeDoctor(value),
        generate: async () => {
            node(role === 'MEDICO' ? 'buscarAfectadosMedicoBtn' : 'buscarAfectadosBtn').dispatchEvent(new Event('click'));
            await tick();
            const affected = node(`${prefix}AfectadosTabla`); affected.inputs[0].checked = true;
            affected.dispatchEvent(new Event('change'));
            node(role === 'MEDICO' ? 'ejecutarReprogramacionMedicoBtn' : 'ejecutarReprogramacionBtn').dispatchEvent(new Event('click'));
            await tick();
            node(role === 'MEDICO' ? 'confirmarReprogramacionMedicoBtn' : 'confirmarReprogramacionBtn').dispatchEvent(new Event('click'));
            await tick(); await tick();
        }
    };
}
const rowCount = page => (page.table.innerHTML.match(/<tr><td>Paciente Prueba<\/td>/g) || []).length;
const initial = /Seleccione una fecha para consultar las propuestas de reprogramación/;

for (const role of ['MEDICO', 'SECRETARIA']) {
    test(`${role}: successful bulk operation uses brief inline feedback, keeps confirmation and refreshes without browser alerts`, async () => {
        const page = await setup(role); await page.activate();
        page.filter('2030-01-11');
        const reads = page.reads();
        await page.generate();
        assert.deepEqual(page.alerts, []);
        assert.equal(page.confirmations.length, 1);
        assert.equal(page.node(`${page.prefix}Mensaje`).textContent, 'Reprogramación ejecutada correctamente');
        assert.equal(page.node(`${page.prefix}Mensaje`).className, 'alert alert-success');
        assert.ok(page.reads() > reads);
        assert.equal(rowCount(page), 2);
        assert.equal(page.rows.at(-1).estado, 'EN_ESPERA');
        assert.equal(page.node(`${page.prefix}AfectadosTabla`).inputs.length, 0);
        assert.deepEqual(Array.from(page.writes[0].body.turnos), [1]);
    });

    test(`${role}: review warnings, rejected turn details and validation errors are preserved`, async () => {
        for (const result of [{ requiere_revision: [1] }, { turnos_rechazados: [2] }]) {
            const page = await setup(role, null, { result }); await page.activate(); await page.generate();
            const message = page.node(`${page.prefix}Mensaje`);
            assert.match(message.textContent, result.requiere_revision ? /Requiere revisión: 1/ : /Turnos rechazados: 2/);
            if (result.requiere_revision) assert.equal(message.className, 'alert alert-warning');
            assert.deepEqual(page.alerts, []);
        }
        const page = await setup(role, null, { failure: { status: 400, data: { detail: 'Selección inválida.' } } });
        await page.activate(); await page.generate();
        assert.equal(page.node(`${page.prefix}Mensaje`).textContent, 'Selección inválida.');
        assert.equal(page.node(`${page.prefix}Mensaje`).className, 'alert alert-danger');
        assert.equal(page.node(`${page.prefix}AfectadosTabla`).inputs.length, 1);
        assert.deepEqual(page.alerts, []);
    });

    test(`${role}: a failed refresh after success retains the necessary warning`, async () => {
        const page = await setup(role, null, { reloadError: new Error('No se pudo actualizar.') });
        await page.activate(); await page.generate();
        const message = page.node(`${page.prefix}Mensaje`);
        assert.match(message.textContent, /Reprogramación ejecutada correctamente/);
        assert.match(message.textContent, /El proceso fue registrado, pero no pudo actualizarse/);
        assert.equal(message.className, 'alert alert-warning');
        assert.deepEqual(page.alerts, []);
    });

    test(`${role}: blank, historical, current, future and empty dates use destination date and retain all states/details`, async () => {
        const page = await setup(role); await page.activate();
        assert.match(page.table.innerHTML, initial); assert.equal(rowCount(page), 0);
        const snapshot = JSON.stringify(page.rows), reads = page.reads();
        page.filter('2019-05-02'); assert.equal(rowCount(page), 5);
        for (const state of ['EN_ESPERA', 'ACEPTADA', 'RECHAZADA', 'ANULADA', 'INVALIDADA']) {
            assert.ok(page.table.innerHTML.includes(proposalStateLabel(state)));
        }
        for (const text of ['Paciente Prueba', 'MEDIA', '2020-01-01', '10:00', 'Motivo 1', 'Generada:', 'Resolución:', 'Cierre 5', 'no garantiza disponibilidad']) {
            assert.ok(page.table.innerHTML.includes(text), text);
        }
        page.filter('2030-01-11', 'change'); assert.equal(rowCount(page), 1);
        assert.ok(page.table.innerHTML.includes('Motivo 6'));
        page.filter('2026-11-16'); assert.equal(rowCount(page), 1);
        page.filter('2020-01-01'); // original date is not the destination date
        assert.match(page.table.innerHTML, /No hay propuestas de reprogramación para la fecha seleccionada/);
        page.filter('2021-01-01'); assert.equal(rowCount(page), 0); // generation date is not used either
        page.clear(); assert.equal(page.date.value, ''); assert.match(page.table.innerHTML, initial);
        page.filter('2030-01-11'); page.filter(''); assert.match(page.table.innerHTML, initial);
        assert.equal(page.reads(), reads); assert.equal(page.writes.length, 0);
        assert.equal(JSON.stringify(page.rows), snapshot);
    });

    test(`${role}: generation preserves the selected filter and full history, and blank stays blank after writes`, async () => {
        const page = await setup(role); await page.activate();
        page.filter('2019-05-02'); await page.generate();
        assert.equal(page.date.value, '2019-05-02'); assert.equal(rowCount(page), 5);
        assert.deepEqual(Array.from(page.writes[0].body.turnos), [1]);
        assert.equal(page.writes[0].body.nueva_fecha, '2030-01-11');
        page.filter('2030-01-11'); assert.equal(rowCount(page), 2);
        page.clear(); await page.generate();
        assert.equal(page.writes.length, 2); assert.equal(rowCount(page), 0);
        assert.match(page.table.innerHTML, initial);
    });

    test(`${role}: loading responses cannot repopulate the table after the date was cleared`, async () => {
        let resolve;
        const pending = new Promise(done => { resolve = done; });
        const page = await setup(role, () => pending);
        const activation = page.activate();
        await tick();
        page.filter('2019-05-02'); page.clear();
        resolve(fixtures()); await activation;
        assert.equal(rowCount(page), 0); assert.match(page.table.innerHTML, initial);
        page.filter('2019-05-02'); assert.equal(rowCount(page), 5);
        if (role === 'SECRETARIA') {
            await page.changeDoctor(null);
            assert.equal(rowCount(page), 0);
            page.filter('2030-01-11'); assert.equal(rowCount(page), 0);
        }
    });
}
