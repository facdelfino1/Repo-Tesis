import { escapeHtml } from "../../core/helpers.js";
import { formatDate } from "../../core/formatters.js";
import { priorityClass, stateText as renderStateText } from "../../components/badges.js";
import { renderTableEmptyRow } from "../../components/tables.js";
import { orderRescheduleTurns, reschedulePriority, hasRescheduleTriage } from "./rescheduling-service.js";

function rescheduleBadge(item) {
    const priority = reschedulePriority(item);
    const text = priority ?? (hasRescheduleTriage(item.especialidad) ? "Sin prioridad registrada" : "Sin triaje espec\u00edfico");
    return `<span class="badge ${priority ? priorityClass(priority) : "text-bg-secondary"}">${escapeHtml(text)}</span>`;
}

export function showAvailabilityWarning(elements, text, showLoadButton) {
    elements.text.textContent = text;
    elements.loadButton.classList.toggle("d-none", !showLoadButton);
    elements.container.classList.remove("d-none");
}

export function hideAvailabilityWarning(elements) {
    elements.container.classList.add("d-none");
    elements.loadButton.classList.add("d-none");
}

export function proposalStateText(status) {
    return `<strong class="fw-semibold">${escapeHtml(status)}</strong>`;
}

export function renderDoctorAffected({
    affectedTable,
    affectedTurns,
    executeButton,
    patientByTurn,
    fullName,
    priorityLabel
}) {
    executeButton.disabled = affectedTurns.length === 0;

    if (affectedTurns.length === 0) {
        affectedTable.innerHTML = '<tr><td colspan="6" class="text-secondary">No se encontraron turnos Reservados o Presentes dentro del bloque seleccionado.</td></tr>';
        return;
    }

    affectedTable.innerHTML = affectedTurns.map((turn) => {
        const patient = patientByTurn(turn);


        return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${formatDate(turn.fecha)}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td>${rescheduleBadge(turn)}</td>
                        <td>${renderStateText(turn.estado, escapeHtml)}</td>
                    </tr>
                `;
    }).join("");
}

export function renderDoctorProposals({
    proposalTable,
    proposals,
    waitlist,
    slotLabel,
    warningElements
}) {
    if (waitlist.some((item) => item.reason === "Sin disponibilidad suficiente")) {
        showAvailabilityWarning(warningElements, "No hay disponibilidad suficiente para reprogramar todos los turnos. Los pacientes restantes seran colocados en lista de espera.", false);
    } else {
        hideAvailabilityWarning(warningElements);
    }

    if (proposals.length === 0) {
        proposalTable.innerHTML = '<tr><td colspan="5" class="text-secondary">Ejecute la reprogramacion para generar propuestas.</td></tr>';
        return;
    }

    let ordered;
    try { ordered = orderRescheduleTurns(proposals); }
    catch (error) { proposalTable.innerHTML = renderTableEmptyRow(5, error.message); return; }
    proposalTable.innerHTML = ordered.map((proposal) => `
                <tr>
                    <td class="fw-semibold">${escapeHtml(proposal.patientName)}</td>
                    <td>${rescheduleBadge(proposal)}</td>
                    <td>${escapeHtml(proposal.previousLabel)}</td>
                    <td>${escapeHtml(slotLabel(proposal.slot))}</td>
                    <td>${proposalStateText(proposal.status)}</td>
                </tr>
            `).join("");
}

export function renderDoctorNotifications({
    notificationContainer,
    proposals,
    slotLabel
}) {
    if (proposals.length === 0) {
        notificationContainer.innerHTML = '<div class="col-12"><div class="alert alert-info mb-0" role="alert">Las notificaciones se mostraran luego de generar propuestas con disponibilidad.</div></div>';
        return;
    }

    notificationContainer.innerHTML = proposals.map((proposal) => {
        const canAnswer = proposal.status === "Pendiente de confirmacion";
        const messageText = `Turno anterior: ${proposal.previousLabel}. Nuevo turno propuesto: ${slotLabel(proposal.slot)}.`;

        return `
                    <div class="col-12 col-lg-6">
                        <article class="card appointment-card border h-100">
                            <div class="card-body">
                                <p class="text-secondary small mb-1">${escapeHtml(proposal.contact || "Sin contacto")}</p>
                                <h3 class="h6 fw-semibold">${escapeHtml(proposal.patientName)}</h3>
                                <p class="small">${escapeHtml(messageText)}</p>
                                <p class="small">Estado: <strong class="fw-semibold">${escapeHtml(proposal.notificationStatus)}</strong></p>
                                <div class="d-grid d-sm-flex gap-2 justify-content-sm-end">
                                    <button type="button" class="btn btn-outline-success btn-sm" data-action="confirm-proposal" data-proposal-id="${proposal.id}" ${canAnswer ? "" : "disabled"}>Confirmar cambio</button>
                                    <button type="button" class="btn btn-outline-danger btn-sm" data-action="reject-proposal" data-proposal-id="${proposal.id}" ${canAnswer ? "" : "disabled"}>Rechazar cambio</button>
                                </div>
                            </div>
                        </article>
                    </div>
                `;
    }).join("");
}

export function renderDoctorWaitlist({
    waitlistTable,
    waitlist
}) {
    let sortedWaitlist;
    try { sortedWaitlist = orderRescheduleTurns(waitlist); }
    catch (error) { waitlistTable.innerHTML = renderTableEmptyRow(5, error.message); return; }

    if (sortedWaitlist.length === 0) {
        waitlistTable.innerHTML = '<tr><td colspan="5" class="text-secondary">No hay pacientes en espera.</td></tr>';
        return;
    }

    waitlistTable.innerHTML = sortedWaitlist.map((item) => `
                <tr>
                    <td class="fw-semibold">${escapeHtml(item.patientName)}</td>
                    <td>${escapeHtml(item.dni || "-")}</td>
                    <td>${rescheduleBadge(item)}</td>
                    <td>${escapeHtml(item.reason)}</td>
                    <td><strong class="fw-semibold">${reschedulePriority(item) === null ? "En espera" : "En espera prioritaria"}</strong></td>
                </tr>
            `).join("");
}

export function renderSecretaryAffected({
    affectedTable,
    affectedTurns,
    executeButton,
    patientByTurn,
    doctorByTurn,
    fullName,
    doctorFullName
}) {
    executeButton.disabled = affectedTurns.length === 0;

    if (affectedTurns.length === 0) {
        affectedTable.innerHTML = renderTableEmptyRow(9, "No se encontraron turnos Reservados o Presentes dentro del bloque seleccionado.");
        return;
    }

    affectedTable.innerHTML = affectedTurns.map((turn) => {
        const patient = patientByTurn(turn);
        const doctor = doctorByTurn(turn);

        return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</td>
                        <td>${escapeHtml(doctor ? doctor.especialidad : turn.especialidad || "-")}</td>
                        <td>${formatDate(turn.fecha)}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td>${rescheduleBadge(turn)}</td>
                        <td>${renderStateText(turn.estado, escapeHtml)}</td>
                        <td>${escapeHtml(turn.origen || "-")}</td>
                    </tr>
                `;
    }).join("");
}

export function renderSecretaryProposals({
    proposalTable,
    proposals,
    waitlist,
    slotLabel,
    warningElements
}) {
    if (waitlist.some((item) => item.reason === "Sin disponibilidad suficiente")) {
        showAvailabilityWarning(
            warningElements,
            "No hay disponibilidad suficiente para reprogramar todos los turnos. Los pacientes restantes seran colocados en lista de espera.",
            false
        );
    } else {
        hideAvailabilityWarning(warningElements);
    }

    if (proposals.length === 0) {
        proposalTable.innerHTML = renderTableEmptyRow(5, "Ejecute la reprogramacion para generar propuestas.");
        return;
    }

    let ordered;
    try { ordered = orderRescheduleTurns(proposals); }
    catch (error) { proposalTable.innerHTML = renderTableEmptyRow(5, error.message); return; }
    proposalTable.innerHTML = ordered.map((proposal) => `
                <tr>
                    <td class="fw-semibold">${escapeHtml(proposal.patientName)}</td>
                    <td>${rescheduleBadge(proposal)}</td>
                    <td>${escapeHtml(proposal.previousLabel)}</td>
                    <td>${escapeHtml(slotLabel(proposal.slot))}</td>
                    <td>${proposalStateText(proposal.status)}</td>
                </tr>
            `).join("");
}

export function renderSecretaryNotifications({
    notificationContainer,
    proposals
}) {
    if (proposals.length === 0) {
        notificationContainer.innerHTML = `
                    <div class="col-12">
                        <div class="alert alert-info mb-0" role="alert">
                            Las notificaciones se mostraran luego de generar propuestas con disponibilidad.
                        </div>
                    </div>
                `;
        return;
    }

    notificationContainer.innerHTML = proposals.map((proposal) => {
        const canAnswer = proposal.status === "Pendiente de confirmacion";
        const messageText = `Su turno fue reprogramado. Nueva fecha: ${formatDate(proposal.slot.fecha)}, horario: ${proposal.slot.hora_inicio}.`;

        return `
                    <div class="col-12 col-lg-6">
                        <article class="card appointment-card border h-100">
                            <div class="card-body">
                                <div class="d-flex justify-content-between gap-3 mb-3">
                                    <div>
                                        <p class="text-secondary small mb-1">${escapeHtml(proposal.contact || "Sin contacto")}</p>
                                        <h3 class="h6 fw-semibold mb-0">${escapeHtml(proposal.patientName)}</h3>
                                    </div>
                                    <strong class="fw-semibold">${escapeHtml(proposal.notificationStatus)}</strong>
                                </div>
                                <p class="small mb-3">${escapeHtml(messageText)}</p>
                                <div class="d-grid d-sm-flex gap-2 justify-content-sm-end">
                                    <button type="button" class="btn btn-outline-success btn-sm" data-action="confirm-proposal" data-proposal-id="${proposal.id}" ${canAnswer ? "" : "disabled"}>
                                        Confirmar cambio
                                    </button>
                                    <button type="button" class="btn btn-outline-danger btn-sm" data-action="reject-proposal" data-proposal-id="${proposal.id}" ${canAnswer ? "" : "disabled"}>
                                        Rechazar cambio
                                    </button>
                                </div>
                            </div>
                        </article>
                    </div>
                `;
    }).join("");
}

export function renderSecretaryWaitlist({
    waitlistTable,
    waitlist
}) {
    let sortedWaitlist;
    try { sortedWaitlist = orderRescheduleTurns(waitlist); }
    catch (error) { waitlistTable.innerHTML = renderTableEmptyRow(5, error.message); return; }

    if (sortedWaitlist.length === 0) {
        waitlistTable.innerHTML = renderTableEmptyRow(5, "No hay pacientes en espera.");
        return;
    }

    waitlistTable.innerHTML = sortedWaitlist.map((item) => `
                <tr>
                    <td class="fw-semibold">${escapeHtml(item.patientName)}</td>
                    <td>${escapeHtml(item.dni || "-")}</td>
                    <td>${rescheduleBadge(item)}</td>
                    <td>${escapeHtml(item.reason)}</td>
                    <td><strong class="fw-semibold">${reschedulePriority(item) === null ? "En espera" : "En espera prioritaria"}</strong></td>
                </tr>
            `).join("");
}
