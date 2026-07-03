const featureModuleBaseUrl = new URL("../features/", document.currentScript.src).href;

document.addEventListener("DOMContentLoaded", async () => {
    const fallbackData = {
        usuarios: {
            usuarios: []
        },
        turnos: {
            turnos: []
        },
        triaje: {
            triajes: []
        },
        disponibilidad: []
    };

    const [
        { initAdminDashboardMetrics, initAdminMetrics: initAdminMetricsFeature },
        { mergeStoredTurns, turnosList },
        { triajeByTurnId },
        { fullName, mergeStoredUsers, roleMatches },
        { initAdminProfile, initUserManagement }
    ] = await Promise.all([
        import(`${featureModuleBaseUrl}metrics/metrics-ui.js`),
        import(`${featureModuleBaseUrl}appointments/appointments-service.js`),
        import(`${featureModuleBaseUrl}triage/triage-service.js`),
        import(`${featureModuleBaseUrl}users/users-service.js`),
        import(`${featureModuleBaseUrl}users/users-ui.js`)
    ]);

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
    }

    function doctorById(users, idMedico) {
        return users.find((user) => String(user.id_medico) === String(idMedico)) || null;
    }

    function initAdminDashboard() {
        initAdminDashboardMetrics({
            fallbackData,
            fullName,
            mergeStoredTurns,
            mergeStoredUsers,
            roleMatches,
            setText,
            triajeByTurnId,
            turnosList
        });
    }

    function initAdminMetrics() {
        initAdminMetricsFeature({
            fallbackData,
            doctorById,
            fullName,
            mergeStoredTurns,
            mergeStoredUsers,
            roleMatches,
            setText,
            triajeByTurnId,
            turnosList
        });
    }

    initAdminDashboard();
    initUserManagement({ fallbackData, setText });
    initAdminMetrics();
    initAdminProfile({ fallbackData, setText });
});
