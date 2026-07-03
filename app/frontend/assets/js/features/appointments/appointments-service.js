import { LOCAL_STORAGE_KEYS } from "../../core/constants.js";
import { clearStoredJson, readStoredJson, writeStoredJson } from "../../core/storage.js";
import { normalizeState } from "../../core/helpers.js";
import { priorityLabel } from "../../core/formatters.js";

function fullName(person) {
    return `${person.nombre} ${person.apellido}`;
}

function doctorById(usuarios, idMedico) {
    return (usuarios.usuarios || []).find((user) => user.id_medico === idMedico) || null;
}

function priorityColor(priority) {
    if (priority === "Alta") {
        return "Rojo";
    }

    if (priority === "Media") {
        return "Amarillo";
    }

    return "Verde";
}

function timeToMinutes(timeValue) {
    const [hours, minutes] = String(timeValue).split(":").map(Number);
    return (hours * 60) + minutes;
}

function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
    const minutes = (totalMinutes % 60).toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}

function addMinutes(timeValue, minutes) {
    return minutesToTime(timeToMinutes(timeValue) + minutes);
}

function normalizePatientPriority(priority) {
    if (priority === "Rojo") {
        return "Alta";
    }

    if (priority === "Amarillo") {
        return "Media";
    }

    if (priority === "Verde") {
        return "Baja";
    }

    return priority;
}

function storedPatientTurnToAppointmentTurn(turn, options = {}) {
    const normalizedPriority = priorityLabel(turn.prioridad);

    const appointmentTurn = {
        id_turno: turn.id,
        id_paciente: turn.pacienteId,
        id_medico: turn.medicoId,
        id_disponibilidad: turn.disponibilidadId,
        id_triaje: turn.idTriaje,
        fecha: turn.fecha,
        hora_inicio: turn.hora,
        hora_fin: turn.horaFin || (options.defaultEnd ? addMinutes(turn.hora, options.defaultEnd) : turn.horaFin),
        estado: turn.estado,
        prioridad: options.normalizeColorPriority ? normalizedPriority : normalizePatientPriority(turn.prioridad),
        color_prioridad: options.usePriorityColor ? priorityColor(normalizedPriority) : turn.prioridad,
        duracion_estimada: Number.parseInt(turn.tiempoEstimado, 10) || 20,
        origen: turn.origen || "Paciente"
    };

    if (options.includeRequestDate) {
        appointmentTurn.fecha_solicitud = turn.fechaSolicitud || new Date().toISOString();
    }

    return appointmentTurn;
}

export function turnosList(turnos) {
    return Array.isArray(turnos.turnos) ? turnos.turnos : [];
}

export function isCompatibleTurn(turn) {
    const validStates = ["reservado", "presente", "en atencion", "completado", "cancelado", "ausente"];

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
    const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

    [storedSecretaryTurns, storedDoctorTurns].forEach((stored) => {
        if (!Array.isArray(stored)) {
            return;
        }

        stored.forEach((turn) => {
            if (turn && turn.id_turno !== undefined) {
                byId.set(String(turn.id_turno), turn);
            }
        });
    });

    if (Array.isArray(storedPatientTurns)) {
        storedPatientTurns.forEach((turn) => {
            if (!turn || turn.id === undefined) {
                return;
            }

            byId.set(String(turn.id), {
                id_turno: turn.id,
                id_paciente: turn.pacienteId,
                id_medico: turn.medicoId,
                id_disponibilidad: turn.disponibilidadId,
                id_triaje: turn.idTriaje,
                fecha: turn.fecha,
                hora_inicio: turn.hora,
                hora_fin: turn.horaFin,
                estado: turn.estado,
                prioridad: priorityLabel(turn.prioridad),
                color_prioridad: turn.prioridad,
                duracion_estimada: Number.parseInt(turn.tiempoEstimado, 10) || 20,
                origen: turn.origen || "Paciente"
            });
        });
    }

    return [...byId.values()];
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
    const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

    [...stored, ...doctorStored, ...convertedPatientTurns].forEach((turn) => {
        if (turn && turn.id_turno !== undefined && turn.id_medico !== undefined) {
            byId.set(String(turn.id_turno), turn);
        }
    });

    return [...byId.values()];
}

export function mergeStoredSecretaryTurns(baseTurns) {
    const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
    const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
    const base = Array.isArray(baseTurns) ? baseTurns : [];
    const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
    const convertedPatientTurns = Array.isArray(storedPatientTurns)
        ? storedPatientTurns.map((turn) => storedPatientTurnToAppointmentTurn(turn, {
            defaultEnd: 20,
            includeRequestDate: true,
            normalizeColorPriority: true,
            usePriorityColor: true
        }))
        : [];
    const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

    [...stored, ...convertedPatientTurns].filter(isCompatibleTurn).forEach((turn) => {
        byId.set(String(turn.id_turno), turn);
    });

    return [...byId.values()];
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
    const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
    const base = Array.isArray(baseTurns) ? baseTurns : [];
    const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
    const convertedPatientTurns = Array.isArray(storedPatientTurns)
        ? storedPatientTurns.map((turn) => storedPatientTurnToAppointmentTurn(turn, {
            defaultEnd: 20,
            includeRequestDate: true,
            normalizeColorPriority: true,
            usePriorityColor: true
        }))
        : [];
    const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

    [...stored, ...convertedPatientTurns].filter(isCompatible).forEach((turn) => {
        byId.set(String(turn.id_turno), turn);
    });

    return [...byId.values()];
}

export function mergeStoredPresenceTurns(baseTurns) {
    return mergeStoredOperationalTurns(baseTurns, compatiblePresenceTurn);
}

export function mergeStoredClosureTurns(baseTurns) {
    return mergeStoredOperationalTurns(baseTurns, compatibleClosureTurn);
}

export function compatiblePatientTurn(turn, doctors, currentPatientId) {
    const validStates = ["Reservado", "Cancelado", "Completado", "Ausente"];

    if (!turn) {
        return false;
    }

    const doctor = doctors.find((currentDoctor) => String(currentDoctor.id) === String(turn.medicoId));

    return turn.origenInterfaz === true
        && turn.pacienteId === currentPatientId
        && doctor
        && turn.especialidad === doctor.especialidad
        && validStates.includes(turn.estado)
        && turn.fecha
        && turn.hora;
}

export function mergeStoredPatientTurns(key, baseTurns, doctors, currentPatientId) {
    const stored = readStoredJson(key, null);

    if (!stored) {
        return baseTurns;
    }

    if (!Array.isArray(stored)) {
        clearStoredJson(key);
        return baseTurns;
    }

    const baseIds = new Set(baseTurns.map((turn) => String(turn.id)));
    const compatibleStoredTurns = stored.filter((turn) => (
        !baseIds.has(String(turn.id))
        && compatiblePatientTurn(turn, doctors, currentPatientId)
    ));

    writeStoredJson(key, compatibleStoredTurns);
    return [...baseTurns, ...compatibleStoredTurns];
}

export function appointmentFromTurn(turn, usuarios) {
    const doctor = doctorById(usuarios, turn.id_medico);

    return {
        id: turn.id_turno,
        pacienteId: turn.id_paciente,
        especialidad: doctor ? doctor.especialidad : turn.especialidad,
        medico: doctor ? fullName(doctor) : turn.medico,
        medicoId: turn.id_medico,
        fecha: turn.fecha,
        hora: turn.hora_inicio,
        horaFin: turn.hora_fin,
        estado: turn.estado,
        prioridad: turn.color_prioridad || turn.prioridad,
        puntaje: turn.puntaje,
        tiempoEstimado: `${turn.duracion_estimada} minutos`,
        disponibilidadId: turn.id_disponibilidad,
        idTriaje: turn.id_triaje
    };
}

export function patientAppointments(turnos, usuarios, patientId) {
    return turnosList(turnos)
        .filter((turn) => turn.id_paciente === patientId)
        .map((turn) => appointmentFromTurn(turn, usuarios));
}

export function nextPatientTurn(turnos, usuarios, patientId) {
    return patientAppointments(turnos, usuarios, patientId)
        .filter((turn) => turn.estado === "Reservado" || turn.estado === "Presente" || turn.estado === "En atenci\u00f3n")
        .sort((a, b) => new Date(`${a.fecha}T${a.hora}:00`) - new Date(`${b.fecha}T${b.hora}:00`))[0] || null;
}

export function appointmentDateTime(turn) {
    return new Date(`${turn.fecha}T${turn.hora}:00`);
}

export function isReservedPatientAppointment(turn) {
    return turn.estado === "Reservado" || turn.estado === "Pendiente";
}

export function isHistoricalPatientAppointment(turn) {
    return turn.estado === "Completado" || turn.estado === "Cancelado" || turn.estado === "Ausente";
}

export function patientAvailableSlotsForTurn(availability, turn) {
    return availability
        .filter((item) => item.estado === "Disponible" && item.especialidad === turn.especialidad)
        .sort((a, b) => new Date(`${a.fecha}T${a.hora_inicio}:00`) - new Date(`${b.fecha}T${b.hora_inicio}:00`));
}

export function canCancelPatientAppointment(turn, currentTime = Date.now()) {
    const millisecondsToTurn = appointmentDateTime(turn).getTime() - currentTime;
    const twoHoursInMilliseconds = 2 * 60 * 60 * 1000;

    return millisecondsToTurn >= twoHoursInMilliseconds;
}

export function cancelPatientAppointment(appointments, turnId) {
    return appointments.map((item) => {
        if (item.id === turnId) {
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
            return {
                ...item,
                estado: "Disponible"
            };
        }

        return item;
    });
}

export function occupyPatientAppointmentAvailability(availability, disponibilidadId) {
    return availability.map((item) => {
        if (String(item.id_disponibilidad) === String(disponibilidadId)) {
            return {
                ...item,
                estado: "Ocupado"
            };
        }

        return item;
    });
}

export function modifyPatientAppointment(appointments, turnId, selectedSlot) {
    return appointments.map((item) => {
        if (item.id === turnId) {
            return {
                ...item,
                especialidad: selectedSlot.especialidad,
                medico: selectedSlot.medico,
                medicoId: selectedSlot.id_medico,
                fecha: selectedSlot.fecha,
                hora: selectedSlot.hora_inicio,
                horaFin: selectedSlot.hora_fin,
                disponibilidadId: selectedSlot.id_disponibilidad
            };
        }

        return item;
    });
}

export function arrivalTime(turn) {
    if (turn.hora_llegada) {
        return turn.hora_llegada;
    }

    if (turn.fecha_arribo) {
        return new Date(turn.fecha_arribo).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    return "-";
}

export function consultationStartValue(turn) {
    return turn.hora_inicio_atencion || turn.hora_inicio_consulta || turn.hora_inicio || "-";
}

export function consultationEndValue(turn) {
    return turn.hora_cierre || turn.hora_fin_atencion || "-";
}

export function attentionStartDate(turn) {
    const start = consultationStartValue(turn);

    if (start === "-") {
        return null;
    }

    return new Date(`${turn.fecha}T${start}:00`);
}

export function attentionDurationMinutes(turn, endDate = null) {
    const startDate = attentionStartDate(turn);

    if (!startDate) {
        return null;
    }

    const finalDate = endDate
        || (turn.fecha_cierre ? new Date(turn.fecha_cierre) : null)
        || (turn.hora_cierre ? new Date(`${turn.fecha}T${turn.hora_cierre}:00`) : null);

    if (!finalDate || Number.isNaN(finalDate.getTime())) {
        return null;
    }

    return Math.max(0, Math.round((finalDate.getTime() - startDate.getTime()) / 60000));
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
