import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { formatDate } from '../assets/js/core/formatters.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function load(file, globals) {
    const source = await readFile(new URL(`../assets/js/${file}`, import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), {
        context: vm.createContext(globals)
    });
    await module.link(() => { throw Error('Unexpected import'); });
    await module.evaluate();
    return module.namespace;
}

test('all four profiles show authenticated birth read-only and retain it on reset', async () => {
    const { formatDate } = await import('../assets/js/core/formatters.js');
    for (const role of ['paciente', 'medico', 'secretaria', 'admin']) {
        const html = await readFile(new URL(`../pages/${role}/perfil-${role}.html`, import.meta.url), 'utf8');
        assert.match(html, /class="col-12 col-md-6">\s*<label[^>]*>Fecha de nacimiento<\/label>\s*<input[^>]*name="fecha_nacimiento" readonly>/);
        for (const birth of [null, '1987-03-12', '1992-02-29', '2000-12-31']) {
            const inputs = [{ name: 'fecha_nacimiento' }, { name: 'nombre' }, { name: 'email' }];
            const form = new EventTarget();
            form.querySelectorAll = () => inputs;
            form.querySelector = () => null;
            const module = await load('features/auth/auth-ui.js', {
                document: { querySelector: () => form },
                getCurrentUser: () => ({ fecha_nacimiento: birth, nombre: 'Ana', email: 'ana@example.test', perfil: null }),
                formatDate, pageMessage() {}, initPasswordToggles() {}
            });
            module.initAccountProfile();
            assert.equal(inputs[0].value, birth ? formatDate(birth, '-') : 'No registrada');
            if (birth === '1987-03-12') assert.equal(inputs[0].value, '12-03-1987');
            assert.equal(inputs[0].defaultValue, inputs[0].value);
            assert.ok(inputs.every(input => input.readOnly));
            assert.equal(inputs[1].value, 'Ana');
            assert.equal(inputs[2].value, 'ana@example.test');
        }
    }
});

async function management({ serverError = false, birthDate = null, patientOnly = false } = {}) {
    let today = '2026-11-18';
    const nodes = new Map(), requests = [], serviceCalls = [];
    function element() {
        const result = new EventTarget();
        Object.assign(result, { value: '', dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
            setCustomValidity(message) { this.validationMessage = message; },
            setAttribute() {}, prepend(child) { this.prepended = child; }, replaceChildren() {}, querySelectorAll: () => [] });
        result.querySelector = () => element();
        return result;
    }
    function node(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
    }
    const createBody = element();
    const html = await readFile(new URL('../pages/admin/gestion-usuarios.html', import.meta.url), 'utf8');
    const createHtml = html.match(/<form id="adminUsuarioCrearForm"[\s\S]*?<\/form>/)[0];
    const birthTag = createHtml.match(/<input[^>]*name="fecha_nacimiento"[^>]*>/)[0];
    const birth = node(birthTag.match(/id="([^"]+)"/)[1]);
    node('adminUsuarioCrearForm').elements = { namedItem: name => name === 'fecha_nacimiento' ? birth : null };
    node('adminUsuarioCrearForm').querySelector = selector => selector === '.modal-body' ? createBody : element();
    node('adminUsuarioCrearForm').reset = () => {};
    // Deliberately accept native validity: explicit date validation must still reject manual input.
    node('adminUsuarioCrearForm').checkValidity = () => true;
    node('adminUsuarioEditarForm').checkValidity = () => true;
    const user = { id: 7, nombre: 'Ana', apellido: 'Prueba', dni: '123', telefono: '456',
        email: 'ana@example.test', rol: 'MEDICO', fecha_nacimiento: birthDate,
        perfil: { matricula: 'MP-1', especialidad: { id: 1, nombre: 'Clinica' } } };
    const patient = { ...user, id: 8, rol: 'PACIENTE', is_active: true, perfil: { id: 3, obra_social: 'Cobertura' } };
    const { validateBirthDate } = await load('components/birth-date.js', { todayInputValue: () => today });
    const api = await load('core/api.js', {
        URL, window: { location: { origin: 'http://localhost' } },
        fetch: async (url, options) => {
            const body = JSON.parse(options.body);
            requests.push({ method: options.method, body, path: url.pathname, headers: options.headers });
            if (url.pathname === '/api/admin/pacientes/8/' && options.method === 'PATCH') {
                assert.equal(typeof body.is_active, 'boolean');
                patient.is_active = body.is_active;
                return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ...patient }) };
            }
            const ok = !serverError && !!body.fecha_nacimiento;
            return { ok, status: ok ? 201 : 400, headers: { get: () => 'application/json' },
                json: async () => ok ? { id: 8, ...body } : { fecha_nacimiento: ['Este campo es obligatorio.'] } };
        }
    });
    api.setCsrfToken('local-csrf');
    const service = await load('features/users/users-service.js', { request: api.request, ApiError: api.ApiError });
    const module = await load('features/users/users-ui.js', {
        document: { getElementById: node, createElement: element },
        Option: function(label, value) { this.value = value; }, validateBirthDate, formatDate,
        errorMessage: api.errorMessage, esc: value => String(value),
        getBootstrapModal: value => value, showModal() {}, hideModal() {},
        listInternalUsers: async () => [], listAdminPatients: async () => patientOnly ? [{ ...patient }] : [], getAdminSpecialties: async () => [{ id: 1, nombre: 'Clinica' }],
        getAdminPatient: async () => ({ ...patient }), updateAdminPatient: service.updateAdminPatient,
        getInternalUser: async () => user,
        createInternalUser: async body => {
            serviceCalls.push(JSON.parse(JSON.stringify(body)));
            return service.createInternalUser(body);
        },
        updateInternalUser: async (id, body) => { requests.push({ method: 'PATCH', body }); }
    });
    await module.initUserManagement();
    const submit = async id => { node(id).dispatchEvent(new Event('submit', { cancelable: true })); await tick(); };
    return { node, birth, requests, serviceCalls, submit, setToday: value => { today = value; }, feedback: () => createBody.prepended };
}

test('internal creation sends birth and preserves each role-specific field', async () => {
    for (const role of ['medico', 'secretaria']) {
        const page = await management();
        page.node('crearUsuarioRol').value = role;
        page.node('crearUsuarioRol').dispatchEvent(new Event('change'));
        page.birth.value = '1992-02-29';
        page.node('crearUsuarioMatricula').value = 'MP-1';
        page.node('crearUsuarioEspecialidad').value = '1';
        page.node('crearUsuarioLegajo').value = 'SEC-1';
        page.node('crearUsuarioPassword').value = 'Valid!123Az';
        assert.equal(page.birth.max, '2026-11-18');
        assert.equal(page.birth.required, true);
        await page.submit('adminUsuarioCrearForm');
        assert.equal(page.requests.length, 1);
        assert.equal(page.serviceCalls.length, 1);
        assert.equal(page.serviceCalls[0].fecha_nacimiento, '1992-02-29');
        assert.equal(page.requests[0].path, '/api/admin/usuarios/');
        assert.equal(page.requests[0].headers['Content-Type'], 'application/json');
        assert.equal(page.node('adminUsuariosMensaje').textContent, 'Cuenta creada correctamente.');
        const body = page.requests[0].body;
        assert.equal(body.fecha_nacimiento, '1992-02-29');
        assert.equal(body.rol, role.toUpperCase());
        assert.equal(body.password, 'Valid!123Az');
        if (role === 'medico') {
            assert.equal(body.matricula, 'MP-1');
            assert.equal(body.especialidad, 1);
            assert.equal(body.legajo, undefined);
        } else {
            assert.equal(body.legajo, 'SEC-1');
            assert.equal(body.matricula, undefined);
            assert.equal(body.especialidad, undefined);
        }
    }
});

test('administration details display birth with hyphens or the historical fallback', async () => {
    for (const birthDate of ['1987-03-12', null]) {
        const page = await management({ birthDate });
        const event = new Event('click');
        Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset: { user: '7', action: 'detail' } }) } });
        page.node('adminGestionUsuariosTabla').dispatchEvent(event);
        await tick();
        const html = page.node('adminUsuarioDetalleContenido').innerHTML;
        assert.ok(html.includes(birthDate ? '12-03-1987' : 'No registrada'));
        assert.ok(html.includes('Fecha de nacimiento'));
        assert.equal(page.requests.length, 0);
    }
});

test('service refuses a missing or malformed birth before issuing any HTTP request', async () => {
    const { ApiError } = await load('core/api.js', {});
    let requests = 0;
    const service = await load('features/users/users-service.js', {
        ApiError, request: async () => { requests++; }
    });
    for (const body of [undefined, {}, { fecha_nacimiento: undefined }, { fecha_nacimiento: '' },
        { fecha_nacimiento: null }, { fecha_nacimiento: '29/02/1992' }]) {
        await assert.rejects(service.createInternalUser(body), error => {
            assert.ok(error instanceof ApiError);
            assert.ok(error.data.fecha_nacimiento);
            return true;
        });
    }
    assert.equal(requests, 0);
});

test('missing, invalid and future birth block creation with existing feedback', async () => {
    for (const value of ['', 'invalid', '2025-02-29', '2026-11-19']) {
        const page = await management();
        page.birth.value = value;
        await page.submit('adminUsuarioCrearForm');
        assert.equal(page.requests.length, 0);
        assert.equal(page.serviceCalls.length, 0);
        assert.equal(page.feedback().className, 'alert alert-danger');
        assert.match(page.feedback().textContent, /fecha de nacimiento/);
    }
    const html = await readFile(new URL('../pages/admin/gestion-usuarios.html', import.meta.url), 'utf8');
    assert.match(html, /type="date"[^>]*name="fecha_nacimiento"[^>]*required/);
    assert.match(html, /class="invalid-feedback" id="crearUsuarioFechaNacimientoError"/);
    assert.equal((html.match(/name="fecha_nacimiento"/g) || []).length, 1);
});

test('backend date errors remain visible in the creation form', async () => {
    const page = await management({ serverError: true });
    page.birth.value = '1992-02-29';
    page.node('crearUsuarioRol').value = 'secretaria';
    await page.submit('adminUsuarioCrearForm');
    assert.equal(page.requests.length, 1);
    assert.equal(page.feedback().className, 'alert alert-danger');
    assert.equal(page.feedback().textContent, 'Fecha de nacimiento: Este campo es obligatorio.');
    assert.equal(page.birth.validationMessage, 'Este campo es obligatorio.');
    page.birth.dispatchEvent(new Event('input'));
    assert.equal(page.birth.validationMessage, '');
});

test('internal creation refreshes local maximum on reopening and submission', async () => {
    const page = await management();
    page.setToday('2026-11-19');
    page.node('crearUsuarioInternoBtn').dispatchEvent(new Event('click'));
    assert.equal(page.birth.max, '2026-11-19');
    page.setToday('2026-11-20');
    page.birth.value = '2026-11-20';
    page.node('crearUsuarioRol').value = 'secretaria';
    await page.submit('adminUsuarioCrearForm');
    assert.equal(page.birth.max, '2026-11-20');
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].body.fecha_nacimiento, '2026-11-20');
});

test('editing historical users sends existing fields without requiring birth', async () => {
    const page = await management();
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset: { user: '7', action: 'edit' } }) } });
    page.node('adminGestionUsuariosTabla').dispatchEvent(event);
    await tick();
    page.node('editarUsuarioNombre').value = 'Editada';
    await page.submit('adminUsuarioEditarForm');
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].method, 'PATCH');
    assert.equal(page.requests[0].body.nombre, 'Editada');
    assert.equal(page.requests[0].body.matricula, 'MP-1');
    assert.equal(page.requests[0].body.especialidad, 1);
    assert.equal(page.requests[0].body.fecha_nacimiento, undefined);
});

test('admin patient activation requires confirmation, preserves internal editing and refreshes state', async () => {
    const page = await management({ patientOnly: true });
    let html = page.node('adminGestionUsuariosTabla').innerHTML;
    assert.match(html, /Paciente/);
    assert.match(html, /Activo/);
    assert.doesNotMatch(html, /data-action="edit"/);
    for (const active of [false, true]) {
        const before = page.requests.length;
        const event = new Event('click');
        Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset: { user: '8', action: 'status' } }) } });
        page.node('adminGestionUsuariosTabla').dispatchEvent(event);
        await tick();
        assert.equal(page.requests.length, before);
        assert.match(page.node('adminUsuarioEstadoTexto').textContent, /no cancela turnos futuros/);
        page.node('adminUsuarioConfirmarEstadoBtn').dispatchEvent(new Event('click'));
        await tick();
        assert.equal(page.requests.length, before + 1);
        const request = page.requests.at(-1);
        assert.equal(request.path, '/api/admin/pacientes/8/');
        assert.deepEqual(request.body, { is_active: active });
        html = page.node('adminGestionUsuariosTabla').innerHTML;
        assert.match(html, active ? /Activo/ : /Inactivo/);
    }
});
