import { minutesToTime, timeToMinutes } from "../../core/formatters.js";

const agendaClock = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

export function isAvailabilityExpired(block, now = new Date()) {
    const parts = Object.fromEntries(agendaClock.formatToParts(now).map(({ type, value }) => [type, value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    return block.fecha < today || (block.fecha === today && block.hora_inicio.slice(0, 5) <= `${parts.hour}:${parts.minute}`);
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
