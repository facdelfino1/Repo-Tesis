import { request } from '../../core/api.js';

export function getAdminMetrics(filters = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value != null));
    return request(`admin/metricas/${query.size ? '?' + query : ''}`);
}
export function observedMinutes(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
    const totalSeconds = Math.round(value * 60);
    if (!Number.isSafeInteger(totalSeconds)) return '—';
    return `${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} s`;
}
