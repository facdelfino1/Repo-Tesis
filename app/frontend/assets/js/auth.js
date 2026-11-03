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
        alert(register, 'El registro público de pacientes no está habilitado. Comuníquese con Secretaría.', 'info');
        register.querySelectorAll('input, select, button').forEach(control => { control.disabled = true; });
        register.addEventListener('submit', event => event.preventDefault());
    }
});
