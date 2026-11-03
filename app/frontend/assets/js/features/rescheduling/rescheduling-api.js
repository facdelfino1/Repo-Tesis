import { request, listAll } from '../../core/api.js';

const agenda = id => `medicos/${encodeURIComponent(id)}/`;
export const getAffectedTurns = (doctor, scope) => request(`${agenda(doctor)}reprogramacion/afectados/?${new URLSearchParams(scope)}`);
export const generateRescheduling = (doctor, body) => request(`${agenda(doctor)}reprogramacion/`, { method: 'POST', body });
export const proposePending = (doctor, turn, body) => request(`${agenda(doctor)}turnos/${encodeURIComponent(turn)}/propuestas/`, { method: 'POST', body });
export const getAgendaProposals = doctor => listAll(`${agenda(doctor)}propuestas/`);
export const getPendingTurns = doctor => listAll(`${agenda(doctor)}pendientes/`);
export const getPatientProposals = () => listAll('propuestas/');
export const getProposal = id => request(`propuestas/${encodeURIComponent(id)}/`);
export function respondProposal(id, decision) {
    if (!['aceptar', 'rechazar'].includes(decision)) throw new TypeError('Respuesta no permitida');
    return request(`propuestas/${encodeURIComponent(id)}/${decision}/`, { method: 'POST', body: {} });
}
export const reassignPatientTurn = (id, disponibilidad) => request(`turnos/${encodeURIComponent(id)}/reasignar/`, { method: 'POST', body: { disponibilidad } });
export const reassignAgendaTurn = (doctor, id, disponibilidad) => request(`${agenda(doctor)}turnos/${encodeURIComponent(id)}/reasignar/`, { method: 'POST', body: { disponibilidad } });
