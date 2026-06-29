import { LOCAL_STORAGE_KEYS, MOCK_PATHS } from "../../core/constants.js";
import { loadMock, readStoredJson } from "../../core/storage.js";
import { escapeHtml, normalizeState } from "../../core/helpers.js";
import { formatToday, priorityLabel, todayInputValue } from "../../core/formatters.js";
import { renderStateText } from "../../components/badges.js";
import { fillSelect } from "../../components/selects.js";
import { renderTableEmptyRow } from "../../components/tables.js";
import {
    calculateAdminDashboardMetrics,
    calculateDoctorMetrics,
    calculateMetricsSummary,
    calculatePriorityDistribution,
    calculateStateDistribution,
    enrichTurnsForMetrics,
    filterTurnsByMetrics
} from "./metrics-service.js";

function formatAverageLabel(minutes) {
    return Number.isFinite(minutes) ? `${minutes} min` : "No disponible";
}

export function renderMetricCards(summary, setText) {
    setText("metricasTotalTurnos", summary.totalTurns);
    setText("metricasCompletados", summary.completed);
    setText("metricasCancelados", summary.canceled);
    setText("metricasAusentes", summary.absent);
    setText("metricasEsperaPromedio", formatAverageLabel(summary.averageWaitMinutes));
    setText("metricasAtencionPromedio", formatAverageLabel(summary.averageAttentionMinutes));
    setText("metricasPrioridadFrecuente", summary.mostFrequentPriority);
    setText("metricasTasaAusentismo", `${summary.absenteeismRate}%`);
}

export function renderPriorityDistribution(priorityContainer, distribution, total) {
    let accumulatedPercent = 0;
    const gradientStops = total === 0
        ? "#e9ecef 0 100%"
        : distribution.map((slice) => {
            const slicePercent = (slice.count / total) * 100;
            const start = accumulatedPercent;
            const end = accumulatedPercent + slicePercent;
            accumulatedPercent = end;

            return `${slice.color} ${start}% ${end}%`;
        }).join(", ");

    priorityContainer.innerHTML = `
        <div class="metric-donut-layout">
            <div class="metric-donut" style="background: conic-gradient(${gradientStops});" aria-label="Distribucion por prioridad">
                <div class="metric-donut-center">
                    <span class="text-secondary small">Total</span>
                    <strong>${total} turnos</strong>
                </div>
            </div>
            <div class="metric-donut-legend">
                ${distribution.map((slice) => {
                    const percent = total === 0 ? 0 : Math.round((slice.count / total) * 100);

                    return `
                        <div class="metric-donut-legend-item">
                            <span class="metric-donut-dot" style="background-color: ${slice.color};"></span>
                            <span class="fw-semibold">${escapeHtml(slice.label)}</span>
                            <span class="text-secondary ms-auto">${slice.count} (${percent}%)</span>
                        </div>
                    `;
                }).join("")}
            </div>
        </div>
    `;
}

export function renderStateDistribution(stateTable, stateDistribution) {
    stateTable.innerHTML = stateDistribution.map((state) => `
        <tr>
            <td>${renderStateText(state.label, escapeHtml)}</td>
            <td class="fw-semibold">${state.count}</td>
        </tr>
    `).join("");
}

export function renderDoctorMetrics(doctorTable, doctorMetrics, helpers) {
    const { doctors, fullName } = helpers;

    if (doctors.length === 0) {
        doctorTable.innerHTML = renderTableEmptyRow(8, "No hay medicos registrados.");
        return;
    }

    doctorTable.innerHTML = doctorMetrics.map((metric) => `
        <tr>
            <td class="fw-semibold">${escapeHtml(fullName(metric.doctor))}</td>
            <td>${escapeHtml(metric.doctor.especialidad || "-")}</td>
            <td>${metric.total}</td>
            <td>${metric.completed}</td>
            <td>${metric.canceled}</td>
            <td>${metric.absent}</td>
            <td>${formatAverageLabel(metric.averageAttentionMinutes)}</td>
            <td>Alta ${metric.priorityCounts.Alta || 0} | Media ${metric.priorityCounts.Media || 0} | Baja ${metric.priorityCounts.Baja || 0}</td>
        </tr>
    `).join("");
}

export function bindMetricsFilters(fields, metricsForm, renderMetrics) {
    Object.values(fields).forEach((field) => {
        field.addEventListener("input", renderMetrics);
        field.addEventListener("change", renderMetrics);
    });

    metricsForm.addEventListener("reset", () => {
        setTimeout(renderMetrics, 0);
    });
}

export function initAdminDashboardMetrics(config) {
    const {
        fallbackData,
        fullName,
        mergeStoredTurns,
        mergeStoredUsers,
        roleMatches,
        setText,
        triajeByTurnId,
        turnosList
    } = config;
    const dashboardMetric = document.getElementById("adminMetricUsuarios");

    if (!dashboardMetric) {
        return;
    }

    Promise.all([
        loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
        loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
        loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad),
        loadMock(MOCK_PATHS.TRIAGE, fallbackData.triaje)
    ]).then(([usuariosData, turnosData, _disponibilidadData, triajeData]) => {
        const users = mergeStoredUsers(usuariosData.usuarios || []);
        const loggedUser = readStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, null);
        const accessMessage = document.getElementById("adminAccesoMensaje");

        if (!loggedUser || !roleMatches(loggedUser, "administrador")) {
            if (accessMessage) {
                accessMessage.classList.remove("d-none");
            }

            return;
        }

        const turns = mergeStoredTurns(turnosList(turnosData));
        const triages = Array.isArray(triajeData.triajes) ? triajeData.triajes : [];
        const summary = calculateAdminDashboardMetrics(users, turns, triages, {
            normalizeState,
            priorityLabel,
            roleMatches,
            today: todayInputValue(),
            triajeByTurnId
        });

        setText("adminNombreNavbar", fullName(loggedUser));
        setText("adminFechaActual", formatToday());
        setText("adminMetricUsuarios", summary.totalUsers);
        setText("adminMetricPacientes", summary.totalPatients);
        setText("adminMetricMedicos", summary.totalDoctors);
        setText("adminMetricSecretarias", summary.totalSecretaries);
        setText("adminMetricTurnosDia", summary.todayTurns);
        setText("adminMetricPresentes", summary.presentTurns);
        setText("adminMetricAtencion", summary.activeAttentionTurns);
        setText("adminMetricReprogramaciones", summary.pendingReschedules);
    });
}

export function initAdminMetrics(config) {
    const {
        fallbackData,
        doctorById,
        fullName,
        mergeStoredTurns,
        mergeStoredUsers,
        roleMatches,
        setText,
        triajeByTurnId,
        turnosList
    } = config;
    const metricsForm = document.getElementById("adminMetricasFiltros");

    if (!metricsForm) {
        return;
    }

    Promise.all([
        loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
        loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
        loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad),
        loadMock(MOCK_PATHS.TRIAGE, fallbackData.triaje)
    ]).then(([usuariosData, turnosData, _disponibilidadData, triajeData]) => {
        const loggedUser = readStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, null);
        const accessMessage = document.getElementById("adminMetricasAccesoMensaje");

        if (!loggedUser || !roleMatches(loggedUser, "administrador")) {
            if (accessMessage) {
                accessMessage.classList.remove("d-none");
            }

            return;
        }

        const users = mergeStoredUsers(usuariosData.usuarios || []);
        const doctors = users.filter((user) => roleMatches(user, "medico"));
        const triages = Array.isArray(triajeData.triajes) ? triajeData.triajes : [];
        const fields = {
            from: document.getElementById("metricasFechaDesde"),
            to: document.getElementById("metricasFechaHasta"),
            doctor: document.getElementById("metricasMedico"),
            specialty: document.getElementById("metricasEspecialidad"),
            state: document.getElementById("metricasEstado")
        };
        const priorityContainer = document.getElementById("metricasPrioridadDistribucion");
        const stateTable = document.getElementById("metricasEstadoTabla");
        const doctorTable = document.getElementById("metricasMedicosTabla");
        const turns = enrichTurnsForMetrics(
            mergeStoredTurns(turnosList(turnosData)),
            triages,
            users,
            { doctorById, priorityLabel, triajeByTurnId }
        );
        const states = ["Reservado", "Presente", "En atenciÃ³n", "Completado", "Cancelado", "Ausente"];

        function renderMetrics() {
            const visibleTurns = filterTurnsByMetrics(turns, {
                from: fields.from.value,
                to: fields.to.value,
                doctor: fields.doctor.value,
                specialty: fields.specialty.value,
                state: fields.state.value
            }, {
                doctorById,
                normalizeState,
                users
            });
            const summary = calculateMetricsSummary(visibleTurns, {
                normalizeState,
                priorityLabel
            });
            const priorityDistribution = calculatePriorityDistribution(visibleTurns, priorityLabel);
            const stateDistribution = calculateStateDistribution(visibleTurns, states, normalizeState);
            const doctorMetrics = calculateDoctorMetrics(visibleTurns, doctors, {
                normalizeState,
                priorityLabel
            });

            renderMetricCards(summary, setText);
            renderPriorityDistribution(priorityContainer, priorityDistribution, visibleTurns.length);
            renderStateDistribution(stateTable, stateDistribution);
            renderDoctorMetrics(doctorTable, doctorMetrics, { doctors, fullName });
        }

        setText("adminMetricasNavbar", fullName(loggedUser));
        fillSelect(fields.doctor, "Todos", doctors, (doctor) => String(doctor.id_medico), (doctor) => fullName(doctor));
        fillSelect(fields.specialty, "Todas", [...new Set(doctors.map((doctor) => doctor.especialidad).filter(Boolean))], (specialty) => specialty, (specialty) => specialty);
        fillSelect(fields.state, "Todos", [...new Set(turns.map((turn) => turn.estado).filter(Boolean))], (state) => state, (state) => state);
        bindMetricsFilters(fields, metricsForm, renderMetrics);
        renderMetrics();
    });
}
