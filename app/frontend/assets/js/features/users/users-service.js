import { ApiError, listAll, request } from '../../core/api.js';

export const listInternalUsers = () => listAll('admin/usuarios/');
export const listAdminPatients = () => listAll('admin/pacientes/');
export const getAdminPatient = id => request(`admin/pacientes/${encodeURIComponent(id)}/`);
export const updateAdminPatient = (id, body) => request(`admin/pacientes/${encodeURIComponent(id)}/`, { method: 'PATCH', body });
export const getInternalUser = id => request(`admin/usuarios/${encodeURIComponent(id)}/`);
export async function createInternalUser(body) {
    if (typeof body?.fecha_nacimiento !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha_nacimiento)) {
        throw new ApiError(400, { fecha_nacimiento: ['Ingrese la fecha de nacimiento en formato YYYY-MM-DD.'] },
            'Fecha de nacimiento obligatoria.');
    }
    return request('admin/usuarios/', { method: 'POST', body });
}
export const updateInternalUser = (id, body) => request(`admin/usuarios/${encodeURIComponent(id)}/`, { method: 'PATCH', body });
export const getAdminSpecialties = () => listAll('admin/especialidades/');
