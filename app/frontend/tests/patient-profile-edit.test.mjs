import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { formatDate } from '../assets/js/core/formatters.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function load(file, globals) {
    const source = await readFile(new URL(`../assets/js/${file}`, import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context: vm.createContext(globals) });
    await module.link(() => { throw Error('Unexpected import'); }); await module.evaluate();
    return module.namespace;
}
function element() {
    const result = new EventTarget(), classes = new Set();
    Object.assign(result, { value: '', defaultValue: '', readOnly: false, disabled: false,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
        setCustomValidity(message) { this.validationMessage = message; } });
    return result;
}
async function setup({ fail = false, valid = true, refreshFails = false, role = 'PACIENTE' } = {}) {
    let current = { id: 7, rol: role, nombre: 'Ana', apellido: 'Original', email: 'ana@example.test',
        dni: '123', telefono: '456', fecha_nacimiento: '1987-03-12', perfil: { id: 8, obra_social: 'Cobertura' } };
    const personal = element(), password = element(), save = element(), change = element(), message = element(), navbar = element();
    const fields = Object.fromEntries(['nombre', 'apellido', 'email', 'telefono', 'obra_social', 'dni', 'fecha_nacimiento', 'matricula', 'especialidad', 'legajo'].map(key => {
        const field = element(), error = element(); field.name = key; field.error = error;
        field.closest = () => ({ querySelector: () => error });
        return [key, field];
    }));
    const passwords = Object.fromEntries(['Actual', 'Nueva', 'Confirmar'].map(key => [key, element()]));
    personal.elements = { namedItem: key => fields[key] };
    personal.querySelectorAll = () => Object.values(fields);
    personal.querySelector = () => save;
    personal.checkValidity = () => valid;
    password.querySelector = selector => selector === '[type="submit"]' ? change
        : selector.includes('PasswordNueva') ? null
        : Object.entries(passwords).find(([key]) => selector.includes(key))?.[1];
    const document = { getElementById: id => ({ perfilPacienteDatosForm: personal, perfilMensaje: message })[id],
        querySelector: selector => selector === 'form[data-form="personal-details"]' ? (role === 'PACIENTE' ? null : personal) : password,
        querySelectorAll: () => [navbar] };
    const requests = []; let refreshes = 0;
    const globals = { document, formatDate, getCurrentUser: () => current, pageMessage() {}, initPasswordToggles() {},
        errorMessage: error => error.message,
        refreshUser: async force => { assert.equal(force, true); refreshes++; if (refreshFails) throw Error('offline'); return current; },
        request: async (url, options) => {
            requests.push({ url, ...options });
            if (url === 'auth/password/') return { detail: 'Contraseña actualizada' };
            if (fail) throw Object.assign(Error('Ingrese un teléfono numérico.'), { data: { telefono: ['Ingrese un teléfono numérico.'] } });
            const { obra_social, ...data } = options.body;
            current = { ...current, ...data, perfil: { ...current.perfil, obra_social } };
            return current;
        } };
    (await load('features/auth/auth-ui.js', globals)).initAccountProfile();
    (await load('features/auth/patient-profile-ui.js', globals)).initPatientProfileEditing();
    return { personal, password, fields, passwords, save, message, navbar, requests, refreshes: () => refreshes,
        submit: async form => { form.dispatchEvent(new Event('submit', { cancelable: true })); await tick(); } };
}

test('patient personal fields are editable while identity remains formatted and read-only', async () => {
    const page = await setup();
    for (const key of ['nombre', 'apellido', 'telefono', 'obra_social']) assert.equal(page.fields[key].readOnly, false);
    for (const key of ['email', 'dni', 'fecha_nacimiento']) assert.equal(page.fields[key].readOnly, true);
    assert.equal(page.fields.fecha_nacimiento.value, '12-03-1987');
    assert.equal(page.fields.obra_social.required, false);
    assert.equal(page.fields.nombre.required, true);
});

test('saving sends only allowed fields, clears coverage, refreshes session and updates navbar/defaults', async () => {
    const page = await setup();
    page.fields.nombre.value = ' Nueva ';
    page.fields.email.value = ' NUEVA@EXAMPLE.TEST ';
    page.fields.obra_social.value = '';
    await page.submit(page.personal);
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].url, 'auth/me/');
    assert.equal(page.requests[0].method, 'PATCH');
    assert.deepEqual(JSON.parse(JSON.stringify(page.requests[0].body)), { nombre: 'Nueva', apellido: 'Original', telefono: '456', obra_social: '' });
    assert.equal(page.fields.email.value, 'ana@example.test');
    assert.equal(page.fields.email.defaultValue, 'ana@example.test');
    assert.equal(page.fields.obra_social.defaultValue, '');
    assert.equal(page.navbar.textContent, 'Nueva Original');
    assert.equal(page.fields.fecha_nacimiento.value, '12-03-1987');
    assert.equal(page.refreshes(), 1);
    assert.equal(page.message.className, 'alert alert-success');
});

test('editable field errors remain visible, preserve input and allow correction', async () => {
    const page = await setup({ fail: true });
    page.fields.telefono.value = 'invalid';
    await page.submit(page.personal);
    assert.match(page.message.textContent, /teléfono numérico/);
    assert.match(page.fields.telefono.validationMessage, /teléfono numérico/);
    assert.equal(page.fields.telefono.value, 'invalid');
    assert.equal(page.fields.telefono.defaultValue, '456');
    assert.equal(page.save.disabled, false);
    page.fields.telefono.dispatchEvent(new Event('input'));
    assert.equal(page.fields.telefono.validationMessage, '');
});

test('invalid personal form blocks writes and duplicate submits produce one PATCH', async () => {
    const invalid = await setup({ valid: false });
    await invalid.submit(invalid.personal);
    assert.equal(invalid.requests.length, 0);
    const page = await setup();
    page.personal.dispatchEvent(new Event('submit', { cancelable: true }));
    page.personal.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    assert.equal(page.requests.length, 1);
});

test('password form remains independent from invalid/unsaved personal changes', async () => {
    const page = await setup({ valid: false });
    page.fields.nombre.value = '';
    for (const field of Object.values(page.passwords)) field.value = 'Valid!123Az';
    await page.submit(page.password);
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].url, 'auth/password/');
    assert.equal(page.requests[0].body.password_actual, 'Valid!123Az');
    assert.equal(page.fields.nombre.value, '');
    assert.equal(page.passwords.Nueva.value, '');
});

test('refresh failure after persistence reports saved data without claiming the PATCH failed', async () => {
    const page = await setup({ refreshFails: true });
    page.fields.nombre.value = 'Guardado';
    await page.submit(page.personal);
    assert.equal(page.fields.nombre.defaultValue, 'Guardado');
    assert.equal(page.message.className, 'alert alert-warning');
    assert.match(page.message.textContent, /datos se guardaron/);
});

test('HTML has separate personal/password forms, immutable identity and no nested forms', async () => {
    const html = await readFile(new URL('../pages/paciente/perfil-paciente.html', import.meta.url), 'utf8');
    const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]);
    assert.equal(forms.length, 2);
    assert.ok(forms.every(form => (form.match(/<form\b/g) || []).length === 1));
    assert.match(forms[0], /id="perfilPacienteDatosForm"/);
    assert.doesNotMatch(forms[0], /type="password"/);
    assert.match(forms[1], /data-form="patient-profile"/);
    assert.match(forms[0], /name="dni" readonly/);
    assert.match(forms[0], /name="fecha_nacimiento" readonly/);
    assert.match(forms[0], /name="email"[^>]*readonly/);
});

test('doctor and secretary reuse editing with exactly three fields and protected identity/professional data', async () => {
    for (const role of ['MEDICO', 'SECRETARIA']) {
        const page = await setup({ role });
        for (const key of ['nombre', 'apellido', 'telefono']) assert.equal(page.fields[key].readOnly, false);
        for (const key of ['email', 'dni', 'fecha_nacimiento', 'matricula', 'especialidad', 'legajo']) assert.equal(page.fields[key].readOnly, true);
        page.fields.nombre.value = 'Nuevo';
        await page.submit(page.personal);
        assert.deepEqual(JSON.parse(JSON.stringify(page.requests[0].body)), { nombre: 'Nuevo', apellido: 'Original', telefono: '456' });
        assert.equal(page.fields.nombre.defaultValue, 'Nuevo');
        assert.equal(page.fields.email.value, 'ana@example.test');
        assert.equal(page.fields.fecha_nacimiento.value, '12-03-1987');
        assert.equal(page.navbar.textContent, 'Nuevo Original');
        assert.equal(page.refreshes(), 1);
    }
});

test('both professional roles retain field errors and independent password submission', async () => {
    for (const role of ['MEDICO', 'SECRETARIA']) {
        const page = await setup({ role, fail: true });
        await page.submit(page.personal);
        assert.match(page.message.textContent, /teléfono numérico/);
        assert.equal(page.save.disabled, false);
        for (const field of Object.values(page.passwords)) field.value = 'Valid!123Az';
        await page.submit(page.password);
        assert.equal(page.requests.at(-1).url, 'auth/password/');
        assert.equal(page.passwords.Nueva.value, '');
    }
});

test('professional HTML separates forms and protects identifying and institutional fields', async () => {
    for (const role of ['medico', 'secretaria']) {
        const html = await readFile(new URL(`../pages/${role}/perfil-${role}.html`, import.meta.url), 'utf8');
        const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]);
        assert.equal(forms.length, 2);
        assert.ok(forms.every(form => (form.match(/<form\b/g) || []).length === 1));
        assert.match(forms[0], /data-form="personal-details"/);
        assert.doesNotMatch(forms[0], /type="password"/);
        for (const key of ['email', 'dni', 'fecha_nacimiento', ...(role === 'medico' ? ['matricula', 'especialidad'] : ['legajo'])]) {
            assert.match(forms[0], new RegExp(`name="${key}"[^>]*readonly`));
        }
        assert.match(forms[1], /type="password"/);
    }
});
