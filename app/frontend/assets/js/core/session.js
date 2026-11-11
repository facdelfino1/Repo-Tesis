import { request, setCsrfToken, ApiError, errorMessage } from './api.js';

let authenticatedUser = null;
let checking = null;
let generation = 0;
let logoutPromise = null;
let navigationInstalled = false;
const frontendRoot = new URL('../../../', import.meta.url);
const obsoleteKeys = ['usuarioActualMock','usuariosAdminMock','perfilAdminMock','perfilMedicoMock',
    'perfilSecretariaMock','perfilPacienteMock','disponibilidadPacienteMock','disponibilidadMedicoMock','disponibilidadSecretariaMock',
    'reprogramacionMedicoMock','reprogramacionMasivaMock','turnosPacienteMock','turnosMedicoMock',
    'turnosSecretariaMock','pacientesSecretariaMock','triajesSecretariaMock'];

export function clearLegacyIdentity() {
    for (const key of obsoleteKeys) { try { localStorage.removeItem(key); } catch {} }
    try { sessionStorage.removeItem('disponibilidadSecretariaTemporal'); sessionStorage.removeItem('disponibilidadMedicoTemporal'); sessionStorage.removeItem('solicitudTurnoPaciente'); sessionStorage.removeItem('turnoReservadoPaciente'); } catch {}
}
export function getCurrentUser() { return authenticatedUser; }
export async function refreshUser(force = false) {
    if (!checking || force) {
        const version = ++generation;
        checking = request('auth/me/').then(user => {
            if (version === generation) authenticatedUser = user;
            return user;
        }).catch(error => {
            if (version === generation && [401,403].includes(error.status)) authenticatedUser = null;
            throw error;
        }).finally(() => { if (version === generation) checking = null; });
    }
    return checking;
}

export function dashboardUrl(role) {
    const folder = { PACIENTE:'paciente', MEDICO:'medico', SECRETARIA:'secretaria', ADMINISTRADOR:'admin' }[role];
    return folder ? new URL(`pages/${folder}/dashboard.html`, frontendRoot).href : null;
}
export function loginUrl() { return new URL('pages/auth/login.html', frontendRoot).href; }
export async function login(email, password) {
    const data = await request('auth/login/', { method:'POST', body:{ email, password } });
    const user = data?.usuario;
    const roles = ['PACIENTE', 'MEDICO', 'SECRETARIA', 'ADMINISTRADOR'];
    const validId = value => Number.isSafeInteger(value) && value > 0;
    if (!user || !validId(user.id) || user.is_active !== true || !roles.includes(user.rol)
        || typeof data.csrfToken !== 'string' || !data.csrfToken.trim()
        || (user.rol === 'ADMINISTRADOR' ? user.perfil !== null : !validId(user.perfil?.id))) {
        throw new ApiError(502, null, 'Respuesta de inicio de sesión inválida.');
    }
    setCsrfToken(data.csrfToken);
    // The destination page independently verifies the server session and role.
    return user;
}
export function logout() {
    if (!logoutPromise) {
        logoutPromise = performLogout().catch(error => {
            logoutPromise = null;
            throw error;
        });
    }
    return logoutPromise;
}
async function performLogout() {
    try { await request('auth/logout/', {method:'POST', body:{}}); }
    catch (error) {
        if (![401,403].includes(error.status)) throw error;
        // A permission or CSRF error is not proof that logout succeeded.
        let gone = false;
        try { await refreshUser(true); }
        catch (probe) { if ([401,403].includes(probe.status)) gone = true; else throw probe; }
        if (!gone) throw error;
    }
    ++generation; checking = null; authenticatedUser = null;
    setCsrfToken(null);
    clearLegacyIdentity();
    window.location.assign(loginUrl());
}
export function pageMessage(text, type='warning') {
    let box = document.getElementById('apiPageMessage');
    if (!box) {
        box = document.createElement('div'); box.id = 'apiPageMessage'; box.setAttribute('role','alert');
        (document.querySelector('main') || document.body).prepend(box);
    }
    box.className = `alert alert-${type}`;
    box.textContent = text;
}
export async function requireRole(role) {
    clearLegacyIdentity();
    try {
        const user = await refreshUser();
        if (logoutPromise) return null;
        if (user.rol !== role) {
            const destination = dashboardUrl(user.rol);
            if (destination) window.location.replace(destination);
            else pageMessage('Su rol no dispone de una página habilitada.', 'danger');
            return null;
        }
        installSessionNavigation();
        return user;
    } catch (error) {
        if (logoutPromise) return null;
        if (error instanceof ApiError && [401,403].includes(error.status)) window.location.replace(loginUrl());
        else { pageMessage(errorMessage(error), 'danger'); document.querySelectorAll('main input, main select, main button').forEach(node => { node.disabled = true; }); }
        return null;
    }
}
function installSessionNavigation() {
    if (navigationInstalled) return;
    navigationInstalled = true;
    window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
    window.addEventListener('api-access-error', async event => {
        if (logoutPromise || event.detail.path === '/api/auth/me/') return;
        try { await refreshUser(); }
        catch (error) { if (!logoutPromise && [401,403].includes(error.status)) window.location.replace(loginUrl()); }
    });
}
