import { errorMessage } from '../../core/api.js';
import { escapeHtml as esc } from '../../core/helpers.js';
import { getBootstrapModal, showModal, hideModal } from '../../components/modals.js';
import { listInternalUsers, getInternalUser, createInternalUser, updateInternalUser, getAdminSpecialties } from './users-service.js';

const node = id => document.getElementById(id);
const name = user => `${user.nombre} ${user.apellido}`;
const roles = { MEDICO: 'Médico', SECRETARIA: 'Secretaría' };
function feedback(box, text, type = 'danger') { box.textContent = text; box.className = `alert alert-${type}${text ? '' : ' d-none'}`; }

export async function initUserManagement() {
    const table = node('adminGestionUsuariosTabla'), message = node('adminUsuariosMensaje');
    const createForm = node('adminUsuarioCrearForm'), editForm = node('adminUsuarioEditarForm');
    const createModal = getBootstrapModal(node('adminUsuarioCrearModal')), editModal = getBootstrapModal(node('adminUsuarioEditarModal'));
    const detailModal = getBootstrapModal(node('adminUsuarioDetalleModal'));
    const stateModal = getBootstrapModal(node('adminUsuarioEstadoModal'));
    let users = [], editing = null, changing = null, busy = false;
    const boxes = new Map();
    for (const form of [createForm, editForm]) {
        const box = document.createElement('div'); box.className = 'alert d-none'; box.setAttribute('role', 'alert'); form.querySelector('.modal-body').prepend(box); boxes.set(form, box);
    }
    const fields = prefix => Object.fromEntries(['nombre', 'apellido', 'dni', 'email', 'telefono', 'rol', 'matricula', 'especialidad', 'legajo', ...(prefix === 'crear' ? ['password'] : [])]
        .map(key => [key, node(`${prefix}Usuario${key[0].toUpperCase() + key.slice(1)}`)]));
    const create = fields('crear'), edit = fields('editar');
    const [specialties, initialUsers] = await Promise.all([getAdminSpecialties(), listInternalUsers()]);
    for (const field of [create.especialidad, edit.especialidad]) {
        field.replaceChildren(new Option('Seleccione una especialidad', ''), ...specialties.map(s => new Option(s.nombre, s.id)));
    }
    function roleFields(prefix, role) {
        for (const suffix of ['MedicoMatriculaGrupo', 'MedicoEspecialidadGrupo']) node(prefix + suffix).classList.toggle('d-none', role !== 'MEDICO');
        node(prefix + 'SecretariaLegajoGrupo').classList.toggle('d-none', role !== 'SECRETARIA');
        const controls = prefix === 'crear' ? create : edit;
        for (const key of ['matricula', 'especialidad', 'legajo']) {
            controls[key].disabled = key === 'legajo' ? role !== 'SECRETARIA' : role !== 'MEDICO';
            controls[key].required = !controls[key].disabled;
        }
    }
    for (const controls of [create, edit]) for (const key of ['nombre', 'apellido', 'email', 'telefono']) controls[key].required = true;
    create.dni.required = true; create.rol.required = true; create.password.required = true;
    create.rol.addEventListener('change', () => roleFields('crear', create.rol.value.toUpperCase()));
    function render() {
        const term = node('adminUsuariosBusqueda').value.trim().toLocaleLowerCase(), role = node('adminUsuariosRolFiltro').value.toUpperCase();
        const visible = users.filter(user => (!role || user.rol === role) && (!term || [user.nombre, user.apellido, user.dni, user.email].join(' ').toLocaleLowerCase().includes(term)));
        table.innerHTML = visible.map(user => `<tr><td>${esc(user.nombre)}</td><td>${esc(user.apellido)}</td><td>${esc(user.dni)}</td><td>${esc(user.email)}</td><td>${esc(user.telefono)}</td><td>${roles[user.rol]}</td><td>${user.is_active ? 'Activo' : 'Inactivo'}</td><td>
            <button type="button" class="btn btn-outline-primary btn-sm" data-user="${user.id}" data-action="detail">Detalle</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" data-user="${user.id}" data-action="edit">Editar</button>
            <button type="button" class="btn btn-outline-warning btn-sm" data-user="${user.id}" data-action="status">${user.is_active ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') || '<tr><td colspan="8">No hay cuentas internas para los filtros seleccionados.</td></tr>';
        table.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    }
    async function refresh() {
        table.innerHTML = '<tr><td colspan="8">Consultando cuentas...</td></tr>';
        users = await listInternalUsers(); render();
    }
    async function afterWrite(text) {
        feedback(message, text, 'success');
        try { await refresh(); } catch (error) { feedback(message, `${text} Recargue para actualizar la lista. ${errorMessage(error)}`, 'warning'); }
    }
    node('adminUsuariosBusqueda').addEventListener('input', render); node('adminUsuariosRolFiltro').addEventListener('change', render);
    node('crearUsuarioInternoBtn').addEventListener('click', () => {
        if (busy) return; createForm.reset(); createForm.classList.remove('was-validated'); roleFields('crear', create.rol.value.toUpperCase()); feedback(boxes.get(createForm), ''); showModal(createModal);
    });
    table.addEventListener('click', async event => {
        const button = event.target.closest('[data-user]'); if (!button || busy) return;
        busy = true; render();
        try {
            const user = await getInternalUser(button.dataset.user);
            if (button.dataset.action === 'detail') {
                node('adminUsuarioDetalleContenido').innerHTML = `<dl class="row">${Object.entries({ Nombre: name(user), DNI: user.dni, Email: user.email, Teléfono: user.telefono, Rol: roles[user.rol], Estado: user.is_active ? 'Activo' : 'Inactivo', ...(user.rol === 'MEDICO' ? { Matrícula: user.perfil.matricula, Especialidad: user.perfil.especialidad.nombre } : { Legajo: user.perfil.legajo }) }).map(([key, value]) => `<dt class="col-sm-4">${key}</dt><dd class="col-sm-8">${esc(value)}</dd>`).join('')}</dl>`; showModal(detailModal);
            } else if (button.dataset.action === 'edit') {
                editing = user; feedback(boxes.get(editForm), '');
                for (const key of ['nombre', 'apellido', 'dni', 'email', 'telefono', 'rol']) edit[key].value = user[key];
                edit.matricula.value = user.perfil.matricula || ''; edit.legajo.value = user.perfil.legajo || ''; edit.especialidad.value = user.perfil.especialidad?.id || '';
                roleFields('editar', user.rol); showModal(editModal);
            } else {
                changing = user; node('adminUsuarioEstadoTitulo').textContent = user.is_active ? 'Desactivar cuenta' : 'Activar cuenta';
                node('adminUsuarioEstadoTexto').textContent = `${name(user)} (${user.email}). ¿Confirma el cambio de activación administrativa?`; showModal(stateModal);
            }
        } catch (error) { feedback(message, errorMessage(error)); }
        finally { busy = false; render(); }
    });
    function payload(controls, role, creating) {
        const body = Object.fromEntries(['nombre', 'apellido', 'email', 'telefono'].map(key => [key, controls[key].value.trim()]));
        if (creating) Object.assign(body, { dni: controls.dni.value.trim(), rol: role, password: controls.password.value });
        if (role === 'MEDICO') Object.assign(body, { matricula: controls.matricula.value.trim(), especialidad: Number(controls.especialidad.value) });
        else body.legajo = controls.legajo.value.trim();
        return body;
    }
    for (const [form, controls, creating, modal] of [[createForm, create, true, createModal], [editForm, edit, false, editModal]]) {
        form.addEventListener('submit', async event => {
            event.preventDefault(); if (busy || !creating && !editing) return;
            if (!form.checkValidity()) { form.classList.add('was-validated'); feedback(boxes.get(form), 'Complete los campos obligatorios con valores válidos.'); return; }
            const role = creating ? controls.rol.value.toUpperCase() : editing.rol, body = payload(controls, role, creating);
            busy = true; const button = form.querySelector('[type=submit]'); button.disabled = true;
            try {
                if (creating) await createInternalUser(body); else await updateInternalUser(editing.id, body);
                if (creating) controls.password.value = ''; hideModal(modal); await afterWrite(creating ? 'Cuenta creada correctamente.' : 'Cuenta actualizada correctamente.');
            } catch (error) { feedback(boxes.get(form), errorMessage(error)); }
            finally { busy = false; button.disabled = false; render(); }
        });
    }
    node('adminUsuarioCrearModal').addEventListener('hidden.bs.modal', () => { create.password.value = ''; });
    node('adminUsuarioConfirmarEstadoBtn').addEventListener('click', async () => {
        if (busy || !changing) return; busy = true; const button = node('adminUsuarioConfirmarEstadoBtn'); button.disabled = true;
        try { await updateInternalUser(changing.id, { is_active: !changing.is_active }); hideModal(stateModal); await afterWrite('Estado de la cuenta actualizado.'); }
        catch (error) { hideModal(stateModal); feedback(message, errorMessage(error)); }
        finally { busy = false; button.disabled = false; render(); }
    });
    users = initialUsers; render();
}
