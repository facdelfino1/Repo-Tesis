import { request, errorMessage } from '../../core/api.js';
import { getCurrentUser, pageMessage } from '../../core/session.js';
import { initPasswordToggles } from '../../components/forms.js';

export function initAccountProfile() {
    const form = document.querySelector('form[data-form$="-profile"]');
    if (!form) return;
    const user = getCurrentUser();
    const values = { ...user, obraSocial:user.perfil?.obra_social || '', legajo:user.perfil?.legajo || '',
        matricula:user.perfil?.matricula || '', especialidad:user.perfil?.especialidad?.nombre || '' };
    form.querySelectorAll('input:not([type="password"])').forEach(input => {
        const key = input.name || Object.keys(values).find(k => input.id.toLowerCase().endsWith(k.toLowerCase()));
        if (key && Object.hasOwn(values,key)) input.value = values[key];
        input.readOnly = true;
    });
    pageMessage('Sus datos se consultan desde la cuenta. En esta pantalla puede cambiar su contraseña.', 'info');
    initPasswordToggles(document);
    const submitLabel = form.querySelector('[type="submit"]');
    if (submitLabel) submitLabel.textContent = 'Cambiar contraseña';
    const newPassword = form.querySelector('input[id$="PasswordNueva"]');
    const help = newPassword?.closest('.col-12, .mb-3')?.querySelector('.form-text');
    if (help) help.textContent = 'El servidor verificara los requisitos de seguridad de la clave.';
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const find = suffix => form.querySelector(`input[id$="${suffix}"]`);
        const actual = find('Actual'), nueva = find('Nueva'), confirmacion = find('Confirmar');
        if (!actual || !nueva || !confirmacion) return;
        const submit = form.querySelector('[type="submit"]');
        if (submit) submit.disabled=true;
        try {
            const data = await request('auth/password/', { method:'POST', body: {
                password_actual:actual.value, password_nueva:nueva.value, password_confirmacion:confirmacion.value } });
            actual.value=''; nueva.value=''; confirmacion.value='';
            pageMessage(data.detail,'success');
        } catch(error) { pageMessage(errorMessage(error),'danger'); }
        finally { if (submit) submit.disabled=false; }
    });
}
