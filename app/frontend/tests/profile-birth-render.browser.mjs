// Real HTML + ES modules + Chrome DOM; HTTP fixtures never reach the application DB.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve('app/frontend');
const profile = path.resolve('.tmp-mejora19', `profile-browser-${randomUUID()}`);
await mkdir(profile, { recursive: true });
const revision = '86237a167e7cfd00515474bbef2d5ccf695c93e9';
const legacyFiles = ['assets/js/pages/medico.js', 'assets/js/features/auth/auth-ui.js', 'assets/js/core/formatters.js'];
const legacy = new Map(legacyFiles.map(file => [file, execFileSync('git', ['show', `${revision}:app/frontend/${file}`], { encoding: 'utf8', windowsHide: true })]));
let warming = true, role = 'MEDICO', birth = '1987-03-12';
const served = [], cached = [], results = [], errors = [], apiRequests = [];
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/')) {
            apiRequests.push({ method: req.method, path: url.pathname });
            assert.equal(req.method, 'GET');
            assert.equal(url.pathname, '/api/auth/me/');
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ id: 1, rol: role, is_active: true, nombre: 'Ana', apellido: 'Local',
                email: 'ana@example.test', dni: '12345678', telefono: '123456789', fecha_nacimiento: birth,
                perfil: role === 'ADMINISTRADOR' ? null : { id: 2, matricula: 'MP-1', legajo: 'SEC-1', obra_social: 'Particular', especialidad: { id: 1, nombre: 'Clinica' } } }));
            return;
        }
        if (url.pathname === '/warm.html') {
            res.setHeader('Content-Type', 'text/html');
            res.end(`<script>Promise.all(${JSON.stringify(legacyFiles)}.map(file => fetch('/frontend/'+file))).then(() => document.title='warmed')</script>`);
            return;
        }
        const relative = decodeURIComponent(url.pathname).replace(/^\/frontend\//, '');
        const target = path.resolve(root, relative);
        if (!target.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
        let content = warming && !url.search && legacy.has(relative) ? legacy.get(relative) : await readFile(target);
        if (relative.endsWith('.html') && url.searchParams.get('baseline') === 'true') {
            content = content.toString().replace(/medico\.js\?v=[^"]+/, 'medico.js');
        }
        served.push(req.url);
        res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html');
        res.setHeader('Cache-Control', relative.endsWith('.js') ? 'public, max-age=3600' : 'no-store');
        res.end(content);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', '--disable-extensions', '--disable-default-apps',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let launchError, socket, session, counter = 0;
browser.on('error', error => { launchError = error; });
const pending = new Map();
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
try {
    let port;
    for (let i = 0; i < 100; i++) {
        if (launchError) throw launchError;
        try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!port) throw Error('No local Chrome debugging port');
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Fetch.requestPaused') {
            const allowed = message.params.request.url.startsWith(origin + '/');
            send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: message.params.requestId,
                ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }, message.sessionId).catch(error => errors.push(error.message));
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
    await send('Page.navigate', { url: `${origin}/frontend/pages/medico/perfil-medico.html?baseline=true` });
    await until("document.querySelector('[name=fecha_nacimiento]')?.value==='1987-03-12'");
    const baseline = await evaluate("({value:document.querySelector('[name=fecha_nacimiento]').value,type:document.querySelector('[name=fecha_nacimiento]').type})");
    assert.equal(baseline.type, 'text');
    assert.ok(cached.some(url => url.endsWith('/features/auth/auth-ui.js')));
    for (const timezoneId of ['UTC', 'America/Argentina/Buenos_Aires', 'Pacific/Kiritimati', 'Pacific/Apia']) {
        await send('Emulation.setTimezoneOverride', { timezoneId });
        for (const [folder, userRole] of [['medico', 'MEDICO'], ['paciente', 'PACIENTE'], ['secretaria', 'SECRETARIA'], ['admin', 'ADMINISTRADOR']]) {
            for (const value of ['1987-03-12', null, '2011-12-30']) {
                role = userRole; birth = value;
                await send('Page.navigate', { url: `${origin}/frontend/pages/${folder}/perfil-${folder}.html?v=profile-birth-20261118-1&case=${results.length}` });
                const expected = value === null ? 'No registrada' : value === '1987-03-12' ? '12-03-1987' : '30-12-2011';
                await until(`document.querySelector('[name=fecha_nacimiento]')?.value===${JSON.stringify(expected)}`);
                const rendered = await evaluate(`(() => {
                    const input=document.querySelector('[name=fecha_nacimiento]');
                    const result={value:input.value,defaultValue:input.defaultValue,type:input.type,readOnly:input.readOnly,visible:input.getClientRects().length>0};
                    input.form.reset(); result.afterReset=input.value;
                    return result;
                })()`);
                assert.equal(rendered.value, expected); assert.equal(rendered.defaultValue, expected);
                assert.equal(rendered.afterReset, expected); assert.equal(rendered.type, 'text');
                assert.equal(rendered.readOnly, true); assert.equal(rendered.visible, true);
                results.push({ role, timezoneId, apiBirth: value, ...rendered });
            }
        }
    }
    assert.ok(served.some(url => url.includes('auth-ui.js?v=profile-birth-20261118-1')));
    assert.ok(served.some(url => url.includes('formatters.js?v=profile-birth-20261118-1')));
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.ok(apiRequests.every(item => item.method === 'GET' && item.path === '/api/auth/me/'));
    const report = { result: 'PASS', browser: version.Browser, baseline, cached, scenarios: results.length, results,
        versionedScripts: served.filter(url => url.includes('?v=profile-birth-20261118-1')), apiRequests };
    await writeFile('.tmp-mejora19/profile-birth-render.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ result: report.result, browser: report.browser, baseline, scenarios: results.length, roles: 4,
        timezones: 4, remoteDatabaseAccess: false, report: '.tmp-mejora19/profile-birth-render.json' }));
} finally {
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, null); } catch {} socket.close(); }
    else browser.kill();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
