// Real Chrome, HTML, module graph and HTTP cache; synthetic API only, never PostgreSQL.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('app/frontend');
const profile = await mkdtemp(path.resolve('.audit-b84/availability-browser-'));
const oldVersion = 'b84-obs09-2';
const version = 'availability-date-filter-2';
const baseline = '86237a167e7cfd00515474bbef2d5ccf695c93e9';
const original = new Map(['availability-ui.js', 'availability-service.js'].map(name => [name,
    execFileSync('git', ['show', `${baseline}:app/frontend/assets/js/features/availability/${name}`], { encoding: 'utf8' })]));
const doctor = { id: 2, nombre: 'Médico', apellido: 'Prueba', especialidad: { id: 1, nombre: 'Clínica Médica' } };
const block = (id, fecha, hora_inicio, hora_fin, estado = 'DISPONIBLE') =>
    ({ id, medico: 2, fecha, hora_inicio, hora_fin, estado, duracion_minutos: 20 });
const fixtures = () => [block(1, '2026-11-13', '09:00:00', '09:20:00'),
    block(2, '2026-11-14', '08:50:30', '09:10:30'), block(3, '2026-11-14', '09:00:00', '09:20:00'),
    block(4, '2026-11-15', '09:00:00', '09:20:00'), block(5, '2026-11-15', '09:20:00', '09:40:00', 'BLOQUEADO'),
    block(6, '2026-11-16', '09:00:00', '09:20:00')];
let role = 'MEDICO', phase = 'prime', rows = fixtures();
const requests = [], writes = [];
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
            requests.push({ method: req.method, path: req.url });
            res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
            const reply = data => res.end(JSON.stringify(data));
            if (url.pathname === '/api/auth/me/') return reply({ ...doctor, id: role === 'MEDICO' ? 2 : 3,
                rol: role, is_active: true, perfil: { ...doctor } });
            if (url.pathname === '/api/auth/csrf/') return reply({ csrfToken: 'synthetic-token' });
            if (url.pathname === '/api/especialidades/') return reply([doctor.especialidad]);
            if (url.pathname === '/api/medicos/') return reply([doctor]);
            if (url.pathname === '/api/medicos/2/') return reply(doctor);
            if (url.pathname === '/api/medicos/2/disponibilidades/' && req.method === 'GET') {
                // Deliberately return all dates: the browser must enforce the display filter too.
                return reply(rows);
            }
            if (req.method !== 'GET' && url.pathname.startsWith('/api/medicos/2/disponibilidades/')) {
                let body = ''; for await (const part of req) body += part;
                writes.push({ method: req.method, path: url.pathname, body: body ? JSON.parse(body) : null });
                const match = url.pathname.match(/disponibilidades\/(\d+)\/(bloquear\/|desbloquear\/)?$/);
                if (match) {
                    const id = Number(match[1]);
                    if (req.method === 'DELETE') rows = rows.filter(row => row.id !== id);
                    else rows.find(row => row.id === id).estado = match[2] === 'bloquear/' ? 'BLOQUEADO' : 'DISPONIBLE';
                }
                return reply({ ok: true });
            }
            res.statusCode = 404; return reply({ detail: 'Unexpected synthetic API request' });
        }
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
        let source = await readFile(file);
        const ext = path.extname(file);
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', ext === '.js' ? 'public, max-age=3600' : 'no-store');
        if (phase !== 'fixed' && ext === '.html') source = source.toString().replaceAll(version, oldVersion);
        if (phase === 'prime' && ext === '.js') source = source.toString().replaceAll(version, oldVersion);
        if (phase === 'prime' && original.has(path.basename(file))) source = original.get(path.basename(file));
        res.end(source);
    } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-sync', '--disable-extensions', '--disable-component-update', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
const browserExited = new Promise(resolve => browser.once('exit', resolve));
let socket, nextId = 0;
const pending = new Map(), cached = [], loaded = [], failures = [], requestURLs = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
try {
    let port;
    for (let i = 0; i < 100; i++) {
        try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
        catch { await delay(100); }
    }
    assert.ok(port, 'Chrome debugging port');
    const info = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
    socket = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data), waiter = pending.get(message.id);
        if (message.method === 'Network.requestWillBeSent') {
            requestURLs.set(message.params.requestId, message.params.request.url);
        }
        if (message.method === 'Network.requestServedFromCache') {
            const url = requestURLs.get(message.params.requestId);
            if (url) cached.push(url);
        }
        if (message.method === 'Network.responseReceived') {
            const response = message.params.response;
            loaded.push(response.url);
            if (response.fromDiskCache) cached.push(response.url);
        }
        if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.text);
        if (!waiter) return;
        clearTimeout(waiter.timer); pending.delete(message.id);
        if (message.error) waiter.reject(Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
    };
    for (const currentRole of ['MEDICO', 'SECRETARIA']) {
        role = currentRole; rows = fixtures(); phase = 'prime';
        const { browserContextId } = await send('Target.createBrowserContext');
        const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const cmd = (method, params) => send(method, params, sessionId);
        const evaluate = async expression => {
            const result = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        };
        const wait = async expression => {
            for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
            const state = await evaluate(`({table:document.querySelector('tbody')?.textContent,alerts:[...document.querySelectorAll('.alert')].map(n=>n.textContent.trim()).filter(Boolean)})`);
            throw Error(`Condition not met: ${expression}; ${JSON.stringify(state)}`);
        };
        await cmd('Page.enable'); await cmd('Network.enable'); await cmd('Runtime.enable');
        await cmd('Network.setBlockedURLs', { urls: ['https://*'] });
        await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
            const RealDate=Date; window.Date=class extends RealDate {
                constructor(...args){super(...(args.length?args:['2026-11-14T12:10:30Z']));}
                static now(){return new RealDate('2026-11-14T12:10:30Z').getTime();}
            }; window.confirm=()=>true;` });
        const isDoctor = role === 'MEDICO';
        const page = isDoctor ? 'medico/cargar-disponibilidad-medico.html' : 'secretaria/cargar-disponibilidad.html';
        const table = isDoctor ? 'disponibilidadMedicoTabla' : 'disponibilidadTabla';
        const filter = isDoctor ? 'disponibilidadMedicoFiltroFecha' : 'disponibilidadFiltroFecha';
        const selectDoctor = async () => {
            if (isDoctor) return;
            await wait(`document.getElementById('disponibilidadMedico')?.options.length>1`);
            await evaluate(`document.getElementById('disponibilidadMedico').value='2';document.getElementById('disponibilidadMedico').dispatchEvent(new Event('change',{bubbles:true}));`);
        };
        const count = `document.querySelectorAll('#${table} tr[data-block-id]').length`;
        const ids = () => evaluate(`[...document.querySelectorAll('#${table} tr[data-block-id]')].map(r=>Number(r.dataset.blockId))`);
        const date = async value => {
            await evaluate(`document.getElementById('${filter}').value=${JSON.stringify(value)};document.getElementById('${filter}').dispatchEvent(new Event('input',{bubbles:true}));`);
        };
        await cmd('Page.navigate', { url: `${origin}/pages/${page}` });
        await selectDoctor(); await wait(`${count}===6`);
        // Same HTML, updated files, unchanged URLs: normal navigation reuses cached old modules.
        phase = 'stale';
        await cmd('Page.navigate', { url: `${origin}/pages/${page}` });
        await selectDoctor(); await wait(`${count}===6`);
        assert.equal(await evaluate(`document.getElementById('${filter}').value`), '');
        assert.match(await evaluate(`document.getElementById('${table}').textContent`), /Horario vencido/);
        console.log(JSON.stringify({ role, staleCacheReproduced: true, visibleWithoutDate: await ids() }));
        phase = 'fixed';
        const before = requests.length;
        await cmd('Page.navigate', { url: `${origin}/pages/${page}` });
        await wait(`performance.getEntriesByType('resource').some(r=>r.name.includes('availability-ui.js?v=${version}'))`);
        await selectDoctor();
        await wait(`document.getElementById('${table}').textContent.includes('Seleccione una fecha')`);
        assert.deepEqual(await ids(), []);
        assert.equal(requests.slice(before).filter(r => r.path.includes('/disponibilidades/')).length, 0);
        await date('2026-11-14'); await wait(`${count}===1`);
        assert.deepEqual(await ids(), [3]);
        assert.doesNotMatch(await evaluate(`document.getElementById('${table}').textContent`), /Horario vencido/);
        await date('');
        assert.deepEqual(await ids(), []); // synchronous clearing on input, before blur/change
        await date('2026-11-15'); await wait(`${count}===2`);
        assert.deepEqual(await ids(), [4, 5]);
        const click = operation => evaluate(`document.querySelector('#${table} [data-slot="4"][data-operation="${operation}"]').click()`);
        await click('bloquear'); await wait(`!!document.querySelector('#${table} [data-slot="4"][data-operation="desbloquear"]')`);
        await click('desbloquear'); await wait(`!!document.querySelector('#${table} [data-slot="4"][data-operation="bloquear"]')`);
        await click('eliminar'); await wait(`${count}===1`);
        assert.deepEqual(await ids(), [5]);
        await date('2026-11-17'); await wait(`document.getElementById('${table}').textContent.includes('No hay disponibilidad registrada')`);
        await date('2026-11-13');
        assert.equal(await evaluate(`document.getElementById('${filter}').value`), '');
        assert.deepEqual(await ids(), []);
        const prefix = isDoctor ? 'disponibilidadMedico' : 'disponibilidad';
        await evaluate(`document.getElementById('${prefix}Fecha').value='2026-11-16';document.getElementById('${prefix}HoraInicio').value='10:00';document.getElementById('${prefix}HoraFin').value='10:40';document.getElementById('${isDoctor ? 'generarBloquesMedicoBtn' : 'generarBloquesBtn'}').click();document.querySelector('form[data-form$="-availability"]').requestSubmit();`);
        await wait(`document.getElementById('${prefix}Mensaje').textContent.includes('guardada correctamente')`);
        assert.deepEqual(await ids(), []);
        console.log(JSON.stringify({ role, corrected: true, emptyDate: true, endTimeFilter: true,
            inputClearsImmediately: true, dateChanges: true, actions: ['bloquear', 'desbloquear', 'eliminar', 'crear'] }));
        await send('Target.disposeBrowserContext', { browserContextId });
    }
    assert.ok(cached.some(url => url.includes('availability-ui.js')), 'old UI was actually loaded from cache');
    assert.ok(loaded.some(url => url.includes(`availability-service.js?v=${version}`)));
    assert.equal(failures.length, 0);
    assert.equal(writes.filter(r => r.path.endsWith('/lote/')).length, 2);
    console.log(JSON.stringify({ success: true, cachedOldModules: [...new Set(cached.filter(url => url.includes('availability-')))],
        updatedModules: [...new Set(loaded.filter(url => url.includes(version)))], syntheticWrites: writes.length, profile }));
} finally {
    if (socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {});
    socket?.close(); browser.kill(); server.close();
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    await Promise.race([browserExited, delay(3000)]);
    if (path.dirname(profile) !== path.resolve('.audit-b84')
            || !path.basename(profile).startsWith('availability-browser-')) throw Error('Unexpected temporary profile path');
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
