import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as service from '../assets/js/features/availability/availability-service.js';

const block = (id, fecha, hora_inicio = '09:00:00', hora_fin = '09:20:00') =>
    ({ id, fecha, hora_inicio, hora_fin, estado: 'DISPONIBLE' });
const now = new Date('2026-11-14T12:10:30Z'); // 09:10:30 in Buenos Aires
const rows = [block(1, '2026-11-13'), block(2, '2026-11-14', '08:50:00', '09:10:30'),
    block(3, '2026-11-14'), block(4, '2026-11-15'), block(5, '2026-11-16')];

test('filters by end time and selected date without mutating historical rows', () => {
    const snapshot = structuredClone(rows);
    assert.deepEqual(service.filterExistingAvailability(rows, '', now), []);
    assert.deepEqual(service.filterExistingAvailability(rows, '2026-11-13', now), []);
    assert.deepEqual(service.filterExistingAvailability(rows, '2026-11-14', now).map(r => r.id), [3]);
    assert.deepEqual(service.filterExistingAvailability(rows, '2026-11-15', now).map(r => r.id), [4]);
    assert.deepEqual(service.filterExistingAvailability(rows, '2026-11-17', now), []);
    assert.deepEqual(rows, snapshot);
    // In-progress blocks remain visible but retain the existing restriction on actions.
    assert.equal(service.isAvailabilityExpired(rows[2], now), true);
});

test('uses the system timezone across UTC midnight, for every availability state', () => {
    const midnightUTC = new Date('2026-11-15T01:30:00Z'); // still November 14 locally
    assert.equal(service.availabilityToday(midnightUTC), '2026-11-14');
    for (const estado of ['DISPONIBLE', 'OCUPADO', 'BLOQUEADO']) {
        const row = { ...block(6, '2026-11-14', '22:00:00', '22:40:00'), estado };
        assert.equal(service.filterExistingAvailability([row], row.fecha, midnightUTC).length, 1);
        assert.equal(service.filterExistingAvailability([row], row.fecha,
            new Date('2026-11-15T01:40:00Z')).length, 0);
    }
});

class Element extends EventTarget {
    value = ''; min = ''; innerHTML = ''; textContent = ''; disabled = false;
    classList = { add() {}, remove() {} };
    replaceChildren() { this.innerHTML = ''; }
    querySelector() { return new Element(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const doctor = { id: 2, nombre: 'Médico', apellido: 'Prueba', especialidad: { nombre: 'Clínica Médica' } };

async function setup(doctorMode, getRows = async () => rows) {
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, new Element());
        return nodes.get(id);
    };
    const calls = [], writes = [];
    let changeDoctor, timer, clock = now;
    const form = new Element();
    const source = await readFile(new URL('../assets/js/features/availability/availability-ui.js', import.meta.url), 'utf8');
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [clock])); }
    }
    const context = vm.createContext({ ...service, Date: Clock,
        availabilityToday: (date = clock) => service.availabilityToday(date),
        isAvailabilityExpired: (block, date = clock) => service.isAvailabilityExpired(block, date),
        filterExistingAvailability: (rows, date, current = clock) => service.filterExistingAvailability(rows, date, current),
        document: { querySelector: () => form, getElementById: node, querySelectorAll: () => [] },
        getCurrentUser: () => ({ ...doctor, perfil: doctor }),
        getBootstrapModal: () => null,
        bindDoctorSelectors: async (_specialty, _doctor, callback) => { changeDoctor = callback; },
        getAvailability: async (id, filters) => { calls.push({ id, filters }); return getRows(id, filters); },
        request: async (path, options) => { writes.push({ path, options }); },
        setInterval: callback => { timer = callback; },
        formatDate: value => value, escapeHtml: value => value,
        timeToMinutes: value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; },
        errorMessage: () => 'Error de prueba'
    });
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await module.link(() => { throw new Error('Unexpected import'); });
    await module.evaluate();
    await module.namespace[doctorMode ? 'initDoctorAvailability' : 'initSecretaryAvailability']();
    const date = node(doctorMode ? 'disponibilidadMedicoFiltroFecha' : 'disponibilidadFiltroFecha');
    const table = node(doctorMode ? 'disponibilidadMedicoTabla' : 'disponibilidadTabla');
    return { node, form, date, table, calls, writes,
        selectDoctor: value => changeDoctor(value),
        advance: value => { clock = new Date(value); timer(); },
        selectDate: async value => { date.value = value; date.dispatchEvent(new Event('change')); await tick(); }
    };
}

for (const doctorMode of [true, false]) {
    const role = doctorMode ? 'Médico' : 'Secretaría';
    test(`${role}: initial prompt, date queries, expired rows, empty and invalid dates`, async () => {
        const page = await setup(doctorMode);
        assert.equal(page.date.value, '');
        assert.equal(page.date.min, '2026-11-14');
        assert.match(page.table.innerHTML, /Seleccione una fecha para consultar la disponibilidad/);
        assert.equal(page.calls.length, 0);
        if (!doctorMode) {
            await page.selectDate('2026-11-15');
            assert.match(page.table.innerHTML, /Seleccione un médico/);
            assert.equal(page.calls.length, 0);
            await page.selectDoctor(doctor);
        } else await page.selectDate('2026-11-15');
        assert.equal(page.calls.at(-1).filters.fecha, '2026-11-15');
        assert.match(page.table.innerHTML, /data-block-id="4"/);
        assert.doesNotMatch(page.table.innerHTML, /data-block-id="[1235]"/);
        await page.selectDate('2026-11-14');
        assert.match(page.table.innerHTML, /data-block-id="3"/);
        assert.doesNotMatch(page.table.innerHTML, /data-block-id="2"/);
        assert.match(page.table.innerHTML, /Horario iniciado/); // restrictions unchanged, block not finished
        page.advance('2026-11-14T12:20:00Z');
        assert.doesNotMatch(page.table.innerHTML, /data-block-id/);
        assert.match(page.table.innerHTML, /No hay disponibilidad registrada para la fecha seleccionada/);
        const reads = page.calls.length;
        await page.selectDate('2026-11-13');
        assert.equal(page.calls.length, reads);
        assert.equal(page.date.value, '');
        await page.selectDate('');
        assert.match(page.table.innerHTML, /Seleccione una fecha/);
        assert.equal(page.writes.length, 0);
    });

    test(`${role}: input clears immediately, invalidates pending results and change does not repeat the query`, async () => {
        let resolve;
        const page = await setup(doctorMode, (_id, filters) => filters.fecha === '2026-11-16'
            ? new Promise(done => { resolve = done; }) : Promise.resolve(rows));
        if (!doctorMode) await page.selectDoctor(doctor);
        page.date.value='2026-11-15';
        page.date.dispatchEvent(new Event('input')); await tick();
        assert.match(page.table.innerHTML, /data-block-id="4"/);
        const reads=page.calls.length;
        page.date.dispatchEvent(new Event('change')); await tick();
        assert.equal(page.calls.length, reads);
        await page.selectDate('2026-11-16');
        page.date.value='';
        page.date.dispatchEvent(new Event('input'));
        assert.doesNotMatch(page.table.innerHTML, /data-block-id/);
        assert.match(page.table.innerHTML, /Seleccione una fecha/);
        resolve(rows); await tick();
        assert.doesNotMatch(page.table.innerHTML, /data-block-id/);
        assert.match(page.table.innerHTML, /Seleccione una fecha/);
    });

    test(`${role}: stale response cannot replace the newly selected date`, async () => {
        let resolve;
        const page = await setup(doctorMode, (_id, filters) => filters.fecha === '2026-11-15'
            ? new Promise(done => { resolve = done; }) : Promise.resolve(rows));
        if (!doctorMode) await page.selectDoctor(doctor);
        await page.selectDate('2026-11-15');
        await page.selectDate('2026-11-16');
        assert.match(page.table.innerHTML, /data-block-id="5"/);
        resolve(rows); await tick();
        assert.match(page.table.innerHTML, /data-block-id="5"/);
        assert.doesNotMatch(page.table.innerHTML, /data-block-id="4"/);
    });

    test(`${role}: midnight clears a date that became historical without requesting or writing data`, async () => {
        const page = await setup(doctorMode);
        if (!doctorMode) await page.selectDoctor(doctor);
        await page.selectDate('2026-11-14');
        const reads = page.calls.length;
        page.advance('2026-11-15T03:00:00Z');
        assert.equal(page.date.min, '2026-11-15');
        assert.equal(page.date.value, '');
        assert.match(page.table.innerHTML, /Seleccione una fecha/);
        assert.equal(page.calls.length, reads);
        assert.equal(page.writes.length, 0);
    });

    test(`${role}: creating blocks keeps the existing payload and refreshes the selected date`, async () => {
        const page = await setup(doctorMode);
        if (!doctorMode) await page.selectDoctor(doctor);
        await page.selectDate('2026-11-15');
        page.node(doctorMode ? 'disponibilidadMedicoFecha' : 'disponibilidadFecha').value = '2026-11-16';
        page.node(doctorMode ? 'disponibilidadMedicoHoraInicio' : 'disponibilidadHoraInicio').value = '10:00';
        page.node(doctorMode ? 'disponibilidadMedicoHoraFin' : 'disponibilidadHoraFin').value = '10:40';
        page.node(doctorMode ? 'generarBloquesMedicoBtn' : 'generarBloquesBtn').dispatchEvent(new Event('click'));
        page.form.dispatchEvent(new Event('submit')); await tick();
        assert.equal(page.writes.length, 1);
        assert.equal(page.writes[0].path, 'medicos/2/disponibilidades/lote/');
        assert.equal(page.writes[0].options.method, 'POST');
        assert.deepEqual(JSON.parse(JSON.stringify(page.writes[0].options.body)), { bloques: [
            { fecha: '2026-11-16', hora_inicio: '10:00', hora_fin: '10:20' },
            { fecha: '2026-11-16', hora_inicio: '10:20', hora_fin: '10:40' }
        ] });
        assert.equal(page.date.value, '2026-11-15');
        assert.equal(page.calls.at(-1).filters.fecha, '2026-11-15');
    });
}
