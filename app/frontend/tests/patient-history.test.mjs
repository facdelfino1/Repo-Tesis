import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as patientHistory from '../assets/js/features/appointments/patient-history-service.js';

const doctors = [null, { id: 1, nombre: 'Ana', apellido: 'Uno', especialidad: { id: 1, nombre: 'Clínica Médica' } },
    { id: 2, nombre: 'Beto', apellido: 'Dos', especialidad: { id: 2, nombre: 'Pediatría' } },
    { id: 3, nombre: 'Carla', apellido: 'Tres', especialidad: { id: 1, nombre: 'Clínica Médica' } }];
const turn = (id, fecha, estado, doctor, hora = '09:00:00', future = false) => ({ id_turno: id, fecha, hora, estado,
    medico: doctors[doctor], horario_futuro: future, prioridad: null, duracion_turno: 20,
    asignacion_vigente: ['RESERVADO', 'PRESENTE', 'EN_ATENCION'].includes(estado) });
const fixtures = () => [turn(1, '2026-01-01', 'COMPLETADO', 1), turn(2, '2026-01-01', 'CANCELADO', 2),
    turn(3, '2026-01-02', 'AUSENTE', 3), turn(4, '2026-01-03', 'COMPLETADO', 2),
    turn(5, '2026-01-04', 'CANCELADO', 3, '10:00:00'), turn(6, '2026-01-04', 'COMPLETADO', 2, '11:00:00'),
    turn(7, '2026-01-05', 'COMPLETADO', 1), turn(8, '2026-01-06', 'COMPLETADO', 2),
    turn(9, '2030-12-01', 'RESERVADO', 1, '09:00:00', true), turn(10, '2026-01-07', 'RESERVADO', 1),
    turn(11, '2026-01-08', 'PENDIENTE', 1), turn(12, '2026-01-08', 'PRESENTE', 1),
    turn(13, '2026-01-08', 'EN_ATENCION', 1), turn(14, '2030-12-01', 'CANCELADO', 2, '10:00:00', true)];

test('retains the existing classification per screen, sorts by appointment date/time and never mutates records', () => {
    const turns = fixtures(), snapshot = JSON.stringify(turns);
    assert.deepEqual(patientHistory.getPatientHistory(turns).map(t => t.id_turno), [14, 8, 7, 6, 5, 4, 3, 2, 1]);
    assert.deepEqual(patientHistory.getRecentPatientHistory(turns).map(t => t.id_turno), [10, 8, 7, 6, 5]);
    assert.deepEqual(patientHistory.getRecentPatientHistory(turns.slice(0, 3)).map(t => t.id_turno), [3, 2, 1]);
    assert.deepEqual(patientHistory.getRecentPatientHistory([]), []);
    assert.equal(JSON.stringify(turns), snapshot);
});

class Element extends EventTarget {
    value = ''; innerHTML = ''; textContent = ''; className = ''; disabled = false; options = [];
    classes = new Set();
    classList = { toggle: (name, enabled) => { if (enabled) this.classes.add(name); else this.classes.delete(name); },
        add: name => this.classes.add(name), contains: name => this.classes.has(name) };
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
    querySelectorAll() { return []; }
}

async function setup(turns, initializer = 'initPatientTurns') {
    const nodes = new Map(), requests = [], proposals = [];
    const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
    const context = vm.createContext({ patientHistory, URL, Response,
        window: { location: { origin: 'http://history.test' } },
        fetch: async url => {
            requests.push(String(url));
            const second = new URL(url).searchParams.has('page');
            return new Response(JSON.stringify({ results: second ? turns.slice(5) : turns.slice(0, 5),
                next: second ? null : 'http://history.test/api/turnos/?page=2' }), { headers: { 'Content-Type': 'application/json' } });
        },
        document: { getElementById: node },
        Option: class { constructor(text, value) { this.text = text; this.value = String(value); } },
        getCurrentUser: () => ({ nombre: 'Paciente', apellido: 'Prueba' }), getBootstrapModal: () => null,
        formatDate: String, escapeHtml: String, priorityClass: () => '', getPatientDelay: async () => ({ demora_estimada_minutos: 0 }),
        createPatientDelay: () => ({ updateTurn: async () => {}, dispose() {} }),
        initPatientProposals: async options => { proposals.push(options); return { refresh: async () => {} }; }
    });
    // Execute real API pagination and patient service, with a read-only synthetic transport.
    const core = new vm.SourceTextModule(await readFile(new URL('../assets/js/core/api.js', import.meta.url), 'utf8'), { context });
    await core.link(() => { throw Error('Unexpected core import'); }); await core.evaluate();
    const api = new vm.SourceTextModule(await readFile(new URL('../assets/js/features/appointments/patient-api.js', import.meta.url), 'utf8'), { context });
    await api.link(() => core); await api.evaluate();
    context.getPatientTurns = api.namespace.getPatientTurns;
    const source = await readFile(new URL('../assets/js/features/appointments/patient-ui.js', import.meta.url), 'utf8');
    const ui = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await ui.link(() => { throw Error('Unexpected UI import'); }); await ui.evaluate();
    await ui.namespace[initializer]();
    return { node, requests, proposals,
        set: (key, value, event = 'input') => {
            const input = node(`historialPacienteFiltro${key}`); input.value = value; input.dispatchEvent(new Event(event));
        }
    };
}
const count = html => (html.match(/<tr>/g) || []).length;

test('dashboard renders at most five past appointments after reading every API page and preserves its next appointment', async () => {
    const page = await setup(fixtures(), 'initPatientDashboard');
    const html = page.node('historialTurnos').innerHTML;
    assert.equal(count(html), 5);
    assert.ok(html.indexOf('2026-01-07') < html.indexOf('2026-01-06'));
    assert.doesNotMatch(html, /2030-12-01|2026-01-08/);
    assert.equal(page.node('turnoEstado').textContent, 'Presente');
    assert.equal(page.requests.length, 2);
    assert.equal(page.proposals[0].initialTurns.length, fixtures().length);
    const empty = await setup([], 'initPatientDashboard');
    assert.match(empty.node('historialTurnos').innerHTML, /Sin turnos históricos/);
});

test('full history filters independently and in all combinations without fetching or touching active appointments', async () => {
    const turns = fixtures(), snapshot = JSON.stringify(turns), page = await setup(turns);
    const table = page.node('historialPacienteTabla'), active = page.node('turnosReservadosLista').innerHTML;
    assert.equal(count(table.innerHTML), 9); // all history, including records beyond the dashboard limit and first API page
    assert.equal(page.requests.length, 2);
    assert.equal(page.proposals[0].initialTurns.length, turns.length);
    const filters = [['Fecha', '2026-01-01'], ['Especialidad', '1'], ['Medico', '1'], ['Estado', 'COMPLETADO']];
    const counts = [9, 2, 4, 1, 2, 1, 2, 1, 5, 1, 2, 1, 2, 1, 2, 1];
    for (let mask = 0; mask < 16; mask++) {
        filters.forEach(([key, value], bit) => page.set(key, mask & (1 << bit) ? value : '', bit % 2 ? 'change' : 'input'));
        assert.equal(count(table.innerHTML), counts[mask], `filter combination ${mask}`);
        assert.equal(page.node('turnosReservadosLista').innerHTML, active);
    }
    assert.deepEqual(page.node('historialPacienteFiltroEspecialidad').options.map(o => o.value), ['', '1', '2']);
    assert.deepEqual(page.node('historialPacienteFiltroMedico').options.map(o => o.value), ['', '1', '2', '3']);
    assert.deepEqual(page.node('historialPacienteFiltroEstado').options.map(o => o.value), ['', 'AUSENTE', 'CANCELADO', 'COMPLETADO']);
    page.set('Fecha', '2026-02-01');
    assert.match(table.innerHTML, /No se encontraron turnos históricos con los filtros seleccionados/);
    page.node('historialPacienteRestablecer').dispatchEvent(new Event('click'));
    assert.equal(count(table.innerHTML), 9);
    filters.forEach(([key]) => assert.equal(page.node(`historialPacienteFiltro${key}`).value, ''));
    assert.equal(page.requests.length, 2);
    assert.equal(JSON.stringify(turns), snapshot);
});

test('empty history retains its original empty state and shows the filter no-match message when applicable', async () => {
    const page = await setup([]);
    assert.equal(page.node('historialPacienteVacio').classes.has('d-none'), false);
    assert.equal(page.node('historialPacienteTabla').innerHTML, '');
    page.set('Fecha', '2026-01-01');
    assert.match(page.node('historialPacienteTabla').innerHTML, /No se encontraron turnos históricos/);
    page.node('historialPacienteRestablecer').dispatchEvent(new Event('click'));
    assert.equal(page.node('historialPacienteTabla').innerHTML, '');
    assert.equal(page.node('historialPacienteVacio').classes.has('d-none'), false);
});

test('dashboard history link targets the full history section, retaining all four columns', async () => {
    const dashboard = await readFile(new URL('../pages/paciente/dashboard.html', import.meta.url), 'utf8');
    const turns = await readFile(new URL('../pages/paciente/mis-turnos.html', import.meta.url), 'utf8');
    assert.match(dashboard, /href="mis-turnos\.html#historial-turnos"[^>]*>Ver historial completo/);
    assert.match(turns, /<section[^>]*id="historial-turnos"/);
});
