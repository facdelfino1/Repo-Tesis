import { priorityLabel } from "../../core/formatters.js";
import { normalizeState } from "../../core/helpers.js";
import { turnCreationDate, patientAvailableSlotsForTurn } from "../appointments/appointments-service.js";
import { availabilityDurationMinutes } from "../availability/availability-service.js";

function timeToMinutes(timeValue) {
    const [hours, minutes] = String(timeValue).split(":").map(Number);
    return (hours * 60) + minutes;
}

function specialtyKey(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .trim().toLowerCase().replace(/\s+/g, "_");
}

export function hasRescheduleTriage(specialty) {
    return ["clinica_medica", "pediatria"].includes(specialtyKey(specialty));
}

export function reschedulePriority(item) {
    if (!hasRescheduleTriage(item.especialidad)) return null;
    const value = Object.hasOwn(item, "prioridad") ? item.prioridad : item.priority;
    return priorityLabel(value, null);
}

function assertSameAgenda(items) {
    if (items.length === 0) return;
    const first = items[0];
    if (first.id_medico == null || first.id_medico === "" || !specialtyKey(first.especialidad)
        || items.some((item) => String(item.id_medico) !== String(first.id_medico)
            || specialtyKey(item.especialidad) !== specialtyKey(first.especialidad))) {
        throw new Error("La reprogramacion requiere una unica agenda de medico y especialidad. Revise los datos.");
    }
}

function compareIdentity(a, b) {
    const left = String(a.id_turno ?? a.turnId ?? a.id ?? "");
    const right = String(b.id_turno ?? b.turnId ?? b.id ?? "");
    return left < right ? -1 : left > right ? 1 : 0;
}

function creationTime(item) {
    const value = turnCreationDate(item);
    const calendar = value?.match(/^\d{4}-\d{2}-\d{2}(?=T|$)/)?.[0];
    if (!calendar) return Infinity;
    const date = new Date(`${calendar}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== calendar) return Infinity;
    const parsed = value === null ? NaN : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Infinity;
}

export function sortedByPriority(items) {
    assertSameAgenda(items);
    if (items.some((item) => !hasRescheduleTriage(item.especialidad) || reschedulePriority(item) === null)) {
        throw new Error("La priorizacion requiere una especialidad con triaje y prioridades validas.");
    }
    const ranks = { Alta: 0, Media: 1, Baja: 2 };
    return [...items].sort((a, b) => {
        const rankDiff = ranks[reschedulePriority(a)] - ranks[reschedulePriority(b)];
        if (rankDiff !== 0) return rankDiff;
        const left = creationTime(a);
        const right = creationTime(b);
        return left !== right ? (left < right ? -1 : 1) : compareIdentity(a, b);
    });
}

export function orderRescheduleTurns(items) {
    assertSameAgenda(items);
    if (items.length === 0) return [];
    if (hasRescheduleTriage(items[0].especialidad)) return sortedByPriority(items);
    // Turnero convencional: fecha/hora del turno, sin rango clinico.
    return [...items].sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || ""))
        || String(a.hora_inicio || "").localeCompare(String(b.hora_inicio || "")) || compareIdentity(a, b));
}

export function restoreRescheduleItems(items, turns) {
    const restored = items.flatMap((item) => {
        const matches = turns.filter((turn) => String(turn.id_turno) === String(item.turnId));
        if (matches.length !== 1) {
            console.warn("No se puede recuperar el contexto de reprogramacion del turno", item.turnId);
            return [];
        }
        const turn = matches[0];
        if ((item.id_medico != null && String(item.id_medico) !== String(turn.id_medico))
            || (item.especialidad && specialtyKey(item.especialidad) !== specialtyKey(turn.especialidad))
            || (item.slot && (String(item.slot.id_medico) !== String(turn.id_medico)
                || specialtyKey(item.slot.especialidad) !== specialtyKey(turn.especialidad)))) {
            throw new Error("El proceso guardado contiene un contexto de agenda incompatible.");
        }
        return [{ ...item, id_medico: turn.id_medico, especialidad: turn.especialidad,
            priority: reschedulePriority(turn),
            ...(Object.hasOwn(item, "prioridad") ? { prioridad: reschedulePriority(turn) } : {}),
            fecha_hora_creacion: turnCreationDate(turn) ?? turnCreationDate(item),
            fecha: turn.fecha, hora_inicio: turn.hora_inicio }];
    });
    assertSameAgenda(restored);
    return restored;
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
        && (state === "reservado" || state === "presente" || state === "pendiente")
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

    return patientAvailableSlotsForTurn(availability, { medicoId: doctorId, especialidad: specialty })
        .filter((slot) => !blockContainsSlot(slot, options))
        .sort((a, b) => slotDateTime(a) - slotDateTime(b));
}

export function buildRescheduleProposals(options) {
    const {
        affectedTurns,
        slots,
        patientByTurn,
        fullName,
        turnLabel,
        reason,
        proposalIdPrefix,
        waitlistIdPrefix,
        notificationStatus
    } = options;
    const nextProposals = [];
    const nextWaitlist = [];

    const ordered = orderRescheduleTurns(affectedTurns);
    if (ordered.length && slots.some((slot) => String(slot.id_medico) !== String(ordered[0].id_medico)
        || specialtyKey(slot.especialidad) !== specialtyKey(ordered[0].especialidad))) {
        throw new Error("Los horarios alternativos deben pertenecer a la misma agenda y especialidad.");
    }
    ordered.forEach((turn, index) => {
        const patient = patientByTurn(turn);
        const slot = slots[index] || null;
        if (slot && patientAvailableSlotsForTurn([slot], {
            medicoId: turn.id_medico, especialidad: turn.especialidad, disponibilidadId: turn.id_disponibilidad
        }).length !== 1) {
            throw new Error("La propuesta requiere un horario futuro, disponible y valido de la misma agenda.");
        }
        const priority = reschedulePriority(turn);
        const context = { id_medico: turn.id_medico, especialidad: turn.especialidad,
            fecha_hora_creacion: turnCreationDate(turn), fecha: turn.fecha, hora_inicio: turn.hora_inicio };

        if (!slot) {
            nextWaitlist.push({
                id: `${waitlistIdPrefix}${turn.id_turno}`,
                turnId: turn.id_turno,
                ...context,
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
            ...context,
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

    const original = turns.find((turn) => String(turn.id_turno) === String(proposal.turnId));
    const slot = availability.find((item) => String(item.id_disponibilidad) === String(proposal.slot?.id_disponibilidad));
    if (!original || !slot || !proposal.slot || String(slot.id_medico) !== String(original.id_medico)
        || specialtyKey(slot.especialidad) !== specialtyKey(original.especialidad)
        || (doctorId !== null && String(doctorId) !== String(original.id_medico))
        || !["reservado", "presente", "pendiente"].includes(normalizeState(original.estado))
        || ["id_medico", "especialidad", "fecha", "hora_inicio", "hora_fin"].some((field) => String(slot[field]) !== String(proposal.slot[field]))
        || patientAvailableSlotsForTurn([slot], { medicoId: original.id_medico, especialidad: original.especialidad,
            disponibilidadId: original.id_disponibilidad }).length !== 1
        || String(proposal.oldAvailabilityId) !== String(original.id_disponibilidad)) {
        return null;
    }
    const oldSlot = availability.find((item) => String(item.id_disponibilidad) === String(original.id_disponibilidad));
    if (oldSlot?.id_turno != null && String(oldSlot.id_turno) !== String(original.id_turno)) return null;
    const nextTurns = turns.map((turn) => {
        if (String(turn.id_turno) !== String(proposal.turnId)) {
            return turn;
        }

        return {
            ...turn,
            id_disponibilidad: slot.id_disponibilidad,
            fecha: slot.fecha,
            hora_inicio: slot.hora_inicio,
            hora_fin: slot.hora_fin,
            duracion_estimada: availabilityDurationMinutes(slot.hora_inicio, slot.hora_fin),
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
        turns,
        proposals,
        waitlist,
        proposalId,
        waitlistIdPrefix
    } = options;
    const proposal = proposals.find((item) => item.id === proposalId);

    if (!proposal || proposal.status !== "Pendiente de confirmacion") {
        return null;
    }
    const original = turns.find((turn) => String(turn.id_turno) === String(proposal.turnId));
    if (!original || !["reservado", "presente", "pendiente"].includes(normalizeState(original.estado))) return null;
    const nextTurns = turns.map((turn) => turn === original ? { ...turn, estado: "Pendiente" } : turn);

    const nextProposals = proposals.map((item) => (
        item.id === proposalId
            ? { ...item, status: "Rechazada", notificationStatus: "Rechazada por paciente" }
            : item
    ));
    const nextWaitlist = [
        ...waitlist.filter((item) => String(item.turnId) !== String(original.id_turno)),
        {
            id: `${waitlistIdPrefix}${proposal.turnId}`,
            turnId: proposal.turnId,
            id_medico: original.id_medico,
            especialidad: original.especialidad,
            fecha_hora_creacion: turnCreationDate(original) ?? turnCreationDate(proposal),
            fecha: original.fecha,
            hora_inicio: original.hora_inicio,
            patientName: proposal.patientName,
            dni: proposal.dni,
            priority: reschedulePriority(original),
            reason: "Paciente rechazo la propuesta",
            status: "En espera prioritaria"
        }
    ];

    return {
        turns: nextTurns,
        proposals: nextProposals,
        waitlist: nextWaitlist
    };
}
