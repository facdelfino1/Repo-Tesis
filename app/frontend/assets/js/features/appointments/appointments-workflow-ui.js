import { triagePriorityForTurn } from "../triage/triage-service.js";
import { escapeHtml, normalizeState } from "../../core/helpers.js";
import { formatDate, todayInputValue } from "../../core/formatters.js";
import { renderPriorityBadge, stateText as renderStateText } from "../../components/badges.js";
import { fillSelect as renderSelect } from "../../components/selects.js";
import { renderTableEmptyRow } from "../../components/tables.js";
import {
    arrivalTime,
    attentionDurationMinutes,
    consultationEndValue,
    consultationStartValue
} from "./appointments-service.js";

export function renderPresenceWorkflowMetrics(dateTurns, setText) {
    const scheduledTurns = dateTurns.filter((turn) => {
        const state = normalizeState(turn.estado);
        return state !== "cancelado" && state !== "ausente";
    });
    const presentTurns = dateTurns.filter((turn) => normalizeState(turn.estado) === "presente");
    const pendingTurns = dateTurns.filter((turn) => normalizeState(turn.estado) === "reservado");

    setText("presenciaMetricReservados", scheduledTurns.length);
    setText("presenciaMetricPresentes", presentTurns.length);
    setText("presenciaMetricPendientes", pendingTurns.length);
}

export function renderPresenceWorkflowActions(turn) {
    const canRegister = normalizeState(turn.estado) === "reservado";
    const registerButton = canRegister
        ? `<button type="button" class="btn btn-success btn-sm" data-action="register" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-person-check me-1"></i>Registrar llegada
                    </button>`
        : "";

    return `
                <div class="d-grid d-sm-flex gap-2">
                    <button type="button" class="btn btn-outline-primary btn-sm" data-action="detail" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-eye me-1"></i>Ver detalle
                    </button>
                    ${registerButton}
                </div>
            `;
}

export function renderPresenceWorkflowTable({
    tableBody,
    dateTurns,
    visibleTurns,
    patientByTurn,
    doctorByTurn,
    fullName,
    doctorFullName,
    setText
}) {
    renderPresenceWorkflowMetrics(dateTurns, setText);

    if (visibleTurns.length === 0) {
        tableBody.innerHTML = renderTableEmptyRow(9, "No hay turnos para la fecha y filtros seleccionados.");
        return;
    }

    tableBody.innerHTML = visibleTurns.map((turn) => {
        const patient = patientByTurn(turn);
        const doctor = doctorByTurn(turn);
        const specialty = doctor ? doctor.especialidad : turn.especialidad;

        return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</td>
                        <td>${escapeHtml(specialty || "-")}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td>${renderPriorityBadge(triagePriorityForTurn(turn, doctor?.especialidad || turn.especialidad))}</td>
                        <td>${renderStateText(turn.estado, escapeHtml)}</td>
                        <td>${escapeHtml(arrivalTime(turn))}</td>
                        <td>${renderPresenceWorkflowActions(turn)}</td>
                    </tr>
                `;
    }).join("");
}

export function renderPresenceWorkflowDetail({
    content,
    turn,
    patient,
    doctor,
    fullName,
    doctorFullName
}) {
    content.innerHTML = `
                <dl class="row mb-0">
                    <dt class="col-sm-4 text-secondary">Paciente</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? fullName(patient) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">DNI</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.dni : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Telefono</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.telefono : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Medico</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Especialidad</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctor.especialidad : turn.especialidad || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Fecha</dt>
                    <dd class="col-sm-8">${formatDate(turn.fecha)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.hora_inicio)} a ${escapeHtml(turn.hora_fin || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Prioridad</dt>
                    <dd class="col-sm-8">${renderPriorityBadge(triagePriorityForTurn(turn, doctor?.especialidad || turn.especialidad))}</dd>
                    <dt class="col-sm-4 text-secondary">Estado</dt>
                    <dd class="col-sm-8">${renderStateText(turn.estado, escapeHtml)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de llegada</dt>
                    <dd class="col-sm-8">${escapeHtml(arrivalTime(turn))}</dd>
                    <dt class="col-sm-4 text-secondary">Origen</dt>
                    <dd class="col-sm-8 mb-0">${escapeHtml(turn.origen || "-")}</dd>
                </dl>
            `;
}

export function initPresenceWorkflowFilters({
    filters,
    doctors,
    secretary,
    fullName,
    doctorFullName,
    setText
}) {
    const specialties = [...new Set(doctors.map((doctor) => doctor.especialidad))].sort();

    setText("presenciaSecretariaNavbar", fullName(secretary));
    filters.date.value = todayInputValue();
    renderSelect(
        filters.doctor,
        "Todos",
        doctors,
        (doctor) => doctorFullName(doctor),
        (doctor) => doctorFullName(doctor)
    );
    renderSelect(
        filters.specialty,
        "Todas",
        specialties,
        (specialty) => specialty,
        (specialty) => specialty
    );
}

export function formatWorkflowDuration(minutes) {
    if (!Number.isFinite(minutes)) {
        return "-";
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours === 0) {
        return `${remainingMinutes} min`;
    }

    return `${hours} h ${remainingMinutes.toString().padStart(2, "0")} min`;
}

export function renderConsultationWorkflowMetrics(visibleTurns, setText) {
    const activeTurns = visibleTurns.filter((turn) => normalizeState(turn.estado) === "en atencion");
    const completedTurns = visibleTurns.filter((turn) => normalizeState(turn.estado) === "completado");

    setText("finalizacionMetricAtencion", activeTurns.length);
    setText("finalizacionMetricCompletadas", completedTurns.length);
    setText("finalizacionMetricPendientes", activeTurns.length);
}

export function renderConsultationWorkflowActions(turn) {
    const canFinish = normalizeState(turn.estado) === "en atencion";
    const finishButton = canFinish
        ? `<button type="button" class="btn btn-success btn-sm" data-action="finish" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-clipboard2-check me-1"></i>Finalizar consulta
                    </button>`
        : "";

    return `
                <div class="d-grid d-sm-flex gap-2">
                    <button type="button" class="btn btn-outline-primary btn-sm" data-action="detail" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-eye me-1"></i>Ver detalle
                    </button>
                    ${finishButton}
                </div>
            `;
}

export function renderConsultationWorkflowTable({
    tableBody,
    visibleTurns,
    patientByTurn,
    doctorByTurn,
    fullName,
    doctorFullName,
    setText
}) {
    renderConsultationWorkflowMetrics(visibleTurns, setText);

    if (visibleTurns.length === 0) {
        tableBody.innerHTML = renderTableEmptyRow(10, "No hay consultas para los filtros seleccionados.");
        return;
    }

    tableBody.innerHTML = visibleTurns.map((turn) => {
        const patient = patientByTurn(turn);
        const doctor = doctorByTurn(turn);
        const specialty = doctor ? doctor.especialidad : turn.especialidad;

        return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</td>
                        <td>${escapeHtml(specialty || "-")}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td>${renderPriorityBadge(triagePriorityForTurn(turn, doctor?.especialidad || turn.especialidad))}</td>
                        <td>${renderStateText(turn.estado, escapeHtml)}</td>
                        <td>${escapeHtml(consultationStartValue(turn))}</td>
                        <td>${escapeHtml(consultationEndValue(turn))}</td>
                        <td>${renderConsultationWorkflowActions(turn)}</td>
                    </tr>
                `;
    }).join("");
}

export function renderConsultationWorkflowDetail({
    content,
    turn,
    patient,
    doctor,
    fullName,
    doctorFullName
}) {
    const duration = attentionDurationMinutes(turn);
    const triageSummary = triagePriorityForTurn(turn, doctor?.especialidad || turn.especialidad) === null
        ? "Sin triaje asociado." : "Prioridad: " + triagePriorityForTurn(turn, doctor?.especialidad || turn.especialidad);

    content.innerHTML = `
                <dl class="row mb-0">
                    <dt class="col-sm-4 text-secondary">Paciente</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? fullName(patient) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">DNI</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.dni : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Medico</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Especialidad</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctor.especialidad : turn.especialidad || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Fecha</dt>
                    <dd class="col-sm-8">${formatDate(turn.fecha)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.hora_inicio)} a ${escapeHtml(turn.hora_fin || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Prioridad</dt>
                    <dd class="col-sm-8">${renderPriorityBadge(triagePriorityForTurn(turn, doctor?.especialidad || turn.especialidad))}</dd>
                    <dt class="col-sm-4 text-secondary">Estado</dt>
                    <dd class="col-sm-8">${renderStateText(turn.estado, escapeHtml)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de inicio</dt>
                    <dd class="col-sm-8">${escapeHtml(consultationStartValue(turn))}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de cierre</dt>
                    <dd class="col-sm-8">${escapeHtml(consultationEndValue(turn))}</dd>
                    <dt class="col-sm-4 text-secondary">Tiempo de atencion</dt>
                    <dd class="col-sm-8">${escapeHtml(formatWorkflowDuration(duration))}</dd>
                    <dt class="col-sm-4 text-secondary">Origen</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.origen || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Triaje</dt>
                    <dd class="col-sm-8 mb-0">${escapeHtml(triageSummary)}</dd>
                </dl>
            `;
}

export function initConsultationWorkflowFilters({
    filters,
    doctors,
    secretary,
    fullName,
    doctorFullName,
    setText
}) {
    const specialties = [...new Set(doctors.map((doctor) => doctor.especialidad))].sort();

    setText("finalizacionSecretariaNavbar", fullName(secretary));
    renderSelect(
        filters.doctor,
        "Todos",
        doctors,
        (doctor) => doctorFullName(doctor),
        (doctor) => doctorFullName(doctor)
    );
    renderSelect(
        filters.specialty,
        "Todas",
        specialties,
        (specialty) => specialty,
        (specialty) => specialty
    );
}
