import { renderEmptyState } from "./alerts.js";

export function clearTableBody(tableBody) {
    if (tableBody) {
        tableBody.innerHTML = "";
    }
}

export function renderTableEmptyRow(colspan, text, className = "text-secondary") {
    return renderEmptyState(text, {
        tagName: "tr",
        colspan,
        className
    });
}
