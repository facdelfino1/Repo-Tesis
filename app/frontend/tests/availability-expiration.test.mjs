import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAvailabilityExpired } from '../assets/js/features/availability/availability-service.js';
import { availabilityActions } from '../assets/js/features/availability/availability-ui.js';

const block = (fecha, hora_inicio) => ({ fecha, hora_inicio });

test('uses the Buenos Aires date and start time, including the exact minute', () => {
    const before = new Date('2026-11-10T11:59:59Z'); // 08:59:59 in Buenos Aires
    const start = new Date('2026-11-10T12:00:00Z'); // 09:00:00 in Buenos Aires
    assert.equal(isAvailabilityExpired(block('2026-11-10', '09:00:00'), before), false);
    assert.equal(isAvailabilityExpired(block('2026-11-10', '09:00:00'), start), true);
    assert.equal(isAvailabilityExpired(block('2026-11-10', '08:40:00'), before), true);
});

test('compares calendar days in the agenda timezone, not the browser timezone', () => {
    const now = new Date('2026-11-10T01:30:00Z'); // 9 November, 22:30 in Buenos Aires
    assert.equal(isAvailabilityExpired(block('2026-11-09', '22:20:00'), now), true);
    assert.equal(isAvailabilityExpired(block('2026-11-09', '22:40:00'), now), false);
    assert.equal(isAvailabilityExpired(block('2026-11-10', '00:00:00'), now), false);
    assert.equal(isAvailabilityExpired(block('2026-11-08', '23:00:00'), now), true);
});

test('real API date/time strings hide actions after 19:00 on the same day for every state', () => {
    const now = new Date('2026-11-10T22:05:00Z');
    for (const estado of ['DISPONIBLE', 'BLOQUEADO', 'OCUPADO']) {
        const row = { id: 9, medico: 1, fecha: '2026-11-10', hora_inicio: '08:00:00',
            hora_fin: '08:20:00', estado, duracion_minutos: 20 };
        assert.equal(isAvailabilityExpired(row, now), true);
        assert.equal(availabilityActions(row, now), 'Horario vencido');
    }
});

test('future blocks retain state-specific actions with the real API shape', () => {
    const now = new Date('2026-11-10T22:05:00Z');
    const row = estado => ({ id: 10, medico: 1, fecha: '2026-11-11',
        hora_inicio: '08:00:00', hora_fin: '08:20:00', estado, duracion_minutos: 20 });
    assert.match(availabilityActions(row('DISPONIBLE'), now), /data-operation="bloquear"/);
    assert.match(availabilityActions(row('BLOQUEADO'), now), /data-operation="desbloquear"/);
    assert.match(availabilityActions(row('DISPONIBLE'), now), /data-operation="eliminar"/);
    assert.equal(availabilityActions(row('OCUPADO'), now), 'Sin acciones');
});
