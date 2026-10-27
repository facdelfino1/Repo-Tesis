// Priorizacion preliminar ambulatoria de sintomas autoinformados.
// No constituye diagnostico ni reemplaza una evaluacion medica.
// Contrato: { especialidad: "clinica_medica" | "pediatria", respuestas: {...} }.
// fechaEvaluacion admite Date o una fecha calendario YYYY-MM-DD (por defecto, hoy).
function triageCalendarDate(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(Date.UTC(
            value.getFullYear(), value.getMonth(), value.getDate()
        ));
    }

    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }

    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function isUnderThreeMonths(birthDate, evaluationDate) {
    // Cumplimiento de meses calendario, limitado al ultimo dia del mes destino.
    const targetMonth = birthDate.getUTCMonth() + 3;
    const lastDay = new Date(Date.UTC(birthDate.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
    const anniversary = new Date(Date.UTC(
        birthDate.getUTCFullYear(), targetMonth, Math.min(birthDate.getUTCDate(), lastDay)
    ));
    return evaluationDate < anniversary;
}

export function validateTriageInput(input, fechaEvaluacion = new Date()) {
    const errors = {};
    const evaluationDate = triageCalendarDate(fechaEvaluacion);

    if (!evaluationDate) {
        errors.fechaEvaluacion = "Ingrese una fecha de evaluacion valida.";
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { valid: false, errors: { ...errors, input: "Ingrese especialidad y respuestas." } };
    }

    if (!["clinica_medica", "pediatria"].includes(input.especialidad)) {
        errors.especialidad = "Especialidad no soportada.";
    }

    const answers = input.respuestas;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        return { valid: false, errors: { ...errors, respuestas: "Complete las respuestas del triaje." } };
    }

    const booleanFields = ["fiebre", "dificultadRespirar"];
    if (input.especialidad === "pediatria") {
        booleanFields.push("muyAgitado", "vomitosRepetidos");
    }
    booleanFields.forEach((field) => {
        if (typeof answers[field] !== "boolean") {
            errors[field] = "Indique Si o No mediante un valor booleano.";
        }
    });

    if (input.especialidad === "clinica_medica") {
        if (!Number.isInteger(answers.dolor) || answers.dolor < 0 || answers.dolor > 10) {
            errors.dolor = "Ingrese un dolor entero entre 0 y 10.";
        }
    }

    if (input.especialidad === "pediatria") {
        const birthDate = triageCalendarDate(answers.fechaNacimiento);
        if (typeof answers.fechaNacimiento !== "string" || !birthDate || (evaluationDate && birthDate > evaluationDate)) {
            errors.fechaNacimiento = "Ingrese una fecha de nacimiento valida, no futura.";
        }

        if (answers.fiebre === true && (!Number.isFinite(answers.duracionFiebreHoras) || answers.duracionFiebreHoras < 0)) {
            errors.duracionFiebreHoras = "Ingrese la duracion de la fiebre en horas, mayor o igual a cero.";
        } else if (answers.fiebre === false && answers.duracionFiebreHoras !== null) {
            errors.duracionFiebreHoras = "Sin fiebre, la duracion debe ser null.";
        }

        if (![
            "alerta_normal",
            "decaido_responde_normalmente",
            "letargico_muy_somnoliento",
            "pobre_respuesta_estimulos",
            "dificultad_despertar"
        ].includes(answers.estadoGeneral)) {
            errors.estadoGeneral = "Seleccione un estado general valido.";
        }
    }

    return { valid: Object.keys(errors).length === 0, errors };
}

function calculateClinicalMedicinePriority(answers) {
    if (answers.dificultadRespirar || answers.dolor >= 7) { // CM-01, CM-02
        return "Alta";
    }
    if (answers.fiebre || (answers.dolor >= 4 && answers.dolor <= 6)) { // CM-03, CM-04
        return "Media";
    }
    return "Baja"; // CM-05: entradas completas y validadas.
}

function calculatePediatricPriority(answers, evaluationDate) {
    if ((answers.fiebre && isUnderThreeMonths(triageCalendarDate(answers.fechaNacimiento), evaluationDate)) // PED-01
        || answers.dificultadRespirar || answers.muyAgitado // PED-02
        || ["pobre_respuesta_estimulos", "dificultad_despertar", "letargico_muy_somnoliento"].includes(answers.estadoGeneral)) { // PED-03, PED-04
        return "Alta";
    }
    if (answers.fiebre && answers.duracionFiebreHoras > 48) { // PED-05
        return "Media";
    }
    if (answers.estadoGeneral === "decaido_responde_normalmente" || answers.vomitosRepetidos) { // PED-06, PED-07
        return "Media";
    }
    if (answers.fiebre && answers.duracionFiebreHoras <= 48) { // PED-08
        return "Media";
    }
    return "Baja"; // PED-09: entradas completas y validadas, sin Alta ni Media.
}
 // Valida si ingresan los datos de triaje para calcular la priorización.
export function calculateTriagePriority(input, fechaEvaluacion = new Date()) {
    const validation = validateTriageInput(input, fechaEvaluacion);
    if (!validation.valid) {
        throw new TypeError(`Datos de triaje invalidos: ${Object.keys(validation.errors).join(", ")}.`);
    }
 // if ? else : operadores ternarios
    return input.especialidad === "clinica_medica"
        ? calculateClinicalMedicinePriority(input.respuestas)
        : calculatePediatricPriority(input.respuestas, triageCalendarDate(fechaEvaluacion));
}

export function calculateTriageScore({ fiebre, dolorIntenso, dificultadRespirar, rangoDolor }) {
    let score = 0;

    if (fiebre === "si") {
        score += 1;
    }

    if (dolorIntenso === "si") {
        score += 3;
    }

    if (dificultadRespirar === "si") {
        score += 8;
    }

    if (rangoDolor >= 0 && rangoDolor <= 3) {
        score += 2;
    } else if (rangoDolor >= 4 && rangoDolor <= 6) {
        score += 4;
    } else if (rangoDolor >= 7 && rangoDolor <= 10) {
        score += 6;
    }

    return score;
}

export function triagePriorityByScore(score) {
    if (score <= 3) {
        return {
            priority: "Baja",
            color: "Verde",
            duration: 20
        };
    }

    if (score <= 7) {
        return {
            priority: "Media",
            color: "Amarillo",
            duration: 30
        };
    }

    return {
        priority: "Alta",
        color: "Rojo",
        duration: 40
    };
}

export function normalizeSecretaryTriageAnswers(answers) {
    return {
        fiebre: answers.fiebre,
        dolorIntenso: answers.dolor_intenso,
        dificultadRespirar: answers.dificultad_respiratoria,
        rangoDolor: answers.rango_dolor
    };
}

export function calculatePatientTriage({ fiebre, dolorIntenso, dificultadRespirar, rangoDolor }) {
    const score = calculateTriageScore({
        fiebre,
        dolorIntenso,
        dificultadRespirar,
        rangoDolor
    });
    const result = triagePriorityByScore(score);

    return {
        color: result.color,
        puntaje: score,
        duracionTurno: result.duration
    };
}

export function calculateSecretaryTriage(answers) {
    const score = calculateTriageScore(normalizeSecretaryTriageAnswers(answers));
    const result = triagePriorityByScore(score);

    return {
        answers,
        score,
        priority: result.priority,
        color: result.color,
        duration: result.duration
    };
}

export function isTriageComplete(answers) {
    return answers.fiebre !== ""
        && answers.dolorIntenso !== ""
        && answers.dificultadRespirar !== ""
        && Number.isInteger(answers.rangoDolor)
        && answers.rangoDolor >= 0
        && answers.rangoDolor <= 10;
}

export function triajesList(triaje) {
    return Array.isArray(triaje.triajes) ? triaje.triajes : [];
}

export function latestTriageForPatient(triaje, turnos, patientId, turnosList) {
    const patientTurnIds = turnosList(turnos)
        .filter((turn) => turn.id_paciente === patientId)
        .map((turn) => turn.id_turno);

    return triajesList(triaje)
        .filter((item) => item.id_paciente === patientId || patientTurnIds.includes(item.id_turno))
        .sort((a, b) => new Date(`${b.fecha}T00:00:00`) - new Date(`${a.fecha}T00:00:00`))[0] || triaje.ultimoTriaje;
}

export function triajeByTurnId(triajes, idTurno) {
    return triajes.find((triaje) => String(triaje.id_turno) === String(idTurno)) || null;
}

export function getTriage(triages, turn) {
    return triages.find((item) => String(item.id_triaje) === String(turn.id_triaje)
        || String(item.id_turno) === String(turn.id_turno)) || null;
}
