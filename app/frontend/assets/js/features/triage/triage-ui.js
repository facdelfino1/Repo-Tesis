import { escapeHtml } from "../../core/helpers.js";
import { priorityClass } from "../../components/badges.js";
import { validateTriageInput } from "./triage-service.js";

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
    form.querySelector("#sinTriajeEspecifico, [data-no-triage]")?.classList.toggle("d-none", supported || !especialidad);
}

// La validación clínica sigue siendo estricta; durante edición solo presentamos
// errores de respuestas ingresadas, no de preguntas todavía pendientes.
export function triageFormErrors(form, especialidad, { submitted = false } = {}) {
    const input = readAnswers(form, especialidad);
    const errors = validateTriageInput(input).errors;
    const controls = { dolor: "rangoDolor", fechaNacimiento: "fechaNacimiento",
        duracionFiebreHoras: "duracionFiebreHoras", estadoGeneral: "estadoGeneral" };
    let incomplete = false;
    const visible = {};
    Object.entries(errors).forEach(([field, message]) => {
        const control = controls[field] && form.elements.namedItem(controls[field]);
        const missing = control ? control.value.trim() === "" && !control.validity?.badInput
            : input.respuestas[field] === undefined;
        if (missing) incomplete = true;
        else visible[field] = message;
    });
    return submitted && incomplete
        ? { incomplete: "Complete todas las preguntas del cuestionario.", ...visible } : visible;
}

export function renderTriageErrors(element, errors) {
    const messages = { fiebre: "Indique Sí o No en todas las preguntas.",
        dificultadRespirar: "Indique Sí o No en todas las preguntas.", muyAgitado: "Indique Sí o No en todas las preguntas.",
        vomitosRepetidos: "Indique Sí o No en todas las preguntas.", dolor: "Indique un valor entero de dolor entre 0 y 10.",
        fechaNacimiento: "Ingrese una fecha de nacimiento válida, no futura.",
        duracionFiebreHoras: "Indique la duración de la fiebre en horas, mayor o igual a cero.",
        estadoGeneral: "Seleccione el estado general del paciente." };
    element.textContent = [...new Set(Object.entries(errors).map(([field, message]) => messages[field] || message))].join(" ");
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

export function renderTriageResponses(responses, specialty) {
    if (!responses || typeof responses !== "object") {
        return "<p class=\"text-secondary mb-0\">Sin respuestas registradas.</p>";
    }

    const fields = specialty === "pediatria" ? {
        fechaNacimiento: "Fecha de nacimiento", fiebre: "Fiebre", duracionFiebreHoras: "Duración de fiebre (horas)",
        dificultadRespirar: "Dificultad respiratoria", muyAgitado: "Muy agitado", estadoGeneral: "Estado general",
        vomitosRepetidos: "Vómitos repetidos"
    } : { fiebre: "Fiebre", dificultadRespirar: "Dificultad respiratoria", dolor: "Dolor (0–10)" };
    const aliases = { dificultadRespirar: "dificultad_respiratoria", dolor: "rango_dolor" };
    const states = { alerta_normal: "Alerta / normal", decaido_responde_normalmente: "Decaído, responde normalmente",
        letargico_muy_somnoliento: "Letárgico / muy somnoliento", pobre_respuesta_estimulos: "Pobre respuesta a estímulos",
        dificultad_despertar: "Dificultad para despertar" };
    return `
        <ul class="mb-0">
            ${Object.entries(fields).map(([key, label]) => {
                const value = responses[key] ?? responses[aliases[key]];
                const display = value === true || value === "si" ? "Sí" : value === false || value === "no" ? "No"
                    : states[value] ?? value ?? "—";
                return `<li><span class="text-secondary">${escapeHtml(label)}:</span> ${escapeHtml(String(display))}</li>`;
            }).join("")}
        </ul>
    `;
}
