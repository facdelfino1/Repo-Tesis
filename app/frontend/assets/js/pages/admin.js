const coreModuleBaseUrl = new URL("../core/", document.currentScript.src).href;
const componentModuleBaseUrl = new URL("../components/", document.currentScript.src).href;
const featureModuleBaseUrl = new URL("../features/", document.currentScript.src).href;

document.addEventListener("DOMContentLoaded", async () => {
    const fallbackData = {
        usuarios: {
            usuarios: []
        },
        turnos: {
            turnos: []
        },
        triaje: {
            triajes: []
        },
        disponibilidad: []
    };

    const [
        { LOCAL_STORAGE_KEYS, MOCK_PATHS },
        { loadMock, readStoredJson, writeStoredJson },
        { escapeHtml, normalizeState, normalizeText },
        { formatToday, priorityLabel, todayInputValue },
        { isStrongPassword, isValidEmail },
        { hideAlert, showAlert },
        { stateText: renderStateText },
        { clearErrors: clearFieldErrors, setFieldError: applyFieldError },
        { getBootstrapModal, hideModal, showModal },
        { fillSelect },
        { renderTableEmptyRow },
        { initAdminDashboardMetrics, initAdminMetrics: initAdminMetricsFeature }
    ] = await Promise.all([
        import(`${coreModuleBaseUrl}constants.js`),
        import(`${coreModuleBaseUrl}storage.js`),
        import(`${coreModuleBaseUrl}helpers.js`),
        import(`${coreModuleBaseUrl}formatters.js`),
        import(`${coreModuleBaseUrl}validators.js`),
        import(`${componentModuleBaseUrl}alerts.js`),
        import(`${componentModuleBaseUrl}badges.js`),
        import(`${componentModuleBaseUrl}forms.js`),
        import(`${componentModuleBaseUrl}modals.js`),
        import(`${componentModuleBaseUrl}selects.js`),
        import(`${componentModuleBaseUrl}tables.js`),
        import(`${featureModuleBaseUrl}metrics/metrics-ui.js`)
    ]);

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
    }

    function roleMatches(user, role) {
        return String(user.rol || "").toLowerCase() === role;
    }

    function fullName(person) {
        return `${person.nombre} ${person.apellido}`;
    }

    function roleLabel(role) {
        const normalizedRole = String(role || "").toLowerCase();

        if (normalizedRole === "paciente") {
            return "Paciente";
        }

        if (normalizedRole === "medico") {
            return "Medico";
        }

        if (normalizedRole === "secretaria") {
            return "Secretaria";
        }

        if (normalizedRole === "administrador") {
            return "Administrador";
        }

        return role || "-";
    }

    function statusLabel(user) {
        return user.estado || "Activo";
    }

    function mergeStoredUsers(baseUsers) {
        const base = Array.isArray(baseUsers) ? baseUsers : [];
        const stored = readStoredJson(LOCAL_STORAGE_KEYS.ADMIN_USERS, null);

        if (!Array.isArray(stored)) {
            return base.map((user) => ({ ...user, estado: user.estado || "Activo" }));
        }

        return stored.map((user) => ({ ...user, estado: user.estado || "Activo" }));
    }

    function persistUsers(users) {
        writeStoredJson(LOCAL_STORAGE_KEYS.ADMIN_USERS, users);
    }

    function turnosList(turnos) {
        return Array.isArray(turnos.turnos) ? turnos.turnos : [];
    }

    function mergeStoredTurns(baseTurns) {
        const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
        const storedDoctorTurns = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_TURNS, null);
        const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
        const base = Array.isArray(baseTurns) ? baseTurns : [];
        const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

        [storedSecretaryTurns, storedDoctorTurns].forEach((stored) => {
            if (!Array.isArray(stored)) {
                return;
            }

            stored.forEach((turn) => {
                if (turn && turn.id_turno !== undefined) {
                    byId.set(String(turn.id_turno), turn);
                }
            });
        });

        if (Array.isArray(storedPatientTurns)) {
            storedPatientTurns.forEach((turn) => {
                if (!turn || turn.id === undefined) {
                    return;
                }

                byId.set(String(turn.id), {
                    id_turno: turn.id,
                    id_paciente: turn.pacienteId,
                    id_medico: turn.medicoId,
                    id_disponibilidad: turn.disponibilidadId,
                    id_triaje: turn.idTriaje,
                    fecha: turn.fecha,
                    hora_inicio: turn.hora,
                    hora_fin: turn.horaFin,
                    estado: turn.estado,
                    prioridad: priorityLabel(turn.prioridad),
                    color_prioridad: turn.prioridad,
                    duracion_estimada: Number.parseInt(turn.tiempoEstimado, 10) || 20,
                    origen: turn.origen || "Paciente"
                });
            });
        }

        return [...byId.values()];
    }

    function triajeByTurnId(triajes, idTurno) {
        return triajes.find((triaje) => String(triaje.id_turno) === String(idTurno)) || null;
    }

    function doctorById(users, idMedico) {
        return users.find((user) => String(user.id_medico) === String(idMedico)) || null;
    }

    function initAdminDashboard() {
        initAdminDashboardMetrics({
            fallbackData,
            fullName,
            mergeStoredTurns,
            mergeStoredUsers,
            roleMatches,
            setText,
            triajeByTurnId,
            turnosList
        });
    }

    function initAdminUserManagement() {
        const tableBody = document.getElementById("adminGestionUsuariosTabla");

        if (!tableBody) {
            return;
        }

        Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, { medicos: [] })
        ]).then(([usuariosData]) => {
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

            function setFieldError(prefix, fieldName, text) {
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
                clearFieldErrors(fieldMap, (fieldName, text) => setFieldError(prefix, fieldName, text));
            }

            function managedUsers() {
                return users.filter((user) => !roleMatches(user, "administrador"));
            }

            function filteredUsers() {
                const query = normalizeText(searchInput.value.trim());
                const selectedRole = roleFilter.value;

                return managedUsers().filter((user) => {
                    const searchable = normalizeText(`${user.nombre} ${user.apellido} ${user.dni} ${user.email}`);
                    const matchesQuery = query === "" || searchable.includes(query);
                    const matchesRole = selectedRole === "" || roleMatches(user, selectedRole);

                    return matchesQuery && matchesRole;
                });
            }

            function userById(userId) {
                return users.find((user) => String(user.id_usuario) === String(userId)) || null;
            }

            function roleSpecificDetail(user) {
                if (roleMatches(user, "paciente")) {
                    return `<dt class="col-sm-4 text-secondary">Obra social</dt><dd class="col-sm-8">${escapeHtml(user.obra_social || "-")}</dd>`;
                }

                if (roleMatches(user, "medico")) {
                    return `
                        <dt class="col-sm-4 text-secondary">Matricula</dt><dd class="col-sm-8">${escapeHtml(user.matricula || "-")}</dd>
                        <dt class="col-sm-4 text-secondary">Especialidad</dt><dd class="col-sm-8">${escapeHtml(user.especialidad || "-")}</dd>
                    `;
                }

                if (roleMatches(user, "secretaria")) {
                    return `<dt class="col-sm-4 text-secondary">Legajo</dt><dd class="col-sm-8">${escapeHtml(user.legajo || "-")}</dd>`;
                }

                return "";
            }

            function renderTable() {
                const visibleUsers = filteredUsers();

                if (visibleUsers.length === 0) {
                    tableBody.innerHTML = renderTableEmptyRow(8, "No hay usuarios para los filtros seleccionados.");
                    return;
                }

                tableBody.innerHTML = visibleUsers.map((user) => {
                    const isActive = statusLabel(user) === "Activo";
                    const statusAction = isActive ? "Desactivar" : "Reactivar";
                    const statusClass = isActive ? "btn-outline-danger" : "btn-outline-success";

                    return `
                        <tr>
                            <td class="fw-semibold">${escapeHtml(user.nombre)}</td>
                            <td>${escapeHtml(user.apellido)}</td>
                            <td>${escapeHtml(user.dni)}</td>
                            <td>${escapeHtml(user.email)}</td>
                            <td>${escapeHtml(user.telefono)}</td>
                            <td><span class="badge text-bg-light border text-secondary">${escapeHtml(roleLabel(user.rol))}</span></td>
                            <td>${renderStateText(statusLabel(user), escapeHtml)}</td>
                            <td>
                                <div class="d-grid d-xl-flex gap-2">
                                    <button type="button" class="btn btn-outline-primary btn-sm" data-action="detail" data-user-id="${user.id_usuario}">Ver detalle</button>
                                    <button type="button" class="btn btn-outline-secondary btn-sm" data-action="edit" data-user-id="${user.id_usuario}">Editar</button>
                                    <button type="button" class="btn ${statusClass} btn-sm" data-action="status" data-user-id="${user.id_usuario}">${statusAction}</button>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join("");
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

            function validateCreateForm() {
                let isValid = true;

                clearFormErrors("crear");

                if (createFields.role.value === "") {
                    setFieldError("crear", "role", "Seleccione un rol.");
                    isValid = false;
                }

                ["nombre", "apellido", "dni", "email", "telefono", "password"].forEach((fieldName) => {
                    if (createFields[fieldName].value.trim() === "") {
                        setFieldError("crear", fieldName, "Campo obligatorio.");
                        isValid = false;
                    }
                });

                if (createFields.dni.value.trim() !== "" && !/^\d+$/.test(createFields.dni.value.trim())) {
                    setFieldError("crear", "dni", "El DNI debe ser numerico.");
                    isValid = false;
                }

                if (createFields.telefono.value.trim() !== "" && !/^\d+$/.test(createFields.telefono.value.trim())) {
                    setFieldError("crear", "telefono", "El telefono debe ser numerico.");
                    isValid = false;
                }

                if (createFields.email.value.trim() !== "" && !isValidEmail(createFields.email.value.trim())) {
                    setFieldError("crear", "email", "Ingrese un email valido.");
                    isValid = false;
                } else if (users.some((user) => user.email === createFields.email.value.trim())) {
                    setFieldError("crear", "email", "El email ya existe.");
                    isValid = false;
                }

                if (createFields.password.value !== "" && !isStrongPassword(createFields.password.value)) {
                    setFieldError("crear", "password", "La contraseña no cumple los requisitos.");
                    isValid = false;
                }

                if (createFields.role.value === "medico") {
                    if (createFields.matricula.value.trim() === "") {
                        setFieldError("crear", "matricula", "La matricula es obligatoria.");
                        isValid = false;
                    }

                    if (createFields.especialidad.value.trim() === "") {
                        setFieldError("crear", "especialidad", "La especialidad es obligatoria.");
                        isValid = false;
                    }
                }

                if (createFields.role.value === "secretaria" && createFields.legajo.value.trim() === "") {
                    setFieldError("crear", "legajo", "El legajo es obligatorio.");
                    isValid = false;
                }

                return isValid;
            }

            function validateEditForm(user) {
                let isValid = true;

                clearFormErrors("editar");

                ["nombre", "apellido", "email", "telefono"].forEach((fieldName) => {
                    if (editFields[fieldName].value.trim() === "") {
                        setFieldError("editar", fieldName, "Campo obligatorio.");
                        isValid = false;
                    }
                });

                if (editFields.email.value.trim() !== "" && !isValidEmail(editFields.email.value.trim())) {
                    setFieldError("editar", "email", "Ingrese un email valido.");
                    isValid = false;
                } else if (users.some((item) => item.email === editFields.email.value.trim() && String(item.id_usuario) !== String(user.id_usuario))) {
                    setFieldError("editar", "email", "El email ya existe.");
                    isValid = false;
                }

                if (editFields.telefono.value.trim() !== "" && !/^\d+$/.test(editFields.telefono.value.trim())) {
                    setFieldError("editar", "telefono", "El telefono debe ser numerico.");
                    isValid = false;
                }

                if (roleMatches(user, "medico")) {
                    if (editFields.matricula.value.trim() === "") {
                        setFieldError("editar", "matricula", "La matricula es obligatoria.");
                        isValid = false;
                    }

                    if (editFields.especialidad.value.trim() === "") {
                        setFieldError("editar", "especialidad", "La especialidad es obligatoria.");
                        isValid = false;
                    }
                }

                if (roleMatches(user, "secretaria") && editFields.legajo.value.trim() === "") {
                    setFieldError("editar", "legajo", "El legajo es obligatorio.");
                    isValid = false;
                }

                return isValid;
            }

            function nextUserId() {
                return users.reduce((maxValue, user) => Math.max(maxValue, Number(user.id_usuario) || 0), 0) + 1;
            }

            function nextRoleId(key) {
                return users.reduce((maxValue, user) => Math.max(maxValue, Number(user[key]) || 0), 0) + 1;
            }

            function openCreateModal() {
                createForm.reset();
                clearFormErrors("crear");
                toggleCreateSpecificFields();
                showModal(createModal);
            }

            function createUser(event) {
                event.preventDefault();

                if (!validateCreateForm()) {
                    return;
                }

                const role = createFields.role.value;
                const newUser = {
                    id_usuario: nextUserId(),
                    nombre: createFields.nombre.value.trim(),
                    apellido: createFields.apellido.value.trim(),
                    dni: createFields.dni.value.trim(),
                    email: createFields.email.value.trim(),
                    contrasena: createFields.password.value,
                    telefono: createFields.telefono.value.trim(),
                    rol: role,
                    estado: "Activo"
                };

                if (role === "medico") {
                    newUser.id_medico = nextRoleId("id_medico");
                    newUser.matricula = createFields.matricula.value.trim();
                    newUser.especialidad = createFields.especialidad.value.trim();
                }

                if (role === "secretaria") {
                    newUser.id_secretaria = nextRoleId("id_secretaria");
                    newUser.legajo = createFields.legajo.value.trim();
                }

                users = [...users, newUser];
                persistUsers(users);
                renderTable();
                hideModal(createModal);
                showMessage("success", "Usuario interno creado correctamente.");
            }

            function openEditModal(userId) {
                const user = userById(userId);

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

                const user = userById(selectedUserId);

                if (!user || !validateEditForm(user)) {
                    return;
                }

                users = users.map((item) => {
                    if (String(item.id_usuario) !== String(selectedUserId)) {
                        return item;
                    }

                    const updatedUser = {
                        ...item,
                        nombre: editFields.nombre.value.trim(),
                        apellido: editFields.apellido.value.trim(),
                        email: editFields.email.value.trim(),
                        telefono: editFields.telefono.value.trim()
                    };

                    if (roleMatches(item, "medico")) {
                        updatedUser.matricula = editFields.matricula.value.trim();
                        updatedUser.especialidad = editFields.especialidad.value.trim();
                    }

                    if (roleMatches(item, "secretaria")) {
                        updatedUser.legajo = editFields.legajo.value.trim();
                    }

                    if (roleMatches(item, "paciente")) {
                        updatedUser.obra_social = editFields.obraSocial.value.trim();
                    }

                    return updatedUser;
                });
                persistUsers(users);
                renderTable();
                hideModal(editModal);
                showMessage("success", "Usuario actualizado correctamente.");
            }

            function openDetailModal(userId) {
                const user = userById(userId);

                if (!user) {
                    return;
                }

                detailContent.innerHTML = `
                    <dl class="row mb-0">
                        <dt class="col-sm-4 text-secondary">Nombre</dt><dd class="col-sm-8">${escapeHtml(user.nombre)}</dd>
                        <dt class="col-sm-4 text-secondary">Apellido</dt><dd class="col-sm-8">${escapeHtml(user.apellido)}</dd>
                        <dt class="col-sm-4 text-secondary">DNI</dt><dd class="col-sm-8">${escapeHtml(user.dni)}</dd>
                        <dt class="col-sm-4 text-secondary">Email</dt><dd class="col-sm-8">${escapeHtml(user.email)}</dd>
                        <dt class="col-sm-4 text-secondary">Telefono</dt><dd class="col-sm-8">${escapeHtml(user.telefono)}</dd>
                        <dt class="col-sm-4 text-secondary">Rol</dt><dd class="col-sm-8">${escapeHtml(roleLabel(user.rol))}</dd>
                        <dt class="col-sm-4 text-secondary">Estado</dt><dd class="col-sm-8">${renderStateText(statusLabel(user), escapeHtml)}</dd>
                        ${roleSpecificDetail(user)}
                    </dl>
                `;
                showModal(detailModal);
            }

            function openStatusModal(userId) {
                const user = userById(userId);

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
                const user = userById(selectedStatusUserId);

                if (!user) {
                    return;
                }

                const nextStatus = statusLabel(user) === "Activo" ? "Inactivo" : "Activo";
                users = users.map((item) => (
                    String(item.id_usuario) === String(selectedStatusUserId)
                        ? { ...item, estado: nextStatus }
                        : item
                ));
                persistUsers(users);
                renderTable();
                hideModal(statusModal);
                showMessage("success", nextStatus === "Activo" ? "Usuario reactivado correctamente." : "Usuario desactivado correctamente.");
            }

            setText("adminUsuariosNavbar", fullName(loggedUser));
            renderTable();

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
        });
    }

    function initAdminMetrics() {
        initAdminMetricsFeature({
            fallbackData,
            doctorById,
            fullName,
            mergeStoredTurns,
            mergeStoredUsers,
            roleMatches,
            setText,
            triajeByTurnId,
            turnosList
        });
    }

    function initAdminProfile() {
        const form = document.querySelector('[data-form="admin-profile"]');

        if (!form) {
            return;
        }

        loadMock(MOCK_PATHS.USERS, fallbackData.usuarios).then((usuariosData) => {
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
            let admin = users.find((user) => String(user.id_usuario) === String(loggedUser.id_usuario))
                || loggedUser;
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

            function fillForm(userData) {
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

            function setFieldError(fieldName, text) {
                const field = fields[fieldName];
                const error = document.getElementById(`perfilAdmin${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}Error`);

                if (!field || !error) {
                    return;
                }

                field.classList.toggle("is-invalid", text !== "");
                error.textContent = text;
            }

            function clearErrors() {
                Object.keys(fields).forEach((fieldName) => setFieldError(fieldName, ""));

                if (message) {
                    message.classList.add("d-none");
                }
            }

            function showMessage(type, text) {
                message.className = `alert alert-${type}`;
                message.textContent = text;
                message.classList.remove("d-none");
            }

            function validateProfile() {
                let isValid = true;
                const wantsPasswordChange = fields.passwordActual.value !== ""
                    || fields.passwordNueva.value !== ""
                    || fields.passwordConfirmar.value !== "";

                clearErrors();

                ["nombre", "apellido", "dni", "email", "telefono"].forEach((fieldName) => {
                    if (fields[fieldName].value.trim() === "") {
                        setFieldError(fieldName, "Campo obligatorio.");
                        isValid = false;
                    }
                });

                if (fields.dni.value.trim() !== "" && !/^\d+$/.test(fields.dni.value.trim())) {
                    setFieldError("dni", "El DNI debe ser numerico.");
                    isValid = false;
                }

                if (fields.telefono.value.trim() !== "" && !/^\d+$/.test(fields.telefono.value.trim())) {
                    setFieldError("telefono", "El telefono debe ser numerico.");
                    isValid = false;
                }

                if (fields.email.value.trim() !== "" && !isValidEmail(fields.email.value.trim())) {
                    setFieldError("email", "Ingrese un email valido.");
                    isValid = false;
                } else if (users.some((user) => user.email === fields.email.value.trim() && String(user.id_usuario) !== String(admin.id_usuario))) {
                    setFieldError("email", "El email ya existe.");
                    isValid = false;
                }

                if (wantsPasswordChange) {
                    if (fields.passwordActual.value === "") {
                        setFieldError("passwordActual", "Ingrese la contrasena actual.");
                        isValid = false;
                    } else if (admin.contrasena && fields.passwordActual.value !== admin.contrasena) {
                        setFieldError("passwordActual", "La contrasena actual no coincide.");
                        isValid = false;
                    }

                    if (fields.passwordNueva.value === "") {
                        setFieldError("passwordNueva", "Ingrese la nueva contrasena.");
                        isValid = false;
                    } else if (!isStrongPassword(fields.passwordNueva.value)) {
                        setFieldError("passwordNueva", "La contrasena debe cumplir los requisitos de seguridad.");
                        isValid = false;
                    }

                    if (fields.passwordConfirmar.value === "") {
                        setFieldError("passwordConfirmar", "Confirme la nueva contrasena.");
                        isValid = false;
                    } else if (fields.passwordConfirmar.value !== fields.passwordNueva.value) {
                        setFieldError("passwordConfirmar", "La confirmacion no coincide con la nueva contrasena.");
                        isValid = false;
                    }
                }

                return isValid;
            }

            fillForm(admin);

            form.addEventListener("submit", (event) => {
                event.preventDefault();

                if (!validateProfile()) {
                    showMessage("danger", "Revise los campos marcados antes de guardar.");
                    return;
                }

                const updatedAdmin = {
                    ...admin,
                    nombre: fields.nombre.value.trim(),
                    apellido: fields.apellido.value.trim(),
                    dni: fields.dni.value.trim(),
                    email: fields.email.value.trim(),
                    telefono: fields.telefono.value.trim(),
                    rol: "administrador"
                };

                if (fields.passwordNueva.value !== "") {
                    updatedAdmin.contrasena = fields.passwordNueva.value;
                    updatedAdmin.passwordActualizada = true;
                }

                users = users.map((user) => (
                    String(user.id_usuario) === String(updatedAdmin.id_usuario)
                        ? updatedAdmin
                        : user
                ));
                admin = updatedAdmin;
                persistUsers(users);
                writeStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, updatedAdmin);
                fillForm(updatedAdmin);
                clearErrors();
                showMessage("success", "Perfil actualizado correctamente.");
            });

            form.addEventListener("reset", () => {
                setTimeout(() => {
                    fillForm(admin);
                    clearErrors();
                }, 0);
            });
        });
    }

    initAdminDashboard();
    initAdminUserManagement();
    initAdminMetrics();
    initAdminProfile();
});
