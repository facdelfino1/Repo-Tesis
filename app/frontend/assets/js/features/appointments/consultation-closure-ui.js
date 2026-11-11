import { listAll, errorMessage } from '../../core/api.js';
import { escapeHtml } from '../../core/helpers.js';
import { formatDate, todayInputValue } from '../../core/formatters.js';
import { getBootstrapModal, showModal, hideModal } from '../../components/modals.js';
import { getAgendaTurns, getAgendaTurn, operateAgendaTurn } from './agenda-api.js';

const name = user => `${user.nombre} ${user.apellido}`;
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const open = turn => turn.estado === 'EN_ATENCION' && !!turn.fecha_hora_inicio && !turn.fecha_hora_cierre;
const stamp = value => value ? new Date(value).toLocaleString('es-AR') : '—';
const priority = turn => {
    const values = { ALTA: ['danger', 'Alta'], MEDIA: ['warning text-dark', 'Media'], BAJA: ['success', 'Baja'] };
    const [color, label] = values[turn.prioridad] || ['secondary', 'Sin triaje'];
    return `<span class="badge bg-${color} fs-6">${label}</span>`;
};

export async function initConsultationClosure() {
    const el = suffix => document.getElementById(`finalizacion${suffix}`);
    const filters = ['Dni', 'Paciente', 'Medico', 'Especialidad', 'Fecha'].map(s => el(`Filtro${s}`));
    const [dni, patient, doctor, specialty, date] = filters;
    const table = el('Tabla');
    const confirmElement = el('ConfirmarModal');
    const confirm = getBootstrapModal(confirmElement);
    const detail = getBootstrapModal(el('DetalleModal'));
    const button = el('ConfirmarBtn');
    let turns = [], selected = null, busy = false, sequence = 0;
    const message = (text = '', type = 'danger') => {
        el('Mensaje').textContent = text;
        el('Mensaje').className = `alert alert-${type}${text ? '' : ' d-none'}`;
    };
    const controls = disabled => {
        filters.forEach(node => { node.disabled = disabled; });
        button.disabled = disabled;
        confirmElement.querySelectorAll('[data-bs-dismiss]').forEach(node => { node.disabled = disabled; });
    };
    function render() {
        const rows = turns.filter(t => (!dni.value || t.paciente_detalle.dni.includes(dni.value.trim()))
            && normalized(name(t.paciente_detalle)).includes(normalized(patient.value.trim()))
            && (!doctor.value || String(t.medico.id) === doctor.value)
            && (!specialty.value || String(t.medico.especialidad.id) === specialty.value));
        el('MetricAtencion').textContent = rows.filter(t => t.estado === 'EN_ATENCION').length;
        el('MetricCompletadas').textContent = rows.filter(t => t.estado === 'COMPLETADO').length;
        el('MetricPendientes').textContent = rows.filter(open).length;
        table.innerHTML = rows.map(t => `<tr>
            <td>${escapeHtml(name(t.paciente_detalle))}</td><td>${escapeHtml(t.paciente_detalle.dni)}</td>
            <td>${escapeHtml(name(t.medico))}</td><td>${escapeHtml(t.medico.especialidad.nombre)}</td>
            <td class="text-nowrap">${escapeHtml(formatDate(t.fecha))}<br>${escapeHtml(t.hora.slice(0, 5))}</td>
            <td>${priority(t)}</td><td>${t.estado === 'COMPLETADO' ? 'Completado' : 'En atención'}</td>
            <td>${escapeHtml(stamp(t.fecha_hora_inicio))}</td><td>${escapeHtml(stamp(t.fecha_hora_cierre))}</td>
            <td><div class="d-flex flex-column gap-2"><button class="btn btn-outline-primary btn-sm" data-detail="${t.id_turno}">Ver detalle</button>
            ${open(t) ? `<button class="btn btn-success btn-sm" data-finish="${t.id_turno}">Finalizar consulta</button>` : ''}</div></td>
            </tr>`).join('') || '<tr><td colspan="10">No hay consultas iniciadas o completadas para estos filtros.</td></tr>';
        table.querySelectorAll('button').forEach(node => { node.disabled = busy; });
    }
    async function load() {
        const current = ++sequence;
        selected = null;
        turns = [];
        table.innerHTML = '<tr><td colspan="10">Cargando consultas…</td></tr>';
        try {
            const rows = await Promise.all(doctors.map(d => getAgendaTurns(d.id, date.value)));
            if (current !== sequence) return;
            turns = rows.flat().filter(t => ['EN_ATENCION', 'COMPLETADO'].includes(t.estado))
                .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`) || a.id_turno - b.id_turno);
            render();
        } catch (error) {
            if (current !== sequence) return;
            turns = [];
            render();
            ['MetricAtencion', 'MetricCompletadas', 'MetricPendientes'].forEach(id => { el(id).textContent = '—'; });
            table.innerHTML = '<tr><td colspan="10">No fue posible cargar las consultas.</td></tr>';
            throw error;
        }
    }
    const doctors = await listAll('medicos/?incluir_inactivos=true');
    const option = (value, label) => new Option(label, value);
    doctor.replaceChildren(option('', 'Todos'), ...doctors.map(d => option(d.id, name(d))));
    const specialties = [...new Map(doctors.map(d => [d.especialidad.id, d.especialidad])).values()];
    specialty.replaceChildren(option('', 'Todas'), ...specialties.map(s => option(s.id, s.nombre)));
    date.value = todayInputValue();
    for (const filter of [dni, patient, doctor, specialty]) filter.addEventListener('input', render);
    date.addEventListener('change', async () => {
        message();
        try { await load(); } catch (error) { message(errorMessage(error)); }
    });
    table.addEventListener('click', async event => {
        const target = event.target.closest('button[data-detail],button[data-finish]');
        if (!target || busy) return;
        const turn = turns.find(t => String(t.id_turno) === (target.dataset.detail || target.dataset.finish));
        if (!turn) return;
        message();
        if (target.dataset.finish) {
            if (!open(turn)) return;
            selected = turn;
            el('ConfirmarPaciente').textContent = `${name(turn.paciente_detalle)} · DNI ${turn.paciente_detalle.dni}`;
            showModal(confirm);
            return;
        }
        busy = true; controls(true); render();
        try {
            const t = await getAgendaTurn(turn.medico.id, turn.id_turno);
            const fields = [
                ['Paciente', name(t.paciente_detalle)], ['DNI', t.paciente_detalle.dni],
                ['Médico', name(t.medico)], ['Especialidad', t.medico.especialidad.nombre],
                ['Turno', `${formatDate(t.fecha)} ${t.hora.slice(0, 5)}`],
                ['Estado', t.estado === 'COMPLETADO' ? 'Completado' : 'En atención'],
                ['Arribo', stamp(t.fecha_hora_arribo)], ['Inicio', stamp(t.fecha_hora_inicio)],
                ['Cierre', stamp(t.fecha_hora_cierre)],
                ['Cerrado por', t.cerrado_por ? `${name(t.cerrado_por)} (${t.cerrado_por.rol === 'SECRETARIA' ? 'Secretaría' : 'Médico'})` : 'Sin registro'],
            ];
            el('DetalleContenido').innerHTML = `<dl class="row mb-0">${fields.map(([label, value]) => `<dt class="col-sm-4">${label}</dt><dd class="col-sm-8 text-break">${escapeHtml(value)}</dd>`).join('')}<dt class="col-sm-4">Prioridad</dt><dd class="col-sm-8">${priority(t)}</dd></dl>`;
            showModal(detail);
        } catch (error) { message(errorMessage(error)); }
        finally { busy = false; controls(false); render(); }
    });
    confirmElement.addEventListener('hidden.bs.modal', () => { selected = null; });
    button.addEventListener('click', async () => {
        if (!selected || busy) return;
        const turn = selected;
        busy = true; controls(true); render();
        let result = '';
        try {
            await operateAgendaTurn(turn.medico.id, turn.id_turno, 'finalizar');
            result = 'Consulta finalizada. Se registraron la hora actual y el usuario responsable.';
        } catch (error) { message(errorMessage(error)); }
        finally {
            busy = false; controls(false); hideModal(confirm);
            try { await load(); if (result) message(result, 'success'); }
            catch (error) { message(`${result ? result + ' ' : ''}${errorMessage(error)}`); }
        }
    });
    await load();
}
