const pageScriptUrl = document.currentScript.src;
const featureModuleBaseUrl = new URL("../features/", document.currentScript.src).href;

document.addEventListener("DOMContentLoaded", async () => {
    const session = await import(new URL('../core/session.js', pageScriptUrl));
    const realUser = await session.requireRole('ADMINISTRADOR');
    if (!realUser) return;
    document.querySelectorAll('[id$="Navbar"]').forEach(node => { node.textContent = realUser.nombre + ' ' + realUser.apellido; });
    if (document.querySelector('form[data-form$="-profile"]')) {
        const { initAccountProfile } = await import(new URL('../features/auth/auth-ui.js',pageScriptUrl));
        initAccountProfile(); return;
    }
    try {
        const availability = await import(new URL('../features/availability/availability-ui.js',pageScriptUrl));
        if (document.querySelector('[data-form="doctor-availability"]')) { await availability.initDoctorAvailability(); return; }
        if (document.querySelector('[data-form="secretary-availability"]')) { await availability.initSecretaryAvailability(); return; }
        if (document.querySelector('[data-form="appointment-request"]')) { await availability.initPatientAvailabilityBrowser(); return; }
    } catch (error) {
        const { errorMessage } = await import(new URL('../core/api.js',pageScriptUrl));
        session.pageMessage(errorMessage(error),'danger'); return;
    }
    session.protectLegacyOperations();
    try {

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
    // Account administration is integrated in a later block; no local credentials.
    if (document.getElementById("usuariosTabla")) session.pageMessage("La gestion de cuentas todavia no esta habilitada en esta pantalla.");
    initAdminMetrics();
    initAdminProfile({ fallbackData, setText });
    } catch (error) {
        const { errorMessage } = await import(new URL('../core/api.js',pageScriptUrl));
        session.pageMessage(errorMessage(error),'danger');
    }
});
