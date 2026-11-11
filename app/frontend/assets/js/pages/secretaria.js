const pageScriptUrl = document.currentScript.src;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await import(new URL('../core/session.js', pageScriptUrl));
    const user = await session.requireRole('SECRETARIA');
    if (!user) return;
    document.querySelectorAll('[id$="Navbar"]').forEach(node => { node.textContent = `${user.nombre} ${user.apellido}`; });
    try {
        if (document.querySelector('form[data-form$="-profile"]')) {
            const { initAccountProfile } = await import(new URL('../features/auth/auth-ui.js', pageScriptUrl));
            initAccountProfile(); return;
        }
        if (document.querySelector('[data-form$="-mass-reschedule"]')) {
            const { initManagerRescheduling } = await import(new URL('../features/rescheduling/rescheduling-ui.js?v=b84-stage7-2', pageScriptUrl));
            await initManagerRescheduling(); return;
        }
        if (document.querySelector('[data-form$="-availability"]')) {
            const availability = await import(new URL('../features/availability/availability-ui.js?v=b84-obs09-2', pageScriptUrl));
            await availability.initSecretaryAvailability(); return;
        }
        if (location.pathname.endsWith('/finalizar-consulta.html')) {
            const { initConsultationClosure } = await import(new URL('../features/appointments/consultation-closure-ui.js', pageScriptUrl));
            await initConsultationClosure(); return;
        }
        const { initOperationalAgenda } = await import(new URL('../features/appointments/agenda-ui.js', pageScriptUrl));
        await initOperationalAgenda(document.getElementById('secretariaAgendaDia') ? 'dashboard' : document.getElementById('presenciaTabla') ? 'presence' : 'management');
    } catch (error) {
        const { errorMessage } = await import(new URL('../core/api.js', pageScriptUrl));
        session.pageMessage(errorMessage(error), 'danger');
    }
});
