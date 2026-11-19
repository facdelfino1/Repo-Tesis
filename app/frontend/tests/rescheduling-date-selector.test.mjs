import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleDestinationDates, initDestinationDateSelector } from '../assets/js/features/rescheduling/date-selector.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class Field extends EventTarget {
    value = ''; disabled = false; textContent = ''; options = [];
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
}
globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };

test('includes the affected date only when authorized by the server and retains later dates', () => {
    const data = { fechas_disponibles: ['2030-01-13', '2030-01-12', '2030-01-13', '2030-01-11'] };
    assert.deepEqual(eligibleDestinationDates(data, '2030-01-12'), ['2030-01-12', '2030-01-13']);
    assert.deepEqual(eligibleDestinationDates({ fechas_disponibles: [] }, '2030-01-12'), []);
});

test('requires explicit selection and clears a date that is no longer eligible', async () => {
    const select = new Field(), status = new Field(), refreshButton = new Field();
    const context = { doctorId: 1, affectedDate: '2026-11-12' };
    let data = { fechas_disponibles: ['2026-11-13', '2026-11-16'] };
    const selector = initDestinationDateSelector({ select, status, refreshButton, context: () => context,
        load: async () => data, onUpdate: () => {} });
    await selector.refresh();
    assert.deepEqual(select.options.map(option => option.value), ['', '2026-11-12', '2026-11-13', '2026-11-16']);
    assert.equal(select.options[1].disabled, true);
    assert.equal(select.value, ''); assert.equal(selector.isValid(), false);
    select.value = '2026-11-16'; select.dispatchEvent(new Event('change'));
    assert.equal(selector.isValid(), true);
    await selector.refresh();
    assert.equal(select.value, '2026-11-16');
    data = { fechas_disponibles: ['2026-11-13'] };
    await selector.refresh();
    assert.equal(select.value, ''); assert.equal(selector.isValid(), false);
    assert.deepEqual(select.options.map(option => option.value), ['', '2026-11-12', '2026-11-13']);
    data = { fechas_disponibles: [] };
    await selector.refresh();
    assert.equal(select.disabled, false); // The affected date remains visible, but cannot be selected.
    assert.equal(select.options[1].disabled, true);
    select.value = context.affectedDate;
    assert.equal(selector.isValid(), false);
    assert.match(status.textContent, /No hay fechas con disponibilidad utilizable/);
});

test('doctor and affected-date changes invalidate immediately and discard obsolete responses', async () => {
    const select = new Field(), status = new Field(), refreshButton = new Field();
    const context = { doctorId: 1, affectedDate: '2026-11-12' }, first = deferred(), second = deferred();
    const selector = initDestinationDateSelector({ select, status, refreshButton, context: () => context,
        load: id => id === 1 ? first.promise : second.promise, onUpdate: () => {} });
    const old = selector.refresh();
    context.doctorId = 2; context.affectedDate = '2026-11-13'; selector.reset();
    const latest = selector.refresh();
    second.resolve({ fechas_disponibles: ['2026-11-16'] });
    await latest;
    first.resolve({ fechas_disponibles: ['2026-11-14'] });
    await old;
    assert.deepEqual(select.options.map(option => option.value), ['', '2026-11-13', '2026-11-16']);
    context.affectedDate = '2026-11-16'; selector.reset();
    assert.equal(select.value, ''); assert.equal(selector.isValid(), false);
});

test('same-day selection becomes invalid when its scope or server availability changes', async () => {
    const select = new Field(), status = new Field(), refreshButton = new Field();
    const context = { doctorId: 1, affectedDate: '2030-01-10', hora_inicio: '09:00', hora_fin: '10:00' };
    let dates = ['2030-01-10', '2030-01-11'];
    const selector = initDestinationDateSelector({ select, status, refreshButton, context: () => context,
        load: async () => ({ fechas_disponibles: dates }), onUpdate() {} });
    await selector.refresh();
    assert.equal(select.options[1].disabled, false);
    select.value = context.affectedDate;
    assert.equal(selector.isValid(), true);
    context.hora_fin = '11:00';
    assert.equal(selector.isValid(), false);
    dates = ['2030-01-11']; await selector.refresh();
    assert.equal(select.value, '');
    assert.equal(select.options[1].value, context.affectedDate);
    assert.equal(select.options[1].disabled, true);
});

test('a failed availability query keeps execution unavailable and reports the error', async () => {
    const select = new Field(), status = new Field(), refreshButton = new Field();
    const selector = initDestinationDateSelector({ select, status, refreshButton,
        context: () => ({ doctorId: 1, affectedDate: '2026-11-12' }),
        load: async () => { throw new Error('synthetic failure'); }, onUpdate: () => {} });
    assert.equal(await selector.refresh(), false);
    assert.equal(selector.isValid(), false);
    assert.equal(select.disabled, true);
    assert.equal(select.options[1].value, '2026-11-12');
    assert.equal(select.options[1].disabled, true);
    assert.match(status.textContent, /No se pudieron consultar las fechas/);
});
