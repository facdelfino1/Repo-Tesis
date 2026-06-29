export function showAlert(messageElement, type, text, options = {}) {
    if (!messageElement) {
        return;
    }

    messageElement.className = `alert alert-${type}`;
    messageElement.textContent = text;
    messageElement.classList.remove("d-none");

    if (options.scrollIntoView === true) {
        messageElement.scrollIntoView({
            behavior: options.scrollBehavior || "smooth",
            block: options.scrollBlock || "nearest"
        });
    }
}

export function hideAlert(messageElement) {
    if (!messageElement) {
        return;
    }

    messageElement.classList.add("d-none");
}

export function renderEmptyState(text, options = {}) {
    const tagName = options.tagName || "div";
    const className = options.className || "text-secondary";

    if (tagName === "tr") {
        const colspan = options.colspan || 1;
        return `<tr><td colspan="${colspan}" class="${className}">${text}</td></tr>`;
    }

    return `<${tagName} class="${className}">${text}</${tagName}>`;
}
