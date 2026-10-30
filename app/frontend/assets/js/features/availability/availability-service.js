import { LOCAL_STORAGE_KEYS } from "../../core/constants.js";
import { clearStoredJson, readStoredJson, writeStoredJson } from "../../core/storage.js";
import { minutesToTime, timeToMinutes } from "../../core/formatters.js";

export function doctorMatchesAvailability(item, doctors) {
    if (!item) {
        return false;
    }

    const specialties = new Set(doctors.map((doctor) => doctor.especialidad));
    const doctor = doctors.find((currentDoctor) => String(currentDoctor.id) === String(item.id_medico));

    if (doctor) {
        return item.especialidad === doctor.especialidad;
    }

    return !item.id_medico && specialties.has(item.especialidad);
}

export function compatibleAvailability(item, doctors) {
    const validStates = ["Disponible", "Ocupado"];

    return item
        && item.id_disponibilidad !== undefined
        && validStates.includes(item.estado)
        && doctorMatchesAvailability(item, doctors)
        && item.fecha
        && item.hora_inicio
        && item.hora_fin;
}

export function mergeStoredAvailability(key, baseAvailability, doctors) {
    const base = Array.isArray(baseAvailability) ? baseAvailability : [];
    const stored = readStoredJson(key, null);

    if (!stored) {
        return base;
    }

    if (!Array.isArray(stored)) {
        clearStoredJson(key);
        return base;
    }

    const storedById = new Map(stored.map((item) => [String(item.id_disponibilidad), item]));
    const baseIds = new Set(base.map((item) => String(item.id_disponibilidad)));
    const mergedBase = base.map((item) => {
        const storedItem = storedById.get(String(item.id_disponibilidad));

        if (!compatibleAvailability(storedItem, doctors)) {
            return item;
        }

        return {
            ...item,
            estado: storedItem.estado,
            id_turno: storedItem.id_turno || item.id_turno
        };
    });
    const extraItems = stored.filter((item) => (
        !baseIds.has(String(item.id_disponibilidad))
        && compatibleAvailability(item, doctors)
    ));
    const merged = [...mergedBase, ...extraItems].map((item) => {
        if (item.estado !== "Disponible") return item;
        const released = { ...item };
        delete released.id_turno;
        return released;
    });

    writeStoredJson(key, merged);
    return merged;
}

export function mergeAllStoredAvailability(baseAvailability, { conservative = false, doctors = [] } = {}) {
    const base = Array.isArray(baseAvailability) ? baseAvailability : [];
    const storedSecretary = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY, null);
    const storedPatient = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, null);
    const storedDoctor = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_AVAILABILITY, null);
    // El modo conservador es de lectura y solo se activa en la solicitud del paciente.
    // Sin versiones compartidas no podemos distinguir una liberacion de una copia antigua.
    const validPatientSlot = (item) => {
        if (!item || item.id_disponibilidad == null || item.id_disponibilidad === ""
            || !item.id_medico || !compatibleAvailability(item, doctors)
            || !/^\d{4}-\d{2}-\d{2}$/.test(item.fecha)
            || availabilityDurationMinutes(item.hora_inicio, item.hora_fin) === null) {
            return false;
        }
        const date = new Date(`${item.fecha}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === item.fecha;
    };
    const byId = new Map();
    const addItem = (item) => {
        if (conservative && !validPatientSlot(item)) {
            return;
        }
        const id = String(item.id_disponibilidad);
        const previous = byId.get(id);
        if (conservative && previous) {
            const sameBlock = ["id_medico", "especialidad", "fecha", "hora_inicio", "hora_fin"]
                .every((field) => String(previous[field]) === String(item[field]));
            if (!sameBlock || previous.estado === "Ocupado" || item.estado === "Ocupado") {
                byId.set(id, { ...previous, estado: "Ocupado" });
                return;
            }
        }
        byId.set(id, item);
    };
    base.forEach((item) => {
        if (conservative) addItem(item);
        else byId.set(String(item.id_disponibilidad), item);
    });

    [storedSecretary, storedPatient, storedDoctor].forEach((stored) => {
        if (!Array.isArray(stored)) {
            return;
        }

        stored.forEach((item) => {
            if (item && item.id_disponibilidad !== undefined && item.fecha && item.hora_inicio && item.hora_fin) {
                addItem(item);
            }
        });
    });

    return [...byId.values()];
}

export function availabilityDateTime(item) {
    return new Date(`${item.fecha}T${item.hora_inicio}:00`).getTime();
}

export function availabilityDurationMinutes(start, end) {
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!validTime.test(start) || !validTime.test(end)) {
        return null;
    }
    const minutes = timeToMinutes(end) - timeToMinutes(start);
    return minutes > 0 ? minutes : null;
}

export function buildAvailabilityBlocks({ doctorId, doctorName, specialty, date, start, end, origin, slotDuration = 20 }) {
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    const blocks = [];

    for (let current = startMinutes; current + slotDuration <= endMinutes; current += slotDuration) {
        blocks.push({
            id_medico: doctorId,
            medico: doctorName,
            especialidad: specialty,
            fecha: date,
            hora_inicio: minutesToTime(current),
            hora_fin: minutesToTime(current + slotDuration),
            duracion_turno: slotDuration,
            estado: "Disponible",
            origen: origin || "Secretaria"
        });
    }

    return blocks;
}

export function hasOverlap(availability, date, start, end) {
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);

    return availability.some((item) => (
        item.fecha === date
        && startMinutes < timeToMinutes(item.hora_fin)
        && endMinutes > timeToMinutes(item.hora_inicio)
    ));
}
