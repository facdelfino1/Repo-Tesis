import { errorMessage } from '../../core/api.js';
import { getPatientDelay } from './patient-api.js?v=patient-delay-1';

// One timer refreshes the selected appointment context and its timing indicators.
export function createPatientDelay({ refreshTurn = null } = {}) {
    const metric = document.getElementById('esperaEstimada');
    const detail = document.getElementById('demoraEstimacionDetalle');
    const average = document.getElementById('duracionPromedio');
    let turn = null, timer = null, pending = null, contextPending = null, revision = 0, disposed = false, initialized = false;
    const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    function clearTimer() { clearTimeout(timer); timer = null; }
    function schedule() {
        clearTimer();
        if (!disposed && (turn || (refreshTurn && initialized)) && !document.hidden && !contextPending) timer = setTimeout(refreshContext, 60000);
    }
    function refreshContext() {
        clearTimer();
        if (disposed || !initialized) return Promise.resolve();
        if (!refreshTurn) return refresh();
        if (contextPending) return contextPending.promise;
        if (pending) return pending.promise;
        const request = { promise: null };
        contextPending = request;
        request.promise = (async () => {
            try {
                await refreshTurn({ isCurrent: () => !disposed && contextPending === request });
            } catch (error) {
                if (!disposed && contextPending === request) {
                    text(metric, 'Espera no disponible');
                    text(detail, `No fue posible actualizar los tiempos del turno. ${errorMessage(error)}`);
                }
            } finally {
                if (contextPending === request) { contextPending = null; schedule(); }
            }
        })();
        return request.promise;
    }
    function render(estimate) {
        const minutes = estimate.espera_estimada_minutos;
        const mean = estimate.promedio_consulta_minutos;
        text(average, Number.isFinite(mean) && mean > 0 ? `${mean} min` : 'Promedio no disponible');
        if (turn?.estado === 'EN_ATENCION') {
            text(metric, 'En atención');
            text(detail, 'Tu consulta ya comenzó');
            return;
        }
        text(metric, estimate.estado_estimacion === 'CONSULTA_DEMORADA' ? 'Consulta anterior demorada'
            : !Number.isFinite(minutes) ? 'Espera no disponible' : minutes === 0 ? 'Sin espera estimada' : `${minutes} min`);
        text(detail, estimate.motivo.endsWith('Estimación informativa sujeta a cambios.')
            ? estimate.motivo : `${estimate.motivo} Estimación informativa sujeta a cambios.`);
    }
    function refresh() {
        clearTimer();
        if (disposed || !turn) { schedule(); return Promise.resolve(); }
        if (pending) return pending.promise;
        const version = revision, id = turn.id_turno;
        const request = { controller: new AbortController(), promise: null };
        pending = request;
        metric.setAttribute('aria-busy', 'true');
        request.promise = (async () => {
            try {
                const estimate = await getPatientDelay(id, { signal: request.controller.signal });
                if (disposed || version !== revision || pending !== request) return;
                render(estimate);
            } catch (error) {
                if (disposed || version !== revision || pending !== request || request.controller.signal.aborted) return;
                if (average.textContent === 'Consultando...') text(average, 'Promedio no disponible');
                text(metric, 'Espera no disponible');
                text(detail, `No fue posible actualizar los tiempos del turno. ${errorMessage(error)}`);
            } finally {
                if (pending === request) {
                    pending = null; metric.setAttribute('aria-busy', 'false'); schedule();
                }
            }
        })();
        return request.promise;
    }
    function updateTurn(next) {
        if (disposed) return Promise.resolve();
        const changed = !initialized || next?.id_turno !== turn?.id_turno || next?.medico?.id !== turn?.medico?.id;
        const contextChanged = changed || next?.estado !== turn?.estado || next?.fecha !== turn?.fecha || next?.hora !== turn?.hora;
        initialized = true;
        turn = next || null;
        if (contextChanged) {
            ++revision; clearTimer(); pending?.controller.abort(); pending = null;
            metric.setAttribute('aria-busy', 'false');
        }
        if (changed) {
            text(average, turn ? 'Consultando...' : 'Promedio no disponible');
            text(metric, turn ? 'Consultando...' : 'Espera no disponible');
            text(detail, 'Estimación informativa sujeta a cambios.');
        }
        return refresh();
    }
    function visibilityChanged() { if (document.hidden) clearTimer(); else refreshContext(); }
    function dispose() {
        disposed = true; ++revision; clearTimer(); pending?.controller.abort(); pending = null; contextPending = null;
        metric.setAttribute('aria-busy', 'false');
        document.removeEventListener('visibilitychange', visibilityChanged);
        window.removeEventListener('pagehide', dispose);
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', dispose);
    return { updateTurn, refresh, dispose };
}
