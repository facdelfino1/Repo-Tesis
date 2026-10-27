import { escapeHtml } from "../../core/helpers.js";
import { priorityClass } from "../../components/badges.js";

export function getRadioValue(form, name) {
    const checkedOption = form.querySelector(`input[name="${name}"]:checked`);
    return checkedOption ? checkedOption.value : "";
}

export function readAnswers(form, especialidad) {
    const boolean = name => { const value = getRadioValue(form, name); return value === "si" ? true : value === "no" ? false : undefined; };
    const number = name => { const value = form.elements.namedItem(name).value; return value.trim() === "" ? NaN : Number(value); };
    const fiebre = boolean("fiebre");
    return { especialidad, respuestas: especialidad === "clinica_medica" ? {
        fiebre, dificultadRespirar: boolean("dificultadRespirar"), dolor: number("rangoDolor")
    } : {
        fechaNacimiento: form.elements.namedItem("fechaNacimiento").value, fiebre,
        duracionFiebreHoras: fiebre === false ? null : number("duracionFiebreHoras"),
        dificultadRespirar: boolean("dificultadRespirar"), muyAgitado: boolean("muyAgitado"),
        estadoGeneral: form.elements.namedItem("estadoGeneral").value, vomitosRepetidos: boolean("vomitosRepetidos")
    } };
}

export function updateTriageQuestionnaire(form, especialidad) {
    const supported = ["clinica_medica", "pediatria"].includes(especialidad);
    form.querySelectorAll("[data-triage-specialty]").forEach(section => {
        const active = section.dataset.triageSpecialty === "common" ? supported : section.dataset.triageSpecialty === especialidad;
        section.classList.toggle("d-none", !active);
        section.querySelectorAll("input, select").forEach(control => { control.disabled = !active; });
    });
    const duration = form.elements.namedItem("duracionFiebreHoras");
    duration.disabled = especialidad !== "pediatria" || getRadioValue(form, "fiebre") !== "si";
    duration.required = !duration.disabled;
    form.querySelector("#sinTriajeEspecifico").classList.toggle("d-none", supported || !especialidad);
}

export function renderTriageErrors(element, errors) {
    element.textContent = Object.values(errors).join(" ");
    element.classList.toggle("d-none", Object.keys(errors).length === 0);
}

export function readRadioValue(name) {
    const selected = document.querySelector(`input[name="${name}"]:checked`);
    return selected ? selected.value : "";
}

export function renderResult(prioridad, { resultBox, resultColor }) {
    resultBox.classList.remove("d-none", "triage-result-success", "triage-result-warning", "triage-result-danger");
    resultBox.classList.add("triage-result-" + (prioridad === "Alta" ? "danger" : prioridad === "Media" ? "warning" : "success"));
    resultColor.textContent = prioridad;
    resultColor.className = "badge " + priorityClass(prioridad);
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
