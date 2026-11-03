// Same-origin deployment: frontend and /api/ are served by the same host.
let csrfToken = null;
let csrfRequest = null;

export class ApiError extends Error {
    constructor(status, data, message) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

export function errorMessage(error) {
    if (!(error instanceof ApiError)) return 'Ocurrió un error inesperado. Intente nuevamente.';
    if (!error.status) return 'No fue posible conectar con el servidor. Revise la conexión e intente nuevamente.';
    if (error.status >= 500) return 'El servidor no pudo completar la operación. Intente nuevamente.';
    const messages = [];
    function collect(value) {
        if (typeof value === 'string') messages.push(value);
        else if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    }
    collect(error.data);
    return [...new Set(messages)].join(' ') || ({400:'Revise los datos ingresados.',401:'Debe iniciar sesión.',
        403:'No tiene permiso para realizar esta operación.',404:'No se encontró el recurso solicitado.',
        409:'La información cambió. Actualice los datos e intente nuevamente.',429:'Demasiadas solicitudes. Intente nuevamente más tarde.'}[error.status]
        || 'No fue posible completar la operación.');
}

export function setCsrfToken(value) { csrfToken = value || null; }

export async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    if (!csrfRequest) {
        csrfRequest = request('auth/csrf/').then(data => {
            if (!data?.csrfToken) throw new ApiError(0, null, 'Respuesta CSRF inválida.');
            csrfToken = data.csrfToken;
            return csrfToken;
        }).finally(() => { csrfRequest = null; });
    }
    return csrfRequest;
}

export async function request(path, { method = 'GET', body, signal } = {}) {
    const url = new URL(path, new URL('/api/', window.location.origin));
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
        throw new TypeError('La API debe pertenecer al mismo origen y al prefijo /api/.');
    }
    const headers = { Accept: 'application/json' };
    if (!['GET','HEAD','OPTIONS'].includes(method.toUpperCase())) {
        headers['X-CSRFToken'] = await getCsrfToken();
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
        response = await fetch(url, { method, headers, credentials: 'same-origin',
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal });
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new ApiError(0, null, 'No se pudo conectar con el servidor.');
    }
    let data = null;
    if (response.status !== 204) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try { data = await response.json(); }
            catch { throw new ApiError(response.status, null, 'El servidor devolvió una respuesta inválida.'); }
        } else if (response.ok) {
            throw new ApiError(response.status, null, 'El servidor no devolvió JSON.');
        }
    }
    if (!response.ok) {
        const error = new ApiError(response.status, data, `HTTP ${response.status}`);
        error.message = errorMessage(error);
        if (error.status === 403) setCsrfToken(null);
        if ([401,403].includes(error.status)) {
            window.dispatchEvent(new CustomEvent('api-access-error', { detail: { error, path: url.pathname } }));
        }
        throw error;
    }
    return data;
}

export async function listAll(path) {
    const rows = [];
    const visited = new Set();
    let next = path;
    while (next) {
        if (visited.has(next)) throw new ApiError(0, null, 'Paginación inválida.');
        visited.add(next);
        const data = await request(next);
        if (Array.isArray(data)) return rows.concat(data);
        if (!Array.isArray(data?.results)) throw new ApiError(0, null, 'Listado inválido.');
        rows.push(...data.results);
        next = data.next;
    }
    return rows;
}
