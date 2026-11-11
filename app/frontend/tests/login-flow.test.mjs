import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const root = new URL('../assets/js/', import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve; const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const userFor = rol => ({ id: 1, rol, is_active: true, nombre: 'Prueba', apellido: 'Local',
    email: 'test@example.test', dni: '1', telefono: '0',
    perfil: rol === 'ADMINISTRADOR' ? null : { id: 2 } });

async function setup({ rol = 'PACIENTE', payload, status = 200, networkError = false,
    pendingPost, legacy = false, existingSession = false } = {}) {
    const user = userFor(rol), calls = [], destinations = [];
    let validSession = existingSession, parsedAt = null, resetCount = 0, feedback = null;
    const button = { disabled: false, type: 'button' };
    const form = new EventTarget();
    form.checkValidity = () => true;
    form.classList = { add() {} };
    form.querySelector = selector => selector === '[data-api-feedback]' ? feedback : button;
    form.prepend = element => { feedback = element; };
    form.reset = () => { resetCount++; };
    const document = new EventTarget();
    document.querySelector = selector => selector === 'form' ? form : null;
    document.querySelectorAll = () => [];
    document.getElementById = id => ({ value: id === 'email' ? ' test@example.test ' : 'synthetic-password' });
    document.createElement = () => ({ dataset: {}, setAttribute() {} });
    const window = new EventTarget();
    window.location = { pathname: '/frontend/pages/auth/login.html', origin: 'http://localhost',
        assign: url => destinations.push({ method: 'assign', url, at: performance.now() }),
        replace: url => destinations.push({ method: 'replace', url, at: performance.now() }) };
    const fetch = async (url, options) => {
        const path = new URL(url).pathname;
        calls.push({ path, method: options.method, credentials: options.credentials });
        let code = 200, body;
        if (path.endsWith('/csrf/')) body = { csrfToken: 'synthetic-initial-csrf' };
        else if (path.endsWith('/login/')) {
            if (pendingPost) await pendingPost.promise;
            if (networkError) throw new TypeError('Synthetic network error');
            code = status;
            body = payload === undefined ? { usuario: user, csrfToken: 'synthetic-renewed-csrf' } : payload;
            validSession = code === 200;
        } else if (path.endsWith('/me/')) {
            code = validSession ? 200 : 403;
            body = validSession ? user : { detail: 'No autenticado' };
        } else throw new Error('Unexpected path: ' + path);
        return { status: code, ok: code >= 200 && code < 300,
            headers: { get: () => 'application/json' },
            json: async () => {
                if (path.endsWith('/login/')) parsedAt = performance.now();
                return body;
            } };
    };
    const storage = { removeItem() {}, setItem() { throw new Error('Persistent identity forbidden'); } };
    const context = vm.createContext({ URL, document, window, fetch, console,
        localStorage: storage, sessionStorage: storage,
        CustomEvent: class extends Event { constructor(type, options) { super(type); this.detail = options.detail; } } });
    const modules = new Map();
    async function load(url) {
        if (modules.has(url.href)) return modules.get(url.href);
        if (url.pathname.endsWith('/components/forms.js')) {
            const module = new vm.SyntheticModule(['initPasswordToggles'], function () {
                this.setExport('initPasswordToggles', () => {});
            }, { context, identifier: url.href });
            modules.set(url.href, module); return module;
        }
        let source = await readFile(url, 'utf8');
        if (legacy && url.pathname.endsWith('/core/session.js')) {
            source = source.replace(/return user;\r?\n}\r?\nexport function logout\(\)/,
                'return refreshUser(true);\n}\nexport function logout()');
        }
        const module = new vm.SourceTextModule(source, { context, identifier: url.href,
            initializeImportMeta: meta => { meta.url = 'http://localhost/frontend/assets/js/' + url.href.slice(root.href.length); } });
        modules.set(url.href, module);
        return module;
    }
    const auth = await load(new URL('auth.js', root));
    await auth.link((specifier, parent) => load(new URL(specifier, parent.identifier)));
    await auth.evaluate();
    document.dispatchEvent(new Event('DOMContentLoaded')); await tick();
    return { calls, destinations, button, submit: () => form.dispatchEvent(new Event('submit', { cancelable: true })),
        session: modules.get(new URL('core/session.js', root).href).namespace,
        invalidateSession: () => { validSession = false; },
        get feedback() { return feedback; }, get resetCount() { return resetCount; },
        get redirectDelay() { return destinations.find(d => d.method === 'assign')?.at - parsedAt; } };
}

for (const [rol, folder] of Object.entries({ PACIENTE: 'paciente', MEDICO: 'medico', SECRETARIA: 'secretaria', ADMINISTRADOR: 'admin' })) {
    test(`${rol}: initial check, one POST, correct destination and independent dashboard validation`, async () => {
        const page = await setup({ rol });
        assert.deepEqual(page.calls.map(c => c.path), ['/api/auth/me/']);
        page.submit(); await tick();
        assert.deepEqual(page.calls.map(c => c.path), ['/api/auth/me/', '/api/auth/csrf/', '/api/auth/login/']);
        assert.equal(page.destinations.length, 1);
        assert.equal(page.destinations[0].url, `http://localhost/frontend/pages/${folder}/dashboard.html`);
        assert.equal(page.resetCount, 1);
        assert.equal((await page.session.requireRole(rol)).rol, rol);
        assert.equal(page.calls.at(-1).path, '/api/auth/me/');
        assert.ok(page.calls.every(c => c.credentials === 'same-origin'));
        console.log(`Controlled ${rol}: POST JSON -> redirect ${page.redirectDelay.toFixed(3)} ms`);
    });
}

test('baseline waits for a second me request; optimized flow removes exactly that request', async () => {
    const old = await setup({ legacy: true }), current = await setup();
    old.submit(); current.submit(); await tick();
    assert.equal(old.calls.filter(c => c.path.endsWith('/me/')).length, 2);
    assert.equal(current.calls.filter(c => c.path.endsWith('/me/')).length, 1);
});

test('existing session still redirects from the initial session check', async () => {
    const page = await setup({ existingSession: true });
    assert.equal(page.destinations[0].method, 'replace');
    assert.deepEqual(page.calls.map(c => c.path), ['/api/auth/me/']);
});

test('missing session cookie is still rejected by the dashboard check', async () => {
    const page = await setup(); page.submit(); await tick();
    page.invalidateSession();
    assert.equal(await page.session.requireRole('PACIENTE'), null);
    assert.ok(page.destinations.at(-1).url.endsWith('/pages/auth/login.html'));
});

test('repeated submit while pending sends one POST and failures permit retry', async () => {
    const pendingPost = deferred();
    const page = await setup({ pendingPost, status: 401 });
    page.submit(); page.submit(); await tick();
    assert.equal(page.button.disabled, true);
    assert.equal(page.calls.filter(c => c.method === 'POST').length, 1);
    pendingPost.resolve(); await tick();
    assert.equal(page.button.disabled, false);
    assert.equal(page.destinations.length, 0);
    page.submit(); await tick();
    assert.equal(page.calls.filter(c => c.method === 'POST').length, 2);
});

for (const scenario of [
    { name: 'incorrect credentials', status: 401 }, { name: 'blocked account', status: 401 },
    { name: 'inactive account', status: 401 }, { name: 'server error', status: 500 },
    { name: 'network error', networkError: true },
    ...[null, {}, { usuario: userFor('PACIENTE') },
        { usuario: { ...userFor('PACIENTE'), is_active: false }, csrfToken: 'test' },
        { usuario: userFor('UNKNOWN'), csrfToken: 'test' },
        { usuario: userFor('toString'), csrfToken: 'test' },
        { usuario: { ...userFor('PACIENTE'), perfil: null }, csrfToken: 'test' },
        { usuario: userFor('PACIENTE'), csrfToken: '' }].map((payload, i) => ({ name: `malformed response ${i}`, payload }))
]) {
    test(`${scenario.name}: no redirect and feedback remains available`, async () => {
        const page = await setup(scenario); page.submit(); await tick();
        assert.equal(page.destinations.length, 0); assert.equal(page.resetCount, 0);
        assert.equal(page.button.disabled, false); assert.ok(page.feedback?.textContent);
        assert.equal(page.calls.filter(c => c.path.endsWith('/me/')).length, 1);
    });
}
