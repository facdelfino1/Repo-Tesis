import { LOCAL_STORAGE_KEYS, MOCK_PATHS } from "../../core/constants.js";
import { loadMock, readStoredJson, writeStoredJson } from "../../core/storage.js";
import { escapeHtml, normalizeState } from "../../core/helpers.js";
import { formatDate } from "../../core/formatters.js";
import { showAlert } from "../../components/alerts.js";
import { priorityClass, renderPriorityBadge, stateText as renderStateText } from "../../components/badges.js";
import { getBootstrapModal, hideModal, showModal } from "../../components/modals.js";
import { renderTableEmptyRow } from "../../components/tables.js";
import { availabilityDurationMinutes, mergeAllStoredAvailability, mergeStoredAvailability } from "../availability/availability-service.js";
import { normalizeTriageSpecialty, triagePriorityForTurn } from "../triage/triage-service.js";
import { renderTriageResponses } from "../triage/triage-ui.js";
import {
    appointmentDateTime,
    canCancelPatientAppointment,
    cancelPatientAppointment,
    isActivePatientAppointment,
    isHistoricalPatientAppointment,
    isReservedPatientAppointment,
    mergeStoredTurns,
    persistPatientTurns,
    modifyPatientAppointment,
    occupyPatientAppointmentAvailability,
    patientAppointments,
    patientAvailableSlotsForTurn,
    releasePatientAppointmentAvailability
} from "./appointments-service.js";

export function renderSlotOptions(select, slots, emptyText) {
    select.innerHTML = "";

    if (slots.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = emptyText;
        select.appendChild(option);
        select.disabled = true;
        return;
    }

    select.disabled = false;
    const firstOption = document.createElement("option");
    firstOption.value = "";
    firstOption.textContent = "Seleccione un horario";
    select.appendChild(firstOption);
    slots.forEach((slot) => {
        const option = document.createElement("option");
        option.value = String(slot.id_disponibilidad);
        option.textContent = `${formatDate(slot.fecha)} ${slot.hora_inicio} a ${slot.hora_fin} - ${slot.medico} (${slot.origen || "Disponible"})`;
        option.dataset.slot = JSON.stringify(slot);
        select.appendChild(option);
    });
}

export function renderSecretaryAppointmentSummary(setText, totalTurns) {
    setText("GestiónTurnosResumen", `${totalTurns} turnos registrados`);
}

export function renderSecretaryAppointmentActions(turn) {
    const state = normalizeState(turn.estado);
    const canEdit = state === "reservado" || state === "presente" || state === "pendiente";

    return `
                <div class="btn-group btn-group-sm" role="group" aria-label="Acciones del turno">
                    <button type="button" class="btn btn-outline-primary" data-action="detail" data-turn-id="${turn.id_turno}" title="Ver detalle">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button type="button" class="btn btn-outline-secondary" data-action="edit" data-turn-id="${turn.id_turno}" ${canEdit ? "" : "disabled"} title="${canEdit ? "Modificar" : "No modificable por estado"}">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <button type="button" class="btn btn-outline-danger" data-action="cancel" data-turn-id="${turn.id_turno}" ${canEdit ? "" : "disabled"} title="${canEdit ? "Cancelar" : "No cancelable por estado"}">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </div>
            `;
}

export function renderSecretaryAppointmentsTable({
    tableBody,
    visibleTurns,
    totalTurns,
    patientByTurn,
    doctorByTurn,
    fullName,
    doctorFullName,
    setText
}) {
    renderSecretaryAppointmentSummary(setText, totalTurns);

    if (visibleTurns.length === 0) {
        tableBody.innerHTML = renderTableEmptyRow(10, "No se encontraron turnos con los filtros seleccionados.");
        return;
    }

    tableBody.innerHTML = visibleTurns.map((turn) => {
        const patient = patientByTurn(turn);
        const doctor = doctorByTurn(turn);
        const specialty = doctor ? doctor.especialidad : turn.especialidad;
        const patientName = patient ? fullName(patient) : "Paciente simulado";
        const doctorName = doctor ? doctorFullName(doctor) : "Medico";

        return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patientName)}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(doctorName)}</td>
                        <td>${escapeHtml(specialty || "-")}</td>
                        <td>${formatDate(turn.fecha)}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td>${renderPriorityBadge(triagePriorityForTurn(turn, specialty))}</td>
                        <td>${renderStateText(turn.estado, escapeHtml)}</td>
                        <td>${escapeHtml(turn.origen || "Mock")}</td>
                        <td>${renderSecretaryAppointmentActions(turn)}</td>
                    </tr>
                `;
    }).join("");
}

export function renderSecretaryAppointmentDetail({
    turnId,
    turns,
    triages,
    detailModal,
    getTriage,
    patientByTurn,
    doctorByTurn,
    fullName,
    doctorFullName
}) {
    const turn = turns.find((item) => String(item.id_turno) === String(turnId));

    if (!turn) {
        return;
    }

    const patient = patientByTurn(turn);
    const doctor = doctorByTurn(turn);
    const specialty = doctor?.especialidad || turn.especialidad;
    const triage = getTriage(triages, turn, specialty);
    const answers = triage?.respuestas;
    const content = document.getElementById("detalleTurnoContenido");

    content.innerHTML = `
                <dl class="row mb-0">
                    <dt class="col-sm-4 text-secondary">Paciente</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? fullName(patient) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">DNI</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.dni : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Telefono</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.telefono : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Obra social</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.obra_social : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Medico</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Especialidad</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctor.especialidad : turn.especialidad || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Fecha y hora</dt>
                    <dd class="col-sm-8">${formatDate(turn.fecha)} ${escapeHtml(turn.hora_inicio)} a ${escapeHtml(turn.hora_fin)}</dd>
                    <dt class="col-sm-4 text-secondary">Estado</dt>
                    <dd class="col-sm-8">${renderStateText(turn.estado, escapeHtml)}</dd>
                    <dt class="col-sm-4 text-secondary">Prioridad</dt>
                    <dd class="col-sm-8">${renderPriorityBadge(triagePriorityForTurn(turn, specialty, triage))}</dd>
                    <dt class="col-sm-4 text-secondary">Duración del bloque</dt>
                    <dd class="col-sm-8">${availabilityDurationMinutes(turn.hora_inicio, turn.hora_fin) ?? "—"} minutos</dd>
                    <dt class="col-sm-4 text-secondary">Origen</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.origen || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Respuestas triaje</dt>
                    <dd class="col-sm-8 mb-0">
                        ${triage ? renderTriageResponses(answers, normalizeTriageSpecialty(specialty)) : "Sin triaje asociado."}
                    </dd>
                </dl>
            `;
    showModal(detailModal);
}

export async function initPatientAppointments(config) {
    const {
        currentPatient,
        fallbackData,
        fullName,
        setText
    } = config;
    const reservedList = document.getElementById("turnosReservadosLista");
    const historyTable = document.getElementById("historialPacienteTabla");

    if (!reservedList || !historyTable) {
        return;
    }

    const [usuarios, turnosMock, disponibilidadData, medicosData] = await Promise.all([
        loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
        loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
        loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad),
        loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos)
    ]);
    const currentPatientData = currentPatient(usuarios);
    const currentPatientId = currentPatientData.id_paciente || 1;
    const patientName = fullName(currentPatientData);
    const medicosMock = Array.isArray(medicosData.medicos) ? medicosData.medicos : [];
    const reservedEmpty = document.getElementById("turnosReservadosVacio");
    const historyEmpty = document.getElementById("historialPacienteVacio");
    const message = document.getElementById("misTurnosMensaje");
    const cancelModalElement = document.getElementById("cancelarTurnoModal");
    const modifyModalElement = document.getElementById("modificarTurnoModal");
    const cancelModal = getBootstrapModal(cancelModalElement);
    const modifyModal = getBootstrapModal(modifyModalElement);
    const confirmCancelButton = document.getElementById("confirmarCancelacionBtn");
    const confirmModifyButton = document.getElementById("confirmarModificacionBtn");
    const modifyList = document.getElementById("modificarDisponibilidadLista");
    const modifyError = document.getElementById("modificarTurnoError");
    let selectedTurnId = null;
    let selectedAvailabilityId = null;
    let appointments = [];
    let availability = [];

    function currentPatientAppointments() {
        return patientAppointments({ turnos: mergeStoredTurns(turnosMock.turnos) }, usuarios, currentPatientId);
    }

    function persistState(updatedTurn) {
        const stored = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
        const localAppointments = (Array.isArray(stored) ? stored : []).filter((turn) => turn
            && String(turn.pacienteId) === String(currentPatientId) && String(turn.id) !== String(updatedTurn.id));
        // Override del mismo ID, incluso si el turno original procede del JSON.
        localAppointments.push({ ...updatedTurn, origenInterfaz: true });

        persistPatientTurns(LOCAL_STORAGE_KEYS.PATIENT_TURNS, localAppointments, currentPatientId);
        writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, availability);
    }

    function showMessage(type, text) {
        showAlert(message, type, text);
    }

    function refreshPatientState(useEffectiveAvailability = false) {
        appointments = currentPatientAppointments();
        availability = useEffectiveAvailability
            ? mergeAllStoredAvailability(disponibilidadData, { conservative: true, doctors: medicosMock })
            : mergeStoredAvailability(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, disponibilidadData, medicosMock);
    }

    function priorityBadge(priority) {
        if (priority == null) {
            return '<span class="badge text-bg-secondary">Sin triaje espec\u00edfico</span>';
        }
        return `<span class="badge ${priorityClass(priority)}">${priority}</span>`;
    }

    function renderReserved(turns) {
        reservedList.innerHTML = "";
        reservedEmpty.classList.toggle("d-none", turns.length > 0);

        turns.forEach((turn) => {
            const column = document.createElement("div");
            column.className = "col-12 col-xl-6";
            column.innerHTML = `
                <article class="card appointment-card border h-100">
                    <div class="card-body">
                        <div class="d-flex flex-column flex-sm-row justify-content-between gap-2 mb-3">
                            <div>
                                <p class="text-secondary small mb-1">${turn.especialidad}</p>
                                <h3 class="h5 fw-semibold mb-0">${turn.medico}</h3>
                            </div>
                            <strong class="fw-semibold align-self-start">${turn.estado}</strong>
                        </div>
                        <dl class="row small mb-3">
                            <dt class="col-5 text-secondary">Fecha</dt>
                            <dd class="col-7 fw-medium">${formatDate(turn.fecha)}</dd>
                            <dt class="col-5 text-secondary">Hora</dt>
                            <dd class="col-7 fw-medium">${turn.hora}</dd>
                            <dt class="col-5 text-secondary">Prioridad</dt>
                            <dd class="col-7">${priorityBadge(turn.prioridad)}</dd>
                            <dt class="col-5 text-secondary">Tiempo estimado</dt>
                            <dd class="col-7 fw-medium mb-0">${turn.tiempoEstimado}</dd>
                        </dl>
                        <div class="d-grid d-sm-flex gap-2 justify-content-sm-end">
                            <button type="button" class="btn btn-outline-primary btn-sm" data-action="modify" data-turn-id="${turn.id}" ${isReservedPatientAppointment(turn) ? "" : "disabled"}>
                                <i class="bi bi-pencil-square me-1"></i>Modificar
                            </button>
                            <button type="button" class="btn btn-outline-danger btn-sm" data-action="cancel" data-turn-id="${turn.id}" ${isReservedPatientAppointment(turn) ? "" : "disabled"}>
                                <i class="bi bi-x-circle me-1"></i>Cancelar
                            </button>
                        </div>
                    </div>
                </article>
            `;
            reservedList.appendChild(column);
        });
    }

    function renderHistoryTable(turns) {
        historyTable.innerHTML = "";
        historyEmpty.classList.toggle("d-none", turns.length > 0);

        turns.forEach((turn) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${turn.especialidad}</td>
                <td>${turn.medico}</td>
                <td>${formatDate(turn.fecha)}</td>
                <td>${turn.hora}</td>
                <td>${renderStateText(turn.estado)}</td>
                <td>${priorityBadge(turn.prioridad)}</td>
            `;
            historyTable.appendChild(row);
        });
    }

    function renderAppointments() {
        const ownAppointments = appointments.filter((turn) => String(turn.pacienteId) === String(currentPatientId));
        const reservedTurns = ownAppointments
            .filter((turn) => isReservedPatientAppointment(turn) || isActivePatientAppointment(turn))
            .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));
        const historicalTurns = ownAppointments
            .filter(isHistoricalPatientAppointment)
            .sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a));

        renderReserved(reservedTurns);
        renderHistoryTable(historicalTurns);
    }

    function cancelSelectedTurn() {
        refreshPatientState();
        const turn = appointments.find((item) => item.id === selectedTurnId);

        if (!turn || !isReservedPatientAppointment(turn)) {
            showMessage("warning", "El turno ya no se encuentra en un estado cancelable. Recargue sus turnos.");
            return;
        }

        if (!canCancelPatientAppointment(turn, Date.now())) {
            hideModal(cancelModal);
            showMessage("warning", "No es posible cancelar este turno desde la pagina por encontrarse fuera del tiempo permitido. Comuniquese telefonicamente con la clinica.");
            return;
        }

        const currentSlot = availability.find((item) => String(item.id_disponibilidad) === String(turn.disponibilidadId));
        if (currentSlot?.id_turno != null && String(currentSlot.id_turno) !== String(turn.id)) {
            showMessage("warning", "El bloque del turno tiene una asociacion incompatible. No se pudo cancelar.");
            return;
        }

        appointments = cancelPatientAppointment(appointments, turn.id);
        availability = releasePatientAppointmentAvailability(availability, turn.disponibilidadId);
        persistState(appointments.find((item) => item.id === turn.id));
        renderAppointments();
        hideModal(cancelModal);
        showMessage("success", "Turno cancelado correctamente. El horario quedo disponible para otros pacientes.");
    }

    function renderModifyOptions(turn) {
        const slots = patientAvailableSlotsForTurn(availability, turn);
        selectedAvailabilityId = null;
        modifyList.innerHTML = "";
        modifyError.classList.toggle("d-none", slots.length > 0);
        confirmModifyButton.disabled = true;

        slots.forEach((slot) => {
            const optionId = `modificar-${slot.id_disponibilidad}`;
            const column = document.createElement("div");
            column.className = "col-12 col-md-6";
            column.innerHTML = `
                <label class="appointment-slot card border h-100" for="${optionId}">
                    <div class="card-body">
                        <div class="form-check">
                            <input class="form-check-input" type="radio" name="modificarDisponibilidad" id="${optionId}" value="${slot.id_disponibilidad}">
                            <span class="form-check-label fw-semibold">${formatDate(slot.fecha)} - ${slot.hora_inicio}</span>
                        </div>
                        <p class="text-secondary small mb-2">${slot.hora_inicio} a ${slot.hora_fin}</p>
                        <p class="mb-0">${slot.medico}</p>
                    </div>
                </label>
            `;
            modifyList.appendChild(column);
        });

        modifyList.querySelectorAll('input[name="modificarDisponibilidad"]').forEach((radio) => {
            radio.addEventListener("change", () => {
                selectedAvailabilityId = radio.value;
                confirmModifyButton.disabled = false;
            });
        });
    }

    function openModifyModal(turnId) {
        refreshPatientState(true);
        const turn = appointments.find((item) => item.id === turnId);

        if (!turn || !isReservedPatientAppointment(turn)) {
            showMessage("warning", "El turno ya no se encuentra en un estado modificable.");
            return;
        }

        selectedTurnId = turnId;
        renderModifyOptions(turn);
        showModal(modifyModal);
    }

    function modifySelectedTurn() {
        const displayedSlot = availability.find((item) => String(item.id_disponibilidad) === String(selectedAvailabilityId));
        const storedSlots = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, []);
        const storedSlot = (Array.isArray(storedSlots) ? storedSlots : [])
            .find((item) => item && String(item.id_disponibilidad) === String(selectedAvailabilityId));
        if (storedSlot && displayedSlot && ["id_medico", "especialidad", "fecha", "hora_inicio", "hora_fin"]
            .some((field) => String(storedSlot[field]) !== String(displayedSlot[field]))) {
            selectedAvailabilityId = null;
            confirmModifyButton.disabled = true;
            showMessage("warning", "El horario seleccionado cambio. Recargue las alternativas antes de confirmar.");
            return;
        }
        refreshPatientState(true);
        const turn = appointments.find((item) => item.id === selectedTurnId);
        const selectedSlot = turn && patientAvailableSlotsForTurn(availability, turn)
            .find((item) => String(item.id_disponibilidad) === String(selectedAvailabilityId)
                && displayedSlot && ["id_medico", "especialidad", "fecha", "hora_inicio", "hora_fin"]
                    .every((field) => String(item[field]) === String(displayedSlot[field])));

        if (!turn || !isReservedPatientAppointment(turn) || !selectedSlot) {
            selectedAvailabilityId = null;
            confirmModifyButton.disabled = true;
            showMessage("warning", "El turno o el horario seleccionado ya no permiten el cambio. Seleccione nuevamente un horario valido.");
            return;
        }

        const currentSlot = availability.find((item) => String(item.id_disponibilidad) === String(turn.disponibilidadId));
        if (currentSlot?.id_turno != null && String(currentSlot.id_turno) !== String(turn.id)) {
            showMessage("warning", "El bloque anterior tiene una asociacion incompatible. No se pudo modificar.");
            return;
        }
        const updatedAppointments = modifyPatientAppointment(appointments, turn.id, selectedSlot);
        if (updatedAppointments.find((item) => item.id === turn.id) === turn) {
            showMessage("warning", "El horario ya no permite el cambio. Seleccione nuevamente un horario valido.");
            return;
        }
        availability = releasePatientAppointmentAvailability(availability, turn.disponibilidadId);
        availability = occupyPatientAppointmentAvailability(availability, selectedSlot.id_disponibilidad, turn.id);
        appointments = updatedAppointments;
        persistState(appointments.find((item) => item.id === turn.id));
        renderAppointments();
        hideModal(modifyModal);
        showMessage("success", "Turno modificado correctamente. Se libero el horario anterior y se ocupo el nuevo horario seleccionado.");
    }

    setText("misTurnosPaciente", patientName);
    appointments = currentPatientAppointments();
    availability = mergeStoredAvailability(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, disponibilidadData, medicosMock);

    reservedList.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        selectedTurnId = Number.parseInt(button.dataset.turnId, 10);

        if (button.dataset.action === "cancel") {
            showModal(cancelModal);
        }

        if (button.dataset.action === "modify") {
            openModifyModal(selectedTurnId);
        }
    });

    confirmCancelButton.addEventListener("click", cancelSelectedTurn);
    confirmModifyButton.addEventListener("click", modifySelectedTurn);
    renderAppointments();
}
