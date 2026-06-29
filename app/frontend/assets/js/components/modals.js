export function getBootstrapModal(element) {
    const bootstrapApi = window.bootstrap || globalThis.bootstrap;

    if (!element || !bootstrapApi || !bootstrapApi.Modal) {
        return null;
    }

    return new bootstrapApi.Modal(element);
}

export function showModal(modal) {
    if (modal && typeof modal.show === "function") {
        modal.show();
    }
}

export function hideModal(modal) {
    if (modal && typeof modal.hide === "function") {
        modal.hide();
    }
}
