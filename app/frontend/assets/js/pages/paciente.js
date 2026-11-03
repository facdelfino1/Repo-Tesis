const pageScriptUrl = document.currentScript.src;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await import(new URL('../core/session.js', pageScriptUrl));
    const user = await session.requireRole('PACIENTE');
    if (!user) return;
    document.querySelectorAll('[id$="Navbar"]').forEach(node => { node.textContent = `${user.nombre} ${user.apellido}`; });
    try {
        if (document.querySelector('form[data-form$="-profile"]')) {
            const { initAccountProfile } = await import(new URL('../features/auth/auth-ui.js', pageScriptUrl));
            initAccountProfile(); return;
        }
        const patient = await import(new URL('../features/appointments/patient-ui.js', pageScriptUrl));
        if (document.querySelector('[data-form="appointment-request"]')) await patient.initPatientRequest();
        else if (document.getElementById('turnosReservadosLista')) await patient.initPatientTurns();
        else if (document.getElementById('turnoReservadoDetalle')) await patient.initPatientConfirmation();
        else if (document.getElementById('historialTurnos')) await patient.initPatientDashboard();
    } catch (error) {
        const { errorMessage } = await import(new URL('../core/api.js', pageScriptUrl));
        session.pageMessage(errorMessage(error), 'danger');
    }
});
