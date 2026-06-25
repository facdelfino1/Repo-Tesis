document.addEventListener("DOMContentLoaded", () => {
    async function loadMock(path, fallback) {
        try {
            const response = await fetch(path);

            if (!response.ok) {
                throw new Error("No se pudo leer el archivo mock.");
            }

            return await response.json();
        } catch (error) {
            return fallback;
        }
    }

    function setValidity(input, isValid) {
        input.classList.toggle("is-invalid", !isValid);
        input.classList.toggle("is-valid", isValid);
    }

    function initPasswordToggles() {
        document.querySelectorAll('[data-action="toggle-password"]').forEach((button) => {
            button.addEventListener("click", () => {
                const input = document.getElementById(button.dataset.target);
                const icon = button.querySelector("i");

                if (!input) {
                    return;
                }

                const isVisible = input.type === "text";
                input.type = isVisible ? "password" : "text";
                button.setAttribute("aria-label", isVisible ? "Mostrar contrasena" : "Ocultar contrasena");
                button.setAttribute("title", isVisible ? "Mostrar contrasena" : "Ocultar contrasena");

                if (icon) {
                    icon.className = isVisible ? "bi bi-eye" : "bi bi-eye-slash";
                }
            });
        });
    }

    function roleDashboard(role) {
        const dashboards = {
            paciente: "../paciente/dashboard.html",
            secretaria: "../secretaria/dashboard.html",
            medico: "../medico/dashboard.html"
        };

        return dashboards[role] || "";
    }

    function initLogin() {
        if (!window.location.pathname.endsWith("/login.html")) {
            return;
        }

        const loginForm = document.querySelector('form[action="#"]');
        const emailInput = document.getElementById("email");
        const passwordInput = document.getElementById("password");
        const submitButton = loginForm ? loginForm.querySelector(".btn-primary") : null;

        if (!loginForm || !emailInput || !passwordInput || !submitButton) {
            return;
        }

        const message = document.createElement("div");
        message.className = "alert alert-danger d-none";
        message.setAttribute("role", "alert");
        loginForm.prepend(message);

        async function submitLogin(event) {
            event.preventDefault();
            message.classList.add("d-none");

            const usuariosData = await loadMock("../../assets/mock/usuarios.json", { usuarios: [] });
            const user = (usuariosData.usuarios || []).find((item) => (
                item.email === emailInput.value.trim()
                && item.contrasena === passwordInput.value
            ));

            setValidity(emailInput, Boolean(user));
            setValidity(passwordInput, Boolean(user));

            if (!user) {
                message.textContent = "Credenciales invalidas.";
                message.classList.remove("d-none");
                return;
            }

            localStorage.setItem("usuarioActualMock", JSON.stringify(user));
            const dashboardUrl = roleDashboard(user.rol);

            if (!dashboardUrl) {
                message.className = "alert alert-info";
                message.textContent = "Credenciales validas. El panel para este rol aun no esta implementado.";
                message.classList.remove("d-none");
                return;
            }

            window.location.href = dashboardUrl;
        }

        submitButton.setAttribute("type", "submit");
        loginForm.addEventListener("submit", submitLogin);
    }

    function initPatientRegister() {
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
    }

    function initPasswordRecovery() {
        const recoveryForm = document.querySelector('[data-form="password-recovery"]');

        if (!recoveryForm) {
            return;
        }

        const emailInput = document.getElementById("recoveryEmail");
        const successMessage = document.getElementById("recuperarPasswordSuccess");
        let validationStarted = false;

        function validateRecoveryForm() {
            const isValid = emailInput.checkValidity();
            setValidity(emailInput, isValid);
            return isValid;
        }

        recoveryForm.addEventListener("submit", (event) => {
            event.preventDefault();
            event.stopPropagation();
            validationStarted = true;

            if (successMessage) {
                successMessage.classList.add("d-none");
            }

            if (!validateRecoveryForm()) {
                return;
            }

            recoveryForm.reset();
            emailInput.classList.remove("is-valid", "is-invalid");

            if (successMessage) {
                successMessage.classList.remove("d-none");
            }
        });

        emailInput.addEventListener("input", () => {
            if (successMessage) {
                successMessage.classList.add("d-none");
            }

            if (validationStarted) {
                validateRecoveryForm();
            }
        });
    }

    initPasswordToggles();
    initLogin();
    initPatientRegister();
    initPasswordRecovery();
});
