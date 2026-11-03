const pageScriptUrl = document.currentScript.src;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await import(new URL('../core/session.js', pageScriptUrl));
    const user = await session.requireRole('ADMINISTRADOR');
    if (!user) return;
    document.querySelectorAll('[id$="Navbar"]').forEach(node => { node.textContent = `${user.nombre} ${user.apellido}`; });
    try {
        if (document.querySelector('form[data-form$="-profile"]')) {
            const { initAccountProfile } = await import(new URL('../features/auth/auth-ui.js', pageScriptUrl));
            initAccountProfile(); return;
        }
        if (document.getElementById('adminGestionUsuariosTabla')) {
            const { initUserManagement } = await import(new URL('../features/users/users-ui.js', pageScriptUrl));
            await initUserManagement(); return;
        }
        const metrics = await import(new URL('../features/metrics/metrics-ui.js', pageScriptUrl));
        if (document.getElementById('adminMetricasFiltros')) await metrics.initAdminMetrics();
        else await metrics.initAdminDashboardMetrics();
    } catch (error) {
        const { errorMessage } = await import(new URL('../core/api.js', pageScriptUrl));
        session.pageMessage(errorMessage(error), 'danger');
    }
});
