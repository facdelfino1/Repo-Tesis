import { priorityRank } from "../../core/formatters.js";
import { normalizeState } from "../../core/helpers.js";

function timeToMinutes(timeValue) {
    const [hours, minutes] = String(timeValue).split(":").map(Number);
    return (hours * 60) + minutes;
}

export function sortedByPriority(items) {
    return [...items].sort((a, b) => {
        const rankDiff = priorityRank(a.prioridad || a.priority) - priorityRank(b.prioridad || b.priority);

        if (rankDiff !== 0) {
            return rankDiff;
        }

        return String(a.hora_inicio || "").localeCompare(String(b.hora_inicio || ""));
    });
}

export function blockOverlaps(startValue, endValue, blockStart, blockEnd) {
    return timeToMinutes(startValue) < blockEnd && timeToMinutes(endValue || startValue) > blockStart;
}

export function isAffectedTurn(turn, options) {
    const {
        doctorId,
        date,
        start,
        end
    } = options;
    const state = normalizeState(turn.estado);

    return String(turn.id_medico) === String(doctorId)
        && turn.fecha === date
        && (state === "reservado" || state === "presente")
        && blockOverlaps(turn.hora_inicio, turn.hora_fin || turn.hora_inicio, timeToMinutes(start), timeToMinutes(end));
}

export function blockContainsSlot(slot, options) {
    const {
        doctorId,
        date,
        start,
        end
    } = options;

    return String(slot.id_medico) === String(doctorId)
        && slot.fecha === date
        && blockOverlaps(slot.hora_inicio, slot.hora_fin || slot.hora_inicio, timeToMinutes(start), timeToMinutes(end));
}

export function slotDateTime(slot) {
    return new Date(`${slot.fecha}T${slot.hora_inicio}:00`).getTime();
}

export function availableSlotsForReschedule(availability, options) {
    const {
        doctorId,
        specialty = ""
    } = options;

    return availability
        .filter((slot) => slot.estado === "Disponible")
        .filter((slot) => String(slot.id_medico) === String(doctorId))
        .filter((slot) => specialty === "" || slot.especialidad === specialty)
        .filter((slot) => !blockContainsSlot(slot, options))
        .sort((a, b) => slotDateTime(a) - slotDateTime(b));
}

export function buildRescheduleProposals(options) {
    const {
        affectedTurns,
        slots,
        patientByTurn,
        fullName,
        priorityLabel,
        turnLabel,
        reason,
        proposalIdPrefix,
        waitlistIdPrefix,
        notificationStatus
    } = options;
    const nextProposals = [];
    const nextWaitlist = [];

    affectedTurns.forEach((turn, index) => {
        const patient = patientByTurn(turn);
        const slot = slots[index] || null;
        const priority = priorityLabel(turn.prioridad);

        if (!slot) {
            nextWaitlist.push({
                id: `${waitlistIdPrefix}${turn.id_turno}`,
                turnId: turn.id_turno,
                patientName: patient ? fullName(patient) : "Paciente",
                dni: patient ? patient.dni : "-",
                priority,
                reason: "Sin disponibilidad suficiente",
                status: "En espera prioritaria"
            });
            return;
        }

        nextProposals.push({
            id: `${proposalIdPrefix}${turn.id_turno}`,
            turnId: turn.id_turno,
            slot,
            oldAvailabilityId: turn.id_disponibilidad,
            patientName: patient ? fullName(patient) : "Paciente",
            dni: patient ? patient.dni : "-",
            contact: patient ? patient.telefono : "",
            priority,
            previousLabel: turnLabel(turn),
            status: "Pendiente de confirmacion",
            notificationStatus,
            reason
        });
    });

    return {
        proposals: nextProposals,
        waitlist: nextWaitlist
    };
}

export function releaseAvailability(availability, disponibilidadId) {
    return availability.map((slot) => {
        if (String(slot.id_disponibilidad) === String(disponibilidadId)) {
            const released = { ...slot, estado: "Disponible" };
            delete released.id_turno;
            return released;
        }

        return slot;
    });
}

export function occupyAvailability(availability, disponibilidadId, turnId) {
    return availability.map((slot) => {
        if (String(slot.id_disponibilidad) === String(disponibilidadId)) {
            return {
                ...slot,
                estado: "Ocupado",
                id_turno: turnId
            };
        }

        return slot;
    });
}

export function confirmRescheduleProposal(options) {
    const {
        turns,
        availability,
        proposals,
        proposalId,
        doctorId = null
    } = options;
    const proposal = proposals.find((item) => item.id === proposalId);

    if (!proposal || proposal.status !== "Pendiente de confirmacion") {
        return null;
    }

    const slot = proposal.slot;
    const nextTurns = turns.map((turn) => {
        if (String(turn.id_turno) !== String(proposal.turnId)) {
            return turn;
        }

        return {
            ...turn,
            id_medico: doctorId === null ? slot.id_medico : doctorId,
            id_disponibilidad: slot.id_disponibilidad,
            fecha: slot.fecha,
            hora_inicio: slot.hora_inicio,
            hora_fin: slot.hora_fin,
            estado: "Reservado",
            motivo_reprogramacion: proposal.reason,
            reprogramado: true
        };
    });
    const releasedAvailability = releaseAvailability(availability, proposal.oldAvailabilityId);
    const occupiedAvailability = occupyAvailability(releasedAvailability, slot.id_disponibilidad, proposal.turnId);
    const nextProposals = proposals.map((item) => (
        item.id === proposalId
            ? { ...item, status: "Confirmada", notificationStatus: "Confirmada por paciente" }
            : item
    ));

    return {
        turns: nextTurns,
        availability: occupiedAvailability,
        proposals: nextProposals
    };
}

export function rejectRescheduleProposal(options) {
    const {
        proposals,
        waitlist,
        proposalId,
        waitlistIdPrefix
    } = options;
    const proposal = proposals.find((item) => item.id === proposalId);

    if (!proposal || proposal.status !== "Pendiente de confirmacion") {
        return null;
    }

    const nextProposals = proposals.map((item) => (
        item.id === proposalId
            ? { ...item, status: "Rechazada", notificationStatus: "Rechazada por paciente" }
            : item
    ));
    const nextWaitlist = [
        ...waitlist,
        {
            id: `${waitlistIdPrefix}${proposal.turnId}`,
            turnId: proposal.turnId,
            patientName: proposal.patientName,
            dni: proposal.dni,
            priority: proposal.priority,
            reason: "Paciente rechazo la propuesta",
            status: "En espera prioritaria"
        }
    ];

    return {
        proposals: nextProposals,
        waitlist: nextWaitlist
    };
}
