// Real Chrome + real local HTTP. Disposable API fixtures; no application database.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve('app/frontend');
const profile = path.resolve('.tmp-mejora19', `cache-browser-${randomUUID()}`);
await mkdir(profile, { recursive: true });
const legacyFiles = ['assets/js/pages/admin.js', 'assets/js/features/users/users-ui.js', 'assets/js/features/users/users-service.js'];
const baselineRevision = '86237a167e7cfd00515474bbef2d5ccf695c93e9';
const legacy = new Map(legacyFiles.map(file => [file, execFileSync('git', ['show', `${baselineRevision}:app/frontend/${file}`], { encoding: 'utf8', windowsHide: true })]));
assert.ok(!legacy.get(legacyFiles[1]).includes('fecha_nacimiento'), 'The baseline must omit birth');
let warming = true;
const posts = [], served = [], cached = [], errors = [];
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/')) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            if (req.method === 'POST' && url.pathname === '/api/admin/usuarios/') {
                let raw = ''; for await (const chunk of req) raw += chunk;
                const body = JSON.parse(raw);
                const status = /^\d{4}-\d{2}-\d{2}$/.test(body.fecha_nacimiento || '') ? 201 : 400;
                posts.push({ body, status, raw });
                res.writeHead(status);
                res.end(JSON.stringify(status === 201 ? { id: posts.length, ...body } : { fecha_nacimiento: ['Este campo es obligatorio.'] }));
            } else {
                const data = url.pathname === '/api/auth/me/' ? { id: 1, rol: 'ADMINISTRADOR', is_active: true, nombre: 'Admin', apellido: 'Local', perfil: null }
                    : url.pathname === '/api/auth/csrf/' ? { csrfToken: 'local-csrf' }
                    : url.pathname === '/api/admin/especialidades/' ? [{ id: 1, nombre: 'Clinica' }] : [];
                res.end(JSON.stringify(data));
            }
            return;
        }
        if (url.pathname === '/warm.html') {
            res.setHeader('Content-Type', 'text/html');
            res.end(`<script>Promise.all(${JSON.stringify(legacyFiles)}.map(file => fetch('/frontend/' + file))).then(() => document.title='warmed')</script>`);
            return;
        }
        const relative = decodeURIComponent(url.pathname).replace(/^\/frontend\//, '');
        const target = path.resolve(root, relative);
        if (!target.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
        let content = warming && !url.search && legacy.has(relative) ? legacy.get(relative) : await readFile(target);
        if (relative.endsWith('.html')) {
            content = content.toString();
            if (url.searchParams.get('mode') === 'baseline') content = content.replace(/admin\.js\?v=[^"]+/, 'admin.js');
        }
        served.push({ url: req.url, legacy: warming && legacy.has(relative) && !url.search });
        res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html');
        res.setHeader('Cache-Control', relative.endsWith('.js') ? 'public, max-age=3600' : 'no-store');
        res.end(content);
    } catch (error) { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', '--disable-extensions', '--disable-default-apps',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let launchError;
browser.on('error', error => { launchError = error; });
const pending = new Map(); let socket, counter = 0, session;
function send(method, params = {}, sessionId = session) {
    return new Promise((resolve, reject) => {
        const id = ++counter;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}
async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
}
async function until(expression) {
    for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(`Condition not met: ${expression}`);
}
async function fillAndSubmit(role, birth) {
    return evaluate(`(() => {
        document.querySelector('#crearUsuarioInternoBtn').click();
        const values = {Rol:${JSON.stringify(role)}, Nombre:'Ana', Apellido:'Prueba', Dni:'12345678', Email:'ana@example.test', Telefono:'123456789', Password:'Valid!123Az', Matricula:'MP-CACHE', Especialidad:'1', Legajo:'SEC-CACHE', FechaNacimiento:${JSON.stringify(birth)}};
        for (const [key,value] of Object.entries(values)) {
            const input = document.getElementById('crearUsuario'+key); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
            if (key==='Rol') input.dispatchEvent(new Event('change',{bubbles:true}));
        }
        const form=document.querySelector('#adminUsuarioCrearForm');
        form.requestSubmit();
        return {birth:form.elements.namedItem('fecha_nacimiento').value, valid:form.checkValidity()};
    })()`);
}
try {
    let port;
    for (let i = 0; i < 100; i++) {
        if (launchError) throw launchError;
        try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!port) throw Error('Chrome did not expose a local debugging port');
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Fetch.requestPaused') {
            const url = message.params.request.url;
            send(url.startsWith(origin + '/') ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
                requestId: message.params.requestId, ...(!url.startsWith(origin + '/') ? { errorReason: 'BlockedByClient' } : {})
            }, message.sessionId).catch(error => errors.push(error.message));
        }
        if (message.method === 'Network.responseReceived' && message.params.response.fromDiskCache) cached.push(message.params.response.url);
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
        const waiter = pending.get(message.id);
        if (waiter) { clearTimeout(waiter.timer); pending.delete(message.id); message.error ? waiter.reject(Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
    };
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    session = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Page.navigate', { url: `${origin}/warm.html` });
    await until("document.title==='warmed'");
    warming = false;
    await send('Page.navigate', { url: `${origin}/frontend/pages/admin/gestion-usuarios.html?mode=baseline` });
    await until("document.querySelector('#crearUsuarioRol')?.required === true");
    assert.equal((await fillAndSubmit('medico', '1992-02-29')).birth, '1992-02-29');
    await until("document.querySelector('#adminUsuarioCrearForm .alert')?.textContent.includes('obligatorio')");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].status, 400);
    assert.equal(Object.hasOwn(posts[0].body, 'fecha_nacimiento'), false);
    await send('Page.navigate', { url: `${origin}/frontend/pages/admin/gestion-usuarios.html?mode=fixed` });
    await until("document.querySelector('#crearUsuarioRol')?.required === true");
    for (const role of ['medico', 'secretaria']) {
        const before = posts.length;
        assert.equal((await fillAndSubmit(role, '1992-02-29')).valid, true);
        await until("document.querySelector('#adminUsuariosMensaje')?.textContent==='Cuenta creada correctamente.'");
        for (let i = 0; posts.length === before && i < 40; i++) await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(posts.length, before + 1);
        assert.equal(posts.at(-1).status, 201);
        assert.equal(posts.at(-1).body.fecha_nacimiento, '1992-02-29');
        assert.equal(posts.at(-1).body.rol, role.toUpperCase());
        await until("document.querySelector('#adminUsuarioCrearForm [type=submit]')?.disabled===false");
    }
    for (const birth of ['', '2999-01-01']) {
        const before = posts.length;
        assert.equal((await fillAndSubmit('medico', birth)).valid, false);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(posts.length, before);
    }
    assert.ok(served.some(item => item.url.includes('users-ui.js?v=patient-management-20261119-1')));
    assert.ok(cached.some(url => url.endsWith('/users-ui.js')), 'Baseline must actually use the browser cache');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log(JSON.stringify({ result: 'PASS', browser: version.Browser, cached, posts, loadedVersionedModules: served.filter(item => item.url.includes('?v=')), profile }, null, 2));
} finally {
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, null); } catch {} socket.close(); }
    else browser.kill();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
