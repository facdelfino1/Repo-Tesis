import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function setup(birthValue = '1992-02-29', { valid = true } = {}) {
    let today = '2026-11-17';
    const document = new EventTarget(), form = new EventTarget(), requests = [];
    const values = { nombre: 'Ana', apellido: 'Prueba', dni: '123', telefono: '456', email: 'ana@example.test',
        obraSocial: '', password: 'Valid!123Az', confirmPassword: 'Valid!123Az', fecha_nacimiento: birthValue };
    const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, {
        value, validity: {}, setCustomValidity(message) { this.validationMessage = message; }, disabled: false
    }]));
    const button = {}, success = { classList: { remove() {} } };
    form.elements = { namedItem: name => fields[name] };
    let feedback = null;
    const classes = new Set();
    form.querySelector = selector => selector === '[type="submit"]' ? button : feedback;
    form.prepend = node => { feedback = node; };
    form.querySelectorAll = () => Object.values(fields);
    form.classList = { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } };
    form.reset = () => {};
    form.checkValidity = () => valid;
    document.querySelector = selector => selector === '[data-form="patient-register"]' ? form : null;
    document.getElementById = () => success;
    document.createElement = () => ({ dataset: {}, setAttribute() {} });
    const source = await readFile(new URL('../assets/js/auth.js', import.meta.url), 'utf8');
    const birthSource = await readFile(new URL('../assets/js/components/birth-date.js', import.meta.url), 'utf8');
    const birthModule = new vm.SourceTextModule(birthSource.replace(/^import .*;\r?\n/gm, ''), {
        context: vm.createContext({ todayInputValue: () => today })
    });
    await birthModule.link(() => { throw Error('Unexpected import'); });
    await birthModule.evaluate();
    const context = vm.createContext({ document, window: { location: { pathname: '/registro.html' }, setTimeout() {} },
        initPasswordToggles() {}, validateBirthDate: birthModule.namespace.validateBirthDate,
        request: async (url, options) => { requests.push({ url, ...options }); return { detail: 'Creada' }; } });
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await module.link(() => { throw Error('Unexpected import'); });
    await module.evaluate(); document.dispatchEvent(new Event('DOMContentLoaded'));
    return { fields, requests, classes, setToday: value => { today = value; }, feedback: () => feedback, submit: async () => {
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(resolve => setImmediate(resolve));
    } };
}

test('registration sends required birth and sets a calendar maximum', async () => {
    for (const value of ['1992-02-29', '2000-12-31']) {
        const page = await setup(value);
        assert.equal(page.fields.fecha_nacimiento.max, '2026-11-17');
        await page.submit();
        assert.equal(page.requests.length, 1);
        assert.equal(page.requests[0].url, 'auth/registro-paciente/');
        const body = page.requests[0].body;
        assert.equal(body.fecha_nacimiento, value);
        assert.equal(body.password_confirmacion, 'Valid!123Az');
    }
});

test('invalid native date validity blocks requests and shows Bootstrap feedback', async () => {
    // Native date inputs enforce required, real dates and the max attribute.
    for (const value of ['', '2025-02-29', '2026-11-18']) {
        const page = await setup(value, { valid: false });
        await page.submit();
        assert.equal(page.requests.length, 0);
        assert.equal(page.classes.has('was-validated'), true);
        assert.equal(page.feedback().className, 'alert alert-danger');
        assert.match(page.feedback().textContent, /fecha de nacimiento/);
    }
});

test('manual future and impossible dates are rejected even if native validity is bypassed', async () => {
    for (const value of ['', '2025-02-29', '2026-11-18']) {
        const page = await setup(value);
        await page.submit();
        assert.equal(page.requests.length, 0);
        assert.match(page.fields.fecha_nacimiento.validationMessage, /fecha de nacimiento/);
    }
});

test('registration refreshes local calendar maximum when submitting after midnight', async () => {
    const page = await setup('2026-11-18');
    assert.equal(page.fields.fecha_nacimiento.max, '2026-11-17');
    page.setToday('2026-11-18');
    await page.submit();
    assert.equal(page.fields.fecha_nacimiento.max, '2026-11-18');
    assert.equal(page.requests.length, 1);
    assert.equal(page.requests[0].body.fecha_nacimiento, '2026-11-18');
});

test('registration date is required with inline feedback and calendar formatting remains unchanged', async () => {
    const html = await readFile(new URL('../pages/auth/registro.html', import.meta.url), 'utf8');
    const control = html.match(/<input[^>]*name="fecha_nacimiento"[^>]*>/)[0];
    assert.match(control, /type="date"/);
    assert.match(control, /\brequired\b/);
    assert.match(html, /<label for="fechaNacimiento" class="form-label">Fecha de nacimiento<\/label>/);
    assert.match(html, /class="invalid-feedback">Ingrese su fecha de nacimiento, válida y no futura\./);
    const { formatDate } = await import('../assets/js/core/formatters.js');
    const originalTimezone = process.env.TZ;
    try {
        for (const timezone of ['UTC', 'America/Argentina/Buenos_Aires', 'Pacific/Kiritimati', 'Pacific/Apia']) {
            process.env.TZ = timezone;
            assert.equal(formatDate('1992-02-29'), '29/02/1992');
            assert.equal(formatDate('1987-03-12', '-'), '12-03-1987');
            assert.equal(formatDate('1992-02-29', '-'), '29-02-1992');
            assert.equal(formatDate('2011-12-30', '-'), '30-12-2011');
        }
    } finally {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
    }
});
