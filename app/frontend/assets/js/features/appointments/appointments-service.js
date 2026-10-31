import { LOCAL_STORAGE_KEYS } from "../../core/constants.js";
import { clearStoredJson, readStoredJson, writeStoredJson } from "../../core/storage.js";
import { normalizeState } from "../../core/helpers.js";
import { priorityLabel } from "../../core/formatters.js";
import { availabilityDateTime, availabilityDurationMinutes } from "../availability/availability-service.js";
import { triagePriorityForTurn } from "../triage/triage-service.js";

function fullName(person) {
    return `${person.nombre} ${person.apellido}`;
}

function doctorById(usuarios, idMedico) {
    return (usuarios.usuarios || []).find((user) => user.id_medico === idMedico) || null;
}

function operationalFields(turn) {
    const names = ["fecha_hora_arribo", "fecha_arribo", "hora_llegada", "hora_arribo", "fecha_hora_inicio",
        "fecha_inicio_atencion", "hora_inicio_atencion", "fecha_hora_cierre", "fecha_cierre", "hora_cierre",
        "tiempo_atencion_minutos", "fecha_cancelacion", "reprogramado", "motivo_reprogramacion"];
    return Object.fromEntries(names.filter((name) => turn[name] !== undefined).map((name) => [name, turn[name]]));
}

// Compatibilidad de la demo: reflejar solo el turno modificado en las copias que ya existen.
// No resuelve escrituras concurrentes ni agrega versionado; será reemplazado por la API.
export function persistTurnUpdate(key, turn) {
    const defined = Object.fromEntries(Object.entries(turn).filter(([, value]) => value !== undefined));
    for (const roleKey of [LOCAL_STORAGE_KEYS.SECRETARY_TURNS, LOCAL_STORAGE_KEYS.DOCTOR_TURNS]) {
        const stored = readStoredJson(roleKey, []);
        const rows = Array.isArray(stored) ? stored : [];
        const existing = rows.find((item) => String(item?.id_turno) === String(turn.id_turno));
        if (!existing && roleKey !== key) continue;
        const updated = preserveTurnCreationDate(existing, { ...existing, ...defined });
        writeStoredJson(roleKey, existing ? rows.map((item) => item === existing ? updated : item) : [...rows, updated]);
    }
    const patients = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
    if (!Array.isArray(patients) || !patients.some((item) => String(item?.id) === String(turn.id_turno))) return;
    writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, patients.map((item) => {
        if (String(item?.id) !== String(turn.id_turno)) return item;
        const mapped = { ...operationalFields(turn), id: turn.id_turno, pacienteId: turn.id_paciente,
            medicoId: turn.id_medico, especialidad: turn.especialidad, fecha: turn.fecha,
            hora: turn.hora_inicio, horaFin: turn.hora_fin, estado: turn.estado, prioridad: turn.prioridad,
            triaje: turn.triaje, disponibilidadId: turn.id_disponibilidad, idTriaje: turn.id_triaje,
            fecha_hora_creacion: turnCreationDate(turn),
            duracion_estimada: availabilityDurationMinutes(turn.hora_inicio, turn.hora_fin) };
        mapped.tiempoEstimado = mapped.duracion_estimada === null ? "-" : `${mapped.duracion_estimada} minutos`;
        const fields = Object.fromEntries(Object.entries(mapped).filter(([, value]) => value !== undefined));
        return preserveTurnCreationDate(item, { ...item, ...fields });
    }));
}

export function turnCreationDate(turn) {
    return [turn?.fecha_hora_creacion, turn?.fecha_solicitud, turn?.fechaSolicitud]
        .find((value) => typeof value === "string" && value.trim() !== "") ?? null;
}

export function preserveTurnCreationDate(existing, incoming) {
    const previousDate = turnCreationDate(existing);
    const incomingDate = turnCreationDate(incoming);
    if (previousDate && incomingDate && previousDate !== incomingDate
        && !(Number.isFinite(Date.parse(previousDate)) && Date.parse(previousDate) === Date.parse(incomingDate))) {
        // No hay versiones ni fuente de verdad para resolver dos antiguedades distintas.
        console.warn("Fechas de creacion en conflicto; se conserva la existente.", {
            id_turno: incoming.id_turno ?? incoming.id,
            fecha_existente: previousDate,
            fecha_entrante: incomingDate
        });
    }
    return { ...incoming, fecha_hora_creacion: previousDate ?? incomingDate };
}

function storedPatientTurnToAppointmentTurn(turn, options = {}) {
    const normalizedPriority = turn.triaje === null ? null : priorityLabel(turn.prioridad, null);

    const appointmentTurn = {
        ...operationalFields(turn),
        id_turno: turn.id,
        id_paciente: turn.pacienteId,
        id_medico: turn.medicoId,
        especialidad: turn.especialidad,
        id_disponibilidad: turn.disponibilidadId,
        id_triaje: turn.idTriaje,
        fecha: turn.fecha,
        hora_inicio: turn.hora,
        hora_fin: turn.horaFin,
        estado: turn.estado,
        prioridad: normalizedPriority,
        triaje: turn.triaje,
        fecha_hora_creacion: turnCreationDate(turn),
        duracion_estimada: availabilityDurationMinutes(turn.hora, turn.horaFin),
        origen: turn.origen || "Paciente"
    };

    if (options.includeRequestDate) {
        appointmentTurn.fecha_solicitud = appointmentTurn.fecha_hora_creacion;
    }

    return appointmentTurn;
}

export function turnosList(turnos) {
    return Array.isArray(turnos.turnos) ? turnos.turnos : [];
}

export function isCompatibleTurn(turn) {
    const validStates = ["reservado", "pendiente", "presente", "en atencion", "completado", "cancelado", "ausente"];

    return turn
        && turn.id_turno !== undefined
        && turn.id_paciente !== undefined
        && turn.id_medico !== undefined
        && turn.fecha
        && turn.hora_inicio
        && validStates.includes(normalizeState(turn.estado));
}

export function mergeStoredTurns(baseTurns) {
    const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
    const storedDoctorTurns = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_TURNS, null);
    const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
    const base = Array.isArray(baseTurns) ? baseTurns : [];
    const byId = new Map();
    base.forEach((turn) => byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn)));

    [storedSecretaryTurns, storedDoctorTurns].forEach((stored) => {
        if (!Array.isArray(stored)) {
            return;
        }

        stored.forEach((turn) => {
            if (turn && turn.id_turno !== undefined) {
                byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn));
            }
        });
    });

    if (Array.isArray(storedPatientTurns)) {
        storedPatientTurns.forEach((turn) => {
            if (!turn || turn.id === undefined) {
                return;
            }

            byId.set(String(turn.id), preserveTurnCreationDate(byId.get(String(turn.id)), storedPatientTurnToAppointmentTurn(turn)));
        });
    }

    return [...byId.values()].map((turn) => preserveTurnCreationDate(null, turn));
}

export function mergeStoredDoctorTurns(baseTurns) {
    const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
    const storedDoctorTurns = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_TURNS, null);
    const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
    const base = Array.isArray(baseTurns) ? baseTurns : [];
    const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
    const doctorStored = Array.isArray(storedDoctorTurns) ? storedDoctorTurns : [];
    const convertedPatientTurns = Array.isArray(storedPatientTurns)
        ? storedPatientTurns.map((turn) => storedPatientTurnToAppointmentTurn(turn))
        : [];
    const byId = new Map();
    base.forEach((turn) => byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn)));

    [...stored, ...doctorStored, ...convertedPatientTurns].forEach((turn) => {
        if (turn && turn.id_turno !== undefined && turn.id_medico !== undefined) {
            byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn));
        }
    });

    return [...byId.values()].map((turn) => preserveTurnCreationDate(null, turn));
}

export function mergeStoredSecretaryTurns(baseTurns) {
    const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
    const storedDoctorTurns = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_TURNS, []);
    const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
    const base = Array.isArray(baseTurns) ? baseTurns : [];
    const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
    const convertedPatientTurns = Array.isArray(storedPatientTurns)
        ? storedPatientTurns.map((turn) => storedPatientTurnToAppointmentTurn(turn, {
            includeRequestDate: true
        }))
        : [];
    const byId = new Map();
    base.forEach((turn) => byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn)));

    [...stored, ...(Array.isArray(storedDoctorTurns) ? storedDoctorTurns : []), ...convertedPatientTurns].filter(isCompatibleTurn).forEach((turn) => {
        byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn));
    });

    return [...byId.values()].map((turn) => preserveTurnCreationDate(null, turn));
}

export function compatiblePresenceTurn(turn) {
    return turn
        && turn.id_turno !== undefined
        && turn.id_paciente !== undefined
        && turn.id_medico !== undefined
        && turn.fecha
        && turn.hora_inicio
        && turn.estado;
}

export function compatibleClosureTurn(turn) {
    return compatiblePresenceTurn(turn);
}

function mergeStoredOperationalTurns(baseTurns, isCompatible) {
    const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
    const storedDoctorTurns = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_TURNS, []);
    const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
    const base = Array.isArray(baseTurns) ? baseTurns : [];
    const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
    const convertedPatientTurns = Array.isArray(storedPatientTurns)
        ? storedPatientTurns.map((turn) => storedPatientTurnToAppointmentTurn(turn, {
            includeRequestDate: true
        }))
        : [];
    const byId = new Map();
    base.forEach((turn) => byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn)));

    [...stored, ...(Array.isArray(storedDoctorTurns) ? storedDoctorTurns : []), ...convertedPatientTurns].filter(isCompatible).forEach((turn) => {
        byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn));
    });

    return [...byId.values()].map((turn) => preserveTurnCreationDate(null, turn));
}

export function mergeStoredPresenceTurns(baseTurns) {
    return mergeStoredOperationalTurns(baseTurns, compatiblePresenceTurn);
}

export function mergeStoredClosureTurns(baseTurns) {
    return mergeStoredOperationalTurns(baseTurns, compatibleClosureTurn);
}

export function compatiblePatientTurn(turn, doctors, currentPatientId) {
    const validStates = ["Reservado", "Pendiente", "Presente", "En atenci\u00f3n", "Cancelado", "Completado", "Ausente"];

    if (!turn) {
        return false;
    }

    const doctor = doctors.find((currentDoctor) => String(currentDoctor.id) === String(turn.medicoId));

    return turn.origenInterfaz === true
        && String(turn.pacienteId) === String(currentPatientId)
        && doctor
        && turn.especialidad === doctor.especialidad
        && validStates.some((state) => normalizeState(state) === normalizeState(turn.estado))
        && turn.fecha
        && turn.hora;
}

export function mergeStoredPatientTurns(key, baseTurns, doctors, currentPatientId) {
    const stored = readStoredJson(key, null);

    if (!stored) {
        return baseTurns.map((turn) => preserveTurnCreationDate(null, turn));
    }

    if (!Array.isArray(stored)) {
        clearStoredJson(key);
        return baseTurns.map((turn) => preserveTurnCreationDate(null, turn));
    }

    const byId = new Map(baseTurns.map((turn) => [String(turn.id), turn]));
    stored.filter((turn) => compatiblePatientTurn(turn, doctors, currentPatientId)).forEach((turn) => {
        byId.set(String(turn.id), preserveTurnCreationDate(byId.get(String(turn.id)), turn));
    });

    return [...byId.values()].map((item) => {
        const turn = preserveTurnCreationDate(null, item);
        const duration = availabilityDurationMinutes(turn.hora, turn.horaFin);
        return {
            ...turn,
            prioridad: turn.triaje === null ? null : priorityLabel(turn.prioridad, null),
            duracion_estimada: duration,
            tiempoEstimado: duration === null ? "-" : `${duration} minutos`
        };
    });
}

export function persistPatientTurns(key, turns, patientId) {
    const stored = readStoredJson(key, []);
    const others = (Array.isArray(stored) ? stored : [])
        .filter((turn) => turn && String(turn.pacienteId) !== String(patientId));
    const storedById = new Map((Array.isArray(stored) ? stored : [])
        .filter((turn) => turn && String(turn.pacienteId) === String(patientId))
        .map((turn) => [String(turn.id), turn]));
    const own = turns.filter((turn) => turn && String(turn.pacienteId) === String(patientId))
        .map((turn) => preserveTurnCreationDate(storedById.get(String(turn.id)), turn));
    writeStoredJson(key, [...others, ...own]);
    own.filter((turn) => JSON.stringify(turn) !== JSON.stringify(storedById.get(String(turn.id))))
        .forEach((turn) => persistTurnUpdate(key, storedPatientTurnToAppointmentTurn(turn)));
}

export function appointmentFromTurn(turn, usuarios) {
    const doctor = doctorById(usuarios, turn.id_medico);
    const duration = availabilityDurationMinutes(turn.hora_inicio, turn.hora_fin);

    return {
        ...operationalFields(turn),
        id: turn.id_turno,
        pacienteId: turn.id_paciente,
        especialidad: doctor ? doctor.especialidad : turn.especialidad,
        medico: doctor ? fullName(doctor) : turn.medico,
        medicoId: turn.id_medico,
        fecha: turn.fecha,
        hora: turn.hora_inicio,
        horaFin: turn.hora_fin,
        estado: normalizeState(turn.estado) === "en atencion" ? "En atenci\u00f3n" : turn.estado,
        prioridad: triagePriorityForTurn(turn, doctor?.especialidad || turn.especialidad),
        triaje: turn.triaje,
        fecha_hora_creacion: turnCreationDate(turn),
        duracion_estimada: duration,
        tiempoEstimado: duration === null ? "-" : `${duration} minutos`,
        disponibilidadId: turn.id_disponibilidad,
        idTriaje: turn.id_triaje
    };
}

export function patientAppointments(turnos, usuarios, patientId) {
    return turnosList(turnos)
        .filter((turn) => String(turn.id_paciente) === String(patientId))
        .map((turn) => appointmentFromTurn(turn, usuarios));
}

export function nextPatientTurn(turnos, usuarios, patientId) {
    return patientAppointments(turnos, usuarios, patientId)
        .filter((turn) => isActivePatientAppointment(turn)
            || (turn.estado === "Reservado" && appointmentDateTime(turn).getTime() >= Date.now()))
        .sort((a, b) => new Date(`${a.fecha}T${a.hora}:00`) - new Date(`${b.fecha}T${b.hora}:00`))[0] || null;
}

export function appointmentDateTime(turn) {
    return new Date(`${turn.fecha}T${turn.hora}:00`);
}

export function isReservedPatientAppointment(turn) {
    return turn.estado === "Reservado" || turn.estado === "Pendiente";
}

export function isActivePatientAppointment(turn) {
    return ["presente", "en atencion"].includes(normalizeState(turn.estado));
}

export function isHistoricalPatientAppointment(turn) {
    return turn.estado === "Completado" || turn.estado === "Cancelado" || turn.estado === "Ausente";
}

export function patientAvailableSlotsForTurn(availability, turn, currentTime = Date.now()) {
    return availability
        .filter((item) => {
            if (!item || item.id_disponibilidad == null || item.id_disponibilidad === ""
                || item.id_medico == null || turn.medicoId == null
                || String(item.id_disponibilidad) === String(turn.disponibilidadId)
                || item.estado !== "Disponible" || item.especialidad !== turn.especialidad
                || String(item.id_medico) !== String(turn.medicoId)
                || !/^\d{4}-\d{2}-\d{2}$/.test(item.fecha)
                || availabilityDurationMinutes(item.hora_inicio, item.hora_fin) === null) return false;
            const date = new Date(`${item.fecha}T00:00:00Z`);
            return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === item.fecha
                && availabilityDateTime(item) > currentTime;
        })
        .sort((a, b) => new Date(`${a.fecha}T${a.hora_inicio}:00`) - new Date(`${b.fecha}T${b.hora_inicio}:00`));
}

export function canCancelPatientAppointment(turn, currentTime = Date.now()) {
    const millisecondsToTurn = appointmentDateTime(turn).getTime() - currentTime;
    const twoHoursInMilliseconds = 2 * 60 * 60 * 1000;

    return isReservedPatientAppointment(turn) && millisecondsToTurn >= twoHoursInMilliseconds;
}

export function cancelPatientAppointment(appointments, turnId) {
    return appointments.map((item) => {
        if (item.id === turnId && isReservedPatientAppointment(item)) {
            return {
                ...item,
                estado: "Cancelado"
            };
        }

        return item;
    });
}

export function releasePatientAppointmentAvailability(availability, disponibilidadId) {
    return availability.map((item) => {
        if (String(item.id_disponibilidad) === String(disponibilidadId)) {
            const released = { ...item, estado: "Disponible" };
            delete released.id_turno;
            return released;
        }

        return item;
    });
}

export function occupyPatientAppointmentAvailability(availability, disponibilidadId, turnId) {
    return availability.map((item) => {
        if (String(item.id_disponibilidad) === String(disponibilidadId)) {
            return {
                ...item,
                estado: "Ocupado",
                ...(turnId !== undefined ? { id_turno: turnId } : {})
            };
        }

        return item;
    });
}

export function modifyPatientAppointment(appointments, turnId, selectedSlot) {
    return appointments.map((item) => {
        if (item.id === turnId && isReservedPatientAppointment(item)
            && patientAvailableSlotsForTurn([selectedSlot], item).length === 1) {
            const duration = availabilityDurationMinutes(selectedSlot.hora_inicio, selectedSlot.hora_fin);
            return {
                ...item,
                fecha: selectedSlot.fecha,
                hora: selectedSlot.hora_inicio,
                horaFin: selectedSlot.hora_fin,
                disponibilidadId: selectedSlot.id_disponibilidad,
                duracion_estimada: duration,
                tiempoEstimado: `${duration} minutos`
            };
        }

        return item;
    });
}

export function arrivalTime(turn) {
    if (turn.hora_llegada) {
        return turn.hora_llegada;
    }

    if (turn.fecha_hora_arribo || turn.fecha_arribo) {
        return new Date(turn.fecha_hora_arribo || turn.fecha_arribo).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    return "-";
}

export function consultationStartValue(turn) {
    const date = attentionStartDate(turn);
    return turn.hora_inicio_atencion || turn.hora_inicio_consulta
        || (date ? date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "-");
}

export function consultationEndValue(turn) {
    const date = effectiveAttentionDate(turn.fecha_hora_cierre || turn.fecha_cierre);
    return turn.hora_cierre || turn.hora_fin_atencion
        || (date ? date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "-");
}

function effectiveAttentionDate(value) {
    if (!(value instanceof Date) && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function attentionStartDate(turn) {
    return effectiveAttentionDate(turn.fecha_hora_inicio || turn.fecha_inicio_atencion);
}

export function attentionDurationMinutes(turn, endDate = null) {
    const startDate = attentionStartDate(turn);

    if (!startDate) {
        return null;
    }

    const finalDate = effectiveAttentionDate(endDate || turn.fecha_hora_cierre || turn.fecha_cierre);

    if (!finalDate || Number.isNaN(finalDate.getTime())) {
        return null;
    }

    const elapsed = finalDate.getTime() - startDate.getTime();
    return elapsed >= 0 ? Math.round(elapsed / 60000) : null;
}

export function registerPresence(turns, selectedTurnId, now = new Date()) {
    const arrivalHour = now.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit"
    });

    return turns.map((turn) => {
        if (String(turn.id_turno) === String(selectedTurnId) && normalizeState(turn.estado) === "reservado") {
            return {
                ...turn,
                estado: "Presente",
                fecha_arribo: now.toISOString(),
                hora_llegada: arrivalHour
            };
        }

        return turn;
    });
}

export function finishConsultation(turns, selectedTurnId, now = new Date(), closingHour = null) {
    const resolvedClosingHour = closingHour || now.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit"
    });

    return turns.map((turn) => {
        if (String(turn.id_turno) === String(selectedTurnId) && normalizeState(turn.estado) === "en atencion") {
            const attentionMinutes = attentionDurationMinutes(turn, now);

            return {
                ...turn,
                estado: "Completado",
                fecha_cierre: now.toISOString(),
                hora_cierre: resolvedClosingHour,
                tiempo_atencion_minutos: attentionMinutes
            };
        }

        return turn;
    });
}
