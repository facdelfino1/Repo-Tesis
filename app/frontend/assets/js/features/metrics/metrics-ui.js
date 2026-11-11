import { listAll, errorMessage } from '../../core/api.js';
import { pageMessage } from '../../core/session.js';
import { escapeHtml as esc } from '../../core/helpers.js';
import { formatToday, todayInputValue } from '../../core/formatters.js';
import { getAdminSpecialties } from '../users/users-service.js';
import { getAdminMetrics, observedMinutes } from './metrics-service.js';

const node = id => document.getElementById(id);
const text = (id, value) => { if (node(id)) node(id).textContent = value; };
const states = { RESERVADO: 'Reservado', PENDIENTE: 'Pendiente', PRESENTE: 'Presente', EN_ATENCION: 'En atención', COMPLETADO: 'Completado', CANCELADO: 'Cancelado', AUSENTE: 'Ausente (histórico)' };
const priorities = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' };
const clearNumbers = () => document.querySelectorAll('[id^="metricas"], [id^="adminMetric"]').forEach(element => { if (['P', 'STRONG'].includes(element.tagName)) element.textContent = '—'; });

export async function initAdminDashboardMetrics() {
    text('adminFechaActual', formatToday()); clearNumbers();
    const today = todayInputValue();
    try {
        const data = await getAdminMetrics({ desde: today, hasta: today });
        const user = data.usuarios, summary = data.resumen;
        for (const [id, value] of Object.entries({ adminMetricUsuarios: user.total, adminMetricPacientes: user.pacientes,
            adminMetricMedicos: user.medicos_activos, adminMetricSecretarias: user.secretarias_activas,
            adminMetricTurnosDia: summary.reservas_activas, adminMetricPresentes: data.estados.PRESENTE,
            adminMetricAtencion: data.estados.EN_ATENCION, adminMetricReprogramaciones: summary.propuestas_en_espera })) text(id, value);
    } catch (error) { pageMessage(errorMessage(error), 'danger'); }
}

function distribution(data) {
    const slices = Object.entries(data.prioridades).map(([label, count]) => ({ label: priorities[label], count, color: { ALTA: '#dc3545', MEDIA: '#ffc107', BAJA: '#198754' }[label] }));
    slices.push({ label: 'Sin triaje específico', count: data.sin_triaje, color: '#6c757d' });
    let percent = 0;
    const stops = slices.map(slice => { const start = percent; percent += data.resumen.total ? slice.count * 100 / data.resumen.total : 0; return `${slice.color} ${start}% ${percent}%`; });
    node('metricasPrioridadDistribucion').innerHTML = data.resumen.total ? `<div class="metric-donut-layout"><div class="metric-donut" style="background:conic-gradient(${stops.join(',')})"><div class="metric-donut-center"><strong>${data.resumen.total} registros</strong></div></div><div class="metric-donut-legend">${slices.map(slice => `<div class="metric-donut-legend-item"><span class="metric-donut-dot" style="background-color:${slice.color}"></span><span>${slice.label}: ${slice.count}</span></div>`).join('')}</div></div>` : '<p class="text-secondary">Sin datos disponibles.</p>';
}

export async function initAdminMetrics() {
    clearNumbers();
    const form = node('adminMetricasFiltros'), filters = { desde: node('metricasFechaDesde'), hasta: node('metricasFechaHasta'), medico: node('metricasMedico'), especialidad: node('metricasEspecialidad'), estado: node('metricasEstado') };
    const [specialties, doctors] = await Promise.all([getAdminSpecialties(), listAll('medicos/?incluir_inactivos=true')]);
    filters.especialidad.replaceChildren(new Option('Todas', ''), ...specialties.map(s => new Option(s.nombre, s.id)));
    filters.estado.replaceChildren(new Option('Todos', ''), ...Object.entries(states).map(([value, label]) => new Option(label, value)));
    function doctorOptions() {
        const selected = filters.medico.value, rows = doctors.filter(d => !filters.especialidad.value || String(d.especialidad.id) === filters.especialidad.value);
        filters.medico.replaceChildren(new Option('Todos', ''), ...rows.map(d => new Option(`${d.nombre} ${d.apellido}`, d.id)));
        filters.medico.value = rows.some(d => String(d.id) === selected) ? selected : '';
    }
    doctorOptions(); let version = 0;
    async function refresh() {
        const current = ++version; clearNumbers();
        node('metricasPrioridadDistribucion').textContent = 'Consultando indicadores...';
        for (const id of ['metricasEstadoTabla', 'metricasMedicosTabla']) node(id).innerHTML = '<tr><td colspan="8">Consultando indicadores...</td></tr>';
        try {
            const data = await getAdminMetrics(Object.fromEntries(Object.entries(filters).map(([key, field]) => [key, field.value])));
            if (current !== version) return;
            const s = data.resumen;
            for (const [id, value] of Object.entries({ metricasTotalTurnos: s.total, metricasCompletados: s.completados,
                metricasCancelados: s.cancelados, metricasAusentes: s.ausentes, metricasEsperaPromedio: observedMinutes(s.espera_promedio_minutos),
                metricasAtencionPromedio: observedMinutes(s.atencion_promedio_minutos), metricasPrioridadFrecuente: s.prioridad_frecuente || 'Sin datos disponibles',
                metricasTasaAusentismo: s.tasa_ausentismo_historico === null ? 'Sin datos disponibles' : `${s.tasa_ausentismo_historico}%` })) text(id, value);
            node('metricasEsperaPromedio').title = `${s.muestras_espera} observaciones válidas (inicio − arribo).`;
            node('metricasAtencionPromedio').title = `${s.muestras_atencion} consultas completas con inicio/cierre válidos.`;
            node('metricasEstadoTabla').innerHTML = Object.entries(data.estados).map(([state, count]) => `<tr><td>${states[state]}</td><td>${count}</td></tr>`).join('');
            node('metricasMedicosTabla').innerHTML = data.medicos.map(row => `<tr><td>${esc(row.medico__usuario__nombre + ' ' + row.medico__usuario__apellido)}</td><td>${esc(row.medico__especialidad__nombre)}</td><td>${row.total}</td><td>${row.completados}</td><td>${row.cancelados}</td><td>${row.ausentes}</td><td>${observedMinutes(row.atencion_promedio_minutos)}</td><td><div class="d-flex flex-wrap gap-2">
                <span class="badge text-bg-danger">Alta: ${row.alta}</span>
                <span class="badge text-bg-warning">Media: ${row.media}</span>
                <span class="badge text-bg-success">Baja: ${row.baja}</span>
                <span class="badge text-bg-secondary">Sin triaje: ${row.sin_triaje}</span>
            </div></td></tr>`).join('') || '<tr><td colspan="8">Sin datos disponibles para los filtros seleccionados.</td></tr>';
            distribution(data);
            const box = node('apiPageMessage'); if (box) box.remove();
        } catch (error) { if (current === version) { clearNumbers(); pageMessage(errorMessage(error), 'danger'); node('metricasPrioridadDistribucion').textContent = 'Sin datos disponibles.'; for (const id of ['metricasEstadoTabla', 'metricasMedicosTabla']) node(id).innerHTML = '<tr><td colspan="8">No fue posible consultar los indicadores.</td></tr>'; } }
    }
    filters.especialidad.addEventListener('change', doctorOptions);
    Object.values(filters).forEach(field => field.addEventListener('change', refresh));
    form.addEventListener('submit', event => { event.preventDefault(); refresh(); });
    form.addEventListener('reset', () => setTimeout(() => { doctorOptions(); refresh(); }, 0));
    await refresh();
}
