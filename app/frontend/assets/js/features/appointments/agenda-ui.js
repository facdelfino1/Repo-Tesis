import { errorMessage } from '../../core/api.js';
import { getCurrentUser, pageMessage } from '../../core/session.js';
import { escapeHtml as esc } from '../../core/helpers.js';
import { formatDate, todayInputValue } from '../../core/formatters.js';
import { priorityClass } from '../../components/badges.js';
import { getBootstrapModal, showModal, hideModal } from '../../components/modals.js';
import { getDoctor, getAvailability, bindDoctorSelectors } from '../catalog/catalog-service.js';
import { readAnswers, updateTriageQuestionnaire, renderTriageResponses } from '../triage/triage-ui.js';
import { getAgendaTurns, getAgendaTurn, findPatients, reserveSecretaryTurn, modifyAgendaTurn, operateAgendaTurn } from './agenda-api.js';

const node = id => document.getElementById(id);
const setText = (id, value) => { if (node(id)) node(id).textContent = value; };
const name = person => `${person.nombre} ${person.apellido}`;
const states = { RESERVADO: 'Reservado', PRESENTE: 'Presente', EN_ATENCION: 'En atención', COMPLETADO: 'Completado', CANCELADO: 'Cancelado', PENDIENTE: 'Pendiente', AUSENTE: 'Ausente' };
const key = doctor => ({ 'Clínica Médica': 'clinica_medica', 'Pediatría': 'pediatria' }[doctor?.especialidad.nombre] || '');
const badge = turn => turn.prioridad === null ? 'Sin triaje específico' : `<span class="badge ${priorityClass(turn.prioridad)}">${esc(turn.prioridad)}</span>`;
const time = value => value ? esc(new Date(value).toLocaleString('es-AR')) : '—';
const hour = turn => turn.estado === 'PENDIENTE' || !turn.asignacion_vigente && !['COMPLETADO', 'CANCELADO', 'AUSENTE'].includes(turn.estado)
    ? 'Pendiente de nueva asignación' : esc(turn.hora.slice(0, 5));
function feedback(box, message, type = 'danger') {
    if (!box) { pageMessage(message, type); return; }
    box.textContent = message; box.className = `alert alert-${type}${message ? '' : ' d-none'}`;
}
function slots(select, rows) {
    select.replaceChildren(new Option(rows.length ? 'Seleccione un horario' : 'No hay horarios disponibles', ''));
    rows.forEach(row => select.add(new Option(`${formatDate(row.fecha)} ${row.hora_inicio.slice(0, 5)}–${row.hora_fin.slice(0, 5)}`, row.id)));
    select.disabled = !rows.length;
}
async function assignableSlots(doctorId) {
    // Gestores can read history/blocked/occupied rows in B3; never offer that full inventory.
    const rows = await getAvailability(doctorId, { estado: 'DISPONIBLE', desde: todayInputValue() });
    return rows.filter(row => new Date(`${row.fecha}T${row.hora_inicio}`).getTime() > Date.now());
}
function collectedAnswers(form, doctor) {
    if (!key(doctor)) return undefined;
    const answers = readAnswers(form, key(doctor)).respuestas;
    if (Object.values(answers).some(value => value === undefined || value === '' || Number.isNaN(value))) {
        throw new Error('Complete todas las preguntas del cuestionario.');
    }
    return answers;
}
function detail(turn) {
    return `<dl class="row"><dt class="col-sm-4">Paciente</dt><dd class="col-sm-8">${esc(name(turn.paciente_detalle))} · DNI ${esc(turn.paciente_detalle.dni)} · ID ${turn.paciente}</dd>
        <dt class="col-sm-4">Médico</dt><dd class="col-sm-8">${esc(name(turn.medico))} · ${esc(turn.medico.especialidad.nombre)}</dd>
        <dt class="col-sm-4">Estado</dt><dd class="col-sm-8">${esc(states[turn.estado] || turn.estado)}</dd>
        <dt class="col-sm-4">Asignación</dt><dd class="col-sm-8">${turn.estado === 'PENDIENTE' ? 'Pendiente de nueva asignación' : `${formatDate(turn.fecha)} ${hour(turn)} · ${turn.duracion_turno} min${turn.asignacion_vigente ? '' : ' (histórico)'}`}</dd>
        <dt class="col-sm-4">Prioridad</dt><dd class="col-sm-8">${badge(turn)}</dd>
        ${[['Creación', 'fecha_hora_creacion'], ['Llegada', 'fecha_hora_arribo'], ['Inicio', 'fecha_hora_inicio'], ['Cierre', 'fecha_hora_cierre']].map(([label, field]) => `<dt class="col-sm-4">${label}</dt><dd class="col-sm-8">${time(turn[field])}</dd>`).join('')}</dl>
        ${turn.triaje ? renderTriageResponses(turn.triaje.respuesta_sintomas, key(turn.medico)) : ''}`;
}

export async function initOperationalAgenda(mode) {
    const user = getCurrentUser(), doctorMode = user.rol === 'MEDICO';
    const dashboard = mode === 'dashboard', presence = mode === 'presence';
    const table = node(doctorMode ? (dashboard ? 'medicoAgendaDia' : 'agendaMedicaTabla') : dashboard ? 'secretariaAgendaDia' : presence ? 'presenciaTabla' : 'GestiónTurnosTabla');
    const message = node(doctorMode ? 'agendaMedicaMensaje' : presence ? 'presenciaMensaje' : 'GestiónTurnosMensaje');
    const date = node(doctorMode ? 'agendaMedicaFiltroFecha' : presence ? 'presenciaFiltroFecha' : 'filtroFechaTurno');
    const filterState = node(doctorMode ? 'agendaMedicaFiltroEstado' : 'filtroEstadoTurno');
    const filterDni = node(doctorMode ? 'agendaMedicaFiltroDni' : presence ? 'presenciaFiltroDni' : 'filtroDniTurno');
    const filterName = node(doctorMode ? 'agendaMedicaFiltroPaciente' : presence ? 'presenciaFiltroPaciente' : 'filtroPacienteTurno');
    const filterPriority = node('agendaMedicaFiltroPrioridad');
    let doctor = doctorMode ? await getDoctor(user.perfil.id) : null, rows = [], generation = 0, busy = false;
    const columns = doctorMode ? dashboard ? 7 : 8 : dashboard ? 6 : presence ? 9 : 10;
    if (date && (presence || doctorMode)) date.value = todayInputValue();
    setText('medicoFechaActual', formatDate(todayInputValue())); setText('secretariaFechaActual', formatDate(todayInputValue()));
    setText('medicoEspecialidadResumen', doctor?.especialidad.nombre || '—'); setText('agendaMedicaEspecialidad', doctor?.especialidad.nombre || '—');
    function actions(turn) {
        if (dashboard && !doctorMode) return '';
        const button = (action, label) => `<button type="button" class="btn btn-sm btn-outline-primary" data-turn="${turn.id_turno}" data-operation="${action}" ${busy ? 'disabled' : ''}>${label}</button>`;
        return button('detalle', 'Detalle') + (doctorMode
            ? turn.estado === 'PRESENTE' ? button('iniciar', 'Iniciar consulta') : turn.estado === 'EN_ATENCION' ? button('finalizar', 'Finalizar consulta') : ''
            : (turn.estado === 'RESERVADO' ? (turn.fecha === todayInputValue() ? button('presencia', 'Registrar presencia') : '') + (presence ? '' : button('modificar', 'Modificar')) : '')
                + (!presence && ['RESERVADO', 'PENDIENTE'].includes(turn.estado) ? button('cancelar', 'Cancelar') : ''));
    }
    function render() {
        const visible = rows.filter(turn => (!filterDni?.value || turn.paciente_detalle.dni.includes(filterDni.value.trim()))
            && (!filterName?.value || name(turn.paciente_detalle).toLocaleLowerCase().includes(filterName.value.toLocaleLowerCase()))
            && (!filterState?.value || states[turn.estado]?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === filterState.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
            && (!filterPriority?.value || turn.prioridad === filterPriority.value.toUpperCase()));
        table.innerHTML = visible.map(turn => {
            const patient = esc(name(turn.paciente_detalle)), dni = esc(turn.paciente_detalle.dni), state = esc(states[turn.estado] || turn.estado);
            const values = doctorMode ? (dashboard ? [hour(turn), patient, dni, badge(turn), state, `${turn.duracion_turno} min`, actions(turn)]
                : [hour(turn), patient, dni, 'No informada', badge(turn), `${turn.duracion_turno} min`, state, actions(turn)])
                : dashboard ? [hour(turn), patient, esc(name(turn.medico)), esc(turn.medico.especialidad.nombre), badge(turn), state]
                : presence ? [patient, dni, esc(name(turn.medico)), esc(turn.medico.especialidad.nombre), hour(turn), badge(turn), state, time(turn.fecha_hora_arribo), actions(turn)]
                : [patient, dni, esc(name(turn.medico)), esc(turn.medico.especialidad.nombre), turn.estado === 'PENDIENTE' ? 'Sin asignación vigente' : formatDate(turn.fecha), hour(turn), badge(turn), state, 'Sistema', actions(turn)];
            return `<tr>${values.map(value => `<td>${value}</td>`).join('')}</tr>`;
        }).join('') || `<tr><td colspan="${columns}">${doctor ? 'No hay turnos para los filtros seleccionados.' : 'Seleccione un médico para consultar su agenda.'}</td></tr>`;
        const counts = state => rows.filter(turn => turn.estado === state).length;
        for (const [id, value] of Object.entries({ medicoMetricTurnosDia: rows.length, medicoMetricPresentes: counts('PRESENTE'), medicoMetricAtencion: counts('EN_ATENCION'), medicoMetricCompletadas: counts('COMPLETADO'), metricTurnosDia: rows.length, metricPresentes: counts('PRESENTE'), metricPendientes: counts('PENDIENTE'), metricAtencion: counts('EN_ATENCION'), metricCompletados: counts('COMPLETADO'), metricCancelados: counts('CANCELADO'), presenciaMetricReservados: counts('RESERVADO'), presenciaMetricPresentes: counts('PRESENTE'), presenciaMetricPendientes: counts('PENDIENTE') })) setText(id, doctor ? value : '—');
        setText('medicoMetricProximo', rows.find(turn => turn.estado === 'RESERVADO')?.hora.slice(0, 5) || 'Sin turnos');
        setText('secretariaResumenJornada', doctor ? `Agenda de ${name(doctor)}` : 'Seleccione un médico');
    }
    async function refresh() {
        const version = ++generation, current = doctor;
        if (!current) { rows = []; render(); return; }
        table.innerHTML = `<tr><td colspan="${columns}">Consultando agenda...</td></tr>`;
        try {
            const data = await getAgendaTurns(current.id, dashboard ? todayInputValue() : date?.value || '');
            if (version !== generation) return;
            rows = data; render();
        } catch (error) {
            if (version !== generation) return;
            rows = []; render(); throw error;
        }
    }
    async function reload() { try { await refresh(); } catch (error) { feedback(message, errorMessage(error)); } }
    if (!doctorMode) {
        let specialty = node(presence ? 'presenciaFiltroEspecialidad' : 'filtroEspecialidadTurno'), select = node(presence ? 'presenciaFiltroMedico' : 'filtroMedicoTurno');
        if (dashboard) {
            const controls = document.createElement('div'); controls.className = 'row g-3 mb-3';
            controls.innerHTML = '<div class="col-md-6"><label class="form-label" for="agendaEspecialidad">Especialidad</label><select id="agendaEspecialidad" class="form-select"></select></div><div class="col-md-6"><label class="form-label" for="agendaMedico">Médico</label><select id="agendaMedico" class="form-select"></select></div>';
            table.closest('section').querySelector('.table-responsive').before(controls); specialty = node('agendaEspecialidad'); select = node('agendaMedico');
            setText('secretariaAlertasOperativas', 'Seleccione un médico. Las propuestas y métricas finales se integrarán en los siguientes bloques.');
        }
        await bindDoctorSelectors(specialty, select, async (value, error) => { doctor = value; ++generation; rows = []; render(); if (error) feedback(message, errorMessage(error)); else await reload(); });
    }
    [date, filterDni, filterName, filterState, filterPriority].filter(Boolean).forEach(control => control.addEventListener('input', () => control === date ? reload() : render()));
    document.querySelectorAll('main form:not([data-form])').forEach(form => {
        form.addEventListener('submit', event => { event.preventDefault(); reload(); });
        form.addEventListener('reset', () => setTimeout(reload, 0));
    });
    const detailId = doctorMode ? 'agendaMedicaDetalleModal' : presence ? 'presenciaDetalleModal' : 'detalleTurnoModal';
    const detailBody = doctorMode ? 'agendaMedicaDetalleContenido' : presence ? 'presenciaDetalleContenido' : 'detalleTurnoContenido';
    let detailModal = getBootstrapModal(node(detailId));
    if (!detailModal && doctorMode && dashboard) {
        const modal = document.createElement('div'); modal.className = 'modal fade'; modal.id = 'dashboardAgendaDetalle'; modal.tabIndex = -1;
        modal.innerHTML = '<div class="modal-dialog modal-lg"><div class="modal-content"><div class="modal-header"><h2 class="modal-title h5">Detalle del turno</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body"></div></div></div>';
        document.body.append(modal); detailModal = getBootstrapModal(modal);
    }
    table.addEventListener('click', async event => {
        const button = event.target.closest('[data-operation]'); if (!button || busy || !doctor) return;
        busy = true; render(); const currentDoctor = doctor.id;
        try {
            const turn = await getAgendaTurn(currentDoctor, button.dataset.turn);
            if (doctor?.id !== currentDoctor) return;
            const action = button.dataset.operation;
            if (action === 'detalle') {
                const body = node(detailBody) || node('dashboardAgendaDetalle')?.querySelector('.modal-body');
                body.innerHTML = detail(turn); showModal(detailModal);
            } else if (action === 'modificar') await edit(turn);
            else if (window.confirm(`¿${{ presencia: 'Registrar presencia', cancelar: 'Cancelar turno', iniciar: 'Iniciar consulta', finalizar: 'Finalizar consulta' }[action]} de ${name(turn.paciente_detalle)}?`)) {
                await operateAgendaTurn(currentDoctor, turn.id_turno, action);
                feedback(message, 'Operación realizada correctamente.', 'success'); await reload();
            }
        } catch (error) { feedback(message, errorMessage(error)); if (error.status === 409) await reload(); }
        finally { busy = false; render(); }
    });
    let editing = null, editRows = [];
    const editForm = node('modificarTurnoForm'), editSelect = node('modificarDisponibilidad');
    const editModal = getBootstrapModal(node('modificarTurnoModal'));
    let editError;
    if (editForm) {
        editError = document.createElement('div'); editError.className = 'alert d-none'; editError.id = 'modificarAgendaError'; editError.setAttribute('role', 'alert'); editForm.querySelector('.modal-body').append(editError);
        editForm.addEventListener('submit', async event => {
            event.preventDefault(); if (busy || !editing) return;
            if (!editRows.some(row => row.id === Number(editSelect.value))) { feedback(editError, 'Seleccione un horario disponible.'); return; }
            busy = true; const submit = editForm.querySelector('[type=submit]'); submit.disabled = true;
            try { await modifyAgendaTurn(editing.medico.id, editing.id_turno, Number(editSelect.value)); hideModal(editModal); feedback(message, 'Turno modificado correctamente.', 'success'); await reload(); }
            catch (error) { feedback(editError, errorMessage(error)); if (error.status === 409) { try { editRows = await assignableSlots(editing.medico.id); slots(editSelect, editRows); await reload(); } catch (refreshError) { feedback(editError, `${errorMessage(error)} ${errorMessage(refreshError)}`); } } }
            finally { busy = false; submit.disabled = false; render(); }
        });
    }
    async function edit(turn) {
        editing = turn; feedback(editError, ''); setText('modificarPacienteResumen', name(turn.paciente_detalle));
        setText('modificarPrioridadResumen', turn.prioridad || 'Sin triaje específico');
        node('modificarPrioridadResumen').className = `badge ${priorityClass(turn.prioridad)}`;
        node('modificarMedico').replaceChildren(new Option(name(turn.medico), turn.medico.id));
        node('modificarEspecialidad').replaceChildren(new Option(turn.medico.especialidad.nombre, turn.medico.especialidad.id));
        editRows = []; slots(editSelect, []); showModal(editModal);
        try { editRows = await assignableSlots(turn.medico.id); slots(editSelect, editRows); }
        catch (error) { feedback(editError, errorMessage(error)); }
    }
    if (!doctorMode && !dashboard && !presence) await initSecretaryBooking(reload);
    await refresh();
}

async function initSecretaryBooking(reload) {
    const form = node('asignarTurnoForm'), message = node('asignarTurnoMensaje'), dni = node('asignarPacienteDni');
    const patients = node('asignarPacienteSeleccion'), lookup = node('buscarPacienteBtn'), slotSelect = node('asignarDisponibilidad');
    let matches = [], doctor = null, rows = [], version = 0, searchVersion = 0, busy = false;
    function clearPatient() { ++searchVersion; matches = []; patients.replaceChildren(new Option('Busque un paciente por DNI', '')); setText('asignarPacienteEstado', ''); node('asignarPacienteNombre').value = ''; node('asignarPacienteApellido').value = ''; }
    dni.addEventListener('input', clearPatient);
    patients.addEventListener('change', () => { const patient = matches.find(row => row.id === Number(patients.value)); node('asignarPacienteNombre').value = patient?.nombre || ''; node('asignarPacienteApellido').value = patient?.apellido || ''; });
    lookup.addEventListener('click', async () => {
        clearPatient(); if (!dni.value.trim()) { feedback(message, 'Ingrese el DNI del paciente.'); return; }
        const current = searchVersion; lookup.disabled = true;
        try {
            const result = await findPatients(dni.value.trim()); if (current !== searchVersion) return;
            matches = result; patients.replaceChildren(new Option(result.length ? 'Seleccione el paciente encontrado' : 'No se encontraron pacientes activos', ''));
            result.forEach(patient => patients.add(new Option(`${name(patient)} · DNI ${patient.dni} · ID ${patient.id}`, patient.id)));
            feedback(message, result.length ? 'Seleccione el paciente existente.' : 'No se encontraron pacientes activos con ese DNI.', result.length ? 'info' : 'warning');
        } catch (error) { feedback(message, errorMessage(error)); }
        finally { lookup.disabled = false; }
    });
    async function refreshSlots() {
        const current = ++version, selected = doctor; rows = []; slots(slotSelect, []);
        if (!selected) { setText('asignarDisponibilidadAyuda', 'Seleccione un médico para consultar horarios.'); return; }
        setText('asignarDisponibilidadAyuda', 'Consultando horarios...');
        const result = await assignableSlots(selected.id); if (current !== version) return;
        rows = result; slots(slotSelect, rows); setText('asignarDisponibilidadAyuda', result.length ? 'Seleccione un bloque real. El servidor revalidará al confirmar.' : 'No hay horarios disponibles para este médico.');
    }
    await bindDoctorSelectors(node('asignarEspecialidad'), node('asignarMedico'), async (value, error) => {
        doctor = value; updateTriageQuestionnaire(form, key(value) || (value ? 'sin_algoritmo' : ''));
        if (error) feedback(message, errorMessage(error));
        try { await refreshSlots(); } catch (err) { feedback(message, errorMessage(err)); }
    });
    updateTriageQuestionnaire(form, '');
    form.addEventListener('input', () => updateTriageQuestionnaire(form, key(doctor) || (doctor ? 'sin_algoritmo' : '')));
    form.addEventListener('submit', async event => {
        event.preventDefault(); if (busy) return;
        const patient = matches.find(row => row.id === Number(patients.value)), slot = rows.find(row => row.id === Number(slotSelect.value));
        if (!patient || !doctor || node('asignarMedico').disabled || !slot) { feedback(message, 'Seleccione un paciente existente, médico y horario disponible.'); return; }
        let answers;
        try { answers = collectedAnswers(form, doctor); } catch (error) { feedback(message, error.message); return; }
        busy = true; const controls = [...form.querySelectorAll('input, select, button')].map(control => [control, control.disabled]); controls.forEach(([control]) => { control.disabled = true; });
        try {
            const turn = await reserveSecretaryTurn(doctor.id, patient.id, slot.id, answers);
            feedback(message, `Turno ${turn.id_turno} reservado. ${turn.prioridad === null ? 'Sin triaje específico.' : 'Prioridad: ' + turn.prioridad + '.'}`, 'success');
            await reload();
            try { await refreshSlots(); } catch (error) { feedback(message, `Turno ${turn.id_turno} reservado. ${errorMessage(error)}`, 'warning'); }
        } catch (error) {
            feedback(message, errorMessage(error));
            if (error.status === 409) { try { await refreshSlots(); } catch (refreshError) { feedback(message, `${errorMessage(error)} ${errorMessage(refreshError)}`); } }
        } finally { controls.forEach(([control, disabled]) => { control.disabled = disabled; }); slotSelect.disabled = !rows.length; busy = false; }
    });
}
