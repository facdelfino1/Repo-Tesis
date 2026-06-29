export function priorityClass(priority, variant = "text") {
    const normalizedPriority = String(priority || "").toLowerCase();

    if (normalizedPriority === "alta" || normalizedPriority === "rojo") {
        return variant === "background" ? "bg-danger" : "text-bg-danger";
    }

    if (normalizedPriority === "media" || normalizedPriority === "amarillo") {
        return variant === "background" ? "bg-warning" : "text-bg-warning";
    }

    return variant === "background" ? "bg-success" : "text-bg-success";
}

export function borderPriorityClass(priorityColor) {
    const normalizedPriority = String(priorityColor || "").toLowerCase();

    if (normalizedPriority === "rojo") {
        return "triage-result-danger";
    }

    if (normalizedPriority === "amarillo") {
        return "triage-result-warning";
    }

    return "triage-result-success";
}

export function stateText(state, escapeHtml = null) {
    const value = state || "-";
    const safeValue = typeof escapeHtml === "function" ? escapeHtml(value) : value;
    return `<strong class="fw-semibold">${safeValue}</strong>`;
}

export function renderPriorityBadge(priority, options = {}) {
    const variant = options.variant || "text";
    const className = options.className || "badge";
    return `<span class="${className} ${priorityClass(priority, variant)}">${priority}</span>`;
}

export function renderStateText(state, escapeHtml = null) {
    return stateText(state, escapeHtml);
}
