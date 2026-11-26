import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as service from '../assets/js/features/availability/availability-service.js';

class Element extends EventTarget {
    value = ''; innerHTML = ''; textContent = ''; disabled = false;
    classList = { add() {}, remove() {} };
    replaceChildren() { this.innerHTML = ''; }
    querySelector() { return this.submit ||= new Element(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup({ doctorMode = true, failSave = false, failRefresh = false } = {}) {
    const nodes = new Map(), links = [new Element(), new Element()], form = new Element();
    const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
    const navigation = [], writes = [];
    let shown = 0;
    const doctor = { id: 2, nombre: 'Profesional', apellido: 'Ficticio', especialidad: { nombre: 'Cardiología' } };
    const modal = { show: () => { shown++; } };
    const context = vm.createContext({ ...service,
        document: { getElementById: node, querySelector: () => form,
            querySelectorAll: selector => { assert.equal(doctorMode, true); assert.equal(selector, '[data-doctor-availability-exit]'); return links; } },
        window: { location: { assign: target => navigation.push(target) } },
        getCurrentUser: () => ({ ...doctor, perfil: doctor }),
        getBootstrapModal: () => modal, showModal: instance => instance.show(),
        bindDoctorSelectors: async (_specialty, _doctor, callback) => callback(doctor),
        getAvailability: async () => { if (failRefresh) throw Error('Refresh failed'); return []; },
        request: async (path, options) => { writes.push({ path, options }); if (failSave) throw Error('Save failed'); },
        setInterval() {}, formatDate: String, escapeHtml: String, errorMessage: error => error.message,
        timeToMinutes: value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
    });
    const source = await readFile(new URL('../assets/js/features/availability/availability-ui.js', import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await module.link(() => { throw Error('Unexpected import'); }); await module.evaluate();
    await module.namespace[doctorMode ? 'initDoctorAvailability' : 'initSecretaryAvailability']();
    const prefix = doctorMode ? 'disponibilidadMedico' : 'disponibilidad';
    const preview = node(doctorMode ? 'bloquesMedicoPreview' : 'bloquesPreview');
    const click = control => { const event = new Event('click', { cancelable: true }); control.dispatchEvent(event); return event; };
    const generate = () => {
        node(prefix + 'Fecha').value = '2030-01-02';
        node(prefix + 'HoraInicio').value = '09:00'; node(prefix + 'HoraFin').value = '09:40';
        click(node(doctorMode ? 'generarBloquesMedicoBtn' : 'generarBloquesBtn'));
        assert.match(preview.innerHTML, /09:00/);
    };
    return { node, form, links, preview, navigation, writes, generate, click, shown: () => shown,
        save: async () => { form.dispatchEvent(new Event('submit', { cancelable: true })); await tick(); } };
}

test('both doctor links navigate directly when no blocks are pending', async () => {
    const page = await setup();
    page.links.forEach(link => assert.equal(page.click(link).defaultPrevented, true));
    assert.deepEqual(page.navigation, ['dashboard.html', 'dashboard.html']);
    assert.equal(page.shown(), 0);
});

test('both links ask for confirmation; dismissing preserves blocks and confirmed exit clears them', async () => {
    const page = await setup(); page.generate(); const preview = page.preview.innerHTML;
    page.click(page.links[0]); assert.equal(page.shown(), 1);
    page.node('salirSinGuardarMedicoModal').dispatchEvent(new Event('hidden.bs.modal'));
    assert.equal(page.preview.innerHTML, preview); assert.deepEqual(page.navigation, []);
    page.click(page.links[1]); assert.equal(page.shown(), 2);
    page.click(page.node('confirmarSalirSinGuardarMedicoBtn'));
    assert.deepEqual(page.navigation, ['dashboard.html']); assert.equal(page.preview.innerHTML, '');
});

test('successful save clears pending blocks and keeps the batch API contract', async () => {
    const page = await setup(); page.generate(); await page.save();
    assert.equal(page.preview.innerHTML, '');
    assert.equal(page.writes.length, 1);
    assert.equal(page.writes[0].path, 'medicos/2/disponibilidades/lote/');
    assert.deepEqual(JSON.parse(JSON.stringify(page.writes[0].options)), { method: 'POST', body: { bloques: [
        { fecha: '2030-01-02', hora_inicio: '09:00', hora_fin: '09:20' },
        { fecha: '2030-01-02', hora_inicio: '09:20', hora_fin: '09:40' }
    ] } });
    page.links.forEach(link => page.click(link));
    assert.equal(page.shown(), 0); assert.equal(page.navigation.length, 2);
});

test('failed save retains pending blocks and exit confirmation', async () => {
    const page = await setup({ failSave: true }); page.generate(); await page.save();
    assert.match(page.preview.innerHTML, /09:00/); page.click(page.links[0]);
    assert.equal(page.shown(), 1); assert.deepEqual(page.navigation, []);
});

test('persisted blocks do not trigger exit warnings even if the subsequent table refresh fails', async () => {
    const page = await setup({ failRefresh: true }); page.generate();
    page.node('disponibilidadMedicoFiltroFecha').value = '2030-01-02'; await page.save();
    assert.equal(page.preview.innerHTML, ''); page.click(page.links[1]);
    assert.equal(page.shown(), 0); assert.deepEqual(page.navigation, ['dashboard.html']);
});

test('editing generation fields clears the obsolete preview, so it no longer counts as pending blocks', async () => {
    const page = await setup(); page.generate();
    page.node('disponibilidadMedicoHoraFin').dispatchEvent(new Event('input'));
    assert.equal(page.preview.innerHTML, ''); page.click(page.links[0]);
    assert.equal(page.shown(), 0); assert.deepEqual(page.navigation, ['dashboard.html']);
});

test('secretary retains its original cancel button and does not intercept doctor links', async () => {
    const page = await setup({ doctorMode: false });
    assert.equal(page.click(page.links[0]).defaultPrevented, false);
    const cancel = page.node('cancelarDisponibilidadBtn');
    page.click(cancel); assert.deepEqual(page.navigation, ['dashboard.html']);
    page.generate(); page.click(cancel); assert.equal(page.shown(), 1);
    page.click(page.node('confirmarSalirSinGuardarBtn'));
    assert.equal(page.preview.innerHTML, ''); assert.equal(page.navigation.length, 2);
});

test('doctor HTML retains only X and exit confirmation in the modal, plus two dashboard links', async () => {
    const html = await readFile(new URL('../pages/medico/cargar-disponibilidad-medico.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /cancelarDisponibilidadMedicoBtn|Cancelar y (?:salir|volver)|Continuar (?:editando|cargando)/);
    assert.equal((html.match(/data-doctor-availability-exit/g) || []).length, 2);
    assert.match(html, /href="dashboard.html"[^>]*data-doctor-availability-exit>Volver al Dashboard/);
    const modal = html.slice(html.indexOf('id="salirSinGuardarMedicoModal"'));
    assert.equal((modal.match(/<button/g) || []).length, 2);
    assert.match(modal, /class="btn-close" data-bs-dismiss="modal"/);
    assert.match(modal, /id="confirmarSalirSinGuardarMedicoBtn">Salir sin guardar/);
});
