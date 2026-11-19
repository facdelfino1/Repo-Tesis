// Clear only the pediatric questionnaire, preserving patient/doctor/slot selection.
export function bindPediatricCleanup(form, specialtySelect) {
    const clear = () => {
        form.querySelectorAll('[data-triage-specialty="pediatria"] input, [data-triage-specialty="pediatria"] select').forEach(control => {
            if (control.type === 'radio' || control.type === 'checkbox') control.checked = false;
            else control.value = '';
        });
    };
    specialtySelect.addEventListener('change', clear);
    form.addEventListener('reset', () => queueMicrotask(clear));
    form.closest('.modal')?.addEventListener('hidden.bs.modal', clear);
    form.querySelector('#asignarPacienteSeleccion')?.addEventListener('change', clear);
    return clear;
}
