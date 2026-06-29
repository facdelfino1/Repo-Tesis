export function buildTurnDateTime(turn, timeField) {
    const timeValue = turn[timeField];

    if (!turn.fecha || !timeValue) {
        return null;
    }

    return `${turn.fecha}T${timeValue}:00`;
}

export function calculateTimeDifferenceMinutes(startValue, endValue) {
    if (!startValue || !endValue) {
        return null;
    }

    const startDate = new Date(startValue);
    const endDate = new Date(endValue);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return null;
    }

    return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
}

export function calculateAverageMinutes(values) {
    const usableValues = values.filter((value) => Number.isFinite(value));

    if (usableValues.length === 0) {
        return null;
    }

    return Math.round(usableValues.reduce((sum, value) => sum + value, 0) / usableValues.length);
}

export function getMostFrequentLabel(counts) {
    const entries = Object.entries(counts);

    if (entries.length === 0) {
        return "-";
    }

    return entries.sort((a, b) => b[1] - a[1])[0][0];
}

export function countBy(items, labelFactory) {
    return items.reduce((counts, item) => {
        const label = labelFactory(item);
        counts[label] = (counts[label] || 0) + 1;
        return counts;
    }, {});
}

export function enrichTurnsForMetrics(turns, triages, users, helpers) {
    const { doctorById, priorityLabel, triajeByTurnId } = helpers;

    return turns.map((turn) => {
        const triage = triajeByTurnId(triages, turn.id_turno);
        const doctor = doctorById(users, turn.id_medico);

        return {
            ...turn,
            prioridad: priorityLabel(turn.prioridad || (triage ? triage.prioridad : "")),
            color_prioridad: turn.color_prioridad || (triage ? triage.color_prioridad : ""),
            puntaje_triaje: turn.puntaje_triaje ?? (triage ? triage.puntaje : ""),
            especialidad: turn.especialidad || (doctor ? doctor.especialidad : ""),
            espera_minutos: calculateTimeDifferenceMinutes(
                turn.fecha_hora_arribo || turn.fecha_arribo || turn.hora_arribo && buildTurnDateTime(turn, "hora_arribo"),
                turn.fecha_hora_inicio || turn.fecha_inicio_atencion || turn.hora_inicio_atencion && buildTurnDateTime(turn, "hora_inicio_atencion")
            ),
            atencion_minutos: calculateTimeDifferenceMinutes(
                turn.fecha_hora_inicio || turn.fecha_inicio_atencion || turn.hora_inicio_atencion && buildTurnDateTime(turn, "hora_inicio_atencion"),
                turn.fecha_hora_cierre || turn.fecha_cierre || turn.hora_cierre && buildTurnDateTime(turn, "hora_cierre")
            )
        };
    });
}

export function filterTurnsByMetrics(turns, filters, helpers) {
    const { doctorById, normalizeState, users } = helpers;

    return turns.filter((turn) => {
        const doctor = doctorById(users, turn.id_medico);
        const matchesFrom = !filters.from || turn.fecha >= filters.from;
        const matchesTo = !filters.to || turn.fecha <= filters.to;
        const matchesDoctor = !filters.doctor || String(turn.id_medico) === filters.doctor;
        const matchesSpecialty = !filters.specialty || (doctor && doctor.especialidad === filters.specialty);
        const matchesState = !filters.state || normalizeState(turn.estado) === normalizeState(filters.state);

        return matchesFrom && matchesTo && matchesDoctor && matchesSpecialty && matchesState;
    });
}

export function calculatePriorityDistribution(turns, priorityLabel) {
    const counts = countBy(turns, (turn) => priorityLabel(turn.prioridad));

    return [
        { label: "Baja", count: counts.Baja || 0, color: "#198754" },
        { label: "Media", count: counts.Media || 0, color: "#ffc107" },
        { label: "Alta", count: counts.Alta || 0, color: "#dc3545" }
    ];
}

export function calculateStateDistribution(turns, states, normalizeState) {
    const counts = countBy(turns, (turn) => turn.estado || "-");

    return states.map((state) => ({
        label: state,
        count: Object.entries(counts).reduce((total, [key, value]) => (
            normalizeState(key) === normalizeState(state) ? total + value : total
        ), 0)
    }));
}

export function calculateDoctorMetrics(turns, doctors, helpers) {
    const { normalizeState, priorityLabel } = helpers;

    return doctors.map((doctor) => {
        const doctorTurns = turns.filter((turn) => String(turn.id_medico) === String(doctor.id_medico));
        const priorityCounts = countBy(doctorTurns, (turn) => priorityLabel(turn.prioridad));

        return {
            doctor,
            total: doctorTurns.length,
            completed: doctorTurns.filter((turn) => normalizeState(turn.estado) === "completado").length,
            canceled: doctorTurns.filter((turn) => normalizeState(turn.estado) === "cancelado").length,
            absent: doctorTurns.filter((turn) => normalizeState(turn.estado) === "ausente").length,
            averageAttentionMinutes: calculateAverageMinutes(doctorTurns.map((turn) => turn.atencion_minutos)),
            priorityCounts
        };
    });
}

export function calculateMetricsSummary(turns, helpers) {
    const { normalizeState, priorityLabel } = helpers;
    const priorityCounts = countBy(turns, (turn) => priorityLabel(turn.prioridad));
    const absentCount = turns.filter((turn) => normalizeState(turn.estado) === "ausente").length;

    return {
        totalTurns: turns.length,
        completed: turns.filter((turn) => normalizeState(turn.estado) === "completado").length,
        canceled: turns.filter((turn) => normalizeState(turn.estado) === "cancelado").length,
        absent: absentCount,
        averageWaitMinutes: calculateAverageMinutes(turns.map((turn) => turn.espera_minutos)),
        averageAttentionMinutes: calculateAverageMinutes(turns.map((turn) => turn.atencion_minutos)),
        mostFrequentPriority: getMostFrequentLabel(priorityCounts),
        absenteeismRate: turns.length ? Math.round((absentCount / turns.length) * 100) : 0,
        priorityCounts
    };
}

export function calculateAdminDashboardMetrics(users, turns, triages, helpers) {
    const { normalizeState, priorityLabel, roleMatches, today, triajeByTurnId } = helpers;
    const turnsWithPriority = turns.map((turn) => {
        const triage = triajeByTurnId(triages, turn.id_turno);

        return {
            ...turn,
            prioridad: priorityLabel(turn.prioridad || (triage ? triage.prioridad : "")),
            color_prioridad: turn.color_prioridad || (triage ? triage.color_prioridad : "")
        };
    });
    const reschedules = turnsWithPriority.filter((turn) => (
        normalizeState(turn.estado) === "cancelado"
        || (turn.reprogramado && normalizeState(turn.estado) !== "completado")
    )).length;

    return {
        totalUsers: users.length,
        totalPatients: users.filter((user) => roleMatches(user, "paciente")).length,
        totalDoctors: users.filter((user) => roleMatches(user, "medico")).length,
        totalSecretaries: users.filter((user) => roleMatches(user, "secretaria")).length,
        todayTurns: turnsWithPriority.filter((turn) => turn.fecha === today).length,
        presentTurns: turnsWithPriority.filter((turn) => normalizeState(turn.estado) === "presente").length,
        activeAttentionTurns: turnsWithPriority.filter((turn) => normalizeState(turn.estado) === "en atencion").length,
        pendingReschedules: reschedules
    };
}
