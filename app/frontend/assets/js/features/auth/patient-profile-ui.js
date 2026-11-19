import { request, errorMessage } from '../../core/api.js';
import { getCurrentUser, refreshUser } from '../../core/session.js';

export function initPersonalProfileEditing() {
    const form = document.querySelector('form[data-form="personal-details"]') || document.getElementById('perfilPacienteDatosForm');
    const role = getCurrentUser()?.rol;
    if (!form || !['PACIENTE', 'MEDICO', 'SECRETARIA'].includes(role)) return;
    const keys = ['nombre', 'apellido', 'telefono', ...(role === 'PACIENTE' ? ['obra_social'] : [])];
    form.elements.namedItem('email').readOnly = true;
    const fields = Object.fromEntries(keys.map(key => [key, form.elements.namedItem(key)]));
    const message = document.getElementById(form.dataset?.message || 'perfilMensaje');
    const button = form.querySelector('[type="submit"]');
    let busy = false;
    function feedback(text, type = 'danger') {
        message.textContent = text;
        message.className = `alert alert-${type}${text ? '' : ' d-none'}`;
    }
    function clearErrors() {
        for (const field of Object.values(fields)) {
            field.setCustomValidity('');
            field.classList.remove('is-invalid');
        }
    }
    function render(user) {
        const values = { ...user, obra_social: user.perfil?.obra_social || '' };
        const email = form.elements.namedItem('email');
        email.value = user.email;
        email.defaultValue = user.email;
        for (const key of keys) {
            fields[key].value = values[key];
            fields[key].defaultValue = values[key];
        }
        document.querySelectorAll('[id$="Navbar"]').forEach(node => { node.textContent = `${user.nombre} ${user.apellido}`; });
    }
    for (const [key, field] of Object.entries(fields)) {
        field.readOnly = false;
        field.required = key !== 'obra_social';
        field.addEventListener('input', () => {
            field.setCustomValidity('');
            field.classList.remove('is-invalid');
            feedback('');
        });
    }
    render(getCurrentUser());
    form.addEventListener('reset', () => { clearErrors(); form.classList.remove('was-validated'); feedback(''); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        clearErrors();
        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            feedback('Complete los datos obligatorios con valores válidos.');
            return;
        }
        busy = true; button.disabled = true;
        try {
            const body = Object.fromEntries(keys.map(key => [key, fields[key].value.trim()]));
            const user = await request('auth/me/', { method: 'PATCH', body });
            render(user);
            form.classList.remove('was-validated');
            try {
                await refreshUser(true);
                feedback('Datos personales actualizados correctamente.', 'success');
            } catch {
                feedback('Los datos se guardaron. Recargue la página para actualizar la información de la sesión.', 'warning');
            }
        } catch (error) {
            for (const key of keys) {
                const errors = error.data?.[key];
                if (!errors) continue;
                const text = Array.isArray(errors) ? errors.join(' ') : String(errors);
                fields[key].setCustomValidity(text);
                fields[key].classList.add('is-invalid');
                const box = fields[key].closest('.col-12').querySelector('.invalid-feedback');
                if (box) box.textContent = text;
            }
            feedback(errorMessage(error));
        } finally { busy = false; button.disabled = false; }
    });
}

export { initPersonalProfileEditing as initPatientProfileEditing };
