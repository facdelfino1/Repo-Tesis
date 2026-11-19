import { minutesToTime, timeToMinutes } from "../../core/formatters.js";

const agendaClock = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function agendaDateTime(now) {
    const parts = Object.fromEntries(agendaClock.formatToParts(now).map(({ type, value }) => [type, value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

export const availabilityToday = (now = new Date()) => agendaDateTime(now).date;

export function filterExistingAvailability(rows, date, now = new Date()) {
    const clock = agendaDateTime(now);
    if (!date || date < clock.date) return [];
    return rows.filter(row => row.fecha === date
        && (date > clock.date || row.hora_fin > clock.time));
}

export function isAvailabilityExpired(block, now = new Date()) {
    const clock = agendaDateTime(now);
    return block.fecha < clock.date || (block.fecha === clock.date && block.hora_inicio.slice(0, 5) <= clock.time.slice(0, 5));
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
