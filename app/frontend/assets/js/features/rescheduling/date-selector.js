import { errorMessage } from '../../core/api.js';
import { formatDate } from '../../core/formatters.js';
import { isAvailabilityExpired } from '../availability/availability-service.js';

export function eligibleDestinationDates({ blocks, proposals, turns }, affectedDate, now = new Date()) {
    if (!affectedDate) return [];
    const offered = new Set(proposals.filter(p => p.estado === 'EN_ESPERA').map(p => String(p.disponibilidad_destino)));
    const assigned = new Set(turns.filter(t => !['CANCELADO', 'PENDIENTE'].includes(t.estado)).map(t => String(t.disponibilidad)));
    return [...new Set(blocks.filter(block => block.fecha > affectedDate && block.estado === 'DISPONIBLE'
        && !isAvailabilityExpired(block, now) && !offered.has(String(block.id)) && !assigned.has(String(block.id)))
        .map(block => block.fecha))].sort();
}

export function initDestinationDateSelector({ select, status, refreshButton, context, load, onUpdate }) {
    let generation = 0, validDates = new Set(), loadedContext = null;
    const key = () => JSON.stringify(context());
    function placeholder(label) {
        select.replaceChildren(new Option(label, ''));
        select.disabled = true;
    }
    function reset() {
        ++generation; validDates = new Set(); loadedContext = null;
        const { doctorId, affectedDate } = context();
        placeholder(doctorId && affectedDate ? 'Consultando fechas...' : 'Seleccione primero el médico y la fecha afectada');
        refreshButton.disabled = !doctorId || !affectedDate;
        status.textContent = '';
        onUpdate();
    }
    async function refresh() {
        const { doctorId, affectedDate } = context();
        if (!doctorId || !affectedDate) { reset(); return false; }
        const current = ++generation, expected = key(), previous = select.value;
        validDates = new Set(); loadedContext = null;
        placeholder('Consultando fechas...');
        refreshButton.disabled = true;
        status.textContent = '';
        onUpdate();
        try {
            const data = await load(doctorId);
            if (current !== generation || expected !== key()) return false;
            const dates = eligibleDestinationDates(data, affectedDate);
            validDates = new Set(dates); loadedContext = expected;
            select.replaceChildren(new Option(dates.length ? 'Seleccione una fecha' : 'No hay fechas disponibles', ''),
                ...dates.map(date => new Option(formatDate(date), date)));
            select.value = validDates.has(previous) ? previous : '';
            select.disabled = !dates.length;
            status.textContent = dates.length ? 'La fecha debe seleccionarse explícitamente. La disponibilidad se verificará al confirmar.'
                : 'No hay fechas posteriores con disponibilidad. Cargue nuevos horarios desde Cargar disponibilidad';
            refreshButton.disabled = false;
            onUpdate();
            return true;
        } catch (error) {
            if (current !== generation || expected !== key()) return false;
            placeholder('No se pudieron consultar fechas');
            status.textContent = `No se pudieron consultar las fechas. ${errorMessage(error)}`;
            refreshButton.disabled = false;
            onUpdate();
            return false;
        }
    }
    select.addEventListener('change', onUpdate);
    refreshButton.addEventListener('click', refresh);
    reset();
    return { reset, refresh, isValid: () => loadedContext === key() && validDates.has(select.value) };
}
