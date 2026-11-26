import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { observedMinutes } from '../assets/js/features/metrics/metrics-service.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const specialty = { id: 1, nombre: 'Especialidad ficticia' };
const doctor = { id: 2, nombre: 'Médico', apellido: 'Prueba', especialidad: specialty };
const sample = () => ({
    usuarios: { total: 20, pacientes: 12, medicos_activos: 5, secretarias_activas: 3 },
    resumen: { total: 10, completados: 6, cancelados: 2, ausentes: 1, reservas_activas: 1,
        espera_promedio_minutos: 11.21, atencion_promedio_minutos: 10.96, muestras_espera: 7,
        muestras_atencion: 6, prioridad_frecuente: 'MEDIA', tasa_ausentismo_historico: 14.29, propuestas_en_espera: 2 },
    estados: { RESERVADO: 0, PENDIENTE: 0, PRESENTE: 0, EN_ATENCION: 1, COMPLETADO: 6, CANCELADO: 2, AUSENTE: 1 },
    prioridades: { ALTA: 1, MEDIA: 5, BAJA: 2 }, sin_triaje: 2,
    medicos: [{ medico__usuario__nombre: 'Médico', medico__usuario__apellido: 'Prueba', medico__especialidad__nombre: specialty.nombre,
        total: 10, completados: 6, cancelados: 2, ausentes: 1, atencion_promedio_minutos: 5.5, alta: 1, media: 5, baja: 2, sin_triaje: 2 }]
});
class Element extends EventTarget {
    value = ''; textContent = 'anterior'; innerHTML = ''; title = '';
    constructor(tagName = 'P') { super(); this.tagName = tagName; }
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
}
async function setup(page, search) {
    const html = await readFile(new URL(`../pages/admin/${page}.html`, import.meta.url), 'utf8');
    const nodes = new Map([...html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map(([, tag, id]) => [id, new Element(tag.toUpperCase())]));
    const navbar = nodes.get(page === 'metricas' ? 'adminMetricasNavbar' : 'adminNombreNavbar');
    assert.ok(navbar, 'actual navbar ID from HTML');
    navbar.textContent = 'Administradora Ficticia';
    nodes.set('adminMetricOther', new Element());
    nodes.set('metricasOther', new Element());
    const document = {
        getElementById: id => nodes.get(id) || null,
        querySelectorAll: selector => [...nodes].filter(([id]) => selector.includes('id^=') && (id.startsWith('metricas') || id.startsWith('adminMetric'))).map(([, element]) => element)
    };
    const calls = [], messages = [];
    const context = vm.createContext({ document, observedMinutes, setTimeout,
        getAdminMetrics: filters => { calls.push({ ...filters }); return search(filters); },
        getAdminSpecialties: async () => [specialty], listAll: async () => [doctor],
        Option: class { constructor(label, value) { this.text = label; this.value = String(value); } },
        esc: String, formatToday: () => '25/11/2026', todayInputValue: () => '2026-11-25',
        pageMessage: message => messages.push(message), errorMessage: error => error.message
    });
    const source = await readFile(new URL('../assets/js/features/metrics/metrics-ui.js', import.meta.url), 'utf8');
    const module = new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm, ''), { context });
    await module.link(() => { throw Error('Unexpected import'); }); await module.evaluate();
    return { node: id => nodes.get(id), navbar, calls, messages, ui: module.namespace,
        checkPreserved() {
            assert.equal(navbar.textContent, 'Administradora Ficticia');
            assert.equal(nodes.get('adminMetricOther').textContent, 'anterior');
            assert.equal(nodes.get('metricasOther').textContent, 'anterior');
        }
    };
}

test('decimal minutes format as minutes and rounded seconds, including valid zero', () => {
    for (const [value, expected] of [[11.21, '11 min 13 s'], [10.96, '10 min 58 s'], [5.5, '5 min 30 s'],
        [0.75, '0 min 45 s'], [12, '12 min 0 s'], [0, '0 min 0 s']]) assert.equal(observedMinutes(value), expected);
});

test('missing, invalid, negative and unrepresentable durations display a dash', () => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity, -0.01, '11.21', '', {}, [], Number.MAX_VALUE]) assert.equal(observedMinutes(value), '—');
    assert.equal(observedMinutes(-0), '0 min 0 s');
});

test('rounding carries 60 seconds into the next minute', () => {
    for (const [value, expected] of [[0.999, '1 min 0 s'], [1.999, '2 min 0 s'], [59.999, '60 min 0 s'], [60.999, '61 min 0 s']]) {
        assert.equal(observedMinutes(value), expected);
        assert.doesNotMatch(observedMinutes(value), / 60 s$/);
    }
});

test('metrics initialization and filtering clear only indicators and preserve navbar, other metrics and sample counts', async () => {
    const initial = deferred(), filtered = deferred(); let query = initial;
    const f = await setup('metricas', () => query.promise);
    const initialization = f.ui.initAdminMetrics(); await tick();
    f.checkPreserved(); assert.equal(f.node('metricasTotalTurnos').textContent, '—');
    assert.equal(f.node('metricasMedico').tagName, 'SELECT');
    initial.resolve(sample()); await initialization;
    assert.equal(f.node('metricasEsperaPromedio').textContent, '11 min 13 s');
    assert.equal(f.node('metricasAtencionPromedio').textContent, '10 min 58 s');
    assert.match(f.node('metricasEsperaPromedio').title, /^7 observaciones/);
    assert.match(f.node('metricasAtencionPromedio').title, /^6 consultas/);
    assert.equal(f.node('metricasTotalTurnos').textContent, 10);
    assert.equal(f.node('metricasCancelados').textContent, 2);
    assert.equal(f.node('metricasTasaAusentismo').textContent, '14.29%');
    assert.match(f.node('metricasMedicosTabla').innerHTML, /5 min 30 s/);
    query = filtered; f.node('metricasMedico').value = '2';
    f.node('metricasMedico').dispatchEvent(new Event('change'));
    f.checkPreserved(); assert.equal(f.node('metricasAtencionPromedio').textContent, '—');
    assert.equal(f.calls.at(-1).medico, '2');
    const data = sample(); data.resumen.espera_promedio_minutos = null; data.resumen.atencion_promedio_minutos = 0;
    data.resumen.muestras_espera = 0; data.resumen.muestras_atencion = 1;
    filtered.resolve(data); await tick(); f.checkPreserved();
    assert.equal(f.node('metricasEsperaPromedio').textContent, '—');
    assert.equal(f.node('metricasAtencionPromedio').textContent, '0 min 0 s');
    assert.match(f.node('metricasEsperaPromedio').title, /^0 observaciones/);
    assert.match(f.node('metricasAtencionPromedio').title, /^1 consultas/);
});

test('filter errors reset indicators without erasing identity, and resubmission recovers normally', async () => {
    let fail = false;
    const f = await setup('metricas', async () => { if (fail) throw Error('Error ficticio'); return sample(); });
    await f.ui.initAdminMetrics(); fail = true;
    f.node('metricasEstado').value = 'COMPLETADO'; f.node('metricasEstado').dispatchEvent(new Event('change'));
    await tick(); f.checkPreserved();
    assert.equal(f.node('metricasTotalTurnos').textContent, '—');
    assert.equal(f.node('metricasAtencionPromedio').textContent, '—');
    assert.deepEqual(f.messages, ['Error ficticio']);
    fail = false;
    f.node('adminMetricasFiltros').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(); f.checkPreserved(); assert.equal(f.node('metricasTotalTurnos').textContent, 10);
    f.node('adminMetricasFiltros').dispatchEvent(new Event('reset'));
    await new Promise(resolve => setTimeout(resolve, 10)); f.checkPreserved();
});

test('dashboard indicators retain their values and identity through initial loading, repeated updates and errors', async () => {
    const loading = deferred(); let query = () => loading.promise;
    const f = await setup('dashboard', () => query());
    const initialization = f.ui.initAdminDashboardMetrics();
    f.checkPreserved(); assert.equal(f.node('adminMetricUsuarios').textContent, '—');
    loading.resolve(sample()); await initialization;
    assert.equal(f.node('adminMetricUsuarios').textContent, 20);
    assert.equal(f.node('adminMetricPacientes').textContent, 12);
    assert.equal(f.node('adminMetricAtencion').textContent, 1);
    assert.equal(f.node('adminMetricReprogramaciones').textContent, 2);
    query = async () => sample(); await f.ui.initAdminDashboardMetrics(); f.checkPreserved();
    query = async () => { throw Error('Error ficticio'); };
    await f.ui.initAdminDashboardMetrics(); f.checkPreserved();
    assert.equal(f.node('adminMetricUsuarios').textContent, '—');
    assert.deepEqual(f.messages, ['Error ficticio']);
});
