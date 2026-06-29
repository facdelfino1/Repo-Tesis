export function setFieldError(fields, fieldName, text, getErrorElement) {
    const field = fields[fieldName];
    const errorElement = typeof getErrorElement === "function" ? getErrorElement(fieldName) : null;

    if (!field || !errorElement) {
        return;
    }

    field.classList.toggle("is-invalid", text !== "");
    errorElement.textContent = text;
}

export function clearErrors(fields, setError, options = {}) {
    Object.keys(fields).forEach((fieldName) => setError(fieldName, ""));

    if (typeof options.onClear === "function") {
        options.onClear();
    }
}

export function resetFormFields(fields, values = {}) {
    Object.entries(fields).forEach(([fieldName, field]) => {
        if (!field) {
            return;
        }

        field.value = values[fieldName] || "";
    });
}

export function initPasswordToggles(root) {
    if (!root) {
        return;
    }

    root.querySelectorAll('[data-action="toggle-password"]').forEach((button) => {
        button.addEventListener("click", () => {
            const input = document.getElementById(button.dataset.target);
            const icon = button.querySelector("i");

            if (!input || !icon) {
                return;
            }

            const isVisible = input.type === "text";
            input.type = isVisible ? "password" : "text";
            icon.className = isVisible ? "bi bi-eye" : "bi bi-eye-slash";
            button.setAttribute("aria-label", isVisible ? "Mostrar contrasena" : "Ocultar contrasena");
        });
    });
}
