// Presentation-only history rules; the backend supplies dates and horario_futuro.
export const activeStates = new Set(['RESERVADO', 'PENDIENTE', 'PRESENTE', 'EN_ATENCION']);

export function getPatientHistory(turns, { includeExpiredReservations = false } = {}) {
    return turns.filter(turn => !activeStates.has(turn.estado)
        || (includeExpiredReservations && turn.estado === 'RESERVADO' && !turn.horario_futuro))
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora) || b.id_turno - a.id_turno);
}

export function getRecentPatientHistory(turns) {
    return getPatientHistory(turns, { includeExpiredReservations: true })
        .filter(turn => !turn.horario_futuro).slice(0, 5);
}

export function filterPatientHistory(history, { fecha = '', especialidad = '', medico = '', estado = '' } = {}) {
    return history.filter(turn => (!fecha || turn.fecha === fecha)
        && (!especialidad || String(turn.medico.especialidad.id) === especialidad)
        && (!medico || String(turn.medico.id) === medico)
        && (!estado || turn.estado === estado));
}
