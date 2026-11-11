import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleDestinationDates, initDestinationDateSelector } from '../assets/js/features/rescheduling/date-selector.js';

const block = (id, fecha, estado = 'DISPONIBLE', hora_inicio = '08:00:00') =>
    ({ id, medico: 1, fecha, hora_inicio, hora_fin: '08:20:00', estado, duracion_minutos: 20 });
const now = new Date('2026-11-10T22:05:00Z');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class Field extends EventTarget {
    value = ''; disabled = false; textContent = ''; options = [];
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
}
globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };

test('filters dates with the same free, future and unoffered block criteria as the engine', () => {
    const data = {
        blocks: [block(1, '2026-11-10'), block(2, '2026-11-12'), block(3, '2026-11-13'),
            block(4, '2026-11-13'), block(5, '2026-11-14', 'BLOQUEADO'),
            block(6, '2026-11-15', 'OCUPADO'), block(7, '2026-11-16'),
            block(8, '2026-11-17'), block(9, '2026-11-18')],
        proposals: [{ estado: 'EN_ESPERA', disponibilidad_destino: 8 },
            { estado: 'RECHAZADA', disponibilidad_destino: 7 }],
        turns: [{ estado: 'RESERVADO', disponibilidad: 9 }, { estado: 'CANCELADO', disponibilidad: 7 }]
    };
    assert.deepEqual(eligibleDestinationDates(data, '2026-11-12', now), ['2026-11-13', '2026-11-16']);
    assert.deepEqual(eligibleDestinationDates(data, '2026-11-16', now), []);
});

test('requires explicit selection and clears a date that is no longer eligible', async () => {
    const select = new Field(), status = new Field(), refreshButton = new Field();
    const context = { doctorId: 1, affectedDate: '2026-11-12' };
    let data = { blocks: [block(3, '2026-11-13'), block(7, '2026-11-16')], proposals: [], turns: [] };
    const selector = initDestinationDateSelector({ select, status, refreshButton, context: () => context,
        load: async () => data, onUpdate: () => {} });
    await selector.refresh();
    assert.deepEqual(select.options.map(option => option.value), ['', '2026-11-13', '2026-11-16']);
    assert.equal(select.value, ''); assert.equal(selector.isValid(), false);
    select.value = '2026-11-16'; select.dispatchEvent(new Event('change'));
    assert.equal(selector.isValid(), true);
    await selector.refresh();
    assert.equal(select.value, '2026-11-16');
    data = { ...data, proposals: [{ estado: 'EN_ESPERA', disponibilidad_destino: 7 }] };
    await selector.refresh();
    assert.equal(select.value, ''); assert.equal(selector.isValid(), false);
    assert.deepEqual(select.options.map(option => option.value), ['', '2026-11-13']);
    data = { ...data, proposals: [], blocks: [] };
    await selector.refresh();
    assert.equal(select.disabled, true);
    assert.match(status.textContent, /No hay fechas posteriores con disponibilidad/);
});

test('doctor and affected-date changes invalidate immediately and discard obsolete responses', async () => {
    const select = new Field(), status = new Field(), refreshButton = new Field();
    const context = { doctorId: 1, affectedDate: '2026-11-12' }, first = deferred(), second = deferred();
    const selector = initDestinationDateSelector({ select, status, refreshButton, context: () => context,
        load: id => id === 1 ? first.promise : second.promise, onUpdate: () => {} });
    const old = selector.refresh();
    context.doctorId = 2; context.affectedDate = '2026-11-13'; selector.reset();
    const latest = selector.refresh();
    second.resolve({ blocks: [block(12, '2026-11-16')], proposals: [], turns: [] });
    await latest;
    first.resolve({ blocks: [block(11, '2026-11-14')], proposals: [], turns: [] });
    await old;
    assert.deepEqual(select.options.map(option => option.value), ['', '2026-11-16']);
    context.affectedDate = '2026-11-16'; selector.reset();
    assert.equal(select.value, ''); assert.equal(selector.isValid(), false);
});

test('a failed availability query keeps execution unavailable and reports the error', async () => {
    const select = new Field(), status = new Field(), refreshButton = new Field();
    const selector = initDestinationDateSelector({ select, status, refreshButton,
        context: () => ({ doctorId: 1, affectedDate: '2026-11-12' }),
        load: async () => { throw new Error('synthetic failure'); }, onUpdate: () => {} });
    assert.equal(await selector.refresh(), false);
    assert.equal(selector.isValid(), false);
    assert.equal(select.disabled, true);
    assert.match(status.textContent, /No se pudieron consultar las fechas/);
});
