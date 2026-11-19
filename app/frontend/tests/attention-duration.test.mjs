import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { formatAttentionDuration } from '../assets/js/features/appointments/attention-duration.js';
import { escapeHtml } from '../assets/js/core/helpers.js';

const completed = (start, end) => ({ estado: 'COMPLETADO', fecha_hora_inicio: start, fecha_hora_cierre: end, duracion_turno: 20 });
const start = '2026-11-17T12:00:00Z';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('only completed attention gets a real duration, while active attention is En curso', () => {
    for (const estado of ['RESERVADO', 'PRESENTE', 'CANCELADO', 'PENDIENTE', 'AUSENTE']) {
        assert.equal(formatAttentionDuration({ ...completed(start, '2026-11-17T12:08:00Z'), estado }), '—');
    }
    assert.equal(formatAttentionDuration({ estado: 'EN_ATENCION' }), 'En curso');
});

test('rounds actual elapsed time upwards, including microseconds, without using the scheduled block', () => {
    for (const [end, expected] of [
        ['2026-11-17T12:08:00Z', '8 min'], ['2026-11-17T12:08:30Z', '9 min'],
        ['2026-11-17T12:17:00Z', '17 min'], ['2026-11-17T12:08:00.000001Z', '9 min'],
        ['2026-11-17T12:00:00.000001Z', '1 min']
    ]) {
        const turn = completed(start, end), snapshot = structuredClone(turn);
        assert.equal(formatAttentionDuration(turn), expected);
        assert.deepEqual(turn, snapshot);
    }
    assert.equal(formatAttentionDuration(completed('2026-11-17T12:00:00.123456Z', '2026-11-17T12:08:00.123456Z')), '8 min');
});

test('uses timezone offsets and dates correctly for historical consultations crossing midnight', () => {
    assert.equal(formatAttentionDuration(completed('2020-01-01T23:55:00-03:00', '2020-01-02T00:03:30-03:00')), '9 min');
    assert.equal(formatAttentionDuration(completed('2020-01-01T09:00:00-03:00', '2020-01-01T12:08:30Z')), '9 min');
});

test('incomplete, invalid, zero and negative completed durations show a dash', () => {
    for (const [begin, end] of [[null, start], [start, null], ['', start], [start, 'invalid'],
        ['invalid', start], [start, start], [start, '2026-11-17T11:59:00Z']]) {
        assert.equal(formatAttentionDuration(completed(begin, end)), '—');
    }
});

class Element extends EventTarget {
    value = ''; disabled = false; innerHTML = ''; textContent = ''; children = new Map();
    querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Element()); return this.children.get(selector); }
    querySelectorAll() { return []; }
    setAttribute() {} append() {}
    classList = { add() {} };
}

async function setup(mode) {
    const nodes = new Map(), queries = [], operations = [];
    const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
    const doctor = { id: 2, nombre: 'Médico', apellido: 'Prueba', especialidad: { nombre: 'Clínica Médica' } };
    const turn = { id_turno: 7, fecha: '2020-01-01', hora: '09:00:00', estado: 'PRESENTE', medico: doctor,
        prioridad: null, asignacion_vigente: true, duracion_turno: 20, paciente_detalle: { nombre: 'Paciente', apellido: 'Prueba', dni: '123' },
        fecha_hora_inicio: null, fecha_hora_cierre: null };
    const context = vm.createContext({ formatAttentionDuration,
        document: { getElementById: node, querySelectorAll: () => [], createElement: () => new Element() },
        getCurrentUser: () => ({ rol: 'MEDICO', perfil: { id: 2 } }), getDoctor: async () => doctor,
        getAgendaTurns: async (id, day) => { queries.push({ id, day }); return [{ ...turn }]; },
        getAgendaTurn: async () => ({ ...turn }),
        operateAgendaTurn: async (doctorId, id, operation) => {
            operations.push({ doctorId, id, operation });
            turn.estado = operation === 'iniciar' ? 'EN_ATENCION' : 'COMPLETADO';
            turn.fecha_hora_inicio = '2020-01-01T09:00:00-03:00';
            if (operation === 'finalizar') turn.fecha_hora_cierre = '2020-01-01T09:08:30-03:00';
        },
        createActionConfirmation: () => ({ open: async options => options.onConfirm() }),
        getBootstrapModal: () => ({}),
        formatDate: String, todayInputValue: () => '2026-11-17', esc: escapeHtml, priorityClass: () => '',
        errorMessage: error => error.message
    });
    const source = await readFile(new URL('../assets/js/features/appointments/agenda-ui.js', import.meta.url), 'utf8');
    const ui = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await ui.link(() => { throw Error('Unexpected import'); }); await ui.evaluate();
    await ui.namespace.initOperationalAgenda(mode);
    const table = node(mode === 'dashboard' ? 'medicoAgendaDia' : 'agendaMedicaTabla');
    return { table, turn, queries, operations,
        duration: () => [...table.innerHTML.matchAll(/<td>([\s\S]*?)<\/td>/g)][5][1],
        date: async value => { node('agendaMedicaFiltroFecha').value = value; node('agendaMedicaFiltroFecha').dispatchEvent(new Event('input')); await tick(); },
        action: async operation => {
            const event = new Event('click');
            Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset: { operation, turn: '7' } }) } });
            table.dispatchEvent(event); await tick(); await tick();
        }
    };
}

for (const mode of ['agenda', 'dashboard']) {
    test(`${mode}: existing post-operation reload changes dash to En curso and then to real duration without extra requests`, async () => {
        const page = await setup(mode);
        assert.equal(page.duration(), '—'); assert.equal(page.queries.length, 1);
        await page.action('iniciar'); assert.equal(page.duration(), 'En curso');
        await page.action('finalizar'); assert.equal(page.duration(), '9 min');
        assert.equal(page.turn.duracion_turno, 20);
        assert.equal(page.queries.length, 3); assert.equal(page.operations.length, 2);
        if (mode === 'agenda') {
            await page.date('2020-01-01');
            assert.equal(page.queries.at(-1).day, '2020-01-01');
            assert.equal(page.duration(), '9 min');
            assert.equal(page.operations.length, 2); // consulting history performs no state mutation
        }
    });
}

test('both medical views use the requested header', async () => {
    for (const name of ['agenda-medica.html', 'dashboard.html']) {
        const html = await readFile(new URL('../pages/medico/' + name, import.meta.url), 'utf8');
        assert.match(html, /<th>Duración de la atención<\/th>/);
    }
});
