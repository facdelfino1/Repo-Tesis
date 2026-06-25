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

    function readStoredJson(key, fallback) {
        const storedValue = localStorage.getItem(key);

        if (!storedValue) {
            return fallback;
        }

        try {
            return JSON.parse(storedValue);
        } catch (error) {
            return fallback;
        }
    }

    function writeStoredJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

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

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function normalizeState(state) {
        return String(state || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }

    function todayInputValue() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");

        return `${now.getFullYear()}-${month}-${day}`;
    }

    function formatToday() {
        return new Intl.DateTimeFormat("es-AR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(new Date());
    }

    function priorityLabel(priority) {
        if (priority === "Rojo" || priority === "Alta") {
            return "Alta";
        }

        if (priority === "Amarillo" || priority === "Media") {
            return "Media";
        }

        return "Baja";
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

    function stateText(state) {
        return `<strong class="fw-semibold">${escapeHtml(state || "-")}</strong>`;
    }

    function normalizeText(value) {
        return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function isStrongPassword(value) {
        return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(value);
    }

    function mergeStoredUsers(baseUsers) {
        const base = Array.isArray(baseUsers) ? baseUsers : [];
        const stored = readStoredJson("usuariosAdminMock", null);

        if (!Array.isArray(stored)) {
            return base.map((user) => ({ ...user, estado: user.estado || "Activo" }));
        }

        return stored.map((user) => ({ ...user, estado: user.estado || "Activo" }));
    }

    function persistUsers(users) {
        writeStoredJson("usuariosAdminMock", users);
    }

    function turnosList(turnos) {
        return Array.isArray(turnos.turnos) ? turnos.turnos : [];
    }

    function mergeStoredTurns(baseTurns) {
        const storedSecretaryTurns = readStoredJson("turnosSecretariaMock", null);
        const storedDoctorTurns = readStoredJson("turnosMedicoMock", null);
        const storedPatientTurns = readStoredJson("turnosPacienteMock", []);
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

    function priorityClass(priority) {
        if (priority === "Alta" || priority === "Rojo") {
            return "bg-danger";
        }

        if (priority === "Media" || priority === "Amarillo") {
            return "bg-warning";
        }

        return "bg-success";
    }

    function timeDifferenceMinutes(startValue, endValue) {
        if (!startValue || !endValue) {
            return null;
        }

        const startDate = new Date(startValue);
        const endDate = new Date(endValue);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return null;
        }

        return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
    }

    function turnDateTime(turn, timeField) {
        const timeValue = turn[timeField];

        if (!turn.fecha || !timeValue) {
            return null;
        }

        return `${turn.fecha}T${timeValue}:00`;
    }

    function averageLabel(values) {
        const usableValues = values.filter((value) => Number.isFinite(value));

        if (usableValues.length === 0) {
            return "No disponible";
        }

        const average = Math.round(usableValues.reduce((sum, value) => sum + value, 0) / usableValues.length);

        return `${average} min`;
    }

    function mostFrequentLabel(counts) {
        const entries = Object.entries(counts);

        if (entries.length === 0) {
            return "-";
        }

        return entries.sort((a, b) => b[1] - a[1])[0][0];
    }

    function doctorById(users, idMedico) {
        return users.find((user) => String(user.id_medico) === String(idMedico)) || null;
    }

    function initAdminDashboard() {
        const dashboardMetric = document.getElementById("adminMetricUsuarios");

        if (!dashboardMetric) {
            return;
        }

        Promise.all([
            loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios),
            loadMock("../../assets/mock/turnos.json", fallbackData.turnos),
            loadMock("../../assets/mock/disponibilidad.json", fallbackData.disponibilidad),
            loadMock("../../assets/mock/triaje.json", fallbackData.triaje)
        ]).then(([usuariosData, turnosData, disponibilidadData, triajeData]) => {
            const users = mergeStoredUsers(usuariosData.usuarios || []);
            const loggedUser = readStoredJson("usuarioActualMock", null);
            const accessMessage = document.getElementById("adminAccesoMensaje");

            if (!loggedUser || !roleMatches(loggedUser, "administrador")) {
                if (accessMessage) {
                    accessMessage.classList.remove("d-none");
                }

                return;
            }

            const turns = mergeStoredTurns(turnosList(turnosData));
            const availability = Array.isArray(disponibilidadData) ? disponibilidadData : [];
            const triages = Array.isArray(triajeData.triajes) ? triajeData.triajes : [];
            const today = todayInputValue();
            const turnsWithPriority = turns.map((turn) => {
                const triage = triajeByTurnId(triages, turn.id_turno);

                return {
                    ...turn,
                    prioridad: priorityLabel(turn.prioridad || (triage ? triage.prioridad : "")),
                    color_prioridad: turn.color_prioridad || (triage ? triage.color_prioridad : "")
                };
            });
            const reprogramacionesPendientes = turnsWithPriority.filter((turn) => (
                normalizeState(turn.estado) === "cancelado"
                || (
                    turn.reprogramado
                    && normalizeState(turn.estado) !== "completado"
                )
            )).length;

            setText("adminNombreNavbar", fullName(loggedUser));
            setText("adminFechaActual", formatToday());
            setText("adminMetricUsuarios", users.length);
            setText("adminMetricPacientes", users.filter((user) => roleMatches(user, "paciente")).length);
            setText("adminMetricMedicos", users.filter((user) => roleMatches(user, "medico")).length);
            setText("adminMetricSecretarias", users.filter((user) => roleMatches(user, "secretaria")).length);
            setText("adminMetricTurnosDia", turnsWithPriority.filter((turn) => turn.fecha === today).length);
            setText("adminMetricPresentes", turnsWithPriority.filter((turn) => normalizeState(turn.estado) === "presente").length);
            setText("adminMetricAtencion", turnsWithPriority.filter((turn) => normalizeState(turn.estado) === "en atencion").length);
            setText("adminMetricReprogramaciones", reprogramacionesPendientes);
        });
    }

    function initAdminUserManagement() {
        const tableBody = document.getElementById("adminGestionUsuariosTabla");

        if (!tableBody) {
            return;
        }

        Promise.all([
            loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios),
            loadMock("../../assets/mock/medicos.json", { medicos: [] })
        ]).then(([usuariosData]) => {
            const loggedUser = readStoredJson("usuarioActualMock", null);
            const accessMessage = document.getElementById("adminUsuariosAccesoMensaje");
            const message = document.getElementById("adminUsuariosMensaje");
            const searchInput = document.getElementById("adminUsuariosBusqueda");
            const roleFilter = document.getElementById("adminUsuariosRolFiltro");
            const createModal = new bootstrap.Modal(document.getElementById("adminUsuarioCrearModal"));
            const editModal = new bootstrap.Modal(document.getElementById("adminUsuarioEditarModal"));
            const detailModal = new bootstrap.Modal(document.getElementById("adminUsuarioDetalleModal"));
            const statusModal = new bootstrap.Modal(document.getElementById("adminUsuarioEstadoModal"));
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

                tableBody.innerHTML = '<tr><td colspan="8" class="text-secondary">No hay informacion disponible para este usuario.</td></tr>';
                return;
            }

            function showMessage(type, text) {
                message.className = `alert alert-${type}`;
                message.textContent = text;
                message.classList.remove("d-none");
            }

            function hideMessage() {
                message.classList.add("d-none");
            }

            function setFieldError(prefix, fieldName, text) {
                const fieldMap = prefix === "crear" ? createFields : editFields;
                const field = fieldMap[fieldName];
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
                const error = document.getElementById(errorIds[prefix][fieldName]);

                if (!field || !error) {
                    return;
                }

                field.classList.toggle("is-invalid", text !== "");
                error.textContent = text;
            }

            function clearFormErrors(prefix) {
                const fieldMap = prefix === "crear" ? createFields : editFields;

                Object.keys(fieldMap).forEach((fieldName) => setFieldError(prefix, fieldName, ""));
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
                    tableBody.innerHTML = '<tr><td colspan="8" class="text-secondary">No hay usuarios para los filtros seleccionados.</td></tr>';
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
                            <td>${stateText(statusLabel(user))}</td>
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
                createModal.show();
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
                createModal.hide();
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
                editModal.show();
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
                editModal.hide();
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
                        <dt class="col-sm-4 text-secondary">Estado</dt><dd class="col-sm-8">${stateText(statusLabel(user))}</dd>
                        ${roleSpecificDetail(user)}
                    </dl>
                `;
                detailModal.show();
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

                statusModal.show();
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
                statusModal.hide();
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
        const metricsForm = document.getElementById("adminMetricasFiltros");

        if (!metricsForm) {
            return;
        }

        Promise.all([
            loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios),
            loadMock("../../assets/mock/turnos.json", fallbackData.turnos),
            loadMock("../../assets/mock/disponibilidad.json", fallbackData.disponibilidad),
            loadMock("../../assets/mock/triaje.json", fallbackData.triaje)
        ]).then(([usuariosData, turnosData, disponibilidadData, triajeData]) => {
            const loggedUser = readStoredJson("usuarioActualMock", null);
            const accessMessage = document.getElementById("adminMetricasAccesoMensaje");

            if (!loggedUser || !roleMatches(loggedUser, "administrador")) {
                if (accessMessage) {
                    accessMessage.classList.remove("d-none");
                }

                return;
            }

            const users = mergeStoredUsers(usuariosData.usuarios || []);
            const doctors = users.filter((user) => roleMatches(user, "medico"));
            const triages = Array.isArray(triajeData.triajes) ? triajeData.triajes : [];
            const availability = Array.isArray(disponibilidadData) ? disponibilidadData : [];
            const fields = {
                from: document.getElementById("metricasFechaDesde"),
                to: document.getElementById("metricasFechaHasta"),
                doctor: document.getElementById("metricasMedico"),
                specialty: document.getElementById("metricasEspecialidad"),
                state: document.getElementById("metricasEstado")
            };
            const priorityContainer = document.getElementById("metricasPrioridadDistribucion");
            const stateTable = document.getElementById("metricasEstadoTabla");
            const doctorTable = document.getElementById("metricasMedicosTabla");
            const turns = mergeStoredTurns(turnosList(turnosData)).map((turn) => {
                const triage = triajeByTurnId(triages, turn.id_turno);
                const doctor = doctorById(users, turn.id_medico);

                return {
                    ...turn,
                    prioridad: priorityLabel(turn.prioridad || (triage ? triage.prioridad : "")),
                    puntaje_triaje: turn.puntaje_triaje ?? (triage ? triage.puntaje : ""),
                    especialidad: turn.especialidad || (doctor ? doctor.especialidad : ""),
                    espera_minutos: timeDifferenceMinutes(
                        turn.fecha_hora_arribo || turn.fecha_arribo || turn.hora_arribo && turnDateTime(turn, "hora_arribo"),
                        turn.fecha_hora_inicio || turn.fecha_inicio_atencion || turn.hora_inicio_atencion && turnDateTime(turn, "hora_inicio_atencion")
                    ),
                    atencion_minutos: timeDifferenceMinutes(
                        turn.fecha_hora_inicio || turn.fecha_inicio_atencion || turn.hora_inicio_atencion && turnDateTime(turn, "hora_inicio_atencion"),
                        turn.fecha_hora_cierre || turn.fecha_cierre || turn.hora_cierre && turnDateTime(turn, "hora_cierre")
                    )
                };
            });

            function fillSelect(select, firstLabel, items, valueFactory, labelFactory) {
                select.innerHTML = "";
                const firstOption = document.createElement("option");
                firstOption.value = "";
                firstOption.textContent = firstLabel;
                select.appendChild(firstOption);

                items.forEach((item) => {
                    const option = document.createElement("option");
                    option.value = valueFactory(item);
                    option.textContent = labelFactory(item);
                    select.appendChild(option);
                });
            }

            function filteredTurns() {
                return turns.filter((turn) => {
                    const doctor = doctorById(users, turn.id_medico);
                    const matchesFrom = !fields.from.value || turn.fecha >= fields.from.value;
                    const matchesTo = !fields.to.value || turn.fecha <= fields.to.value;
                    const matchesDoctor = !fields.doctor.value || String(turn.id_medico) === fields.doctor.value;
                    const matchesSpecialty = !fields.specialty.value || (doctor && doctor.especialidad === fields.specialty.value);
                    const matchesState = !fields.state.value || normalizeState(turn.estado) === normalizeState(fields.state.value);

                    return matchesFrom && matchesTo && matchesDoctor && matchesSpecialty && matchesState;
                });
            }

            function countBy(items, labelFactory) {
                return items.reduce((counts, item) => {
                    const label = labelFactory(item);
                    counts[label] = (counts[label] || 0) + 1;
                    return counts;
                }, {});
            }

            function renderPriorityDistribution(visibleTurns) {
                const counts = countBy(visibleTurns, (turn) => priorityLabel(turn.prioridad));
                const total = visibleTurns.length;
                const slices = [
                    { label: "Baja", count: counts.Baja || 0, color: "#198754" },
                    { label: "Media", count: counts.Media || 0, color: "#ffc107" },
                    { label: "Alta", count: counts.Alta || 0, color: "#dc3545" }
                ];
                let accumulatedPercent = 0;
                const gradientStops = total === 0
                    ? "#e9ecef 0 100%"
                    : slices.map((slice) => {
                        const slicePercent = (slice.count / total) * 100;
                        const start = accumulatedPercent;
                        const end = accumulatedPercent + slicePercent;
                        accumulatedPercent = end;

                        return `${slice.color} ${start}% ${end}%`;
                    }).join(", ");

                priorityContainer.innerHTML = `
                    <div class="metric-donut-layout">
                        <div class="metric-donut" style="background: conic-gradient(${gradientStops});" aria-label="Distribucion por prioridad">
                            <div class="metric-donut-center">
                                <span class="text-secondary small">Total</span>
                                <strong>${total} turnos</strong>
                            </div>
                        </div>
                        <div class="metric-donut-legend">
                            ${slices.map((slice) => {
                                const percent = total === 0 ? 0 : Math.round((slice.count / total) * 100);

                                return `
                                    <div class="metric-donut-legend-item">
                                        <span class="metric-donut-dot" style="background-color: ${slice.color};"></span>
                                        <span class="fw-semibold">${escapeHtml(slice.label)}</span>
                                        <span class="text-secondary ms-auto">${slice.count} (${percent}%)</span>
                                    </div>
                                `;
                            }).join("")}
                        </div>
                    </div>
                `;
            }

            function renderStateDistribution(visibleTurns) {
                const counts = countBy(visibleTurns, (turn) => turn.estado || "-");
                const states = ["Reservado", "Presente", "En atención", "Completado", "Cancelado", "Ausente"];

                stateTable.innerHTML = states.map((state) => {
                    const count = Object.entries(counts).reduce((total, [key, value]) => (
                        normalizeState(key) === normalizeState(state) ? total + value : total
                    ), 0);

                    return `
                        <tr>
                            <td>${stateText(state)}</td>
                            <td class="fw-semibold">${count}</td>
                        </tr>
                    `;
                }).join("");
            }

            function renderDoctorMetrics(visibleTurns) {
                if (doctors.length === 0) {
                    doctorTable.innerHTML = '<tr><td colspan="8" class="text-secondary">No hay medicos registrados.</td></tr>';
                    return;
                }

                doctorTable.innerHTML = doctors.map((doctor) => {
                    const doctorTurns = visibleTurns.filter((turn) => String(turn.id_medico) === String(doctor.id_medico));
                    const priorityCounts = countBy(doctorTurns, (turn) => priorityLabel(turn.prioridad));

                    return `
                        <tr>
                            <td class="fw-semibold">${escapeHtml(fullName(doctor))}</td>
                            <td>${escapeHtml(doctor.especialidad || "-")}</td>
                            <td>${doctorTurns.length}</td>
                            <td>${doctorTurns.filter((turn) => normalizeState(turn.estado) === "completado").length}</td>
                            <td>${doctorTurns.filter((turn) => normalizeState(turn.estado) === "cancelado").length}</td>
                            <td>${doctorTurns.filter((turn) => normalizeState(turn.estado) === "ausente").length}</td>
                            <td>${averageLabel(doctorTurns.map((turn) => turn.atencion_minutos))}</td>
                            <td>Alta ${priorityCounts.Alta || 0} | Media ${priorityCounts.Media || 0} | Baja ${priorityCounts.Baja || 0}</td>
                        </tr>
                    `;
                }).join("");
            }

            function renderMetrics() {
                const visibleTurns = filteredTurns();
                const priorityCounts = countBy(visibleTurns, (turn) => priorityLabel(turn.prioridad));
                const absentCount = visibleTurns.filter((turn) => normalizeState(turn.estado) === "ausente").length;

                setText("metricasTotalTurnos", visibleTurns.length);
                setText("metricasCompletados", visibleTurns.filter((turn) => normalizeState(turn.estado) === "completado").length);
                setText("metricasCancelados", visibleTurns.filter((turn) => normalizeState(turn.estado) === "cancelado").length);
                setText("metricasAusentes", absentCount);
                setText("metricasEsperaPromedio", averageLabel(visibleTurns.map((turn) => turn.espera_minutos)));
                setText("metricasAtencionPromedio", averageLabel(visibleTurns.map((turn) => turn.atencion_minutos)));
                setText("metricasPrioridadFrecuente", mostFrequentLabel(priorityCounts));
                setText("metricasTasaAusentismo", `${visibleTurns.length ? Math.round((absentCount / visibleTurns.length) * 100) : 0}%`);
                renderPriorityDistribution(visibleTurns);
                renderStateDistribution(visibleTurns);
                renderDoctorMetrics(visibleTurns);
            }

            setText("adminMetricasNavbar", fullName(loggedUser));
            fillSelect(fields.doctor, "Todos", doctors, (doctor) => String(doctor.id_medico), (doctor) => fullName(doctor));
            fillSelect(fields.specialty, "Todas", [...new Set(doctors.map((doctor) => doctor.especialidad).filter(Boolean))], (specialty) => specialty, (specialty) => specialty);
            fillSelect(fields.state, "Todos", [...new Set(turns.map((turn) => turn.estado).filter(Boolean))], (state) => state, (state) => state);

            Object.values(fields).forEach((field) => {
                field.addEventListener("input", renderMetrics);
                field.addEventListener("change", renderMetrics);
            });
            metricsForm.addEventListener("reset", () => {
                setTimeout(renderMetrics, 0);
            });
            renderMetrics();
        });
    }

    function initAdminProfile() {
        const form = document.querySelector('[data-form="admin-profile"]');

        if (!form) {
            return;
        }

        loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios).then((usuariosData) => {
            const loggedUser = readStoredJson("usuarioActualMock", null);
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
                writeStoredJson("usuarioActualMock", updatedAdmin);
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
