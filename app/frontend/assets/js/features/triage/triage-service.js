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
