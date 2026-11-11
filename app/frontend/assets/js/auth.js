import { login, dashboardUrl, refreshUser } from './core/session.js';
import { request, errorMessage } from './core/api.js';
import { initPasswordToggles } from './components/forms.js';

function alert(form,text,type='danger') {
    let element=form.querySelector('[data-api-feedback]');
    if (!element) { element=document.createElement('div'); element.dataset.apiFeedback=''; element.setAttribute('role','alert'); form.prepend(element); }
    element.className=`alert alert-${type}`; element.textContent=text;
}
async function submit(form,operation) {
    const button=form.querySelector('[type="submit"]');
    if (button) button.disabled=true;
    try { await operation(); }
    catch(error) { alert(form,errorMessage(error)); }
    finally { if(button)button.disabled=false; }
}

document.addEventListener('DOMContentLoaded', async () => {
    initPasswordToggles(document);
    const path=window.location.pathname;
    if (path.endsWith('/login.html')) {
        const form=document.querySelector('form');
        form.querySelector('.btn-primary').type='submit';
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (form.querySelector('[type="submit"]')?.disabled) return;
            if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
            submit(form,async () => {
                const user=await login(document.getElementById('email').value.trim(),document.getElementById('password').value);
                const destination=dashboardUrl(user.rol);
                if (!destination) throw new Error('Rol sin panel.');
                form.reset(); window.location.assign(destination);
            });
        });
        try { const user=await refreshUser(); const url=dashboardUrl(user.rol); if(url)window.location.replace(url); }
        catch(error) { if (![401,403].includes(error.status)) alert(form,errorMessage(error)); }
    }
    const recovery=document.querySelector('[data-form="password-recovery"]');
    if (recovery) {
        const params=new URLSearchParams(window.location.search);
        const uid=params.get('uid'), token=params.get('token');
        if (uid && token) {
            // Keep reset secrets in memory; remove them from the address bar/history entry.
            history.replaceState(null,'',window.location.pathname);
            recovery.querySelector('input[type="email"]').closest('.mb-3').hidden=true;
            for (const [id,label] of [['password_nueva','Nueva contraseña'],['password_confirmacion','Confirmar contraseña']]) {
                const block=document.createElement('div'); block.className='mb-3';
                const title=document.createElement('label'); title.className='form-label'; title.htmlFor=id; title.textContent=label;
                const input=document.createElement('input'); input.type='password'; input.id=id; input.className='form-control'; input.required=true; input.autocomplete='new-password';
                block.append(title,input); recovery.insertBefore(block,recovery.querySelector('.d-grid'));
            }
            recovery.querySelector('[type="submit"]').textContent='Restablecer contraseña';
        }
        recovery.addEventListener('submit', event => {
            event.preventDefault();
            submit(recovery,async () => {
                let result;
                if (uid && token) {
                    result=await request('auth/password-reset/confirm/',{method:'POST',body:{uid,token,
                        password_nueva:document.getElementById('password_nueva').value,
                        password_confirmacion:document.getElementById('password_confirmacion').value}});
                } else {
                    const email=document.getElementById('recoveryEmail');
                    if(!email.checkValidity()){email.classList.add('is-invalid');return;}
                    result=await request('auth/password-reset/',{method:'POST',body:{email:email.value.trim()}});
                }
                recovery.reset(); alert(recovery,result.detail,'success');
            });
        });
    }
    const register=document.querySelector('[data-form="patient-register"]');
    if (register) {
        const password = register.elements.namedItem('password');
        const confirmation = register.elements.namedItem('confirmPassword');
        const button = register.querySelector('[type="submit"]');
        const success = document.getElementById('registroSuccess');
        let busy = false, registered = false;
        function checkConfirmation() {
            confirmation.setCustomValidity(confirmation.value && confirmation.value !== password.value
                ? 'Las contraseñas no coinciden.' : '');
        }
        register.addEventListener('input', () => {
            checkConfirmation();
            register.querySelector('[data-api-feedback]')?.remove();
        });
        register.addEventListener('submit', async event => {
            event.preventDefault();
            if (busy || registered) return;
            checkConfirmation();
            if (!register.checkValidity()) {
                register.classList.add('was-validated');
                alert(register, confirmation.validity.customError ? 'Las contraseñas no coinciden.' : 'Complete los campos obligatorios con datos válidos.');
                return;
            }
            const field = name => register.elements.namedItem(name).value.trim();
            const body = { nombre: field('nombre'), apellido: field('apellido'), dni: field('dni'),
                telefono: field('telefono'), email: field('email'), obra_social: field('obraSocial'),
                password: password.value, password_confirmacion: confirmation.value };
            busy = true; button.disabled = true;
            try {
                const result = await request('auth/registro-paciente/', { method: 'POST', body });
                registered = true; register.reset();
                register.querySelector('[data-api-feedback]')?.remove();
                register.classList.remove('was-validated');
                success.textContent = result.detail; success.classList.remove('d-none');
                register.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
                window.setTimeout(() => window.location.assign('login.html'), 1500);
            } catch (error) { alert(register, errorMessage(error)); }
            finally { busy = false; if (!registered) button.disabled = false; }
        });
    }
});
