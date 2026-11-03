import { errorMessage } from '../../core/api.js';
import { getCurrentUser, pageMessage } from '../../core/session.js';
import { escapeHtml } from '../../core/helpers.js';
import { formatDate } from '../../core/formatters.js';
import { priorityClass } from '../../components/badges.js';
import { getBootstrapModal, showModal, hideModal } from '../../components/modals.js';
import { bindDoctorSelectors, getAvailability } from '../catalog/catalog-service.js';
import { readAnswers, updateTriageQuestionnaire } from '../triage/triage-ui.js';
import { getPatientTurns, getPatientTurn, reservePatientTurn, modifyPatientTurn, cancelPatientTurn } from './patient-api.js';
import { initPatientProposals, openPendingRecovery } from '../rescheduling/rescheduling-ui.js';

const labels = { RESERVADO: 'Reservado', PENDIENTE: 'Pendiente', PRESENTE: 'Presente',
    EN_ATENCION: 'En atención', COMPLETADO: 'Completado', CANCELADO: 'Cancelado', AUSENTE: 'Ausente' };
const activeStates = new Set(['RESERVADO', 'PENDIENTE', 'PRESENTE', 'EN_ATENCION']);
const text = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
const fullName = doctor => `${doctor.nombre} ${doctor.apellido}`;
const state = turn => labels[turn.estado] || turn.estado;
const priority = turn => turn.prioridad === null ? 'Sin triaje específico' : turn.prioridad;
const specialtyKey = doctor => ({ 'Clínica Médica': 'clinica_medica', 'Pediatría': 'pediatria' }[doctor?.especialidad.nombre] || '');
const questionnaireView = doctor => specialtyKey(doctor) || (doctor ? 'sin_algoritmo' : '');
function feedback(node, message, type = 'danger') {
    node.textContent = message;
    node.className = `alert alert-${type}${message ? '' : ' d-none'}`;
}
function priorityBadge(turn) {
    return turn.prioridad === null ? '' : `<span class="badge ${priorityClass(turn.prioridad)}">${escapeHtml(turn.prioridad)}</span>`;
}
function schedule(turn) {
    return turn.asignacion_vigente
        ? `<dt class="col-5 text-secondary">Fecha</dt><dd class="col-7">${formatDate(turn.fecha)}</dd>
           <dt class="col-5 text-secondary">Hora</dt><dd class="col-7">${escapeHtml(turn.hora.slice(0, 5))}</dd>
           <dt class="col-5 text-secondary">Duración del bloque</dt><dd class="col-7">${turn.duracion_turno} min</dd>`
        : '<dt class="col-5 text-secondary">Horario</dt><dd class="col-7">Pendiente de nueva asignación</dd>';
}
function renderSlots(node, rows, name) {
    node.innerHTML = rows.map(row => `<div class="col-12 col-md-6"><label class="card border h-100"><span class="card-body">
        <input type="radio" name="${name}" value="${row.id}" class="form-check-input me-2">
        <span class="fw-semibold">${formatDate(row.fecha)} ${escapeHtml(row.hora_inicio.slice(0, 5))}–${escapeHtml(row.hora_fin.slice(0, 5))}</span>
        </span></label></div>`).join('');
}
// Collect typed answers; clinical validation and classification remain exclusively server-side.
function questionnaire(form, key) {
    if (!key) return undefined;
    const answers = readAnswers(form, key).respuestas;
    if (Object.values(answers).some(value => value === undefined || value === '' || Number.isNaN(value))) {
        throw new Error('Complete todas las preguntas del cuestionario.');
    }
    return answers;
}

export async function initPatientRequest() {
    const form = document.querySelector('[data-form="appointment-request"]');
    const list = document.getElementById('disponibilidadLista');
    const section = document.getElementById('disponibilidadSection');
    const confirm = document.getElementById('confirmarTurnoBtn');
    const consult = form.querySelector('[type="submit"]');
    const triageError = document.getElementById('triajeError');
    const slotError = document.getElementById('disponibilidadError');
    let selected = null, rows = [], generation = 0, busy = false;
    function reset() {
        ++generation; rows = []; list.replaceChildren(); section.classList.add('d-none'); confirm.disabled = true;
        feedback(triageError, ''); feedback(slotError, '');
    }
    consult.disabled = true; confirm.disabled = true;
    await bindDoctorSelectors(document.getElementById('especialidad'), document.getElementById('medico'), (doctor, error) => {
        selected = doctor; reset(); consult.disabled = !doctor || busy;
        updateTriageQuestionnaire(form, questionnaireView(doctor));
        if (error) pageMessage(errorMessage(error), 'danger');
    });
    updateTriageQuestionnaire(form, '');
    form.addEventListener('input', event => {
        if (event.target.closest('[data-triage-specialty]')) {
            reset(); updateTriageQuestionnaire(form, questionnaireView(selected));
        }
    });
    async function refresh() {
        const version = ++generation, doctor = selected;
        confirm.disabled = true; rows = []; list.replaceChildren();
        const result = await getAvailability(doctor.id);
        if (version !== generation) return;
        rows = result; section.classList.remove('d-none');
        document.getElementById('sinDisponibilidad').classList.toggle('d-none', rows.length > 0);
        renderSlots(list, rows, 'reservaDisponibilidad');
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!selected || busy) return;
        try { questionnaire(form, specialtyKey(selected)); }
        catch (error) { feedback(triageError, error.message); return; }
        feedback(triageError, ''); feedback(slotError, ''); consult.disabled = true;
        try { await refresh(); }
        catch (error) { feedback(slotError, errorMessage(error)); section.classList.remove('d-none'); }
        finally { consult.disabled = !selected || busy; }
    });
    list.addEventListener('change', () => { confirm.disabled = busy || !list.querySelector('input:checked'); });
    confirm.addEventListener('click', async () => {
        const id = Number(list.querySelector('input:checked')?.value);
        if (busy || !selected || !rows.some(row => row.id === id)) return;
        let answers;
        try { answers = questionnaire(form, specialtyKey(selected)); }
        catch (error) { feedback(triageError, error.message); return; }
        feedback(slotError, ''); busy = true; confirm.disabled = true; consult.disabled = true;
        form.querySelectorAll('input, select').forEach(node => { node.disabled = true; });
        list.querySelectorAll('input').forEach(node => { node.disabled = true; });
        try {
            const turn = await reservePatientTurn(selected.id, id, answers);
            // Navigation carries only the server identity; the next page retrieves the DTO again.
            window.location.assign(`turno-reservado.html?id=${encodeURIComponent(turn.id_turno)}`);
        } catch (error) {
            feedback(slotError, errorMessage(error));
            if (error.status === 409) {
                try { await refresh(); }
                catch (refreshError) { feedback(slotError, `${errorMessage(error)} ${errorMessage(refreshError)}`); }
            }
            busy = false; consult.disabled = false;
            form.querySelectorAll('input, select').forEach(node => { node.disabled = false; });
            updateTriageQuestionnaire(form, questionnaireView(selected));
            list.querySelectorAll('input').forEach(node => { node.disabled = false; });
            confirm.disabled = !list.querySelector('input:checked');
        }
    });
    const exit = getBootstrapModal(document.getElementById('cancelarSolicitudModal'));
    document.querySelectorAll('[data-action="cancelar-solicitud"]').forEach(node => node.addEventListener('click', event => {
        event.preventDefault(); if (busy) return;
        if (exit) showModal(exit); else window.location.assign('dashboard.html');
    }));
    document.getElementById('confirmarSalidaSolicitudBtn').addEventListener('click', () => window.location.assign('dashboard.html'));
}

export async function initPatientConfirmation() {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id || !/^\d+$/.test(id)) { document.getElementById('turnoReservadoVacio').classList.remove('d-none'); return; }
    const turn = await getPatientTurn(id);
    document.getElementById('turnoReservadoDetalle').classList.remove('d-none');
    text('turnoReservadoEspecialidad', turn.medico.especialidad.nombre);
    text('turnoReservadoMedico', fullName(turn.medico));
    text('turnoReservadoEstado', state(turn));
    text('turnoDetalleBadge', state(turn));
    const pending = turn.estado === 'PENDIENTE';
    text('turnoReservadoFecha', pending ? 'Pendiente de nueva asignación' : formatDate(turn.fecha));
    text('turnoReservadoHora', pending ? '—' : turn.hora.slice(0, 5));
    text('turnoReservadoTipo', turn.asignacion_vigente ? 'Turno de agenda' : 'Referencia histórica');
    text('turnoReservadoDuracion', pending ? '—' : turn.duracion_turno);
    const badge = document.getElementById('turnoReservadoPrioridad');
    badge.textContent = priority(turn); badge.className = `badge align-self-start ${priorityClass(turn.prioridad)}`;
}

async function renderPatientDashboard() {
    const turns = await getPatientTurns();
    const active = turns.filter(turn => ['RESERVADO', 'PRESENTE', 'EN_ATENCION'].includes(turn.estado) && turn.asignacion_vigente);
    const pending = turns.filter(turn => turn.estado === 'PENDIENTE');
    const next = active.find(turn => ['PRESENTE', 'EN_ATENCION'].includes(turn.estado)) || active[0];
    text('pacienteNombre', getCurrentUser().nombre);
    text('heroProximoTurno', next ? `${formatDate(next.fecha)} - ${next.hora.slice(0, 5)}` : pending.length ? 'Solicitud pendiente de nueva asignación' : 'Sin turnos reservados');
    text('turnoEspecialidad', next?.medico.especialidad.nombre || '—');
    text('turnoMedico', next ? fullName(next.medico) : '—');
    text('turnoFecha', next ? formatDate(next.fecha) : '—'); text('turnoHora', next ? next.hora.slice(0, 5) : '—');
    text('turnoEstado', next ? state(next) : '—'); text('triajePrioridad', next ? priority(next) : 'Sin turno asignado');
    document.getElementById('triajePrioridad').className = `badge ${priorityClass(next?.prioridad)}`;
    text('esperaEstimada', 'No informada'); text('duracionEstimada', next ? `${next.duracion_turno} min` : '—');
    document.getElementById('solicitudesPendientesAviso').classList.toggle('d-none', !pending.length);
    text('solicitudesPendientesResumen', `${pending.length} solicitud(es) pendiente(s) de nueva asignación. No tienen horario vigente.`);
    document.getElementById('historialTurnos').innerHTML = turns.filter(turn => !activeStates.has(turn.estado)).map(turn =>
        `<tr><td>${formatDate(turn.fecha)}</td><td>${escapeHtml(turn.medico.especialidad.nombre)}</td><td>${escapeHtml(fullName(turn.medico))}</td><td>${escapeHtml(state(turn))}</td></tr>`).join('') || '<tr><td colspan="4">Sin turnos históricos.</td></tr>';
}

export async function initPatientDashboard() {
    await renderPatientDashboard();
    await initPatientProposals({ onUpdated: renderPatientDashboard });
}

export async function initPatientTurns() {
    const list = document.getElementById('turnosReservadosLista');
    const message = document.getElementById('misTurnosMensaje');
    const editError = document.getElementById('modificarTurnoError');
    const choices = document.getElementById('modificarDisponibilidadLista');
    const cancelModal = getBootstrapModal(document.getElementById('cancelarTurnoModal'));
    const editModal = getBootstrapModal(document.getElementById('modificarTurnoModal'));
    const cancel = document.getElementById('confirmarCancelacionBtn');
    const modify = document.getElementById('confirmarModificacionBtn');
    let selected = null, rows = [], busy = false, generation = 0;
    let proposals = { refresh: async () => {} };
    function setBusy(value) {
        busy = value;
        list.querySelectorAll('button').forEach(button => { button.disabled = value; });
    }
    text('misTurnosPaciente', `${getCurrentUser().nombre} ${getCurrentUser().apellido}`);
    async function refresh() {
        const turns = await getPatientTurns();
        const active = turns.filter(turn => activeStates.has(turn.estado));
        document.getElementById('turnosReservadosVacio').classList.toggle('d-none', !!active.length);
        list.innerHTML = active.map(turn => `<div class="col-12 col-lg-6"><article class="card dashboard-card border-0 shadow-sm h-100"><div class="card-body">
            <div class="d-flex justify-content-between"><h3 class="h5">${escapeHtml(turn.medico.especialidad.nombre)}</h3>${priorityBadge(turn)}</div>
            <dl class="row"><dt class="col-5 text-secondary">Médico</dt><dd class="col-7">${escapeHtml(fullName(turn.medico))}</dd>
            ${schedule(turn)}<dt class="col-5 text-secondary">Estado</dt><dd class="col-7">${escapeHtml(state(turn))}</dd></dl>
            <button type="button" class="btn btn-outline-primary btn-sm" data-action="detail" data-turn="${turn.id_turno}">Ver detalle</button>
            ${turn.estado === 'RESERVADO' ? `<button type="button" class="btn btn-outline-secondary btn-sm" data-action="modify" data-turn="${turn.id_turno}">Modificar</button>` : ''}
            ${turn.estado === 'PENDIENTE' ? `<button type="button" class="btn btn-outline-secondary btn-sm" data-action="recover" data-turn="${turn.id_turno}">Elegir nuevo horario</button>` : ''}
            ${['RESERVADO', 'PENDIENTE'].includes(turn.estado) ? `<button type="button" class="btn btn-outline-danger btn-sm" data-action="cancel" data-turn="${turn.id_turno}">Cancelar</button>` : ''}
            </div></article></div>`).join('');
        const history = turns.filter(turn => !activeStates.has(turn.estado));
        document.getElementById('historialPacienteVacio').classList.toggle('d-none', !!history.length);
        document.getElementById('historialPacienteTabla').innerHTML = history.map(turn => `<tr><td>${escapeHtml(turn.medico.especialidad.nombre)}</td>
            <td>${escapeHtml(fullName(turn.medico))}</td><td>${formatDate(turn.fecha)}</td><td>${escapeHtml(turn.hora.slice(0, 5))}</td>
            <td>${escapeHtml(state(turn))}</td><td>${priorityBadge(turn)}</td></tr>`).join('');
        setBusy(busy);
    }
    async function refreshAfterWrite(success) {
        feedback(message, success, 'success');
        try { await refresh(); await proposals.refresh(); }
        catch (error) { feedback(message, `${success} No fue posible actualizar la lista. Recargue la página. ${errorMessage(error)}`, 'warning'); }
    }
    async function refreshChoices() {
        const version = ++generation, turn = selected;
        modify.disabled = true; rows = []; choices.replaceChildren();
        const result = await getAvailability(turn.medico.id);
        if (version !== generation || selected?.id_turno !== turn.id_turno) return;
        rows = result; renderSlots(choices, rows, 'modificarDisponibilidad');
        if (!rows.length) feedback(editError,
            `${editError.classList.contains('d-none') ? '' : editError.textContent + ' '}No hay horarios disponibles para este médico.`, 'warning');
    }
    list.addEventListener('click', async event => {
        const button = event.target.closest('[data-turn]'); if (!button || busy) return;
        setBusy(true);
        try {
            selected = await getPatientTurn(button.dataset.turn);
            feedback(message, '');
            if (button.dataset.action === 'detail') {
                window.location.assign(`turno-reservado.html?id=${selected.id_turno}`); return;
            }
            if (button.dataset.action === 'recover') {
                await openPendingRecovery(selected, { onUpdated: async () => { await refresh(); await proposals.refresh(); } }); return;
            }
            if (button.dataset.action === 'cancel') {
                if (!cancelModal) throw new Error('Modal no disponible');
                showModal(cancelModal);
            } else {
                if (!editModal) throw new Error('Modal no disponible');
                feedback(editError, ''); showModal(editModal);
                try { await refreshChoices(); } catch (error) { feedback(editError, errorMessage(error)); }
            }
        } catch (error) { feedback(message, errorMessage(error)); }
        finally { setBusy(false); }
    });
    choices.addEventListener('change', () => { modify.disabled = busy || !choices.querySelector('input:checked'); });
    modify.addEventListener('click', async () => {
        const id = Number(choices.querySelector('input:checked')?.value);
        if (busy || !selected || !rows.some(row => row.id === id)) return;
        setBusy(true); modify.disabled = true; choices.querySelectorAll('input').forEach(node => { node.disabled = true; });
        try {
            selected = await modifyPatientTurn(selected.id_turno, id);
            hideModal(editModal); await refreshAfterWrite('Turno modificado correctamente.');
        } catch (error) {
            feedback(editError, errorMessage(error));
            if (error.status === 409) {
                try { await refreshChoices(); await refresh(); }
                catch (refreshError) { feedback(editError, `${errorMessage(error)} ${errorMessage(refreshError)}`); }
            }
        } finally {
            setBusy(false); choices.querySelectorAll('input').forEach(node => { node.disabled = false; });
            modify.disabled = !choices.querySelector('input:checked');
        }
    });
    cancel.addEventListener('click', async () => {
        if (busy || !selected) return;
        setBusy(true); cancel.disabled = true;
        try {
            selected = await cancelPatientTurn(selected.id_turno);
            hideModal(cancelModal); await refreshAfterWrite('Turno cancelado correctamente.');
        } catch (error) {
            hideModal(cancelModal); feedback(message, errorMessage(error));
            if (error.status === 409) { try { await refresh(); } catch {} }
        } finally { setBusy(false); cancel.disabled = false; }
    });
    await refresh();
    proposals = await initPatientProposals({ onUpdated: refresh });
}
