import { PRIORITY_LABELS } from "./constants.js";

export function formatDate(dateValue) {
    if (!dateValue) {
        return "-";
    }

    const date = new Date(`${dateValue}T00:00:00`);

    return new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(date);
}

export function formatToday() {
    return new Intl.DateTimeFormat("es-AR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(new Date());
}

export function todayInputValue() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${now.getFullYear()}-${month}-${day}`;
}

export function currentTimeValue(date = new Date()) {
    return date.toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function timeToMinutes(timeValue) {
    const [hours, minutes] = String(timeValue || "00:00").split(":").map(Number);
    return (hours * 60) + minutes;
}

export function minutesToTime(totalMinutes) {
    const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalizedMinutes / 60).toString().padStart(2, "0");
    const minutes = (normalizedMinutes % 60).toString().padStart(2, "0");

    return `${hours}:${minutes}`;
}

export function priorityLabel(priority, fallback = PRIORITY_LABELS.LOW) {
    if (priority === "Rojo" || priority === PRIORITY_LABELS.HIGH) {
        return PRIORITY_LABELS.HIGH;
    }

    if (priority === "Amarillo" || priority === PRIORITY_LABELS.MEDIUM) {
        return PRIORITY_LABELS.MEDIUM;
    }

    if (priority === "Verde" || priority === PRIORITY_LABELS.LOW) {
        return PRIORITY_LABELS.LOW;
    }

    return fallback;
}

export function priorityRank(priority) {
    const label = priorityLabel(priority);

    if (label === PRIORITY_LABELS.HIGH) {
        return 0;
    }

    if (label === PRIORITY_LABELS.MEDIUM) {
        return 1;
    }

    return 2;
}
