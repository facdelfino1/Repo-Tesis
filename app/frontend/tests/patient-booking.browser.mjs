// Real Chrome and application modules; synthetic API only. No operational database access.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve('app/frontend');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'patient-booking-'));
const profile = path.join(temporary, 'chrome');
const assets = new Map();
const cdn = [
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js'
];
for (const [i, url] of cdn.entries()) {
    const response = await fetch(url);
    assert.ok(response.ok, 'Bootstrap fixture dependency');
    assets.set(`/vendor/${i}`, await response.text());
}
const specialty = { id: 1, nombre: 'Cardiología' };
const doctor = { id: 2, nombre: 'Médico', apellido: 'Ficticio', especialidad: specialty };
const patients = [
    { id: 82, nombre: 'Ana', apellido: 'Prueba', dni: '00123456', telefono: '5550100' },
    { id: 83, nombre: 'Ana', apellido: 'Prueba', dni: '00123456', telefono: '' }
];
let rejectNext = false;
const writes = [], turns = [], queries = [], errors = [];
const block = { id: 10, fecha: '2030-01-10', hora_inicio: '09:00:00', hora_fin: '09:20:00' };
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        res.setHeader('Cache-Control', 'no-store');
        const reply = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
        if (url.pathname.startsWith('/api/')) {
            if (url.pathname === '/api/auth/me/') return reply({ id: 3, nombre: 'Secretaría', apellido: 'Ficticia', rol: 'SECRETARIA', is_active: true, perfil: { id: 3 } });
            if (url.pathname === '/api/auth/csrf/') return reply({ csrfToken: 'synthetic-csrf' });
            if (url.pathname === '/api/especialidades/') return reply([specialty]);
            if (url.pathname === '/api/medicos/') return reply([doctor]);
            if (url.pathname === '/api/medicos/2/') return reply(doctor);
            if (url.pathname === '/api/pacientes/') {
                queries.push(url.searchParams.get('q'));
                return reply({ count: 2, next: null, previous: null, results: patients });
            }
            if (url.pathname === '/api/medicos/2/disponibilidades/') return reply([block]);
            if (url.pathname === '/api/medicos/2/turnos/' && req.method === 'GET') return reply(turns);
            if (url.pathname === '/api/medicos/2/turnos/' && req.method === 'POST') {
                let text = ''; for await (const part of req) text += part;
                const body = JSON.parse(text); writes.push(body);
                assert.deepEqual(Object.keys(body).sort(), ['disponibilidad', 'paciente']);
                assert.equal(req.headers['x-csrftoken'], 'synthetic-csrf');
                if (rejectNext) { rejectNext = false; res.statusCode = 409; return reply({ detail: 'Horario ocupado (prueba).' }); }
                const patient = patients.find(p => p.id === body.paciente);
                assert.ok(patient); assert.equal(body.disponibilidad, 10);
                const turn = { id_turno: 7, paciente: patient.id, paciente_detalle: patient, medico: doctor,
                    fecha: block.fecha, hora: block.hora_inicio, estado: 'RESERVADO', asignacion_vigente: true,
                    prioridad: null, origen: 'SECRETARIA' };
                turns.push(turn); res.statusCode = 201; return reply(turn);
            }
            throw Error(`Unexpected synthetic API: ${req.method} ${url.pathname}`);
        }
        if (assets.has(url.pathname)) {
            res.setHeader('Content-Type', url.pathname.endsWith('0') ? 'text/css' : 'text/javascript');
            return res.end(assets.get(url.pathname));
        }
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        assert.ok(file.startsWith(root + path.sep));
        let source = await readFile(file);
        const ext = path.extname(file);
        res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream');
        if (ext === '.html') {
            source = source.toString();
            cdn.forEach((url, i) => { source = source.replaceAll(url, `/vendor/${i}`); });
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
        for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(50); }
        throw Error(`Condition not met: ${expression}`);
    };
    await cmd('Page.enable'); await cmd('Network.enable'); await cmd('Runtime.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await cmd('Network.setBlockedURLs', { urls: ['https://*'] });
    await cmd('Page.navigate', { url: `${origin}/pages/secretaria/gestion-turnos.html` });
    await until("document.getElementById('asignarMedico').options.length>1");
    const open = async () => {
        await evaluate("document.querySelector('[data-bs-target=\"#asignarTurnoModal\"]').click()");
        await until("document.getElementById('asignarTurnoModal').classList.contains('show')");
        await delay(350);
    };
    const input = async (field, text) => {
        await evaluate(`document.getElementById('asignarPaciente${field}').focus();document.getElementById('asignarPaciente${field}').value=${JSON.stringify(text)};document.getElementById('asignarPaciente${field}').dispatchEvent(new Event('input',{bubbles:true}))`);
        await until("document.querySelectorAll('#asignarPacienteSugerencias button').length===2");
    };
    const select = () => evaluate("document.querySelectorAll('#asignarPacienteSugerencias button')[1].click()");
    const values = () => evaluate("['Nombre','Apellido','Dni','Telefono'].map(k=>document.getElementById('asignarPaciente'+k).value)");
    await open();
    await input('Nombre', 'Ana');
    assert.deepEqual(await values(), ['Ana', '', '', '']);
    assert.doesNotMatch(await evaluate("document.getElementById('asignarPacienteSugerencias').textContent"), /5550100/);
    await evaluate("document.getElementById('asignarTurnoForm').requestSubmit()");
    assert.equal(writes.length, 0);
    const point = await evaluate("(()=>{const option=document.querySelector('#asignarPacienteSugerencias button');option.scrollIntoView({block:'nearest'});const r=option.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    assert.deepEqual(await values(), ['Ana', 'Prueba', '00123456', '5550100']);
    await input('Apellido', 'Prueba');
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    assert.equal(await evaluate("document.getElementById('asignarTurnoModal').classList.contains('show') && document.getElementById('asignarPacienteSugerencias').hidden"), true);
    await input('Nombre', 'Ana');
    await select();
    assert.deepEqual(await values(), ['Ana', 'Prueba', '00123456', 'No registrado']);
    assert.equal(await evaluate("getComputedStyle(document.getElementById('asignarPacienteSugerencias')).display"), 'none');
    for (const field of ['Nombre', 'Apellido', 'Dni']) {
        await input(field, 'An');
        assert.deepEqual(await values(), ['Nombre', 'Apellido', 'Dni', 'Telefono'].map(k => k === field ? 'An' : ''));
        await select();
    }
    await input('Dni', '0012');
    for (const key of ['ArrowDown', 'ArrowDown', 'Enter']) {
        await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: { ArrowDown: 40, Enter: 13 }[key] });
        await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
    }
    assert.deepEqual(await values(), ['Ana', 'Prueba', '00123456', 'No registrado']);
    await evaluate("document.getElementById('asignarEspecialidad').value='1';document.getElementById('asignarEspecialidad').dispatchEvent(new Event('change',{bubbles:true}))");
    await until("!document.getElementById('asignarMedico').disabled");
    await evaluate("document.getElementById('asignarMedico').value='2';document.getElementById('asignarMedico').dispatchEvent(new Event('change',{bubbles:true}))");
    await until("!document.getElementById('asignarDisponibilidad').disabled");
    await evaluate("document.getElementById('asignarDisponibilidad').value='10'");
    rejectNext = true;
    await evaluate("document.getElementById('asignarTurnoForm').requestSubmit()");
    await until("document.getElementById('asignarTurnoMensaje').textContent.includes('Horario ocupado') && !document.querySelector('#asignarTurnoForm [type=submit]').disabled");
    assert.deepEqual(await values(), ['Ana', 'Prueba', '00123456', 'No registrado']);
    await evaluate("document.getElementById('asignarDisponibilidad').value='10';document.getElementById('asignarTurnoForm').requestSubmit()");
    await until("document.getElementById('asignarTurnoMensaje').textContent.includes('reservado.') && !document.querySelector('#asignarTurnoForm [type=submit]').disabled");
    assert.deepEqual(writes, [{ paciente: 83, disponibilidad: 10 }, { paciente: 83, disponibilidad: 10 }]);
    assert.equal(turns[0].paciente, 83);
    assert.deepEqual(await values(), ['', '', '', '']);
    await input('Apellido', 'Prueba'); await select();
    await evaluate("bootstrap.Modal.getInstance(document.getElementById('asignarTurnoModal')).hide()");
    await until("!document.getElementById('asignarTurnoModal').classList.contains('show')"); await delay(350);
    await open(); assert.deepEqual(await values(), ['', '', '', '']);
    await input('Nombre', 'Ana'); await select();
    await evaluate("document.getElementById('asignarTurnoForm').reset()");
    assert.deepEqual(await values(), ['', '', '', '']);

    for (const width of [1366, 390]) {
        await cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
        await input('Nombre', 'Ana');
        const geometry = await evaluate(`(()=>{
            const fields=['Nombre','Apellido','Dni','Telefono'].map(k=>document.getElementById('asignarPaciente'+k).getBoundingClientRect());
            const modal=document.querySelector('#asignarTurnoModal .modal-body');
            return {fields:fields.map(r=>({x:r.x,y:r.y,width:r.width})),overflow:modal.scrollWidth>modal.clientWidth,
                listOverflow:document.getElementById('asignarPacienteSugerencias').scrollWidth>document.getElementById('asignarPacienteSugerencias').clientWidth};
        })()`);
        assert.equal(geometry.overflow, false); assert.equal(geometry.listOverflow, false);
        if (width >= 768) {
            assert.ok(geometry.fields.every(r => Math.abs(r.y - geometry.fields[0].y) < 1));
            assert.ok(geometry.fields.every(r => Math.abs(r.width - geometry.fields[0].width) < 1));
        } else assert.ok(geometry.fields.every((r, i) => !i || r.y > geometry.fields[i - 1].y));
        const screenshot = await cmd('Page.captureScreenshot', { format: 'png' });
        const destination = path.join(temporary, `modal-${width}.png`);
        await writeFile(destination, Buffer.from(screenshot.data, 'base64'));
        console.log(JSON.stringify({ viewport: width, geometry, screenshot: destination }));
    }
    assert.ok(queries.includes('Ana') && queries.includes('Prueba') && queries.includes('0012'));
    assert.deepEqual(errors.filter(e => !e.includes('favicon.ico')), []);
    console.log(JSON.stringify({ success: true, syntheticWrites: writes.length, selectedPatient: 83,
        checks: ['no selection no POST', 'keyboard', 'autofill', 'invalidation', '409 retry', 'POST contract', 'success cleanup', 'close/reopen', 'reset', 'responsive'] }));
} finally {
    if (socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {});
    socket?.close(); browser.kill(); server.close();
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    await Promise.race([exited, delay(3000)]);
    // Only this run's owned Chrome profile, outside the repository.
    assert.equal(path.dirname(profile), temporary);
    assert.equal(path.dirname(temporary), os.tmpdir());
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
