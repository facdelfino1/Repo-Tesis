// Observed attention time only; duracion_turno remains the scheduled block length.
export function formatAttentionDuration(turn) {
    if (turn.estado === 'EN_ATENCION') return 'En curso';
    if (turn.estado !== 'COMPLETADO') return '—';
    if (typeof turn.fecha_hora_inicio !== 'string' || typeof turn.fecha_hora_cierre !== 'string') return '—';
    // Date.parse keeps milliseconds; retain the remaining PostgreSQL microseconds for correct ceiling at minute boundaries.
    const remainder = value => Number((value.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0').slice(3, 6));
    const elapsed = (Date.parse(turn.fecha_hora_cierre) - Date.parse(turn.fecha_hora_inicio)) * 1000
        + remainder(turn.fecha_hora_cierre) - remainder(turn.fecha_hora_inicio);
    if (!Number.isFinite(elapsed) || elapsed <= 0) return '—';
    return `${Math.ceil(elapsed / 60000000)} min`;
}
