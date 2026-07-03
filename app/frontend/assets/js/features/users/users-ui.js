import { LOCAL_STORAGE_KEYS } from "../../core/constants.js";
import { readStoredJson, writeStoredJson } from "../../core/storage.js";
import { escapeHtml } from "../../core/helpers.js";
import { hideAlert, showAlert } from "../../components/alerts.js";
import { stateText as renderStateText } from "../../components/badges.js";
import { clearErrors as clearFieldErrors, setFieldError as applyFieldError } from "../../components/forms.js";
import { getBootstrapModal, hideModal, showModal } from "../../components/modals.js";
import { renderTableEmptyRow } from "../../components/tables.js";
import {
    adminByLoggedUser,
    createInternalUser,
    filterUsers,
    fullName,
    loadUserManagementData,
    loadUsers,
    mergeStoredUsers,
    persistUsers,
    roleLabel,
    roleMatches,
    statusLabel,
    toggleUserStatus,
    updateAdminProfile,
    updateUser,
    userById,
    validateAdminProfile,
    validateCreateUser,
    validateEditUser
} from "./users-service.js";

function hasErrors(errors) {
    return Object.keys(errors).length > 0;
}

function createUserValues(fields) {
    return {
        role: fields.role.value,
        nombre: fields.nombre.value,
        apellido: fields.apellido.value,
        dni: fields.dni.value,
        email: fields.email.value,
        telefono: fields.telefono.value,
        password: fields.password.value,
        matricula: fields.matricula.value,
        especialidad: fields.especialidad.value,
        legajo: fields.legajo.value
    };
}

function editUserValues(fields) {
    return {
        nombre: fields.nombre.value,
        apellido: fields.apellido.value,
        email: fields.email.value,
        telefono: fields.telefono.value,
        matricula: fields.matricula.value,
        especialidad: fields.especialidad.value,
        legajo: fields.legajo.value,
        obraSocial: fields.obraSocial.value
    };
}

function adminProfileValues(fields) {
    return {
        nombre: fields.nombre.value,
        apellido: fields.apellido.value,
        dni: fields.dni.value,
        email: fields.email.value,
        telefono: fields.telefono.value,
        passwordActual: fields.passwordActual.value,
        passwordNueva: fields.passwordNueva.value,
        passwordConfirmar: fields.passwordConfirmar.value
    };
}

function applyErrors(errors, setError) {
    Object.entries(errors).forEach(([fieldName, text]) => setError(fieldName, text));
}

function renderUserStatus(user) {
    return renderStateText(statusLabel(user), escapeHtml);
}

function renderUserActions(user) {
    const isActive = statusLabel(user) === "Activo";
    const statusAction = isActive ? "Desactivar" : "Reactivar";
    const statusClass = isActive ? "btn-outline-danger" : "btn-outline-success";

    return `
        <div class="d-grid d-xl-flex gap-2">
            <button type="button" class="btn btn-outline-primary btn-sm" data-action="detail" data-user-id="${user.id_usuario}">Ver detalle</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" data-action="edit" data-user-id="${user.id_usuario}">Editar</button>
            <button type="button" class="btn ${statusClass} btn-sm" data-action="status" data-user-id="${user.id_usuario}">${statusAction}</button>
        </div>
    `;
}

export function renderAdministratorProfile() {
    return "";
}

export function renderDoctorProfile(user) {
    return `
        <dt class="col-sm-4 text-secondary">Matricula</dt><dd class="col-sm-8">${escapeHtml(user.matricula || "-")}</dd>
        <dt class="col-sm-4 text-secondary">Especialidad</dt><dd class="col-sm-8">${escapeHtml(user.especialidad || "-")}</dd>
    `;
}

export function renderPatientProfile(user) {
    return `<dt class="col-sm-4 text-secondary">Obra social</dt><dd class="col-sm-8">${escapeHtml(user.obra_social || "-")}</dd>`;
}

export function renderSecretaryProfile(user) {
    return `<dt class="col-sm-4 text-secondary">Legajo</dt><dd class="col-sm-8">${escapeHtml(user.legajo || "-")}</dd>`;
}

function renderRoleSpecificProfile(user) {
    if (roleMatches(user, "paciente")) {
        return renderPatientProfile(user);
    }

    if (roleMatches(user, "medico")) {
        return renderDoctorProfile(user);
    }

    if (roleMatches(user, "secretaria")) {
        return renderSecretaryProfile(user);
    }

    return renderAdministratorProfile(user);
}

export function renderUsersTable(tableBody, users, filters) {
    const visibleUsers = filterUsers(users, filters);

    if (visibleUsers.length === 0) {
        tableBody.innerHTML = renderTableEmptyRow(8, "No hay usuarios para los filtros seleccionados.");
        return;
    }

    tableBody.innerHTML = visibleUsers.map((user) => `
        <tr>
            <td class="fw-semibold">${escapeHtml(user.nombre)}</td>
            <td>${escapeHtml(user.apellido)}</td>
            <td>${escapeHtml(user.dni)}</td>
            <td>${escapeHtml(user.email)}</td>
            <td>${escapeHtml(user.telefono)}</td>
            <td><span class="badge text-bg-light border text-secondary">${escapeHtml(roleLabel(user.rol))}</span></td>
            <td>${renderUserStatus(user)}</td>
            <td>${renderUserActions(user)}</td>
        </tr>
    `).join("");
}

export function renderUserDetails(detailContent, user) {
    detailContent.innerHTML = `
        <dl class="row mb-0">
            <dt class="col-sm-4 text-secondary">Nombre</dt><dd class="col-sm-8">${escapeHtml(user.nombre)}</dd>
            <dt class="col-sm-4 text-secondary">Apellido</dt><dd class="col-sm-8">${escapeHtml(user.apellido)}</dd>
            <dt class="col-sm-4 text-secondary">DNI</dt><dd class="col-sm-8">${escapeHtml(user.dni)}</dd>
            <dt class="col-sm-4 text-secondary">Email</dt><dd class="col-sm-8">${escapeHtml(user.email)}</dd>
            <dt class="col-sm-4 text-secondary">Telefono</dt><dd class="col-sm-8">${escapeHtml(user.telefono)}</dd>
            <dt class="col-sm-4 text-secondary">Rol</dt><dd class="col-sm-8">${escapeHtml(roleLabel(user.rol))}</dd>
            <dt class="col-sm-4 text-secondary">Estado</dt><dd class="col-sm-8">${renderUserStatus(user)}</dd>
            ${renderRoleSpecificProfile(user)}
        </dl>
    `;
}

export function renderRoleFilters(roleFilter) {
    return roleFilter;
}

function fillAdminProfileForm(fields, userData, setText) {
    fields.nombre.value = userData.nombre || "";
    fields.apellido.value = userData.apellido || "";
    fields.dni.value = userData.dni || "";
    fields.email.value = userData.email || "";
    fields.telefono.value = userData.telefono || "";
    fields.passwordActual.value = "";
    fields.passwordNueva.value = "";
    fields.passwordConfirmar.value = "";
    setText("perfilAdminNavbar", fullName(userData));
}

export function bindUserEvents(context) {
    const {
        confirmStatusButton,
        createFields,
        createForm,
        editForm,
        hideMessage,
        openCreateModal,
        openDetailModal,
        openEditModal,
        openStatusModal,
        renderTable,
        roleFilter,
        saveEditedUser,
        searchInput,
        tableBody,
        toggleCreateSpecificFields,
        confirmStatusChange,
        createUser
    } = context;

    document.getElementById("crearUsuarioInternoBtn").addEventListener("click", openCreateModal);
    createFields.role.addEventListener("change", toggleCreateSpecificFields);
    createForm.addEventListener("submit", createUser);
    editForm.addEventListener("submit", saveEditedUser);
    confirmStatusButton.addEventListener("click", confirmStatusChange);
    [searchInput, roleFilter].forEach((field) => {
        field.addEventListener("input", () => {
            hideMessage();
            renderTable();
        });
        field.addEventListener("change", () => {
            hideMessage();
            renderTable();
        });
    });
    tableBody.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        if (button.dataset.action === "detail") {
            openDetailModal(button.dataset.userId);
        }

        if (button.dataset.action === "edit") {
            openEditModal(button.dataset.userId);
        }

        if (button.dataset.action === "status") {
            openStatusModal(button.dataset.userId);
        }
    });
}

export function initUserManagement(config) {
    const { fallbackData, setText } = config;
    const tableBody = document.getElementById("adminGestionUsuariosTabla");

    if (!tableBody) {
        return;
    }

    loadUserManagementData(fallbackData).then((usuariosData) => {
        const loggedUser = readStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, null);
        const accessMessage = document.getElementById("adminUsuariosAccesoMensaje");
        const message = document.getElementById("adminUsuariosMensaje");
        const searchInput = document.getElementById("adminUsuariosBusqueda");
        const roleFilter = document.getElementById("adminUsuariosRolFiltro");
        const createModal = getBootstrapModal(document.getElementById("adminUsuarioCrearModal"));
        const editModal = getBootstrapModal(document.getElementById("adminUsuarioEditarModal"));
        const detailModal = getBootstrapModal(document.getElementById("adminUsuarioDetalleModal"));
        const statusModal = getBootstrapModal(document.getElementById("adminUsuarioEstadoModal"));
        const createForm = document.getElementById("adminUsuarioCrearForm");
        const editForm = document.getElementById("adminUsuarioEditarForm");
        const detailContent = document.getElementById("adminUsuarioDetalleContenido");
        const statusTitle = document.getElementById("adminUsuarioEstadoTitulo");
        const statusText = document.getElementById("adminUsuarioEstadoTexto");
        const confirmStatusButton = document.getElementById("adminUsuarioConfirmarEstadoBtn");
        const createFields = {
            role: document.getElementById("crearUsuarioRol"),
            nombre: document.getElementById("crearUsuarioNombre"),
            apellido: document.getElementById("crearUsuarioApellido"),
            dni: document.getElementById("crearUsuarioDni"),
            email: document.getElementById("crearUsuarioEmail"),
            telefono: document.getElementById("crearUsuarioTelefono"),
            password: document.getElementById("crearUsuarioPassword"),
            matricula: document.getElementById("crearUsuarioMatricula"),
            especialidad: document.getElementById("crearUsuarioEspecialidad"),
            legajo: document.getElementById("crearUsuarioLegajo")
        };
        const editFields = {
            nombre: document.getElementById("editarUsuarioNombre"),
            apellido: document.getElementById("editarUsuarioApellido"),
            dni: document.getElementById("editarUsuarioDni"),
            role: document.getElementById("editarUsuarioRol"),
            email: document.getElementById("editarUsuarioEmail"),
            telefono: document.getElementById("editarUsuarioTelefono"),
            matricula: document.getElementById("editarUsuarioMatricula"),
            especialidad: document.getElementById("editarUsuarioEspecialidad"),
            legajo: document.getElementById("editarUsuarioLegajo"),
            obraSocial: document.getElementById("editarUsuarioObraSocial")
        };
        let users = mergeStoredUsers(usuariosData.usuarios || []);
        let selectedUserId = null;
        let selectedStatusUserId = null;

        if (!loggedUser || !roleMatches(loggedUser, "administrador")) {
            if (accessMessage) {
                accessMessage.classList.remove("d-none");
            }

            tableBody.innerHTML = renderTableEmptyRow(8, "No hay informacion disponible para este usuario.");
            return;
        }

        function showMessage(type, text) {
            showAlert(message, type, text);
        }

        function hideMessage() {
            hideAlert(message);
        }

        function setFormFieldError(prefix, fieldName, text) {
            const fieldMap = prefix === "crear" ? createFields : editFields;
            const errorIds = {
                crear: {
                    role: "crearUsuarioRolError",
                    nombre: "crearUsuarioNombreError",
                    apellido: "crearUsuarioApellidoError",
                    dni: "crearUsuarioDniError",
                    email: "crearUsuarioEmailError",
                    telefono: "crearUsuarioTelefonoError",
                    password: "crearUsuarioPasswordError",
                    matricula: "crearUsuarioMatriculaError",
                    especialidad: "crearUsuarioEspecialidadError",
                    legajo: "crearUsuarioLegajoError"
                },
                editar: {
                    nombre: "editarUsuarioNombreError",
                    apellido: "editarUsuarioApellidoError",
                    email: "editarUsuarioEmailError",
                    telefono: "editarUsuarioTelefonoError",
                    matricula: "editarUsuarioMatriculaError",
                    especialidad: "editarUsuarioEspecialidadError",
                    legajo: "editarUsuarioLegajoError"
                }
            };
            applyFieldError(fieldMap, fieldName, text, (name) => document.getElementById(errorIds[prefix][name]));
        }

        function clearFormErrors(prefix) {
            const fieldMap = prefix === "crear" ? createFields : editFields;
            clearFieldErrors(fieldMap, (fieldName, text) => setFormFieldError(prefix, fieldName, text));
        }

        function renderTable() {
            renderUsersTable(tableBody, users, {
                query: searchInput.value,
                role: roleFilter.value
            });
        }

        function toggleCreateSpecificFields() {
            const role = createFields.role.value;

            document.getElementById("crearMedicoMatriculaGrupo").classList.toggle("d-none", role !== "medico");
            document.getElementById("crearMedicoEspecialidadGrupo").classList.toggle("d-none", role !== "medico");
            document.getElementById("crearSecretariaLegajoGrupo").classList.toggle("d-none", role !== "secretaria");
        }

        function toggleEditSpecificFields(user) {
            const isDoctor = roleMatches(user, "medico");
            const isSecretary = roleMatches(user, "secretaria");
            const isPatient = roleMatches(user, "paciente");

            document.getElementById("editarMedicoMatriculaGrupo").classList.toggle("d-none", !isDoctor);
            document.getElementById("editarMedicoEspecialidadGrupo").classList.toggle("d-none", !isDoctor);
            document.getElementById("editarSecretariaLegajoGrupo").classList.toggle("d-none", !isSecretary);
            document.getElementById("editarPacienteObraSocialGrupo").classList.toggle("d-none", !isPatient);
        }

        function openCreateModal() {
            createForm.reset();
            clearFormErrors("crear");
            toggleCreateSpecificFields();
            showModal(createModal);
        }

        function createUser(event) {
            event.preventDefault();

            const values = createUserValues(createFields);
            const errors = validateCreateUser(values, users);

            clearFormErrors("crear");

            if (hasErrors(errors)) {
                applyErrors(errors, (fieldName, text) => setFormFieldError("crear", fieldName, text));
                return;
            }

            users = createInternalUser(users, values);
            persistUsers(users);
            renderTable();
            hideModal(createModal);
            showMessage("success", "Usuario interno creado correctamente.");
        }

        function openEditModal(userId) {
            const user = userById(users, userId);

            if (!user || roleMatches(user, "administrador")) {
                return;
            }

            selectedUserId = user.id_usuario;
            clearFormErrors("editar");
            editFields.nombre.value = user.nombre || "";
            editFields.apellido.value = user.apellido || "";
            editFields.dni.value = user.dni || "";
            editFields.role.value = roleLabel(user.rol);
            editFields.email.value = user.email || "";
            editFields.telefono.value = user.telefono || "";
            editFields.matricula.value = user.matricula || "";
            editFields.especialidad.value = user.especialidad || "";
            editFields.legajo.value = user.legajo || "";
            editFields.obraSocial.value = user.obra_social || "";
            toggleEditSpecificFields(user);
            showModal(editModal);
        }

        function saveEditedUser(event) {
            event.preventDefault();

            const user = userById(users, selectedUserId);
            const values = editUserValues(editFields);
            const errors = user ? validateEditUser(values, users, user) : {};

            clearFormErrors("editar");

            if (!user || hasErrors(errors)) {
                applyErrors(errors, (fieldName, text) => setFormFieldError("editar", fieldName, text));
                return;
            }

            users = updateUser(users, selectedUserId, values);
            persistUsers(users);
            renderTable();
            hideModal(editModal);
            showMessage("success", "Usuario actualizado correctamente.");
        }

        function openDetailModal(userId) {
            const user = userById(users, userId);

            if (!user) {
                return;
            }

            renderUserDetails(detailContent, user);
            showModal(detailModal);
        }

        function openStatusModal(userId) {
            const user = userById(users, userId);

            if (!user || roleMatches(user, "administrador")) {
                return;
            }

            selectedStatusUserId = user.id_usuario;

            if (statusLabel(user) === "Activo") {
                statusTitle.textContent = "Desactivar usuario";
                statusText.textContent = "Esta seguro que desea desactivar este usuario? No podra acceder al sistema hasta ser reactivado.";
            } else {
                statusTitle.textContent = "Reactivar usuario";
                statusText.textContent = "Confirme la reactivacion del usuario seleccionado.";
            }

            showModal(statusModal);
        }

        function confirmStatusChange() {
            const user = userById(users, selectedStatusUserId);

            if (!user) {
                return;
            }

            const result = toggleUserStatus(users, selectedStatusUserId);
            users = result.users;
            persistUsers(users);
            renderTable();
            hideModal(statusModal);
            showMessage("success", result.nextStatus === "Activo" ? "Usuario reactivado correctamente." : "Usuario desactivado correctamente.");
        }

        setText("adminUsuariosNavbar", fullName(loggedUser));
        renderRoleFilters(roleFilter);
        renderTable();
        bindUserEvents({
            confirmStatusButton,
            createFields,
            createForm,
            editForm,
            hideMessage,
            openCreateModal,
            openDetailModal,
            openEditModal,
            openStatusModal,
            renderTable,
            roleFilter,
            saveEditedUser,
            searchInput,
            tableBody,
            toggleCreateSpecificFields,
            confirmStatusChange,
            createUser
        });
    });
}

export function initAdminProfile(config) {
    const { fallbackData, setText } = config;
    const form = document.querySelector('[data-form="admin-profile"]');

    if (!form) {
        return;
    }

    loadUsers(fallbackData).then((usuariosData) => {
        const loggedUser = readStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, null);
        const accessMessage = document.getElementById("perfilAdminAccesoMensaje");
        const message = document.getElementById("perfilAdminMensaje");

        if (!loggedUser || !roleMatches(loggedUser, "administrador")) {
            if (accessMessage) {
                accessMessage.classList.remove("d-none");
            }

            form.classList.add("d-none");
            return;
        }

        let users = mergeStoredUsers(usuariosData.usuarios || []);
        let admin = adminByLoggedUser(users, loggedUser);
        const fields = {
            nombre: document.getElementById("perfilAdminNombre"),
            apellido: document.getElementById("perfilAdminApellido"),
            dni: document.getElementById("perfilAdminDni"),
            email: document.getElementById("perfilAdminEmail"),
            telefono: document.getElementById("perfilAdminTelefono"),
            passwordActual: document.getElementById("perfilAdminPasswordActual"),
            passwordNueva: document.getElementById("perfilAdminPasswordNueva"),
            passwordConfirmar: document.getElementById("perfilAdminPasswordConfirmar")
        };

        function setProfileFieldError(fieldName, text) {
            applyFieldError(fields, fieldName, text, (name) => (
                document.getElementById(`perfilAdmin${name.charAt(0).toUpperCase()}${name.slice(1)}Error`)
            ));
        }

        function clearProfileErrors() {
            clearFieldErrors(fields, setProfileFieldError, {
                onClear: () => hideAlert(message)
            });
        }

        fillAdminProfileForm(fields, admin, setText);

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            const values = adminProfileValues(fields);
            const errors = validateAdminProfile(values, users, admin);

            clearProfileErrors();

            if (hasErrors(errors)) {
                applyErrors(errors, setProfileFieldError);
                showAlert(message, "danger", "Revise los campos marcados antes de guardar.");
                return;
            }

            const result = updateAdminProfile(users, admin, values);
            users = result.users;
            admin = result.updatedAdmin;
            persistUsers(users);
            writeStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, result.updatedAdmin);
            fillAdminProfileForm(fields, result.updatedAdmin, setText);
            clearProfileErrors();
            showAlert(message, "success", "Perfil actualizado correctamente.");
        });

        form.addEventListener("reset", () => {
            setTimeout(() => {
                fillAdminProfileForm(fields, admin, setText);
                clearProfileErrors();
            }, 0);
        });
    });
}
