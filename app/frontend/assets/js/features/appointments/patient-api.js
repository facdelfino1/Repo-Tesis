import { request, listAll } from '../../core/api.js';

// Only backend DTOs: no local identity, dates, state transitions or inventory writes.
export const getPatientTurns = () => listAll('turnos/');
export const getPatientTurn = id => request(`turnos/${encodeURIComponent(id)}/`);
export const getPatientDelay = id => request(`turnos/${encodeURIComponent(id)}/demora/`);
export const evaluatePatientTriage = (doctorId, respuestas, disponibilidad) => request(
    `medicos/${encodeURIComponent(doctorId)}/triaje-preliminar/`, { method: 'POST', body: { respuestas, disponibilidad } });
export const reservePatientTurn = (doctorId, disponibilidad, respuestas) => request(
    `medicos/${encodeURIComponent(doctorId)}/turnos/`, {
        method: 'POST', body: { disponibilidad, ...(respuestas === undefined ? {} : { respuestas }) }
    });
export const modifyPatientTurn = (id, disponibilidad) => request(`turnos/${encodeURIComponent(id)}/modificar/`, {
    method: 'POST', body: { disponibilidad }
});
export const cancelPatientTurn = id => request(`turnos/${encodeURIComponent(id)}/cancelar/`, {
    method: 'POST', body: {}
});
