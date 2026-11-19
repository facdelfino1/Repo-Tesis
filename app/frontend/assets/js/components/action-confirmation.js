import { getBootstrapModal, showModal, hideModal } from './modals.js';

let nextId = 0;

// One lazily created Bootstrap modal per controller, shared by its configured actions.
export function createActionConfirmation() {
    let element, modal, title, message, context, errorBox, confirm, back, request;
    let processing = false, closing = false;
    function controls(disabled) {
        element.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
    }
    function mount() {
        if (element) return;
        const id = `actionConfirmation${++nextId}`;
        element = document.createElement('div');
        element.id = id; element.className = 'modal fade'; element.tabIndex = -1;
        element.setAttribute('aria-labelledby', `${id}Title`);
        element.setAttribute('aria-describedby', `${id}Message`);
        element.setAttribute('aria-hidden', 'true');
        element.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content">
            <div class="modal-header"><h2 class="modal-title h5" id="${id}Title"></h2>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
            <div class="modal-body"><p class="fw-semibold" data-context></p><p id="${id}Message" data-message></p>
                <div class="alert alert-danger d-none mb-0" role="alert" tabindex="-1" data-error></div></div>
            <div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" data-back>Volver</button>
                <button type="button" class="btn btn-primary" data-confirm></button></div>
            </div></div>`;
        document.body.append(element);
        title = element.querySelector('.modal-title'); message = element.querySelector('[data-message]');
        context = element.querySelector('[data-context]'); errorBox = element.querySelector('[data-error]');
        confirm = element.querySelector('[data-confirm]'); back = element.querySelector('[data-back]');
        modal = getBootstrapModal(element);
        element.addEventListener('shown.bs.modal', () => {
            if (closing) hideModal(modal);
            else back.focus();
        });
        element.addEventListener('hide.bs.modal', event => {
            if (processing && !closing) event.preventDefault();
        });
        element.addEventListener('hidden.bs.modal', () => {
            const previous = request;
            request = null; processing = false; closing = false;
            if (!previous) return;
            previous.resolve(previous.confirmed);
            // The caller may re-render the table when its pending open() finishes.
            queueMicrotask(() => previous.restoreFocus?.());
        });
        confirm.addEventListener('click', async () => {
            if (!request || processing || closing || request.notice) return;
            processing = true; controls(true); errorBox.classList.add('d-none');
            try {
                await request.onConfirm();
                request.confirmed = true; closing = true;
                hideModal(modal);
            } catch (error) {
                const failure = request.onError ? await request.onError(error) : 'No fue posible completar la operación.';
                processing = false; controls(false);
                if (failure?.notice) {
                    request.notice = true;
                    title.textContent = failure.title || title.textContent;
                    message.textContent = failure.notice;
                    confirm.classList.add('d-none'); confirm.disabled = true;
                    back.textContent = 'Entendido'; back.focus();
                } else {
                    errorBox.textContent = failure; errorBox.classList.remove('d-none'); errorBox.focus();
                }
            }
        });
    }
    return {
        open(options) {
            if (request) return Promise.resolve(false);
            mount();
            if (!modal) throw new Error('No fue posible abrir la confirmación. Recargue la página.');
            title.textContent = options.title; message.textContent = options.message;
            context.textContent = options.context || ''; confirm.textContent = options.confirmText;
            confirm.classList.remove('d-none'); back.textContent = 'Volver';
            errorBox.textContent = ''; errorBox.classList.add('d-none'); controls(false);
            return new Promise(resolve => {
                request = { ...options, resolve, confirmed: false };
                showModal(modal);
            });
        }
    };
}
