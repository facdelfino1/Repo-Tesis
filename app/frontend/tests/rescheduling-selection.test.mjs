import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element extends EventTarget {
    value = ''; checked = false; indeterminate = false; disabled = false; textContent = ''; tagName = 'INPUT';
    classList = { add() {}, toggle() {} };
    inputs = []; children = new Map(); _html = '';
    set innerHTML(html) {
        this._html = html;
        this.inputs = [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(([tag]) => {
            const input = new Element(); input.value = tag.match(/value="([^"]*)"/)[1]; return input;
        });
    }
    get innerHTML() { return this._html; }
    querySelectorAll(selector) {
        return this.inputs.filter(input => (!selector.includes(':not(:disabled)') || !input.disabled)
            && (!selector.includes(':checked') || input.checked));
    }
    querySelector(selector) {
        if (!this.children.has(selector)) this.children.set(selector, new Element());
        return this.children.get(selector);
    }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const doctor = { id: 2, nombre: 'Médico', apellido: 'Prueba', especialidad: { nombre: 'Clínica Médica' } };
const turn = id => ({ id_turno: id, paciente_detalle: { nombre: 'Paciente', apellido: String(id), dni: String(id) },
    medico: doctor, fecha: '2030-01-10', hora: '09:00:00', prioridad: 'BAJA', estado: 'RESERVADO' });

async function setup(role) {
    const prefix = role === 'MEDICO' ? 'reprogramacionMedico' : 'reprogramacion';
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, new Element());
        return nodes.get(id);
    };
    node(`${prefix}NuevaFecha`).tagName = 'SELECT';
    node(`${prefix}NuevaFecha`).value = '2030-01-11';
    node(`${prefix}Fecha`).value = '2030-01-10';
    node(`${prefix}HoraInicio`).value = '09:00';
    node(`${prefix}HoraFin`).value = '10:00';
    node(`${prefix}Motivo`).value = 'Ausencia';
    let candidates = [turn(1), turn(2), turn(3)], write, completeWrite, doctorChanged;
    const context = vm.createContext({ document: { getElementById: node },
        getCurrentUser: () => ({ rol: role, perfil: { id: 2 } }),
        getDoctor: async () => doctor, getAgendaTurns: async () => [],
        bindDoctorSelectors: async (_specialty, _doctor, callback) => { doctorChanged = callback; await callback(doctor); },
        getBootstrapModal: () => ({}), hideModal() {}, showModal() {},
        esc: String, formatDate: String, appointmentStateLabel: String, errorMessage: () => 'Error',
        initDestinationDateSelector: () => ({ isValid: () => true, reset() {}, refresh: async () => true }),
        api: { getAffectedTurns: async () => candidates,
            getAgendaProposals: async () => [], getPendingTurns: async () => [],
            generateRescheduling: async (id, body) => {
                write = { id, body };
                return new Promise(resolve => { completeWrite = () => resolve({ nueva_fecha: body.nueva_fecha,
                    propuestas: [], requiere_revision: [], turnos_rechazados: [] }); });
            }
        }
    });
    const source = await readFile(new URL('../assets/js/features/rescheduling/rescheduling-ui.js', import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await module.link(() => { throw Error('Unexpected import'); }); await module.evaluate();
    await module.namespace.initManagerRescheduling();
    const table = node(`${prefix}AfectadosTabla`), master = node(`${prefix}SeleccionarTodos`);
    const search = node(role === 'MEDICO' ? 'buscarAfectadosMedicoBtn' : 'buscarAfectadosBtn');
    const execute = node(role === 'MEDICO' ? 'ejecutarReprogramacionMedicoBtn' : 'ejecutarReprogramacionBtn');
    const confirm = node(role === 'MEDICO' ? 'confirmarReprogramacionMedicoBtn' : 'confirmarReprogramacionBtn');
    return { prefix, node, table, master, execute, confirm,
        search: async rows => { if (rows) candidates = rows; search.dispatchEvent(new Event('click')); await tick(); },
        all: checked => { master.checked = checked; master.dispatchEvent(new Event('change')); },
        individual: (index, checked) => { table.inputs[index].checked = checked; table.dispatchEvent(new Event('change')); },
        doctorChanged: value => doctorChanged(value),
        write: () => write, complete: () => completeWrite()
    };
}

for (const role of ['MEDICO', 'SECRETARIA']) {
    test(`${role}: all, none and partial selection stay synchronized with individual choices`, async () => {
        const page = await setup(role);
        assert.equal(page.master.disabled, true);
        assert.equal(page.execute.disabled, true);
        await page.search();
        assert.equal(page.master.disabled, false);
        assert.equal(page.master.checked, false);
        page.all(true);
        assert.ok(page.table.inputs.every(input => input.checked));
        assert.equal(page.master.checked, true);
        assert.equal(page.master.indeterminate, false);
        assert.equal(page.node(`${page.prefix}SeleccionarTodosTexto`).textContent, 'Deseleccionar todos');
        assert.equal(page.execute.disabled, false);
        page.individual(1, false);
        assert.equal(page.master.checked, false);
        assert.equal(page.master.indeterminate, true);
        page.individual(1, true);
        assert.equal(page.master.checked, true);
        page.all(false);
        assert.ok(page.table.inputs.every(input => !input.checked));
        assert.equal(page.master.indeterminate, false);
        assert.equal(page.execute.disabled, true);
        page.confirm.dispatchEvent(new Event('click')); await tick();
        assert.equal(page.write(), undefined);
        page.individual(0, true);
        assert.equal(page.master.indeterminate, true);
        page.individual(0, false);
        assert.equal(page.master.checked, false);
        assert.equal(page.master.indeterminate, false);
    });

    test(`${role}: disabled rows are untouched and only selected eligible IDs reach the existing API`, async () => {
        const page = await setup(role); await page.search();
        page.table.inputs[2].disabled = true;
        page.all(true);
        assert.equal(page.table.inputs[2].checked, false);
        assert.equal(page.master.checked, true);
        page.individual(1, false);
        page.table.inputs[2].checked = true; // even a checked disabled row cannot enter the payload
        page.confirm.dispatchEvent(new Event('click')); await tick();
        assert.equal(page.write().id, 2);
        assert.deepEqual(Array.from(page.write().body.turnos), [1]);
        assert.equal(page.write().body.nueva_fecha, '2030-01-11');
        assert.equal(page.master.disabled, true);
        page.all(false); // cannot alter selection during execution
        assert.equal(page.table.inputs[0].checked, true);
        page.complete(); await tick();
        assert.equal(page.master.checked, false);
        assert.equal(page.master.indeterminate, false);
        assert.equal(page.master.disabled, true);
        assert.equal(page.execute.disabled, true);
    });

    test(`${role}: new results, empty results and scope changes reset the master and row selection`, async () => {
        const page = await setup(role); await page.search(); page.all(true);
        await page.search([turn(4)]);
        assert.equal(page.master.checked, false);
        assert.equal(page.table.inputs[0].checked, false);
        page.all(true);
        page.node(`${page.prefix}HoraFin`).dispatchEvent(new Event('input'));
        assert.equal(page.table.inputs.length, 0);
        assert.equal(page.master.checked, false);
        assert.equal(page.master.disabled, true);
        await page.search([]);
        assert.equal(page.master.disabled, true);
        assert.equal(page.master.indeterminate, false);
        page.confirm.dispatchEvent(new Event('click')); await tick();
        assert.equal(page.write(), undefined);
        await page.search([turn(5)]);
        page.table.inputs[0].disabled = true;
        page.table.dispatchEvent(new Event('change'));
        assert.equal(page.master.disabled, true);
        assert.equal(page.execute.disabled, true);
        if (role === 'SECRETARIA') {
            await page.doctorChanged(null);
            assert.equal(page.table.inputs.length, 0);
            assert.equal(page.master.checked, false);
        }
    });
}
