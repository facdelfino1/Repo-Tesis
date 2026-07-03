import { escapeHtml } from "../../core/helpers.js";
import { borderPriorityClass, priorityClass } from "../../components/badges.js";

export function getRadioValue(form, name) {
    const checkedOption = form.querySelector(`input[name="${name}"]:checked`);
    return checkedOption ? checkedOption.value : "";
}

export function readAnswers(form, rangoDolor) {
    const painValue = Number.parseInt(rangoDolor.value, 10);

    return {
        fiebre: getRadioValue(form, "fiebre"),
        dolorIntenso: getRadioValue(form, "dolorIntenso"),
        dificultadRespirar: getRadioValue(form, "dificultadRespirar"),
        rangoDolor: painValue
    };
}

export function readRadioValue(name) {
    const selected = document.querySelector(`input[name="${name}"]:checked`);
    return selected ? selected.value : "";
}

export function renderResult(result, elements) {
    const { resultBox, resultColor, setText } = elements;

    resultBox.classList.remove("d-none", "triage-result-success", "triage-result-warning", "triage-result-danger");
    resultBox.classList.add(borderPriorityClass(result.color));

    resultColor.textContent = result.color;
    resultColor.className = `badge ${priorityClass(result.color)}`;
    setText("resultadoPuntaje", result.puntaje);
    setText("resultadoDuracion", result.duracionTurno);
}

export function renderTriageResponses(responses) {
    if (!responses || typeof responses !== "object") {
        return "<p class=\"text-secondary mb-0\">Sin respuestas registradas.</p>";
    }

    return `
        <ul class="mb-0">
            ${Object.entries(responses).map(([key, value]) => `
                <li><span class="text-secondary">${escapeHtml(key.replace(/_/g, " "))}:</span> ${escapeHtml(value)}</li>
            `).join("")}
        </ul>
    `;
}
