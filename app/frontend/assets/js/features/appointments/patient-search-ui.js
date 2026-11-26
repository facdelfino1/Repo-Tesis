import { errorMessage } from '../../core/api.js';
import { searchPatients } from './agenda-api.js';

const normalize = text => text.trim().replace(/\s+/g, ' ');

export function initPatientSearch(form, search = searchPatients) {
    const field = id => form.querySelector(`#asignarPaciente${id}`);
    const inputs = ['Nombre', 'Apellido', 'Dni'].map(field);
    const phone = field('Telefono'), suggestions = field('Sugerencias'), status = field('Estado');
    let matches = [], patient = null, activeInput = null, activeIndex = -1;
    let version = 0, timer, controller;
    const notify = () => form.dispatchEvent(new Event('patient-selection-change'));
    function cancel() {
        ++version;
        clearTimeout(timer);
        controller?.abort();
        suggestions.removeAttribute('aria-busy');
    }
    function hide() {
        suggestions.hidden = true;
        suggestions.replaceChildren();
        matches = [];
        activeIndex = -1;
        inputs.forEach(input => {
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        });
    }
    function invalidate(edited = null) {
        const hadPatient = patient !== null;
        patient = null;
        if (hadPatient) inputs.forEach(input => { if (input !== edited) input.value = ''; });
        phone.value = '';
        status.classList.remove('text-success');
        if (hadPatient) notify();
    }
    function clear() {
        cancel();
        hide();
        invalidate();
        inputs.forEach(input => { input.value = ''; });
        activeInput = null;
        status.textContent = 'Ingrese entre 2 y 200 caracteres en nombre, apellido o DNI.';
        const message = form.querySelector('#asignarTurnoMensaje');
        if (message) { message.textContent = ''; message.classList.add('d-none'); }
    }
    function choose(index) {
        const match = matches[index];
        if (!match) return;
        const focus = activeInput;
        cancel();
        patient = match;
        inputs[0].value = match.nombre;
        inputs[1].value = match.apellido;
        inputs[2].value = match.dni;
        phone.value = match.telefono?.trim() || 'No registrado';
        hide();
        status.textContent = `Paciente seleccionado: ${match.nombre} ${match.apellido} · DNI ${match.dni} · ID ${match.id}`;
        status.classList.add('text-success');
        notify();
        focus?.focus();
    }
    function highlight(index) {
        if (!matches.length || suggestions.hidden) return;
        activeIndex = (index + matches.length) % matches.length;
        [...suggestions.children].forEach((option, i) => {
            option.setAttribute('aria-selected', String(i === activeIndex));
            option.classList.toggle('active', i === activeIndex);
        });
        const option = suggestions.children[activeIndex];
        activeInput.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
    }
    async function run(query, current) {
        controller = new AbortController();
        suggestions.setAttribute('aria-busy', 'true');
        status.textContent = 'Buscando pacientes…';
        try {
            const data = await search(query, controller.signal);
            if (current !== version) return;
            matches = data.results;
            const labels = matches.map(p => `${p.nombre} ${p.apellido} · DNI ${p.dni}`);
            const counts = new Map();
            labels.forEach(label => counts.set(label, (counts.get(label) || 0) + 1));
            suggestions.replaceChildren(...matches.map((p, i) => {
                const option = form.ownerDocument.createElement('button');
                option.type = 'button';
                option.tabIndex = -1;
                option.id = `asignarPacienteOpcion${i}`;
                option.className = 'list-group-item list-group-item-action text-wrap text-break';
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', 'false');
                option.textContent = `${labels[i]}${counts.get(labels[i]) > 1 || data.next ? ' · ID ' + p.id : ''}`;
                option.addEventListener('mousedown', event => event.preventDefault());
                option.addEventListener('click', () => choose(i));
                return option;
            }));
            suggestions.hidden = !matches.length;
            activeInput.setAttribute('aria-expanded', String(matches.length > 0));
            status.textContent = !matches.length ? 'No se encontraron pacientes activos.'
                : `${data.count} coincidencia(s). Seleccione un paciente.${data.next ? ' Se muestran los primeros 25 resultados; refine la búsqueda para ver otras coincidencias.' : ''}`;
        } catch (error) {
            if (current !== version || error.name === 'AbortError') return;
            status.textContent = errorMessage(error);
        } finally {
            if (current === version) suggestions.removeAttribute('aria-busy');
        }
    }
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            cancel(); hide(); invalidate(input);
            activeInput = input;
            const query = normalize(input.value);
            status.textContent = 'Ingrese entre 2 y 200 caracteres en nombre, apellido o DNI.';
            if (query.length < 2 || query.length > 200) return;
            const current = version;
            timer = setTimeout(() => run(query, current), 300);
        });
        input.addEventListener('keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                if (activeIndex >= 0) choose(activeIndex);
            } else if (event.key === 'Escape') {
                if (!suggestions.hidden) { event.preventDefault(); event.stopPropagation(); }
                cancel(); hide();
                if (!patient) status.textContent = 'Búsqueda cerrada. Escriba para buscar nuevamente.';
            } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && !suggestions.hidden && input === activeInput) {
                event.preventDefault();
                highlight(activeIndex < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
                    : activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
            }
        });
    });
    form.addEventListener('focusout', event => {
        if (!inputs.includes(event.target) || inputs.includes(event.relatedTarget) || suggestions.contains(event.relatedTarget)) return;
        cancel(); hide();
        if (!patient) status.textContent = 'Escriba para buscar y seleccione un paciente.';
    });
    form.addEventListener('reset', () => { clear(); queueMicrotask(clear); });
    const modal = form.closest('.modal');
    modal?.addEventListener('show.bs.modal', clear);
    modal?.addEventListener('hide.bs.modal', () => { cancel(); hide(); });
    modal?.addEventListener('hidden.bs.modal', clear);
    return {
        getSelectedPatient() {
            if (patient && inputs.some((input, i) => input.value !== [patient.nombre, patient.apellido, patient.dni][i])) {
                cancel(); hide(); invalidate();
                status.textContent = 'Seleccione nuevamente un paciente para continuar.';
            }
            return patient;
        },
        clear
    };
}
