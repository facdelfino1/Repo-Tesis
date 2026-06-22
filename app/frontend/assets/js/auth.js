document.addEventListener("DOMContentLoaded", () => {
    const registerForm = document.querySelector('[data-form="patient-register"]');

    if (!registerForm) {
        return;
    }

    const successMessage = document.getElementById("registroSuccess");
    const fields = {
        nombre: document.getElementById("nombre"),
        apellido: document.getElementById("apellido"),
        dni: document.getElementById("dni"),
        telefono: document.getElementById("telefono"),
        email: document.getElementById("email"),
        password: document.getElementById("password"),
        confirmPassword: document.getElementById("confirmPassword")
    };

    const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
    let validationStarted = false;

    function setValidity(input, isValid) {
        input.classList.toggle("is-invalid", !isValid);
        input.classList.toggle("is-valid", isValid);
    }

    function validateRegisterForm() {
        const validations = {
            nombre: fields.nombre.value.trim().length > 0,
            apellido: fields.apellido.value.trim().length > 0,
            dni: /^\d+$/.test(fields.dni.value.trim()),
            telefono: /^\d+$/.test(fields.telefono.value.trim()),
            email: fields.email.checkValidity(),
            password: passwordPattern.test(fields.password.value),
            confirmPassword: fields.confirmPassword.value === fields.password.value && fields.confirmPassword.value.length > 0
        };

        Object.entries(validations).forEach(([fieldName, isValid]) => {
            setValidity(fields[fieldName], isValid);
        });

        return Object.values(validations).every(Boolean);
    }

    registerForm.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopPropagation();
        validationStarted = true;

        if (successMessage) {
            successMessage.classList.add("d-none");
        }

        if (!validateRegisterForm()) {
            return;
        }

        registerForm.reset();
        Object.values(fields).forEach((field) => {
            field.classList.remove("is-valid", "is-invalid");
        });

        if (successMessage) {
            successMessage.classList.remove("d-none");
        }
    });

    Object.values(fields).forEach((field) => {
        field.addEventListener("input", () => {
            if (successMessage) {
                successMessage.classList.add("d-none");
            }

            if (validationStarted) {
                validateRegisterForm();
            }
        });
    });
});
