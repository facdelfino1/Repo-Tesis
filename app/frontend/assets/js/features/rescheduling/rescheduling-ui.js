import { errorMessage } from '../../core/api.js';
import { getCurrentUser, pageMessage } from '../../core/session.js';
import { escapeHtml as esc } from '../../core/helpers.js';
import { formatDate } from '../../core/formatters.js';
import { getBootstrapModal, showModal, hideModal } from '../../components/modals.js';
import { bindDoctorSelectors, getDoctor, getAssignableAvailability } from '../catalog/catalog-service.js';
import { getAgendaTurns } from '../appointments/agenda-api.js';
import { getPatientTurns } from '../appointments/patient-api.js';
import * as api from './rescheduling-api.js';

const node = id => document.getElementById(id);
const fullName = person => `${person.nombre} ${person.apellido}`;
const priority = turn => esc(turn?.prioridad ?? 'Sin triaje específico');
const stamp = value => value ? esc(new Date(value).toLocaleString('es-AR')) : '—';
const emptyRow = (columns, text) => `<tr><td colspan="${columns}">${esc(text)}</td></tr>`;
function feedback(box, text, type = 'danger') { box.textContent = text; box.className = `alert alert-${type}${text ? '' : ' d-none'}`; }
function conflictMessage(error) {
    const ids = error.data?.turnos_rechazados;
    // B6 may attach the full proposal DTO to a conflict; display its human detail only.
    const detail = typeof error.data?.detail === 'string' ? error.data.detail : errorMessage(error);
    return detail + (Array.isArray(ids) && ids.length ? ` Turnos rechazados: ${ids.join(', ')}.` : '');
}
function summary(p, turn) {
    return `<p class="fw-semibold mb-1">Turno ${p.turno}${turn ? ` · ${esc(fullName(turn.medico))} · ${esc(turn.medico.especialidad.nombre)}` : ''}</p>
        <p class="mb-1">Origen histórico: ${formatDate(p.fecha_origen)} ${esc(p.hora_origen.slice(0, 5))} (no vigente)</p>
        <p class="mb-1">Propuesta: ${formatDate(p.fecha_destino)} ${esc(p.hora_inicio_destino.slice(0, 5))}–${esc(p.hora_fin_destino.slice(0, 5))}</p>
        <p class="mb-1">Estado: <strong>${esc(p.estado)}</strong> · ${p.vigente ? 'Vigente al consultar' : 'No aplicable actualmente'}</p>
        <p class="mb-1">Motivo: ${esc(p.motivo)}</p><p class="small mb-1">Generada: ${stamp(p.fecha_hora_creacion)} · Resolución: ${stamp(p.fecha_hora_resolucion)}</p>
        ${p.motivo_cierre ? `<p class="mb-1">${esc(p.motivo_cierre)}</p>` : ''}
        <p class="small text-secondary">Una propuesta EN_ESPERA no garantiza disponibilidad. Solo una aceptación confirmada por el servidor reserva el horario.</p>`;
}

export async function openPendingRecovery(turn, { secretary = false, onUpdated = async () => {} } = {}) {
    let element = node('recuperarPendienteModal');
    if (!element) {
        element = document.createElement('div'); element.id = 'recuperarPendienteModal'; element.className = 'modal fade'; element.tabIndex = -1;
        element.innerHTML = '<div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h2 class="modal-title h5">Asignar horario al pendiente</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body"><p data-summary></p><div data-feedback class="alert d-none" role="alert"></div><label class="form-label" for="recuperarPendienteSlot">Nuevo bloque del mismo médico</label><select id="recuperarPendienteSlot" class="form-select"></select></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cerrar</button><button type="button" class="btn btn-primary" data-save>Confirmar asignación</button></div></div></div>';
        document.body.append(element);
    }
    const modal = getBootstrapModal(element), message = element.querySelector('[data-feedback]'), select = node('recuperarPendienteSlot'), save = element.querySelector('[data-save]');
    if (!modal) { pageMessage('No fue posible abrir el formulario. Recargue la página.', 'danger'); return; }
    element.querySelector('[data-summary]').textContent = `Turno ${turn.id_turno} · ${fullName(turn.medico)} · ${turn.medico.especialidad.nombre}. El horario anterior es histórico.`;
    let rows = [], busy = false;
    async function refresh() {
        rows = []; save.disabled = true; select.disabled = true; select.replaceChildren(new Option('Consultando horarios...', ''));
        rows = await getAssignableAvailability(turn.medico.id);
        select.replaceChildren(new Option(rows.length ? 'Seleccione un horario' : 'No hay horarios disponibles', ''));
        rows.forEach(row => select.add(new Option(`${formatDate(row.fecha)} ${row.hora_inicio.slice(0, 5)}–${row.hora_fin.slice(0, 5)}`, row.id)));
        select.disabled = !rows.length;
    }
    feedback(message, ''); showModal(modal);
    select.onchange = () => { save.disabled = busy || !select.value; };
    save.onclick = async () => {
        const id = Number(select.value); if (busy || !rows.some(row => row.id === id)) return;
        busy = true; save.disabled = true; select.disabled = true;
        try {
            if (secretary) await api.reassignAgendaTurn(turn.medico.id, turn.id_turno, id);
            else await api.reassignPatientTurn(turn.id_turno, id);
            busy = false; hideModal(modal);
            try { await onUpdated(); }
            catch (error) { pageMessage(`La asignación se confirmó, pero no pudo actualizarse la consulta. ${errorMessage(error)}`, 'warning'); }
        } catch (error) {
            feedback(message, conflictMessage(error));
            if (error.status === 409) { try { await refresh(); await onUpdated(); } catch (refreshError) { feedback(message, `${errorMessage(error)} ${errorMessage(refreshError)}`); } }
        } finally { busy = false; select.disabled = !rows.length; save.disabled = !select.value; }
    };
    const preventClose = event => { if (busy) event.preventDefault(); };
    element.addEventListener('hide.bs.modal', preventClose);
    element.addEventListener('hidden.bs.modal', () => element.removeEventListener('hide.bs.modal', preventClose), { once: true });
    try { await refresh(); } catch (error) { feedback(message, errorMessage(error)); }
}

export async function initPatientProposals({ onUpdated = async () => {} } = {}) {
    const section = document.createElement('section'); section.id = 'propuestasPacienteSection'; section.className = 'card dashboard-card border-0 shadow-sm my-4';
    section.innerHTML = '<div class="card-body"><div class="d-flex justify-content-between"><h2 class="h5">Propuestas de reprogramación</h2><button type="button" class="btn btn-outline-primary btn-sm" data-refresh>Actualizar</button></div><div data-feedback class="alert d-none" role="alert"></div><div data-proposals class="row g-3"></div></div>';
    document.querySelector('main').append(section);
    const message = section.querySelector('[data-feedback]'), list = section.querySelector('[data-proposals]');
    let busy = false, readVersion = 0;
    async function refresh() {
        const version = ++readVersion;
        const [proposals, turns] = await Promise.all([api.getPatientProposals(), getPatientTurns()]);
        if (version !== readVersion) return;
        const byId = new Map(turns.map(turn => [turn.id_turno, turn]));
        list.innerHTML = proposals.map(p => `<div class="col-12 col-lg-6"><article class="border rounded-3 p-3 h-100">${summary(p, byId.get(p.turno))}
            <button type="button" class="btn btn-outline-secondary btn-sm" data-proposal="${p.id}" data-decision="detalle">Consultar detalle</button>
            ${p.estado === 'EN_ESPERA' ? `<button type="button" class="btn btn-primary btn-sm" data-proposal="${p.id}" data-decision="aceptar">Aceptar propuesta</button><button type="button" class="btn btn-outline-danger btn-sm" data-proposal="${p.id}" data-decision="rechazar">Rechazar propuesta</button>` : ''}</article></div>`).join('') || '<p class="text-secondary mb-0">No tiene propuestas de reprogramación.</p>';
        list.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    }
    section.querySelector('[data-refresh]').addEventListener('click', async () => { try { await refresh(); await onUpdated(); } catch (error) { feedback(message, errorMessage(error)); } });
    list.addEventListener('click', async event => {
        const button = event.target.closest('[data-proposal]'); if (!button || busy) return;
        busy = true; list.querySelectorAll('button').forEach(control => { control.disabled = true; });
        try {
            const p = await api.getProposal(button.dataset.proposal);
            if (button.dataset.decision === 'detalle') feedback(message, `Propuesta ${p.id}: ${p.estado}. ${p.motivo}. ${p.motivo_cierre || ''}`, 'info');
            else if (window.confirm(`¿${button.dataset.decision === 'aceptar' ? 'Aceptar' : 'Rechazar'} la propuesta ${p.id}?`)) {
                const result = await api.respondProposal(p.id, button.dataset.decision);
                feedback(message, `Propuesta ${result.id}: ${result.estado}.`, 'success');
                try { await refresh(); await onUpdated(); }
                catch (error) { feedback(message, `Propuesta ${result.id}: ${result.estado}. No pudo actualizarse la consulta. ${errorMessage(error)}`, 'warning'); }
            }
        } catch (error) {
            feedback(message, conflictMessage(error));
            if (error.status === 409) { try { await refresh(); await onUpdated(); } catch (refreshError) { feedback(message, `${errorMessage(error)} ${errorMessage(refreshError)}`); } }
        } finally { busy = false; list.querySelectorAll('button').forEach(control => { control.disabled = false; }); }
    });
    try { await refresh(); } catch (error) { feedback(message, errorMessage(error)); }
    return { refresh };
}

export async function initManagerRescheduling() {
    const medical = getCurrentUser().rol === 'MEDICO', prefix = medical ? 'reprogramacionMedico' : 'reprogramacion';
    const form = node(`${prefix}Form`), message = node(`${prefix}Mensaje`), affected = node(`${prefix}AfectadosTabla`), proposalsTable = node(`${prefix}PropuestasTabla`), pendingTable = node(`${prefix}EsperaTabla`);
    const search = node(medical ? 'buscarAfectadosMedicoBtn' : 'buscarAfectadosBtn'), execute = node(medical ? 'ejecutarReprogramacionMedicoBtn' : 'ejecutarReprogramacionBtn');
    const confirmButton = node(medical ? 'confirmarReprogramacionMedicoBtn' : 'confirmarReprogramacionBtn');
    const modalElement = node(medical ? 'confirmarReprogramacionMedicoModal' : 'confirmarReprogramacionModal'), modal = getBootstrapModal(modalElement);
    const fields = { fecha_original: node(`${prefix}Fecha`), hora_inicio: node(`${prefix}HoraInicio`), hora_fin: node(`${prefix}HoraFin`) };
    const destination = node(`${prefix}NuevaFecha`), reason = node(`${prefix}Motivo`);
    let doctor = medical ? await getDoctor(getCurrentUser().perfil.id) : null, candidates = [], lastScope = null, busy = false, generation = 0, collectionsVersion = 0, context = new Map(), pending = [];
    function scope() { return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])); }
    const signature = () => JSON.stringify([doctor?.id, scope()]);
    const selectedIds = () => [...affected.querySelectorAll('input:checked')].map(input => Number(input.value));
    function updateExecute() { execute.disabled = busy || !doctor || signature() !== lastScope || !selectedIds().length; }
    function clearFeedback() { feedback(message, ''); node(`${prefix}DisponibilidadAviso`).classList.add('d-none'); }
    function clearCandidates() { ++generation; candidates = []; lastScope = null; affected.innerHTML = emptyRow(medical ? 7 : 10, 'Consulte los turnos afectados de esta agenda.'); updateExecute(); }
    function renderCandidates() {
        affected.innerHTML = candidates.map(t => `<tr><td><input type="checkbox" class="form-check-input" value="${t.id_turno}" aria-label="Seleccionar turno ${t.id_turno}"></td><td>${esc(fullName(t.paciente_detalle))}</td><td>${esc(t.paciente_detalle.dni)}</td>${medical ? '' : `<td>${esc(fullName(t.medico))}</td><td>${esc(t.medico.especialidad.nombre)}</td>`}<td>${formatDate(t.fecha)}</td><td>${esc(t.hora.slice(0, 5))}</td><td>${priority(t)}</td><td>${esc(t.estado)}</td>${medical ? '' : '<td>Sistema</td>'}</tr>`).join('') || emptyRow(medical ? 7 : 10, 'No hay reservas candidatas en ese intervalo.'); updateExecute();
    }
    function renderProposals(proposals) {
        proposalsTable.innerHTML = proposals.map(p => { const t = context.get(p.turno); return `<tr><td>${t ? esc(fullName(t.paciente_detalle)) : `Turno ${p.turno}`}</td><td>${priority(t)}</td><td>${formatDate(p.fecha_origen)} ${esc(p.hora_origen.slice(0, 5))} (histórico)</td><td>${summary(p, t)}</td><td>${esc(p.estado)}</td></tr>`; }).join('') || emptyRow(5, 'No hay propuestas para esta agenda.');
    }
    async function refreshCollections() {
        const version = ++collectionsVersion;
        const current = doctor; if (!current) { context = new Map(); pending = []; renderProposals([]); pendingTable.innerHTML = emptyRow(5, 'Seleccione un médico.'); return; }
        const [turns, proposals, pendingTurns] = await Promise.all([getAgendaTurns(current.id), api.getAgendaProposals(current.id), api.getPendingTurns(current.id)]);
        if (doctor?.id !== current.id || version !== collectionsVersion) return;
        context = new Map(turns.map(t => [t.id_turno, t])); pending = pendingTurns; renderProposals(proposals);
        pendingTable.innerHTML = pending.map(t => `<tr><td>${esc(fullName(t.paciente_detalle))} · Turno ${t.id_turno}</td><td>${esc(t.paciente_detalle.dni)}</td><td>${priority(t)}</td><td>Necesita nueva asignación. El origen es histórico.</td><td>PENDIENTE <button type="button" class="btn btn-outline-primary btn-sm" data-pending="${t.id_turno}" data-action="proponer">Generar propuesta</button>${medical ? '' : `<button type="button" class="btn btn-outline-secondary btn-sm" data-pending="${t.id_turno}" data-action="reasignar">Reasignar</button>`}</td></tr>`).join('') || emptyRow(5, 'No hay turnos pendientes.');
    }
    async function showResult(result) {
        feedback(message, `Nueva fecha: ${formatDate(result.nueva_fecha)}. Propuestas generadas: ${result.propuestas.map(p => `${p.id} (Turno ${p.turno})`).join(', ') || 'ninguna'}. Requiere revisión: ${result.requiere_revision.join(', ') || 'ninguno'}. Turnos rechazados: ${result.turnos_rechazados.join(', ') || 'ninguno'}. Los afectados siguen PENDIENTE hasta una asignación confirmada.`, result.requiere_revision.length ? 'warning' : 'success');
        node(`${prefix}DisponibilidadAviso`).classList.toggle('d-none', !result.requiere_revision.length);
        node(`${prefix}DisponibilidadTexto`).textContent = `La fecha ${formatDate(result.nueva_fecha)} no tuvo bloques suficientes. Requieren revisión los turnos: ${result.requiere_revision.join(', ')}. No se buscó otra fecha.`;
        node(`${prefix}CargarDisponibilidadBtn`).classList.toggle('d-none', !result.requiere_revision.length);
        try { await refreshCollections(); renderProposals(result.propuestas); }
        catch (error) { feedback(message, `${message.textContent} El proceso fue registrado, pero no pudo actualizarse la consulta. ${errorMessage(error)}`, 'warning'); }
    }
    if (!medical) await bindDoctorSelectors(node('reprogramacionEspecialidad'), node('reprogramacionMedico'), async (value, error) => {
        doctor = value; clearCandidates(); clearFeedback(); context = new Map(); pending = []; renderProposals([]); pendingTable.innerHTML = emptyRow(5, 'Consultando pendientes...');
        if (error) feedback(message, errorMessage(error));
        try { await refreshCollections(); } catch (err) { feedback(message, errorMessage(err)); }
    });
    node(`${prefix}Notificaciones`).textContent = 'Las propuestas son notificaciones internas consultables por el Paciente. Solo el propietario puede aceptarlas o rechazarlas. No se envían correos desde esta pantalla.';
    form.addEventListener('submit', event => event.preventDefault());
    Object.values(fields).forEach(field => field.addEventListener('input', () => { if (!busy) { clearCandidates(); clearFeedback(); } }));
    [destination, reason].forEach(field => field.addEventListener('input', () => { if (!busy) clearFeedback(); }));
    affected.addEventListener('change', updateExecute);
    async function searchCandidates() {
        if (!doctor || Object.values(scope()).some(value => !value)) { feedback(message, 'Seleccione médico, fecha original y ambas horas.'); return; }
        const current = ++generation, snapshot = signature(), doctorId = doctor.id; search.disabled = true;
        try { const data = await api.getAffectedTurns(doctorId, scope()); if (current !== generation || snapshot !== signature()) return; candidates = data; lastScope = snapshot; renderCandidates(); }
        catch (error) { if (current === generation) { clearCandidates(); feedback(message, conflictMessage(error)); } }
        finally { search.disabled = busy; }
    }
    search.addEventListener('click', () => { if (!busy) searchCandidates(); });
    execute.addEventListener('click', () => {
        if (busy || execute.disabled) return;
        if (!destination.value || !reason.value.trim()) { feedback(message, 'Indique nueva fecha y motivo.'); return; }
        if (!modal) { feedback(message, 'No fue posible abrir la confirmación. Recargue la página.'); return; }
        modalElement.querySelector('.modal-body').textContent = `Generar propuestas para ${selectedIds().length} turno(s) de ${fullName(doctor)} en ${formatDate(destination.value)}. Los turnos pasarán a PENDIENTE y los bloques originales se bloquearán. Una propuesta no es una reserva.`; showModal(modal);
    });
    async function withWrite(operation) {
        if (busy) return; busy = true;
        const previous = [...form.querySelectorAll('input,select,button'), ...affected.querySelectorAll('input'), ...pendingTable.querySelectorAll('button'), confirmButton].map(control => [control, control.disabled]);
        previous.forEach(([control]) => { control.disabled = true; });
        try { await showResult(await operation()); clearCandidates(); }
        catch (error) { feedback(message, conflictMessage(error)); if (error.status === 409) { clearCandidates(); try { await refreshCollections(); await searchCandidates(); } catch (refreshError) { feedback(message, `${errorMessage(error)} ${errorMessage(refreshError)}`); } } }
        finally { busy = false; previous.forEach(([control, disabled]) => { control.disabled = disabled; }); search.disabled = false; updateExecute(); }
    }
    confirmButton.addEventListener('click', async () => {
        if (busy || signature() !== lastScope || !selectedIds().length) return;
        const doctorId = doctor.id, body = { ...scope(), nueva_fecha: destination.value, turnos: selectedIds(), motivo: reason.value.trim() };
        hideModal(modal); await withWrite(() => api.generateRescheduling(doctorId, body));
    });
    pendingTable.addEventListener('click', async event => {
        const button = event.target.closest('[data-pending]'); if (!button || busy || !doctor) return;
        const turn = pending.find(t => t.id_turno === Number(button.dataset.pending)); if (!turn) return;
        if (button.dataset.action === 'reasignar') { await openPendingRecovery(turn, { secretary: true, onUpdated: refreshCollections }); return; }
        if (!destination.value || !reason.value.trim()) { feedback(message, 'Indique nueva fecha y motivo en el formulario para generar una propuesta individual.'); return; }
        const doctorId = doctor.id, body = { nueva_fecha: destination.value, motivo: reason.value.trim() };
        await withWrite(() => api.proposePending(doctorId, turn.id_turno, body));
    });
    clearCandidates(); await refreshCollections();
}
