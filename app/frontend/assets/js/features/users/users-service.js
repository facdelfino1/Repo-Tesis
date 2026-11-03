import { listAll, request } from '../../core/api.js';

export const listInternalUsers = () => listAll('admin/usuarios/');
export const getInternalUser = id => request(`admin/usuarios/${encodeURIComponent(id)}/`);
export const createInternalUser = body => request('admin/usuarios/', { method: 'POST', body });
export const updateInternalUser = (id, body) => request(`admin/usuarios/${encodeURIComponent(id)}/`, { method: 'PATCH', body });
export const getAdminSpecialties = () => listAll('admin/especialidades/');
