import { request, setCsrfToken, ApiError, errorMessage } from './api.js';

let authenticatedUser = null;
let checking = null;
let generation = 0;
const frontendRoot = new URL('../../../', import.meta.url);
const obsoleteKeys = ['usuarioActualMock','usuariosAdminMock','perfilAdminMock','perfilMedicoMock',
    'perfilSecretariaMock','perfilPacienteMock','disponibilidadPacienteMock','disponibilidadMedicoMock','disponibilidadSecretariaMock'];

export function clearLegacyIdentity() {
    for (const key of obsoleteKeys) { try { localStorage.removeItem(key); } catch {} }
    try { sessionStorage.removeItem('disponibilidadSecretariaTemporal'); sessionStorage.removeItem('disponibilidadMedicoTemporal'); } catch {}
}
export function getCurrentUser() { return authenticatedUser; }
export function legacyUser(user = authenticatedUser) {
    if (!user) return null;
    const role = user.rol.toLowerCase();
    return { ...user, rol: role, id_usuario: user.id,
        ...(role === 'paciente' ? { id_paciente: user.perfil.id, obra_social: user.perfil.obra_social } : {}),
        ...(role === 'medico' ? { id_medico: user.perfil.id, especialidad: user.perfil.especialidad.nombre, matricula: user.perfil.matricula } : {}),
        ...(role === 'secretaria' ? { id_secretaria: user.perfil.id, legajo: user.perfil.legajo } : {}) };
}
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
    setCsrfToken(data.csrfToken);
    return refreshUser(true);
}
export async function logout() {
    try { await request('auth/logout/', {method:'POST', body:{}}); }
    catch (error) {
        if (![401,403].includes(error.status)) throw error;
        // A permission or CSRF error is not proof that logout succeeded.
        let gone = false;
        try { await refreshUser(); }
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
        if (user.rol !== role) {
            const destination = dashboardUrl(user.rol);
            if (destination) window.location.replace(destination);
            else pageMessage('Su rol no dispone de una página habilitada.', 'danger');
            return null;
        }
        installSessionNavigation();
        return user;
    } catch (error) {
        if (error instanceof ApiError && [401,403].includes(error.status)) window.location.replace(loginUrl());
        else { pageMessage(errorMessage(error), 'danger'); document.querySelectorAll('main input, main select, main button').forEach(node => { node.disabled = true; }); }
        return null;
    }
}
function installSessionNavigation() {
    document.querySelectorAll('a[href*="auth/login.html"]').forEach(link => link.addEventListener('click', async event => {
        event.preventDefault();
        try { await logout(); } catch(error) { pageMessage(errorMessage(error),'danger'); }
    }));
    window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
    window.addEventListener('api-access-error', async event => {
        if (event.detail.path === '/api/auth/me/') return;
        try { await refreshUser(); }
        catch (error) { if ([401,403].includes(error.status)) window.location.replace(loginUrl()); }
    });
}
export function protectLegacyOperations() {
    pageMessage('Esta sección conserva datos de demostración. Las operaciones de turnos aún no están habilitadas.');
    document.querySelector('main')?.addEventListener('submit', event => {
        event.preventDefault(); event.stopImmediatePropagation();
        pageMessage('Esta operación todavía no está habilitada.');
    }, true);
    document.querySelector('main')?.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button || button.dataset.bsDismiss || ['detail','toggle-password'].includes(button.dataset.action)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        pageMessage('Esta operación todavía no está habilitada.');
    }, true);
}

// UI state helpers retained for unintegrated appointment flows; never identity.
export function getSessionItem(key) { return sessionStorage.getItem(key); }
export function setSessionItem(key,value) { sessionStorage.setItem(key,value); }
export function removeSessionItem(key) { sessionStorage.removeItem(key); }
export function readSessionJson(key,fallback) { try { return JSON.parse(getSessionItem(key)) ?? fallback; } catch { return fallback; } }
export function writeSessionJson(key,value) { setSessionItem(key,JSON.stringify(value)); }
