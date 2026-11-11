// Loaded in the head, before the logout control can be used.
let logoutPending = false;

document.addEventListener('click', async event => {
    const control = event.target.closest('[data-logout]');
    if (!control) return;
    event.preventDefault();
    if (logoutPending) return;

    logoutPending = true;
    control.disabled = true;
    control.setAttribute('aria-disabled', 'true');
    try {
        const session = await import('./session.js');
        await session.logout();
    } catch (error) {
        try {
            const { errorMessage } = await import('./api.js');
            const { pageMessage } = await import('./session.js');
            pageMessage(errorMessage(error), 'danger');
        } catch {
            const box = document.createElement('div');
            box.className = 'alert alert-danger';
            box.setAttribute('role', 'alert');
            box.textContent = 'No se pudo cerrar la sesión. Intente nuevamente.';
            (document.querySelector('main') || document.body).prepend(box);
        }
        logoutPending = false;
        control.disabled = false;
        control.removeAttribute('aria-disabled');
    }
}, true);
