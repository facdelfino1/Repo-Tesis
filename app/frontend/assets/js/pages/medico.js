const pageScriptUrl = document.currentScript.src;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await import(new URL('../core/session.js', pageScriptUrl));
    const user = await session.requireRole('MEDICO');
    if (!user) return;
    document.querySelectorAll('[id$="Navbar"]').forEach(node => { node.textContent = `${user.nombre} ${user.apellido}`; });
    try {
        if (document.querySelector('form[data-form$="-profile"]')) {
            const { initAccountProfile } = await import(new URL('../features/auth/auth-ui.js', pageScriptUrl));
            initAccountProfile(); return;
        }
        if (document.querySelector('[data-form$="-mass-reschedule"]')) {
            const { initManagerRescheduling } = await import(new URL('../features/rescheduling/rescheduling-ui.js', pageScriptUrl));
            await initManagerRescheduling(); return;
        }
        if (document.querySelector('[data-form$="-availability"]')) {
            const availability = await import(new URL('../features/availability/availability-ui.js', pageScriptUrl));
            await availability.initDoctorAvailability(); return;
        }
        if (location.pathname.endsWith('/finalizar-consulta.html')) {
            session.pageMessage('El cierre corresponde al M\u00e9dico. Consulte el estado real en Gesti\u00f3n de turnos.', 'info');
            document.querySelectorAll('main input, main select, main button').forEach(node => { node.disabled = true; }); return;
        }
        const { initOperationalAgenda } = await import(new URL('../features/appointments/agenda-ui.js', pageScriptUrl));
        await initOperationalAgenda(document.getElementById('medicoAgendaDia') ? 'dashboard' : 'agenda');
    } catch (error) {
        const { errorMessage } = await import(new URL('../core/api.js', pageScriptUrl));
        session.pageMessage(errorMessage(error), 'danger');
    }
});
