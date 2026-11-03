import { request } from '../../core/api.js';

export function getAdminMetrics(filters = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value != null));
    return request(`admin/metricas/${query.size ? '?' + query : ''}`);
}
export const observedMinutes = value => typeof value === 'number' && Number.isFinite(value) ? `${value} min` : 'Sin datos disponibles';
