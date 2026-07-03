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
    const merged = [...mergedBase, ...extraItems];

    writeStoredJson(key, merged);
    return merged;
}

export function mergeAllStoredAvailability(baseAvailability) {
    const base = Array.isArray(baseAvailability) ? baseAvailability : [];
    const storedSecretary = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY, null);
    const storedPatient = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, null);
    const storedDoctor = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_AVAILABILITY, null);
    const byId = new Map(base.map((item) => [String(item.id_disponibilidad), item]));

    [storedSecretary, storedPatient, storedDoctor].forEach((stored) => {
        if (!Array.isArray(stored)) {
            return;
        }

        stored.forEach((item) => {
            if (item && item.id_disponibilidad !== undefined && item.fecha && item.hora_inicio && item.hora_fin) {
                byId.set(String(item.id_disponibilidad), item);
            }
        });
    });

    return [...byId.values()];
}

export function availabilityDateTime(item) {
    return new Date(`${item.fecha}T${item.hora_inicio}:00`).getTime();
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
