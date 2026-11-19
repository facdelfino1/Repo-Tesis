import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as patientHistory from '../assets/js/features/appointments/patient-history-service.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const target = id => ({ id_turno: id, duracion_turno: 20, estado: 'RESERVADO', asignacion_vigente: true,
    horario_futuro: true, fecha: '2030-01-10', hora: '09:00:00', prioridad: null,
    medico: { id: 2, nombre: 'Médico', apellido: 'Prueba', especialidad: { nombre: 'Clínica Médica' } } });
const estimated = minutes => ({ espera_estimada_minutos: minutes, demora_estimada_minutos: 0, estado_estimacion: minutes ? 'ESTIMADA' : 'SIN_DEMORA', promedio_consulta_minutos: 12,
    motivo: 'Estimación informativa.', inicio_estimado: null, calculado_en: '2030-01-10T12:00:00Z' });
const late = { espera_estimada_minutos: null, promedio_consulta_minutos: 12, demora_estimada_minutos: null, inicio_estimado: null, estado_estimacion: 'CONSULTA_DEMORADA',
    motivo: 'La consulta anterior alcanzó o superó el promedio histórico. El tiempo restante es indeterminado.' };

async function setup() {
    const nodes = new Map(), timers = new Map(), queue = [], turnQueue = [], calls = [], writes = [], textWrites = [], controllers = [];
    let turns = [target(1)], onUpdated;
    let nextTimer = 0, turnReads = 0, proposalInitializations = 0;
    class Element {
        _text = '-'; _html = ''; className = ''; attrs = new Map();
        set textContent(value) { this._text = value; writes.push(this.id); textWrites.push({ id: this.id, value }); }
        get textContent() { return this._text; }
        set innerHTML(value) { this._html = value; writes.push(this.id); }
        get innerHTML() { return this._html; }
        classList = { toggle() {} };
        setAttribute(name, value) { this.attrs.set(name, value); }
    }
    const node = id => { if (!nodes.has(id)) { const element = new Element(); element.id = id; nodes.set(id, element); } return nodes.get(id); };
    const document = new EventTarget(); document.hidden = false;
    document.getElementById = id => id === 'duracionEstimada' ? null : node(id);
    const window = new EventTarget();
    const context = vm.createContext({ document, window, AbortController, patientHistory,
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        getPatientDelay: async (id, { signal }) => {
            calls.push({ id, signal });
            const next = queue.length ? queue.shift() : estimated(5);
            if (next instanceof Error) throw next;
            return await next; // deliberately allow obsolete mock responses even after an abort
        },
        errorMessage: error => error.message,
        getPatientTurns: async () => {
            turnReads++;
            const next = turnQueue.length ? turnQueue.shift() : turns;
            if (next instanceof Error) throw next;
            return await next;
        },
        getCurrentUser: () => ({ nombre: 'Paciente' }), formatDate: String, escapeHtml: String, priorityClass: () => '',
        initPatientProposals: async options => { proposalInitializations++; onUpdated = options.onUpdated; }
    });
    const source = await readFile(new URL('../assets/js/features/appointments/patient-delay-ui.js', import.meta.url), 'utf8');
    const component = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await component.link(() => { throw Error('Unexpected import'); }); await component.evaluate();
    context.createPatientDelay = options => {
        const controller = component.namespace.createPatientDelay(options); controllers.push(controller); return controller;
    };
    const patientSource = await readFile(new URL('../assets/js/features/appointments/patient-ui.js', import.meta.url), 'utf8');
    const patient = new vm.SourceTextModule(patientSource.replace(/^import .*;\r?\n/gm, ''), { context });
    await patient.link(() => { throw Error('Unexpected import'); }); await patient.evaluate();
    return { node, calls, timers, writes, textWrites, document, window, controllers,
        create: context.createPatientDelay, enqueue: value => queue.push(value),
        setTurns: rows => { turns = rows; }, enqueueTurns: value => turnQueue.push(value),
        refreshDashboard: () => onUpdated(),
        initializeDashboard: patient.namespace.initPatientDashboard,
        counts: () => ({ turnReads, proposalInitializations }),
        poll: async () => {
            assert.equal(timers.size, 1);
            const [id, job] = [...timers.entries()][0]; timers.delete(id);
            assert.equal(job.delay, 60000); await job.callback(); await tick();
        }
    };
}

test('renders distinct estimated, late and unavailable states without inventing a zero remaining time', async () => {
    const page = await setup(), controller = page.create();
    page.enqueue(estimated(5)); await controller.updateTurn(target(1));
    assert.equal(page.node('esperaEstimada').textContent, '5 min');
    assert.equal(page.document.getElementById('duracionEstimada'), null);
    assert.equal(page.node('duracionPromedio').textContent, '12 min');
    page.enqueue(late); await page.poll();
    assert.equal(page.node('esperaEstimada').textContent, 'Consulta anterior demorada');
    assert.equal(page.node('duracionPromedio').textContent, '12 min');
    assert.match(page.node('demoraEstimacionDetalle').textContent, /tiempo restante es indeterminado/);
    page.enqueue({ demora_estimada_minutos: null, estado_estimacion: 'SIN_DATOS', motivo: 'No hay duraciones válidas.' });
    await page.poll(); assert.equal(page.node('esperaEstimada').textContent, 'Espera no disponible');
    assert.equal(page.node('duracionPromedio').textContent, 'Promedio no disponible');
    assert.match(page.node('demoraEstimacionDetalle').textContent, /No hay duraciones válidas/);
    page.enqueue(estimated(0)); await page.poll();
    assert.equal(page.node('esperaEstimada').textContent, 'Sin espera estimada');
    controller.dispose(); assert.equal(page.timers.size, 0);
});

test('poll verifies the next appointment without rewriting unchanged cards or history', async () => {
    const page = await setup(); await page.initializeDashboard();
    const history = page.node('historialTurnos').innerHTML, next = page.node('heroProximoTurno').textContent;
    page.writes.length = 0;
    page.enqueue(late); await page.poll();
    page.enqueue({ ...estimated(14), promedio_consulta_minutos: 14 }); await page.poll();
    assert.equal(page.node('esperaEstimada').textContent, '14 min');
    assert.equal(page.node('duracionPromedio').textContent, '14 min');
    assert.ok(page.writes.every(id => ['esperaEstimada', 'demoraEstimacionDetalle', 'duracionPromedio'].includes(id)));
    assert.deepEqual(page.counts(), { turnReads: 3, proposalInitializations: 1 });
    assert.equal(page.node('historialTurnos').innerHTML, history);
    assert.equal(page.node('heroProximoTurno').textContent, next);
    page.controllers[0].dispose();
});

test('does not overlap equivalent requests or accumulate timers during a slow response', async () => {
    const page = await setup(), controller = page.create(), pending = deferred();
    page.enqueue(pending.promise);
    const initial = controller.updateTurn(target(1));
    assert.equal(controller.refresh(), initial);
    assert.equal(controller.updateTurn(target(1)), initial);
    assert.equal(page.calls.length, 1); assert.equal(page.timers.size, 0);
    assert.equal(page.node('esperaEstimada').attrs.get('aria-busy'), 'true');
    pending.resolve(estimated(7)); await initial;
    assert.equal(page.timers.size, 1);
    assert.equal(page.node('esperaEstimada').attrs.get('aria-busy'), 'false');
    controller.dispose();
});

test('changing the target aborts and ignores an older response, including its timer cleanup', async () => {
    const page = await setup(), controller = page.create(), old = deferred();
    page.enqueue(old.promise); const first = controller.updateTurn(target(1));
    page.enqueue({ ...estimated(3), promedio_consulta_minutos: 18 }); await controller.updateTurn(target(2));
    assert.equal(page.calls[0].signal.aborted, true);
    old.resolve(late); await first;
    assert.equal(page.node('esperaEstimada').textContent, '3 min');
    assert.equal(page.node('duracionPromedio').textContent, '18 min');
    assert.equal(page.timers.size, 1);
    assert.deepEqual(page.calls.map(call => call.id), [1, 2]);
    controller.dispose();
});

test('pagehide cancels resources and a response after disposal cannot render or reschedule', async () => {
    const page = await setup(), controller = page.create(), pending = deferred();
    page.enqueue(pending.promise); const initial = controller.updateTurn(target(1));
    page.window.dispatchEvent(new Event('pagehide'));
    assert.equal(page.calls[0].signal.aborted, true);
    pending.resolve(late); await initial;
    assert.notEqual(page.node('esperaEstimada').textContent, 'Consulta anterior demorada');
    assert.equal(page.timers.size, 0);
    await controller.refresh(); assert.equal(page.calls.length, 1);
});

test('hidden tabs pause timers and visibility restores one refresh without overlapping a pending request', async () => {
    const page = await setup(), controller = page.create(), pending = deferred();
    page.enqueue(pending.promise); const initial = controller.updateTurn(target(1));
    page.document.hidden = true; page.document.dispatchEvent(new Event('visibilitychange'));
    page.document.hidden = false; page.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(page.calls.length, 1);
    pending.resolve(estimated(5)); await initial;
    page.document.hidden = true; page.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(page.timers.size, 0);
    page.document.hidden = false; page.document.dispatchEvent(new Event('visibilitychange')); await tick();
    assert.equal(page.calls.length, 2); assert.equal(page.timers.size, 1);
    controller.dispose();
});

test('network failures retain an informative state, clear loading and recover on the next poll', async () => {
    const page = await setup(), controller = page.create();
    page.enqueue(new Error('Sin conexión')); await controller.updateTurn(target(1));
    assert.equal(page.node('esperaEstimada').textContent, 'Espera no disponible');
    assert.equal(page.node('duracionPromedio').textContent, 'Promedio no disponible');
    assert.match(page.node('demoraEstimacionDetalle').textContent, /Sin conexión/);
    assert.equal(page.node('esperaEstimada').attrs.get('aria-busy'), 'false');
    await page.poll(); assert.equal(page.node('esperaEstimada').textContent, '5 min');
    controller.dispose();
});

test('reinitializing the dashboard disposes the previous controller and leaves exactly one timer', async () => {
    const page = await setup(); await page.initializeDashboard(); await page.initializeDashboard();
    assert.equal(page.controllers.length, 2); assert.equal(page.timers.size, 1);
    const reads = page.calls.length;
    await page.controllers[0].refresh(); assert.equal(page.calls.length, reads);
    await page.poll(); assert.equal(page.calls.length, reads+1);
    page.controllers[1].dispose(); assert.equal(page.timers.size, 0);
});

test('no appointment shows the empty estimate state and schedules no requests', async () => {
    const page = await setup(), controller = page.create();
    await controller.updateTurn(null);
    assert.equal(page.node('esperaEstimada').textContent, 'Espera no disponible');
    assert.equal(page.node('duracionPromedio').textContent, 'Promedio no disponible');
    assert.equal(page.calls.length, 0); assert.equal(page.timers.size, 0);
    controller.dispose();
});

test('historical mean remains visible when delay is unavailable for reserved or present appointments', async () => {
    const page = await setup(), controller = page.create();
    for (const estado of ['RESERVADO', 'PRESENTE']) {
        page.enqueue({ demora_estimada_minutos: null, promedio_consulta_minutos: 14,
            estado_estimacion: 'SIN_DATOS', motivo: 'No puede estimarse la demora.' });
        await controller.updateTurn({ ...target(1), estado });
        assert.equal(page.node('duracionPromedio').textContent, '14 min');
        assert.equal(page.node('esperaEstimada').textContent, 'Espera no disponible');
    }
    page.enqueue({ ...estimated(0), promedio_consulta_minutos: null });
    await page.poll();
    assert.equal(page.node('duracionPromedio').textContent, 'Promedio no disponible');
    controller.dispose();
});

test('reserved and present display the unified backend message without duplicating the notice', async () => {
    const page = await setup(), controller = page.create();
    const motivo = 'Espera aproximada basada en los pacientes presentes y la consulta en curso. Estimación informativa sujeta a cambios.';
    for (const estado of ['RESERVADO', 'PRESENTE']) {
        page.enqueue({ ...estimated(5), motivo });
        await controller.updateTurn({ ...target(1), estado });
        assert.equal(page.node('demoraEstimacionDetalle').textContent, motivo);
    }
    controller.dispose();
});

test('in-attention presentation preserves the mean across polls and leaves waiting states unchanged', async () => {
    const page = await setup(), controller = page.create();
    const inAttention = { ...estimated(null), estado_estimacion: 'NO_APLICA',
        motivo: 'El turno no espera el inicio de una atención asignada.' };
    page.enqueue(inAttention);
    await controller.updateTurn({ ...target(1), estado: 'EN_ATENCION' });
    for (let poll = 0; poll < 2; poll++) {
        assert.equal(page.node('esperaEstimada').textContent, 'En atención');
        assert.equal(page.node('demoraEstimacionDetalle').textContent, 'Tu consulta ya comenzó');
        assert.equal(page.node('duracionPromedio').textContent, '12 min');
        page.enqueue(inAttention); await page.poll();
    }
    page.enqueue(late);
    await controller.updateTurn({ ...target(1), estado: 'PRESENTE' });
    assert.equal(page.node('esperaEstimada').textContent, 'Consulta anterior demorada');
    assert.match(page.node('demoraEstimacionDetalle').textContent, /tiempo restante es indeterminado/);
    page.enqueue(estimated(5)); await controller.updateTurn(target(1));
    assert.equal(page.node('esperaEstimada').textContent, '5 min');
    assert.equal(page.node('duracionPromedio').textContent, '12 min');
    controller.dispose();
});

test('transient failures preserve the last known mean and report the refresh error', async () => {
    const page = await setup(), controller = page.create();
    await controller.updateTurn(target(1));
    page.enqueue(new Error('Sin conexión')); await page.poll();
    assert.equal(page.node('duracionPromedio').textContent, '12 min');
    assert.match(page.node('demoraEstimacionDetalle').textContent, /No fue posible actualizar/);
    page.enqueue({ ...estimated(4), promedio_consulta_minutos: 16 }); await page.poll();
    assert.equal(page.node('duracionPromedio').textContent, '16 min');
    controller.dispose();
});

test('remaining wait decreases on each poll while the historical mean stays stable', async () => {
    const page = await setup(), controller = page.create();
    page.enqueue({ ...estimated(6), promedio_consulta_minutos: 10 });
    await controller.updateTurn(target(1));
    assert.equal(page.node('esperaEstimada').textContent, '6 min');
    page.enqueue({ ...estimated(5), promedio_consulta_minutos: 10 }); await page.poll();
    assert.equal(page.node('esperaEstimada').textContent, '5 min');
    assert.equal(page.node('duracionPromedio').textContent, '10 min');
    page.enqueue({ ...late, promedio_consulta_minutos: 10 }); await page.poll();
    assert.equal(page.node('esperaEstimada').textContent, 'Consulta anterior demorada');
    assert.equal(page.node('duracionPromedio').textContent, '10 min');
    controller.dispose();
});

for (const previousState of ['COMPLETADO', 'CANCELADO', 'PENDIENTE', 'RESERVADO']) {
    test(`automatic next-turn refresh switches doctors after ${previousState}, including rescheduling`, async () => {
        const page = await setup();
        page.enqueue({ ...estimated(6), promedio_consulta_minutos: 10 });
        await page.initializeDashboard();
        const next = { ...target(2), fecha: '2030-01-11', prioridad: 'ALTA',
            medico: { ...target(2).medico, id: 3, nombre: 'Otra', apellido: 'Agenda' } };
        const previous = { ...target(1), estado: previousState, fecha: '2030-01-12',
            asignacion_vigente: previousState === 'RESERVADO' };
        page.setTurns([next, previous]);
        page.enqueue({ ...estimated(12), promedio_consulta_minutos: 18 }); await page.poll();
        assert.equal(page.node('turnoMedico').textContent, 'Otra Agenda');
        assert.equal(page.node('heroProximoTurno').textContent, '2030-01-11 - 09:00');
        assert.equal(page.node('triajePrioridad').textContent, 'ALTA');
        assert.equal(page.node('duracionPromedio').textContent, '18 min');
        assert.equal(page.node('esperaEstimada').textContent, '12 min');
        assert.deepEqual(page.calls.map(call => call.id), [1, 2]);
        assert.equal(page.timers.size, 1);
        page.textWrites.length = 0; page.writes.length = 0;
        page.enqueue({ ...estimated(11), promedio_consulta_minutos: 18 }); await page.poll();
        assert.ok(!page.textWrites.some(write => write.value === 'Consultando...'));
        assert.ok(page.writes.every(id => ['esperaEstimada', 'demoraEstimacionDetalle', 'duracionPromedio'].includes(id)));
        page.controllers[0].dispose();
    });
}

test('no next appointment clears associated cards and stops querying the old estimator', async () => {
    const page = await setup(); await page.initializeDashboard();
    page.setTurns([]); await page.poll();
    assert.equal(page.node('heroProximoTurno').textContent, 'Sin turnos reservados');
    assert.equal(page.node('turnoMedico').textContent, '—');
    assert.equal(page.node('triajePrioridad').textContent, 'Sin turno asignado');
    assert.equal(page.node('duracionPromedio').textContent, 'Promedio no disponible');
    await page.poll(); assert.equal(page.calls.length, 1);
    // Continue checking for new appointments without sending empty estimator requests.
    page.setTurns([target(2)]); await page.poll();
    assert.deepEqual(page.calls.map(call => call.id), [1, 2]);
    page.controllers[0].dispose();
});

test('slow next-turn checks share the list request with other refreshes and reject older context', async () => {
    const page = await setup(); await page.initializeDashboard();
    const slow = deferred(); page.enqueueTurns(slow.promise);
    const polling = page.poll(); await tick();
    page.document.dispatchEvent(new Event('visibilitychange')); await tick();
    assert.equal(page.counts().turnReads, 2);
    assert.equal(page.timers.size, 0);
    const otherRefresh = page.refreshDashboard(); await tick();
    assert.equal(page.counts().turnReads, 2);
    const next = { ...target(2), medico: { ...target(2).medico, id: 3, nombre: 'Otra', apellido: 'Agenda' } };
    page.enqueue({ ...estimated(8), promedio_consulta_minutos: 18 });
    slow.resolve([next]); await Promise.all([polling, otherRefresh]);
    assert.deepEqual(page.calls.map(call => call.id), [1, 2]);
    assert.equal(page.node('turnoMedico').textContent, 'Otra Agenda');
    assert.equal(page.node('duracionPromedio').textContent, '18 min');
    assert.equal(page.timers.size, 1);
    page.controllers[0].dispose();
});

test('an obsolete estimate cannot overwrite the next doctor selected by an automatic refresh', async () => {
    const page = await setup(); await page.initializeDashboard();
    const slow = deferred(); page.enqueueTurns(slow.promise);
    const polling = page.poll(); await tick();
    const oldEstimate = deferred(); page.enqueue(oldEstimate.promise);
    const oldRequest = page.controllers[0].refresh();
    const next = { ...target(2), medico: { ...target(2).medico, id: 3, nombre: 'Otra', apellido: 'Agenda' } };
    page.enqueue({ ...estimated(4), promedio_consulta_minutos: 18 });
    slow.resolve([next]); await polling;
    assert.equal(page.calls[1].signal.aborted, true);
    oldEstimate.resolve({ ...late, promedio_consulta_minutos: 10 }); await oldRequest;
    assert.equal(page.node('turnoMedico').textContent, 'Otra Agenda');
    assert.equal(page.node('duracionPromedio').textContent, '18 min');
    assert.equal(page.node('esperaEstimada').textContent, '4 min');
    assert.equal(page.timers.size, 1);
    page.controllers[0].dispose();
});

test('pagehide during a next-turn request prevents subsequent context rendering and estimation', async () => {
    const page = await setup(); await page.initializeDashboard();
    const slow = deferred(); page.enqueueTurns(slow.promise);
    const polling = page.poll(); await tick();
    page.window.dispatchEvent(new Event('pagehide'));
    page.writes.length = 0;
    slow.resolve([target(2)]); await polling;
    assert.equal(page.calls.length, 1);
    assert.equal(page.writes.length, 0);
    assert.equal(page.timers.size, 0);
});

test('failed next-turn checks do not estimate a stale turn and recover on the following poll', async () => {
    const page = await setup(); await page.initializeDashboard();
    page.enqueueTurns(new Error('Sin conexión')); await page.poll();
    assert.equal(page.calls.length, 1);
    assert.equal(page.node('duracionPromedio').textContent, '12 min');
    assert.match(page.node('demoraEstimacionDetalle').textContent, /No fue posible actualizar/);
    page.setTurns([target(2)]); await page.poll();
    assert.deepEqual(page.calls.map(call => call.id), [1, 2]);
    page.controllers[0].dispose();
});

test('poll updates the same appointment to in-attention without resetting its mean', async () => {
    const page = await setup(); await page.initializeDashboard();
    page.setTurns([{ ...target(1), estado: 'EN_ATENCION' }]);
    page.enqueue({ ...estimated(null), estado_estimacion: 'NO_APLICA' });
    page.textWrites.length = 0; await page.poll();
    assert.equal(page.node('turnoEstado').textContent, 'En atención');
    assert.equal(page.node('esperaEstimada').textContent, 'En atención');
    assert.equal(page.node('demoraEstimacionDetalle').textContent, 'Tu consulta ya comenzó');
    assert.equal(page.node('duracionPromedio').textContent, '12 min');
    assert.ok(!page.textWrites.some(write => write.value === 'Consultando...'));
    page.controllers[0].dispose();
});

test('visibility during initial Dashboard loading does not start a second context refresh', async () => {
    const page = await setup(), slow = deferred();
    page.enqueueTurns(slow.promise);
    const initialization = page.initializeDashboard(); await tick();
    page.document.dispatchEvent(new Event('visibilitychange')); await tick();
    assert.equal(page.counts().turnReads, 1);
    slow.resolve([target(1)]); await initialization;
    assert.equal(page.calls.length, 1);
    assert.equal(page.timers.size, 1);
    page.controllers[0].dispose();
});
