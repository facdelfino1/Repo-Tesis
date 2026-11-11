import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const navigation = readFileSync(new URL('assets/js/core/logout-navigation.js', root), 'utf8');
const sessionSource = readFileSync(new URL('assets/js/core/session.js', root), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function setup(logout) {
    let onClick;
    const alerts = [];
    const control = {
        disabled: false,
        attributes: new Map(),
        setAttribute(key, value) { this.attributes.set(key, value); },
        removeAttribute(key) { this.attributes.delete(key); },
    };
    const document = {
        addEventListener(name, listener, capture) {
            assert.equal(name, 'click');
            assert.equal(capture, true);
            assert.equal(onClick, undefined);
            onClick = listener;
        },
        querySelector() { return { prepend: box => alerts.push(box) }; },
        createElement() { return { setAttribute() {} }; },
        body: { prepend: box => alerts.push(box) },
    };
    const source = navigation.replaceAll("import('./session.js')", 'loadSession()')
        .replaceAll("import('./api.js')", 'loadApi()');
    runInNewContext(source, {
        document,
        loadSession: async () => ({ logout, pageMessage: (message, type) => alerts.push({ message, type }) }),
        loadApi: async () => ({ errorMessage: error => error.message }),
    });
    const click = () => {
        let prevented = false;
        const promise = onClick({ target: { closest: () => control }, preventDefault() { prevented = true; } });
        assert.equal(prevented, true);
        return promise;
    };
    return { control, alerts, click };
}

test('immediate and repeated clicks start one logout and disable the control', async () => {
    const pending = deferred();
    let calls = 0;
    const page = setup(() => { calls++; return pending.promise; });
    const first = page.click();
    const second = page.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(page.control.disabled, true);
    pending.resolve();
    await Promise.all([first, second]);
    assert.equal(page.control.disabled, true); // navigation follows successful logout
    assert.equal(page.alerts.length, 0);
});

test('failed logout shows an error and allows retry', async () => {
    let calls = 0;
    const page = setup(() => {
        calls++;
        return calls === 1 ? Promise.reject(new Error('Servidor no disponible')) : Promise.resolve();
    });
    await page.click();
    assert.equal(page.control.disabled, false);
    assert.deepEqual(page.alerts.map(alert => alert.message), ['Servidor no disponible']);
    await page.click();
    assert.equal(calls, 2);
    assert.equal(page.control.disabled, true);
});

test('each protected page loads the handler before its logout button', () => {
    for (const path of ['secretaria/dashboard.html', 'medico/dashboard.html',
        'paciente/dashboard.html', 'admin/dashboard.html', 'paciente/solicitar-turno.html']) {
        const html = readFileSync(new URL(`pages/${path}`, root), 'utf8');
        const script = html.indexOf('src="../../assets/js/core/logout-navigation.js"');
        const button = html.indexOf('data-logout');
        assert.ok(script > 0 && button > script, path);
        assert.equal((html.match(/data-logout/g) || []).length, 1, path);
        assert.equal(html.includes('href="../auth/login.html"'), false, path);
    }
});

function setupSession(request) {
    const destinations = [];
    const source = sessionSource.replace(/^import .*;\r?\n/, '')
        .replace("new URL('../../../', import.meta.url)", "new URL('http://localhost/frontend/')")
        .replaceAll('export ', '') + '\nglobalThis.sessionUnderTest = { logout, requireRole };';
    const storage = { removeItem() {} };
    const context = {
        URL, request, ApiError: class ApiError extends Error {},
        setCsrfToken() {}, errorMessage: error => error.message,
        localStorage: storage, sessionStorage: storage,
        document: { querySelectorAll: () => [], getElementById: () => null },
        window: {
            location: { origin: 'http://localhost', assign: url => destinations.push(url),
                replace: url => destinations.push(url) },
            addEventListener() {},
        },
    };
    runInNewContext(source, context);
    return { ...context.sessionUnderTest, destinations };
}

test('session logout uses one POST even when called twice', async () => {
    const pending = deferred();
    let posts = 0;
    const session = setupSession(path => {
        if (path === 'auth/logout/') { posts++; return pending.promise; }
        throw new Error(`Unexpected request: ${path}`);
    });
    const first = session.logout();
    const second = session.logout();
    assert.equal(posts, 1);
    assert.equal(first, second);
    assert.equal(session.destinations.length, 0);
    pending.resolve(null);
    await first;
    assert.equal(session.destinations.length, 1);
    assert.ok(session.destinations[0].endsWith('/pages/auth/login.html'));
});

test('server failure leaves session on the page and permits a new POST', async () => {
    let posts = 0;
    const session = setupSession(path => {
        assert.equal(path, 'auth/logout/');
        posts++;
        return posts === 1 ? Promise.reject(new Error('Fallo del servidor')) : Promise.resolve(null);
    });
    await assert.rejects(session.logout(), /Fallo del servidor/);
    assert.equal(session.destinations.length, 0);
    await session.logout();
    assert.equal(posts, 2);
    assert.equal(session.destinations.length, 1);
});

test('a late role check cannot redirect while logout is pending', async () => {
    const me = deferred();
    const post = deferred();
    const session = setupSession(path => path === 'auth/me/' ? me.promise : post.promise);
    const guard = session.requireRole('SECRETARIA');
    const logout = session.logout();
    me.resolve({ rol: 'MEDICO' });
    assert.equal(await guard, null);
    assert.equal(session.destinations.length, 0);
    post.resolve(null);
    await logout;
    assert.equal(session.destinations.length, 1);
    assert.ok(session.destinations[0].endsWith('/pages/auth/login.html'));
});
