// Invoked by Django LiveServerTestCase; all API calls reach the isolated local test database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const origin = process.env.PATIENT_TEST_ORIGIN;
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || ''), 'Only a disposable local Django server is allowed');
const fixturePassword = process.env.PATIENT_TEST_PASSWORD;
const patientEmail = process.env.PATIENT_TEST_EMAIL;
assert.ok(fixturePassword);
const patientId = process.env.PATIENT_TEST_ID;
assert.match(patientId, /^\d+$/);
const profile = path.resolve('.tmp-mejora19', `patient-management-browser-${randomUUID()}`);
await mkdir(profile, { recursive: true });
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
    '--disable-component-update', '--disable-extensions', '--disable-default-apps',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let launchError, socket, counter = 0;
browser.on('error', error => { launchError = error; });
const pending = new Map(), writes = [], errors = [];
let cancelledInterceptions = 0;
function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const id = ++counter;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}
async function newPage() {
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable']) await send(method, {}, sessionId);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    }
    async function until(expression) {
        for (let i = 0; i < 150; i++) {
            if (await evaluate(expression)) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw Error(`Condition not met: ${expression}`);
    }
    async function go(file) { await send('Page.navigate', { url: `${origin}/frontend/pages/${file}` }, sessionId); }
    return { evaluate, until, go, insertText: text => send('Input.insertText', { text }, sessionId) };
}
async function login(page, email, shouldSucceed = true, password = fixturePassword) {
    await page.go('auth/login.html');
    await page.until("document.querySelector('form [type=submit]')?.disabled===false");
    await page.evaluate(`document.querySelector('#email').value=${JSON.stringify(email)}; document.querySelector('#password').value=${JSON.stringify(password)}; document.querySelector('form').requestSubmit()`);
    if (shouldSucceed) await page.until("location.pathname.endsWith('/dashboard.html')");
    else await page.until("!!document.querySelector('[data-api-feedback]')?.textContent");
}
async function api(page, route, body) {
    if (body === undefined) {
        return page.evaluate(`(async()=>{const response=await fetch('/api/'+${JSON.stringify(route)},{credentials:'same-origin'});return response.ok?{ok:true}:{ok:false,status:response.status}})()`);
    }
    return page.evaluate(`(async()=>{
        const {request,setCsrfToken}=await import('/frontend/assets/js/core/api.js');
        try {const data=await request(${JSON.stringify(route)},${JSON.stringify(body === undefined ? {} : { method: 'POST', body })});if(${JSON.stringify(route)}==='auth/login/')setCsrfToken(data.csrfToken);return {ok:true,rol:data?.rol};}
        catch(error){return {ok:false,status:error.status};}
    })()`);
}
try {
    let port;
    for (let i = 0; i < 100; i++) {
        if (launchError) throw launchError;
        try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!port) throw Error('No Chrome debugging port');
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Fetch.requestPaused') {
            const allowed = message.params.request.url.startsWith(origin + '/');
            send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: message.params.requestId,
                ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }, message.sessionId).catch(error => {
                    // Navigation may cancel an asset before CDP handles its paused request.
                    if (error.message.includes('"code":-32602') && error.message.includes('Invalid InterceptionId.')) cancelledInterceptions++;
                    else errors.push(error.message);
                });
        }
        if (message.method === 'Network.requestWillBeSent') {
            const request = message.params.request;
            if (request.method === 'PATCH') writes.push({ path: new URL(request.url).pathname, body: JSON.parse(request.postData) });
        }
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
        const waiter = pending.get(message.id);
        if (waiter) { clearTimeout(waiter.timer); pending.delete(message.id); message.error ? waiter.reject(Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
    };
    const patient = await newPage();
    await login(patient, process.env.PATIENT_TEST_EMAIL);
    await patient.go('paciente/perfil-paciente.html');
    await patient.until("document.querySelector('#perfilNombre')?.defaultValue==='Persona' && document.querySelector('#perfilNombre').readOnly===false");
    const identity = await patient.evaluate("({birth:document.querySelector('#perfilFechaNacimiento').value,birthReadOnly:document.querySelector('#perfilFechaNacimiento').readOnly,dniReadOnly:document.querySelector('#perfilDni').readOnly,emailReadOnly:document.querySelector('#perfilEmail').readOnly,forms:document.querySelectorAll('main form').length})");
    assert.deepEqual(identity, { birth: '12-03-1987', birthReadOnly: true, dniReadOnly: true, emailReadOnly: true, forms: 2 });
    await patient.evaluate("document.querySelector('#perfilEmail').focus()");
    await patient.insertText('no-permitido@example.test');
    assert.equal(await patient.evaluate("document.querySelector('#perfilEmail').value"), patientEmail);
    async function editProfile() {
        await patient.evaluate(`(() => {
            for(const [name,value] of Object.entries({nombre:'Editado',apellido:'Paciente',telefono:'3511234567',obra_social:''})){
                const input=document.querySelector('#perfilPacienteDatosForm').elements.namedItem(name);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
            }
            document.querySelector('#perfilPacienteDatosForm').requestSubmit();
        })()`);
    }
    await editProfile();
    await patient.until("document.querySelector('#perfilMensaje').classList.contains('alert-success')");
    assert.equal(await patient.evaluate("document.querySelector('#perfilEmail').value"), patientEmail);
    assert.equal(await patient.evaluate("document.querySelector('#perfilPacienteNavbar').textContent"), 'Editado Paciente');
    assert.ok(writes.filter(item => item.path === '/api/auth/me/').every(item => !('email' in item.body) && !('dni' in item.body) && !('fecha_nacimiento' in item.body) && !('password' in item.body)));
    const forbiddenEdit = await patient.evaluate(`(async()=>{
        const {request}=await import('/frontend/assets/js/core/api.js');
        try{await request('auth/me/',{method:'PATCH',body:{email:'no-permitido@example.test',nombre:'No guardar'}});return {status:200};}
        catch(error){return {status:error.status,emailRejected:!!error.data?.email};}
    })()`);
    assert.deepEqual(forbiddenEdit, { status: 400, emailRejected: true });
    await patient.go('paciente/perfil-paciente.html');
    await patient.until(`document.querySelector('#perfilEmail')?.value===${JSON.stringify(patientEmail)}`);
    assert.equal(await patient.evaluate("document.querySelector('#perfilNombre').value"), 'Editado');
    assert.equal(await patient.evaluate("document.querySelector('#perfilObraSocial').value"), '');
    await patient.evaluate("(async()=>{const {logout}=await import('/frontend/assets/js/core/session.js');await logout()})()");
    await patient.until("location.pathname.endsWith('/login.html')");
    await login(patient, patientEmail);

    const admin = await newPage();
    await login(admin, process.env.PATIENT_TEST_ADMIN_EMAIL);
    await admin.go('admin/gestion-usuarios.html');
    await admin.until(`!!document.querySelector('#adminGestionUsuariosTabla [data-user="${patientId}"][data-action="status"]')`);
    for (const active of [false, true]) {
        const before = writes.filter(item => item.path === `/api/admin/pacientes/${patientId}/`).length;
        await admin.evaluate(`document.querySelector('#adminGestionUsuariosTabla [data-user="${patientId}"][data-action="status"]').click()`);
        await admin.until(`document.querySelector('#adminUsuarioEstadoTitulo').textContent===${JSON.stringify(active ? 'Activar cuenta' : 'Desactivar cuenta')}`);
        await admin.until("document.querySelector('#adminUsuarioEstadoTexto').textContent.includes('no cancela turnos futuros')");
        assert.equal(writes.filter(item => item.path === `/api/admin/pacientes/${patientId}/`).length, before);
        await admin.evaluate("document.querySelector('#adminUsuarioConfirmarEstadoBtn').click()");
        const label = active ? 'Desactivar' : 'Activar';
        await admin.until(`document.querySelector('#adminGestionUsuariosTabla [data-user="${patientId}"][data-action="status"]')?.textContent===${JSON.stringify(label)}`);
        assert.equal(writes.at(-1).body.is_active, active);
        if (!active) {
            assert.deepEqual(await api(patient, 'auth/me/'), { ok: false, status: 403 });
            assert.deepEqual(await api(patient, 'turnos/'), { ok: false, status: 403 });
            assert.equal((await api(patient, 'auth/password-reset/', { email: patientEmail })).ok, true);
        }
    }
    assert.equal((await api(patient, 'auth/login/', { email: patientEmail, password: fixturePassword })).ok, true);
    assert.equal((await api(patient, 'auth/password-reset/', { email: patientEmail })).ok, true);
    const professionals = [];
    for (const [folder, prefix, email, updatedName] of [
        ['medico', 'Medico', process.env.PROFESSIONAL_TEST_DOCTOR_EMAIL, 'Medico editado'],
        ['secretaria', 'Secretaria', process.env.PROFESSIONAL_TEST_SECRETARY_EMAIL, 'Secretaria editada']
    ]) {
        const page = await newPage();
        await login(page, email);
        await page.go(`${folder}/perfil-${folder}.html`);
        await page.until(`document.querySelector('#perfil${prefix}Nombre')?.defaultValue==='Persona' && document.querySelector('#perfil${prefix}Nombre').readOnly===false`);
        const protectedKeys = ['email', 'dni', 'fecha_nacimiento', ...(folder === 'medico' ? ['matricula', 'especialidad'] : ['legajo'])];
        const protectedState = await page.evaluate(`(() => {
            const form=document.querySelector('[data-form="personal-details"]');
            return Object.fromEntries(${JSON.stringify(protectedKeys)}.map(key=>{const input=form.elements.namedItem(key);return [key,{value:input.value,readOnly:input.readOnly}]}));
        })()`);
        assert.ok(Object.values(protectedState).every(input => input.readOnly));
        assert.equal(protectedState.email.value, email);
        assert.equal(protectedState.fecha_nacimiento.value, '12-03-1987');
        await page.evaluate(`(() => {
            const form=document.querySelector('[data-form="personal-details"]');
            for(const [name,value] of Object.entries({nombre:${JSON.stringify(updatedName)},apellido:'Perfil actualizado',telefono:'3514445566'})){
                const input=form.elements.namedItem(name);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
            }
            form.requestSubmit();
        })()`);
        await page.until(`document.querySelector('#perfil${prefix}Mensaje').classList.contains('alert-success')`);
        assert.deepEqual(Object.keys(writes.at(-1).body).sort(), ['apellido', 'nombre', 'telefono']);
        assert.equal(await page.evaluate(`document.querySelector('#perfil${prefix}Navbar').textContent`), `${updatedName} Perfil actualizado`);
        for (const key of protectedKeys) {
            const result = await page.evaluate(`(async()=>{
                const {request}=await import('/frontend/assets/js/core/api.js');
                try{await request('auth/me/',{method:'PATCH',body:{nombre:'No guardar',${JSON.stringify(key)}:'No permitido'}});return 200;}
                catch(error){return error.status;}
            })()`);
            assert.equal(result, 400);
        }
        await page.go(`${folder}/perfil-${folder}.html`);
        await page.until(`document.querySelector('#perfil${prefix}Nombre')?.defaultValue===${JSON.stringify(updatedName)} && document.querySelector('#perfil${prefix}Nombre').readOnly===false`);
        const afterReload = await page.evaluate(`(() => {
            const form=document.querySelector('[data-form="personal-details"]');
            return Object.fromEntries(${JSON.stringify(protectedKeys)}.map(key=>[key,{value:form.elements.namedItem(key).value,readOnly:form.elements.namedItem(key).readOnly}]));
        })()`);
        assert.deepEqual(afterReload, protectedState);
        await page.evaluate(`(() => {
            const form=document.querySelector('#perfil${prefix}Form');
            form.elements.namedItem('passwordActual').value=${JSON.stringify(fixturePassword)};
            form.elements.namedItem('passwordNueva').value='Nueva!Clave4827Az';
            form.elements.namedItem('passwordConfirmar').value='Nueva!Clave4827Az';
            form.requestSubmit();
        })()`);
        await page.until("document.querySelector('#apiPageMessage')?.textContent==='Contraseña actualizada correctamente.'");
        await page.evaluate("(async()=>{const {logout}=await import('/frontend/assets/js/core/session.js');await logout()})()");
        await page.until("location.pathname.endsWith('/login.html')");
        await login(page, email, true, 'Nueva!Clave4827Az');
        professionals.push({ role: folder, persisted: true, protectedFields: true, independentPasswordChange: true });
    }
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const summary = { result: 'PASS', browser: version.Browser, realDjangoApi: true, profileEditing: true,
        emailReadOnly: true, directEmailPatchRejected: true, originalEmailLogin: true, confirmationRequired: true, inactiveSessionBlocked: true,
        reactivation: true, recoveryForActive: true, professionals, cancelledInterceptions, writes };
    await writeFile('.tmp-mejora19/patient-management-browser.json', JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ result: 'PASS', browser: version.Browser, scenarios: 'profile-edit, readonly-email, direct-email-rejection, login, deactivate, old-session-denial, reactivate, recovery' }));
} finally {
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} socket.close(); }
    else browser.kill();
}
