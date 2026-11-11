import { errorMessage } from '../../core/api.js';
import { searchPatients } from './agenda-api.js';

const normalize = text => text.trim().replace(/\s+/g, ' ');

export function initPatientSearch(form, search = searchPatients) {
    const field = id => form.querySelector(`#asignarPaciente${id}`);
    const input = field('Dni'), select = field('Seleccion'), status = field('Estado');
    let matches = [], version = 0, timer, controller;
    const selected = () => matches.find(patient => String(patient.id) === select.value) || null;
    function identify() {
        const patient = selected();
        field('Nombre').value = patient?.nombre || '';
        field('Apellido').value = patient?.apellido || '';
        if (patient) status.textContent = `Seleccionado: ${patient.nombre} ${patient.apellido} · DNI ${patient.dni} · ID ${patient.id}`;
    }
    function clear() {
        ++version;
        clearTimeout(timer);
        controller?.abort();
        matches = [];
        select.replaceChildren(new Option('Escriba para buscar un paciente', ''));
        select.removeAttribute('aria-busy');
        identify();
        status.textContent = 'Ingrese entre 2 y 200 caracteres.';
    }
    async function run(query, current) {
        controller = new AbortController();
        select.setAttribute('aria-busy', 'true');
        status.textContent = 'Buscando pacientes…';
        try {
            const data = await search(query, controller.signal);
            if (current !== version) return;
            matches = data.results;
            const labels = matches.map(p => `${p.nombre} ${p.apellido} · DNI ${p.dni}`);
            const counts = new Map();
            labels.forEach(label => counts.set(label, (counts.get(label) || 0) + 1));
            select.replaceChildren(new Option(matches.length ? 'Seleccione un paciente' : 'Sin coincidencias', ''),
                ...matches.map((p, i) => new Option(`${labels[i]}${counts.get(labels[i]) > 1 || data.next ? ' · ID ' + p.id : ''}`, p.id)));
            status.textContent = !matches.length ? 'No se encontraron pacientes activos.'
                : `${data.count} coincidencia(s). Seleccione un paciente.${data.next ? ' Se muestran los primeros 25 resultados; refine la búsqueda para ver otras coincidencias.' : ''}`;
        } catch (error) {
            if (current !== version || error.name === 'AbortError') return;
            status.textContent = errorMessage(error);
        } finally {
            if (current === version) select.removeAttribute('aria-busy');
        }
    }
    input.addEventListener('input', () => {
        clear();
        const query = normalize(input.value);
        if (query.length < 2 || query.length > 200) return;
        const current = version;
        timer = setTimeout(() => run(query, current), 300);
    });
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault(); // Searching must never implicitly submit the booking form.
        select.focus();
    });
    select.addEventListener('change', () => {
        identify();
        if (!selected()) status.textContent = 'Seleccione un paciente para continuar.';
    });
    form.addEventListener('reset', clear);
    return { getSelectedPatient: selected };
}
