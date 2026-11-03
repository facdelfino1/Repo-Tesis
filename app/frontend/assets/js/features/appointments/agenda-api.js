import { request, listAll } from '../../core/api.js';

const root = doctor => `medicos/${encodeURIComponent(doctor)}/turnos/`;
export const getAgendaTurns = (doctor, fecha = '') => listAll(root(doctor) + (fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''));
export const getAgendaTurn = (doctor, id) => request(`${root(doctor)}${encodeURIComponent(id)}/`);
export const findPatients = dni => listAll(`pacientes/?dni=${encodeURIComponent(dni)}`);
export const reserveSecretaryTurn = (doctor, paciente, disponibilidad, respuestas) => request(root(doctor), {
    method: 'POST', body: { paciente, disponibilidad, ...(respuestas === undefined ? {} : { respuestas }) }
});
export const modifyAgendaTurn = (doctor, id, disponibilidad) => request(`${root(doctor)}${encodeURIComponent(id)}/modificar/`, {
    method: 'POST', body: { disponibilidad }
});
// Explicit operations only; no generic state or timestamp write.
export function operateAgendaTurn(doctor, id, action) {
    if (!['cancelar', 'presencia', 'iniciar', 'finalizar'].includes(action)) throw new TypeError('Acción no permitida');
    return request(`${root(doctor)}${encodeURIComponent(id)}/${action}/`, { method: 'POST', body: {} });
}
