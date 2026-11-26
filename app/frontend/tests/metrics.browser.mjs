// Application HTML/modules in Chrome, with a read-only synthetic API and no database access.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve('app/frontend');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'admin-metrics-'));
const profile = path.join(temporary, 'chrome');
const cdn = ['https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js'];
const assets = await Promise.all(cdn.map(async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert.ok(response.ok); return response.text();
}));
const specialty = { id: 1, nombre: 'Cardiología' };
const doctor = { id: 2, nombre: 'Médico', apellido: 'Ficticio', especialidad: specialty };
const sample = () => ({
    usuarios: { total: 20, pacientes: 12, medicos_activos: 5, secretarias_activas: 3 },
    resumen: { total: 10, completados: 6, cancelados: 2, ausentes: 1, reservas_activas: 1,
        espera_promedio_minutos: 11.21, atencion_promedio_minutos: 10.96, muestras_espera: 7,
        muestras_atencion: 6, prioridad_frecuente: 'MEDIA', tasa_ausentismo_historico: 14.29, propuestas_en_espera: 2 },
    estados: { RESERVADO: 0, PENDIENTE: 0, PRESENTE: 0, EN_ATENCION: 1, COMPLETADO: 6, CANCELADO: 2, AUSENTE: 1 },
    prioridades: { ALTA: 1, MEDIA: 5, BAJA: 2 }, sin_triaje: 2,
    medicos: [{ medico__usuario__nombre: doctor.nombre, medico__usuario__apellido: doctor.apellido, medico__especialidad__nombre: specialty.nombre,
        total: 10, completados: 6, cancelados: 2, ausentes: 1, atencion_promedio_minutos: 5.5, alta: 1, media: 5, baja: 2, sin_triaje: 2 }]
});
let hold = true, release, fail = false, missing = false;
const queries = [], errors = [], writes = [];
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        res.setHeader('Cache-Control', 'no-store');
        const reply = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
        if (url.pathname.startsWith('/api/')) {
            if (req.method !== 'GET') { writes.push(req.method); throw Error('Unexpected write'); }
            if (url.pathname === '/api/auth/me/') return reply({ id: 1, nombre: 'Administradora', apellido: 'Ficticia', rol: 'ADMINISTRADOR', is_active: true, perfil: null });
            if (url.pathname === '/api/admin/especialidades/') return reply([specialty]);
            if (url.pathname === '/api/medicos/') return reply([doctor]);
            if (url.pathname === '/api/admin/metricas/') {
                queries.push(Object.fromEntries(url.searchParams));
                if (hold) await new Promise(resolve => { release = resolve; });
                if (fail) { res.statusCode = 500; return reply({ detail: 'Error ficticio' }); }
                const data = sample();
                if (missing) Object.assign(data.resumen, { espera_promedio_minutos: null, muestras_espera: 0, atencion_promedio_minutos: 0, muestras_atencion: 1 });
                return reply(data);
            }
            throw Error(`Unexpected API: ${url.pathname}`);
        }
        if (url.pathname.startsWith('/vendor/')) {
            const index = Number(url.pathname.split('/').at(-1));
            res.setHeader('Content-Type', index === 0 ? 'text/css' : 'text/javascript'); return res.end(assets[index]);
        }
        if (url.pathname === '/favicon.ico') { res.statusCode = 204; return res.end(); }
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        assert.ok(file.startsWith(root + path.sep));
        let source = await readFile(file);
        const extension = path.extname(file);
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extension] || 'application/octet-stream');
        if (extension === '.html') {
            source = source.toString(); cdn.forEach((url, i) => { source = source.replaceAll(url, `/vendor/${i}`); });
            source = source.replace(/<link[^>]*bootstrap-icons[^>]*>/, '');
        }
        res.end(source);
    } catch (error) { errors.push(error.message); res.statusCode = 500; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
const exited = new Promise(resolve => browser.once('exit', resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, counter = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000);
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
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
        if (!waiter) return;
        clearTimeout(waiter.timer); pending.delete(message.id);
        if (message.error) waiter.reject(Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
    };
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cmd = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
        const result = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    };
    const until = async expression => {
        for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
        throw Error(`Condition not met: ${expression}`);
    };
    const name = () => evaluate("document.getElementById('adminMetricasNavbar').textContent");
    const filter = (field, value) => evaluate(`document.getElementById('${field}').value=${JSON.stringify(value)};document.getElementById('${field}').dispatchEvent(new Event('change',{bubbles:true}))`);
    const screenshot = async label => {
        const result = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        const destination = path.join(temporary, `${label}.png`);
        await writeFile(destination, Buffer.from(result.data, 'base64')); console.log(JSON.stringify({ screenshot: destination }));
    };
    await cmd('Page.enable'); await cmd('Network.enable'); await cmd('Runtime.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await cmd('Network.setBlockedURLs', { urls: ['https://*'] });
    await cmd('Page.navigate', { url: `${origin}/pages/admin/metricas.html` });
    await until("document.getElementById('metricasPrioridadDistribucion').textContent==='Consultando indicadores...'");
    assert.equal(await name(), 'Administradora Ficticia');
    assert.equal(await evaluate("document.getElementById('metricasTotalTurnos').textContent"), '—');
    for (let i = 0; i < 100 && !release; i++) await delay(20);
    assert.ok(release); hold = false; release();
    await until("document.getElementById('metricasAtencionPromedio').textContent==='10 min 58 s'");
    assert.equal(await evaluate("document.getElementById('metricasEsperaPromedio').textContent"), '11 min 13 s');
    assert.match(await evaluate("document.getElementById('metricasEsperaPromedio').title"), /^7 observaciones/);
    assert.match(await evaluate("document.getElementById('metricasAtencionPromedio').title"), /^6 consultas/);
    assert.match(await evaluate("document.getElementById('metricasMedicosTabla').textContent"), /5 min 30 s/);
    await screenshot('metrics-desktop');
    hold = true; release = null;
    await filter('metricasMedico', '2');
    await until("document.getElementById('metricasAtencionPromedio').textContent==='—'");
    assert.equal(await name(), 'Administradora Ficticia');
    for (let i = 0; i < 100 && !release; i++) await delay(20);
    assert.ok(release); assert.equal(queries.at(-1).medico, '2'); hold = false; release();
    await until("document.getElementById('metricasAtencionPromedio').textContent==='10 min 58 s'");
    fail = true; await filter('metricasEstado', 'COMPLETADO');
    await until("!!document.getElementById('apiPageMessage')");
    assert.equal(await name(), 'Administradora Ficticia');
    assert.equal(await evaluate("document.getElementById('metricasTotalTurnos').textContent"), '—');
    fail = false; missing = true; await filter('metricasEstado', '');
    await until("document.getElementById('metricasAtencionPromedio').textContent==='0 min 0 s'");
    assert.equal(await evaluate("document.getElementById('metricasEsperaPromedio').textContent"), '—');
    assert.match(await evaluate("document.getElementById('metricasEsperaPromedio').title"), /^0 observaciones/);
    assert.equal(await name(), 'Administradora Ficticia');
    missing = false; await evaluate("document.getElementById('adminMetricasFiltros').reset()");
    await until("document.getElementById('metricasAtencionPromedio').textContent==='10 min 58 s'");
    assert.equal(await name(), 'Administradora Ficticia');
    assert.deepEqual(queries.at(-1), {});
    await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 1100, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth"), false);
    await screenshot('metrics-mobile');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await cmd('Page.navigate', { url: `${origin}/pages/admin/dashboard.html` });
    await until("document.getElementById('adminMetricUsuarios')?.textContent==='20'");
    assert.equal(await evaluate("document.getElementById('adminNombreNavbar').textContent"), 'Administradora Ficticia');
    await screenshot('dashboard-desktop');
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ success: true, checks: ['initial loading', 'navbar', 'filters', 'errors', 'reset', 'zero vs missing', 'sample counts', 'doctor table', 'dashboard', 'responsive'], writes: 0 }));
} finally {
    release?.();
    if (socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {});
    socket?.close(); browser.kill(); server.close();
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    await Promise.race([exited, delay(3000)]);
    assert.equal(path.dirname(profile), temporary);
    assert.equal(path.dirname(temporary), os.tmpdir());
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
