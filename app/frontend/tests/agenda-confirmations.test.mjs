import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { escapeHtml } from '../assets/js/core/helpers.js';
import { formatAttentionDuration } from '../assets/js/features/appointments/attention-duration.js';
import { formatDate } from '../assets/js/core/formatters.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const doctor = { id: 2, nombre: 'Médico', apellido: 'Prueba', especialidad: { nombre: 'Clínica Médica' } };
const cases = [
    ['SECRETARIA', 'management', 'cancelar', 'RESERVADO', 'CANCELADO', 'Confirmar cancelación de turno', 'Confirmar cancelación', 'Esta acción no implica eliminar el registro del sistema'],
    ['SECRETARIA', 'presence', 'presencia', 'RESERVADO', 'PRESENTE', 'Confirmar registro de presencia', 'Confirmar presencia', 'se registrará su hora de llegada'],
    ['MEDICO', 'agenda', 'iniciar', 'PRESENTE', 'EN_ATENCION', 'Confirmar inicio de consulta', 'Confirmar inicio', 'se registrará la hora de inicio'],
    ['MEDICO', 'agenda', 'finalizar', 'EN_ATENCION', 'COMPLETADO', 'Confirmar finalización de consulta', 'Confirmar finalización', 'se registrará la hora de finalización']
];

async function setup([role, mode, action, state, target], { defer = false, failure = null, origin = null, birth } = {}) {
    const nodes = new Map(), mounted = [], writes = [], modals = new Map();
    let focused, release, reads = 0, nativeConfirms = 0;
    class Element extends EventTarget {
        innerHTML = ''; textContent = ''; className = ''; value = ''; disabled = false; children = new Map(); attrs = new Map();
        classList = {
            add: name => { this.className = [...new Set([...this.className.split(' '), name])].join(' '); },
            remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
            contains: name => this.className.split(' ').includes(name)
        };
        setAttribute(key, value) { this.attrs.set(key, value); }
        querySelector(selector) {
            if (!this.children.has(selector)) this.children.set(selector, new Element());
            return this.children.get(selector);
        }
        querySelectorAll(selector) {
            return selector === 'button' && this.id?.startsWith('actionConfirmation')
                ? ['.btn-close', '[data-back]', '[data-confirm]'].map(key => this.querySelector(key)) : [];
        }
        append() {}
        focus() { focused = this; }
    }
    const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
    const document = { getElementById: node, querySelectorAll: () => [], createElement: () => new Element(),
        body: { append: element => mounted.push(element) } };
    const getBootstrapModal = element => {
        if (!modals.has(element)) {
            const instance = {
                show() { element.dispatchEvent(new Event('shown.bs.modal')); },
                hide() {
                    const event = new Event('hide.bs.modal', { cancelable: true }); element.dispatchEvent(event);
                    if (!event.defaultPrevented) element.dispatchEvent(new Event('hidden.bs.modal'));
                    return !event.defaultPrevented;
                }
            };
            element.querySelector('[data-back]').addEventListener('click', () => instance.hide());
            element.querySelector('.btn-close').addEventListener('click', () => instance.hide());
            modals.set(element, instance);
        }
        return modals.get(element);
    };
    const turn = { id_turno: 7, fecha: '2030-01-10', hora: '09:00:00', estado: state, medico: doctor,
        paciente: 1, paciente_detalle: { nombre: 'Paciente', apellido: 'Prueba', dni: '123' }, prioridad: null,
        duracion_turno: 20, asignacion_vigente: true, origen: origin, nacimiento_atendido: birth };
    const context = vm.createContext({ document, queueMicrotask, console, formatAttentionDuration,
        getBootstrapModal, showModal: modal => modal.show(), hideModal: modal => modal.hide(),
        getCurrentUser: () => ({ rol: role, perfil: { id: 2 } }), getDoctor: async () => doctor,
        loadDoctorCatalog: async () => ({ specialties: [], doctors: [] }),
        bindDoctorSelectors: async (specialty, _select, callback) => { if (specialty !== node('asignarEspecialidad')) await callback(doctor); },
        getAgendaTurns: async () => { reads++; return [{ ...turn }]; }, getAgendaTurn: async () => ({ ...turn }),
        operateAgendaTurn: async (doctorId, id, operation) => {
            writes.push({ doctorId, id, operation });
            if (defer) await new Promise(resolve => { release = resolve; });
            if (failure) throw failure;
            turn.estado = target;
        },
        window: { confirm: () => { nativeConfirms++; throw Error('Native confirmation must not run'); } },
        formatDate, todayInputValue: () => '2030-01-10', esc: escapeHtml,
        errorMessage: error => error.message, priorityClass: () => '', pageMessage() {},
        initPatientSearch: () => ({}), updateTriageQuestionnaire() {}, bindTriageNotice: () => () => {}, bindPediatricCleanup: () => () => {}
    });
    const component = await readFile(new URL('../assets/js/components/action-confirmation.js', import.meta.url), 'utf8');
    const componentModule = new vm.SourceTextModule(component.replace(/^import .*;\r?\n/gm, ''), { context });
    await componentModule.link(() => { throw Error('Unexpected import'); }); await componentModule.evaluate();
    context.createActionConfirmation = componentModule.namespace.createActionConfirmation;
    const source = await readFile(new URL('../assets/js/features/appointments/agenda-ui.js', import.meta.url), 'utf8');
    const ui = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await ui.link(() => { throw Error('Unexpected import'); }); await ui.evaluate();
    await ui.namespace.initOperationalAgenda(mode);
    const table = node(role === 'MEDICO' ? mode === 'dashboard' ? 'medicoAgendaDia' : 'agendaMedicaTabla'
        : mode === 'presence' ? 'presenciaTabla' : 'GestiónTurnosTabla');
    const click = async (operation = action) => {
        const event = new Event('click');
        Object.defineProperty(event, 'target', { value: { closest: () => ({ dataset: { operation, turn: '7' } }) } });
        table.dispatchEvent(event); await tick();
    };
    return { click, writes, turn, table, node,
        modal: () => mounted.find(element => element.id?.startsWith('actionConfirmation')),
        dismiss: () => modals.get(mounted.find(element => element.id?.startsWith('actionConfirmation'))).hide(),
        focus: () => focused, reads: () => reads, nativeConfirms: () => nativeConfirms, release: () => release(),
        mounted: () => mounted.filter(element => element.id?.startsWith('actionConfirmation')).length
    };
}

test('secretary management renders persisted origins and never infers historical NULL as Sistema', async () => {
    for (const [origin, label] of [
        ['PACIENTE', 'Paciente'], ['SECRETARIA', 'Secretaría'], ['SISTEMA', 'Sistema'],
        [null, 'No determinado'], [undefined, 'No determinado']
    ]) {
        const page = await setup(cases[0], { origin });
        const cells = [...page.table.innerHTML.matchAll(/<td>(.*?)<\/td>/gs)].map(match => match[1]);
        assert.equal(cells.length, 10);
        assert.equal(cells[8], label);
        assert.match(cells[9], /data-operation="cancelar"/);
        assert.equal(page.writes.length, 0);
    }
});

for (const specification of cases) {
    const [role, , action, state, target, title, confirmText, fragment] = specification;
    test(`${role} ${action}: correct copy, contextual confirmation and cancellation via Volver, X or Escape`, async () => {
        const page = await setup(specification);
        for (const dismiss of ['[data-back]', '.btn-close', 'escape']) {
            await page.click();
            const modal = page.modal();
            assert.equal(modal.querySelector('.modal-title').textContent, title);
            assert.equal(modal.querySelector('[data-confirm]').textContent, confirmText);
            assert.ok(modal.querySelector('[data-message]').textContent.includes(fragment));
            assert.match(modal.querySelector('[data-context]').textContent, /Paciente Prueba/);
            assert.equal(page.focus(), modal.querySelector('[data-back]'));
            assert.ok(modal.attrs.has('aria-labelledby')); assert.ok(modal.attrs.has('aria-describedby'));
            if (dismiss === 'escape') page.dismiss(); else modal.querySelector(dismiss).dispatchEvent(new Event('click'));
            await tick();
            assert.equal(page.writes.length, 0); assert.equal(page.turn.estado, state);
        }
        assert.equal(page.mounted(), 1);
        assert.equal(page.nativeConfirms(), 0);
    });

    test(`${role} ${action}: double clicks execute once, cannot dismiss during processing, then refresh`, async () => {
        const page = await setup(specification, { defer: true });
        await page.click(); await page.click();
        const modal = page.modal(), confirm = modal.querySelector('[data-confirm]');
        assert.equal(page.writes.length, 0);
        confirm.dispatchEvent(new Event('click')); confirm.dispatchEvent(new Event('click')); await tick();
        assert.equal(page.writes.length, 1);
        assert.deepEqual(page.writes[0], { doctorId: 2, id: 7, operation: action });
        assert.ok(modal.querySelectorAll('button').every(button => button.disabled));
        assert.equal(page.dismiss(), false);
        page.release(); await tick(); await tick();
        assert.equal(page.turn.estado, target); assert.ok(page.reads() >= 2);
        assert.match(page.table.innerHTML, new RegExp(({ CANCELADO: 'Cancelado', PRESENTE: 'Presente', EN_ATENCION: 'En atención', COMPLETADO: 'Completado' })[target]));
        assert.equal(page.nativeConfirms(), 0);
        confirm.dispatchEvent(new Event('click')); await tick(); assert.equal(page.writes.length, 1);
    });
}

test('API errors preserve patient context and display existing error details, including 409 refresh', async () => {
    for (const status of [400, 409, 500]) {
        const page = await setup(cases[2], { failure: { status, message: 'El turno cambió de estado.' } });
        await page.click();
        const modal = page.modal(); modal.querySelector('[data-confirm]').dispatchEvent(new Event('click'));
        await tick();
        assert.equal(modal.querySelector('[data-error]').textContent, 'El turno cambió de estado.');
        assert.match(modal.querySelector('[data-context]').textContent, /Paciente Prueba/);
        assert.equal(page.node('agendaMedicaMensaje').textContent, 'El turno cambió de estado.');
        assert.equal(modal.querySelector('[data-confirm]').disabled, false);
        assert.equal(page.turn.estado, 'PRESENTE');
        if (status === 409) assert.ok(page.reads() >= 2);
        assert.equal(page.dismiss(), true); await tick();
    }
});

test('Detalle remains read-only and doctor dashboard reuses the same confirmation', async () => {
    const page = await setup(cases[2]);
    await page.click('detalle');
    assert.equal(page.mounted(), 0); assert.equal(page.writes.length, 0);
    const dashboard = await setup(['MEDICO', 'dashboard', ...cases[2].slice(2)]);
    await dashboard.click(); assert.ok(dashboard.modal()); assert.equal(dashboard.writes.length, 0);
    dashboard.dismiss(); await tick();
});

test('both professional details show attended birth and server age including zero, without writes', async () => {
    for (const roleCase of [cases[0], cases[2]]) {
        for (const birth of [undefined, { fecha_nacimiento: null, edad: null, es_menor_atendido: true },
            { fecha_nacimiento: '2029-12-01', edad: 0, es_menor_atendido: true },
            { fecha_nacimiento: '1990-01-01', edad: 40, es_menor_atendido: false }]) {
            const page = await setup(roleCase, { birth });
            await page.click('detalle');
            const html = page.node(roleCase[0] === 'MEDICO' ? 'agendaMedicaDetalleContenido' : 'detalleTurnoContenido').innerHTML;
            assert.match(html, /Edad a la fecha del turno/);
            assert.ok(html.includes(birth?.fecha_nacimiento ? formatDate(birth.fecha_nacimiento, '-') : 'No registrada'));
            if (birth?.edad != null) assert.ok(html.includes(`${birth.edad} años`));
            else assert.doesNotMatch(html, /\d+ años/);
            if (birth?.es_menor_atendido) assert.match(html, /Fecha de nacimiento del menor atendido/);
            assert.equal(page.writes.length, 0);
        }
    }
});

test('active consultation conflict reuses the existing modal as an Entendido notice without retrying or changing the rejected turn', async () => {
    const message = 'Antes de iniciar una nueva consulta, debés finalizar la consulta que se encuentra actualmente en atención.';
    for (const mode of ['agenda', 'dashboard']) {
        const specification = ['MEDICO', mode, ...cases[2].slice(2)];
        const page = await setup(specification, { failure: { status: 409, message, data: { detail: message } } });
        const before = JSON.stringify(page.turn);
        await page.click();
        const modal = page.modal(), confirm = modal.querySelector('[data-confirm]'), back = modal.querySelector('[data-back]');
        confirm.dispatchEvent(new Event('click')); await tick();
        assert.equal(modal.querySelector('.modal-title').textContent, 'Consulta en atención');
        assert.equal(modal.querySelector('[data-message]').textContent, message);
        assert.equal(back.textContent, 'Entendido');
        assert.equal(page.focus(), back);
        assert.equal(confirm.classList.contains('d-none'), true);
        assert.equal(confirm.disabled, true);
        confirm.dispatchEvent(new Event('click')); await tick();
        assert.equal(page.writes.length, 1);
        assert.equal(JSON.stringify(page.turn), before);
        assert.ok(page.reads() >= 2);
        assert.equal(page.node('agendaMedicaMensaje').textContent, message);
        assert.equal(page.mounted(), 1); assert.equal(page.nativeConfirms(), 0);
        back.dispatchEvent(new Event('click')); await tick();
        await page.click(); // Next opening is a regular confirmation, not a stale informational modal.
        assert.equal(modal.querySelector('.modal-title').textContent, 'Confirmar inicio de consulta');
        assert.equal(confirm.classList.contains('d-none'), false);
        assert.equal(confirm.disabled, false);
        assert.equal(back.textContent, 'Volver');
        assert.equal(page.mounted(), 1);
        page.dismiss(); await tick();
    }
});
