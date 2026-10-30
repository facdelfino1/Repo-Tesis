const coreModuleBaseUrl = new URL("../core/", document.currentScript.src).href;
const componentModuleBaseUrl = new URL("../components/", document.currentScript.src).href;
const featureModuleBaseUrl = new URL("../features/", document.currentScript.src).href;

document.addEventListener("DOMContentLoaded", async () => {
    const fallbackData = {
        usuarios: {
            usuarios: []
        },
        medicos: {
            medicos: []
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
        {
            currentTimeValue,
            formatDate,
            formatToday,
            priorityLabel: sharedPriorityLabel,
            timeToMinutes,
            todayInputValue
        },
        { isStrongPassword, isValidEmail },
        { hideAlert, showAlert },
        { priorityClass, stateText: renderStateText },
        { clearErrors: clearFieldErrors, initPasswordToggles: componentInitPasswordToggles, setFieldError: applyFieldError },
        { getBootstrapModal, hideModal, showModal },
        { renderTableEmptyRow },
        { mergeStoredDoctorTurns, turnosList },
        { triajeByTurnId },
        { renderTriageResponses },
        { mergeAllStoredAvailability },
        {
            availableSlotsForReschedule: getAvailableSlotsForReschedule,
            buildRescheduleProposals,
            confirmRescheduleProposal,
            isAffectedTurn: isRescheduleAffectedTurn,
            rejectRescheduleProposal,
            orderRescheduleTurns,
            reschedulePriority,
            restoreRescheduleItems
        },
        {
            renderDoctorAffected,
            renderDoctorNotifications,
            renderDoctorProposals,
            renderDoctorWaitlist,
            showAvailabilityWarning: showRescheduleAvailabilityWarning
        },
        { initDoctorAvailability: initDoctorAvailabilityFeature }
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
        import(`${componentModuleBaseUrl}tables.js`),
        import(`${featureModuleBaseUrl}appointments/appointments-service.js`),
        import(`${featureModuleBaseUrl}triage/triage-service.js`),
        import(`${featureModuleBaseUrl}triage/triage-ui.js`),
        import(`${featureModuleBaseUrl}availability/availability-service.js`),
        import(`${featureModuleBaseUrl}rescheduling/rescheduling-service.js`),
        import(`${featureModuleBaseUrl}rescheduling/rescheduling-ui.js`),
        import(`${featureModuleBaseUrl}availability/availability-ui.js`)
    ]);
    const priorityLabel = (priority) => sharedPriorityLabel(priority, priority || "Baja");

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

    function currentUser() {
        return readStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, null);
    }

    function patientsFromUsers(usuarios) {
        return (usuarios.usuarios || []).filter((user) => roleMatches(user, "paciente"));
    }

    function doctorsFromData(usuarios, medicosData) {
        const users = usuarios.usuarios || [];

        if (Array.isArray(medicosData.medicos) && medicosData.medicos.length > 0) {
            return medicosData.medicos.map((doctor) => {
                const user = users.find((item) => String(item.id_usuario) === String(doctor.id_usuario)) || {};

                return {
                    ...user,
                    ...doctor,
                    id_medico: doctor.id_medico || doctor.id,
                    rol: "medico",
                    contraseña: user.contraseña
                };
            });
        }

        return users
            .filter((user) => roleMatches(user, "medico"))
            .map((doctor) => ({
                id: doctor.id_medico,
                id_medico: doctor.id_medico,
                id_usuario: doctor.id_usuario,
                nombre: doctor.nombre,
                apellido: doctor.apellido,
                dni: doctor.dni,
                email: doctor.email,
                telefono: doctor.telefono,
                contraseña: doctor.contraseña,
                especialidad: doctor.especialidad,
                matricula: doctor.matricula,
                rol: "medico"
            }));
    }

    function consultationStartValue(turn) {
        return turn.hora_inicio_atencion || turn.hora_inicio_consulta || "";
    }

    function consultationEndValue(turn) {
        return turn.hora_cierre || turn.hora_fin_atencion || "";
    }

    function arrivalValue(turn) {
        if (turn.hora_llegada || turn.hora_arribo) {
            return turn.hora_llegada || turn.hora_arribo;
        }

        if (turn.fecha_hora_arribo || turn.fecha_arribo) {
            const date = new Date(turn.fecha_hora_arribo || turn.fecha_arribo);
            return Number.isNaN(date.getTime()) ? "-" : currentTimeValue(date);
        }

        return "-";
    }

    function attentionStartDate(turn) {
        const start = consultationStartValue(turn);

        if (!start) {
            return null;
        }

        const date = new Date(`${turn.fecha}T${start}:00`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function attentionDurationMinutes(turn, endDate = null) {
        const startDate = attentionStartDate(turn);

        if (!startDate) {
            return null;
        }

        const finalDate = endDate
            || (turn.fecha_cierre ? new Date(turn.fecha_cierre) : null)
            || (turn.hora_cierre ? new Date(`${turn.fecha}T${turn.hora_cierre}:00`) : null);

        if (!finalDate || Number.isNaN(finalDate.getTime())) {
            return null;
        }

        return Math.max(0, Math.round((finalDate.getTime() - startDate.getTime()) / 60000));
    }

    function formatDuration(minutes) {
        if (!Number.isFinite(minutes)) {
            return "-";
        }

        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;

        if (hours === 0) {
            return `${remainingMinutes} min`;
        }

        return `${hours} h ${remainingMinutes.toString().padStart(2, "0")} min`;
    }

    function patientById(patients, idPaciente) {
        return patients.find((patient) => String(patient.id_paciente) === String(idPaciente)) || null;
    }

    function renderUnauthorized() {
        const message = document.getElementById("medicoAccesoMensaje")
            || document.getElementById("perfilMedicoAccesoMensaje")
            || document.getElementById("agendaMedicaAccesoMensaje")
            || document.getElementById("disponibilidadMedicoAccesoMensaje")
            || document.getElementById("reprogramacionMedicoAccesoMensaje");

        if (message) {
            message.classList.remove("d-none");
        }
    }

    async function initDoctorProfile() {
        const form = document.querySelector('[data-form="doctor-profile"]');

        if (!form) {
            return;
        }

        const [usuarios, medicosData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos)
        ]);
        const loggedUser = currentUser();
        const message = document.getElementById("perfilMedicoMensaje");

        if (!loggedUser || !roleMatches(loggedUser, "medico")) {
            renderUnauthorized();
            form.classList.add("d-none");
            return;
        }

        const doctors = doctorsFromData(usuarios, medicosData);
        const mockDoctor = doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(loggedUser.id_medico))
            || loggedUser;
        const storedDoctor = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_PROFILE, null);
        let doctor = storedDoctor && String(storedDoctor.id_medico) === String(mockDoctor.id_medico || mockDoctor.id)
            ? {
                ...mockDoctor,
                ...storedDoctor,
                matricula: mockDoctor.matricula,
                especialidad: mockDoctor.especialidad
            }
            : mockDoctor;
        const fields = {
            nombre: document.getElementById("perfilMedicoNombre"),
            apellido: document.getElementById("perfilMedicoApellido"),
            dni: document.getElementById("perfilMedicoDni"),
            email: document.getElementById("perfilMedicoEmail"),
            telefono: document.getElementById("perfilMedicoTelefono"),
            matricula: document.getElementById("perfilMedicoMatricula"),
            especialidad: document.getElementById("perfilMedicoEspecialidad"),
            passwordActual: document.getElementById("perfilMedicoPasswordActual"),
            passwordNueva: document.getElementById("perfilMedicoPasswordNueva"),
            passwordConfirmar: document.getElementById("perfilMedicoPasswordConfirmar")
        };

        function fillForm(doctorData) {
            fields.nombre.value = doctorData.nombre || "";
            fields.apellido.value = doctorData.apellido || "";
            fields.dni.value = doctorData.dni || "";
            fields.email.value = doctorData.email || "";
            fields.telefono.value = doctorData.telefono || "";
            fields.matricula.value = doctorData.matricula || "";
            fields.especialidad.value = doctorData.especialidad || "";
            fields.passwordActual.value = "";
            fields.passwordNueva.value = "";
            fields.passwordConfirmar.value = "";
            setText("perfilMedicoNavbar", fullName(doctorData));
            setText("perfilMedicoEspecialidadResumen", doctorData.especialidad || "Datos del medico");
        }

        function setFieldError(fieldName, text) {
            applyFieldError(
                fields,
                fieldName,
                text,
                (name) => document.getElementById(`perfilMedico${name.charAt(0).toUpperCase()}${name.slice(1)}Error`)
            );
        }

        function clearErrors() {
            clearFieldErrors(fields, setFieldError, {
                onClear: () => hideAlert(message)
            });
        }

        function showMessage(type, text) {
            showAlert(message, type, text);
        }

        function validateProfile() {
            let isValid = true;
            const wantsPasswordChange = fields.passwordActual.value !== ""
                || fields.passwordNueva.value !== ""
                || fields.passwordConfirmar.value !== "";

            clearErrors();

            if (fields.nombre.value.trim() === "") {
                setFieldError("nombre", "El nombre es obligatorio.");
                isValid = false;
            }

            if (fields.apellido.value.trim() === "") {
                setFieldError("apellido", "El apellido es obligatorio.");
                isValid = false;
            }

            if (fields.dni.value.trim() === "") {
                setFieldError("dni", "El DNI es obligatorio.");
                isValid = false;
            }

            if (fields.email.value.trim() === "") {
                setFieldError("email", "El email es obligatorio.");
                isValid = false;
            } else if (!isValidEmail(fields.email.value.trim())) {
                setFieldError("email", "Ingrese un email valido.");
                isValid = false;
            }

            if (fields.telefono.value.trim() === "") {
                setFieldError("telefono", "El telefono es obligatorio.");
                isValid = false;
            }

            if (wantsPasswordChange) {
                if (fields.passwordActual.value === "") {
                    setFieldError("passwordActual", "Ingrese la contraseña actual.");
                    isValid = false;
                } else if (doctor.contraseña && fields.passwordActual.value !== doctor.contraseña) {
                    setFieldError("passwordActual", "La contraseña actual no coincide.");
                    isValid = false;
                }

                if (fields.passwordNueva.value === "") {
                    setFieldError("passwordNueva", "Ingrese la nueva contraseña.");
                    isValid = false;
                } else if (!isStrongPassword(fields.passwordNueva.value)) {
                    setFieldError("passwordNueva", "La contraseña debe cumplir los requisitos de seguridad.");
                    isValid = false;
                }

                if (fields.passwordConfirmar.value === "") {
                    setFieldError("passwordConfirmar", "Confirme la nueva contraseña.");
                    isValid = false;
                } else if (fields.passwordConfirmar.value !== fields.passwordNueva.value) {
                    setFieldError("passwordConfirmar", "La confirmacion no coincide con la nueva contraseña.");
                    isValid = false;
                }
            }

            return isValid;
        }

        function initPasswordToggles() {
            form.querySelectorAll('[data-action="toggle-password"]').forEach((button) => {
                button.addEventListener("click", () => {
                    const input = document.getElementById(button.dataset.target);
                    const icon = button.querySelector("i");

                    if (!input || !icon) {
                        return;
                    }

                    const isVisible = input.type === "text";
                    input.type = isVisible ? "password" : "text";
                    icon.className = isVisible ? "bi bi-eye" : "bi bi-eye-slash";
                    button.setAttribute("aria-label", isVisible ? "Mostrar contraseña" : "Ocultar contraseña");
                });
            });
        }

        fillForm(doctor);
        componentInitPasswordToggles(form);

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            if (!validateProfile()) {
                showMessage("danger", "Revise los campos marcados antes de guardar.");
                return;
            }

            const updatedDoctor = {
                ...doctor,
                id_usuario: mockDoctor.id_usuario,
                id_medico: mockDoctor.id_medico || mockDoctor.id,
                rol: "medico",
                matricula: mockDoctor.matricula,
                especialidad: mockDoctor.especialidad,
                nombre: fields.nombre.value.trim(),
                apellido: fields.apellido.value.trim(),
                dni: fields.dni.value.trim(),
                email: fields.email.value.trim(),
                telefono: fields.telefono.value.trim()
            };

            if (fields.passwordNueva.value !== "") {
                updatedDoctor.contraseña = fields.passwordNueva.value;
                updatedDoctor.passwordActualizada = true;
            }

            doctor = updatedDoctor;
            writeStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_PROFILE, updatedDoctor);
            writeStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, {
                ...loggedUser,
                ...updatedDoctor,
                matricula: mockDoctor.matricula,
                especialidad: mockDoctor.especialidad
            });

            fillForm(updatedDoctor);
            clearErrors();
            showMessage("success", "Perfil actualizado correctamente.");
        });

        form.addEventListener("reset", () => {
            setTimeout(() => {
                const storedProfile = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_PROFILE, null);
                const doctorData = storedProfile && String(storedProfile.id_medico) === String(mockDoctor.id_medico || mockDoctor.id)
                    ? {
                        ...mockDoctor,
                        ...storedProfile,
                        matricula: mockDoctor.matricula,
                        especialidad: mockDoctor.especialidad
                    }
                    : mockDoctor;

                fillForm(doctorData);
                clearErrors();
            }, 0);
        });
    }

    async function initDoctorAgenda() {
        const tableBody = document.getElementById("agendaMedicaTabla");

        if (!tableBody) {
            return;
        }

        const [usuarios, medicosData, turnosData, triajeData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
            loadMock(MOCK_PATHS.TRIAGE, fallbackData.triaje)
        ]);
        const loggedUser = currentUser();
        const form = document.getElementById("agendaMedicaFiltros");
        const message = document.getElementById("agendaMedicaMensaje");
        const presentAlert = document.getElementById("agendaMedicaPresentesAlerta");
        const longAttentionAlert = document.getElementById("agendaMedicaAtencionAlerta");
        const actionModalElement = document.getElementById("agendaMedicaAccionModal");
        const detailModalElement = document.getElementById("agendaMedicaDetalleModal");
        const actionModal = getBootstrapModal(actionModalElement);
        const detailModal = getBootstrapModal(detailModalElement);
        const actionTitle = document.getElementById("agendaMedicaAccionTitulo");
        const actionText = document.getElementById("agendaMedicaAccionTexto");
        const confirmActionButton = document.getElementById("agendaMedicaConfirmarAccion");
        const detailContent = document.getElementById("agendaMedicaDetalleContenido");
        const filters = {
            date: document.getElementById("agendaMedicaFiltroFecha"),
            state: document.getElementById("agendaMedicaFiltroEstado"),
            priority: document.getElementById("agendaMedicaFiltroPrioridad"),
            dni: document.getElementById("agendaMedicaFiltroDni"),
            patient: document.getElementById("agendaMedicaFiltroPaciente")
        };
        let selectedAction = null;

        if (!loggedUser || !roleMatches(loggedUser, "medico")) {
            renderUnauthorized();
            tableBody.innerHTML = renderTableEmptyRow(9, "No hay informacion disponible para este usuario.");

            if (form) {
                form.classList.add("d-none");
            }

            return;
        }

        const doctors = doctorsFromData(usuarios, medicosData);
        const mockDoctor = doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(loggedUser.id_medico))
            || loggedUser;
        const storedDoctor = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_PROFILE, null);
        const doctor = storedDoctor && String(storedDoctor.id_medico) === String(mockDoctor.id_medico || mockDoctor.id)
            ? {
                ...mockDoctor,
                ...loggedUser,
                ...storedDoctor,
                matricula: mockDoctor.matricula,
                especialidad: mockDoctor.especialidad
            }
            : {
                ...mockDoctor,
                ...loggedUser,
                matricula: mockDoctor.matricula,
                especialidad: mockDoctor.especialidad
            };
        const patients = patientsFromUsers(usuarios);
        const triajes = Array.isArray(triajeData.triajes) ? triajeData.triajes : [];
        let turns = mergeStoredDoctorTurns(turnosList(turnosData))
            .filter((turn) => String(turn.id_medico) === String(doctor.id_medico || doctor.id))
            .map((turn) => {
                const triaje = triajeByTurnId(triajes, turn.id_turno);

                return {
                    ...turn,
                    prioridad: priorityLabel(turn.prioridad || (triaje ? triaje.prioridad : "")),
                    color_prioridad: turn.color_prioridad || (triaje ? triaje.color_prioridad : ""),
                    puntaje_triaje: turn.puntaje_triaje ?? (triaje ? triaje.puntaje : ""),
                    duracion_estimada: turn.duracion_estimada || (triaje ? triaje.duracion_estimada : ""),
                    respuestas_triaje: turn.respuestas_triaje || (triaje ? triaje.respuestas : null),
                    recomendacion_triaje: turn.recomendacion_triaje || (triaje ? triaje.recomendacion : "")
                };
            });

        function patientByTurn(turn) {
            return patientById(patients, turn.id_paciente);
        }

        function showMessage(type, text) {
            showAlert(message, type, text);
        }

        function hideMessage() {
            hideAlert(message);
        }

        function persistTurns() {
            writeStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_TURNS, turns);
        }

        function doctorId() {
            return doctor.id_medico || doctor.id;
        }

        function defaultAgendaDate() {
            const today = todayInputValue();

            if (turns.some((turn) => turn.fecha === today)) {
                return today;
            }

            const futureTurn = [...turns]
                .filter((turn) => turn.fecha >= today)
                .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora_inicio).localeCompare(String(b.hora_inicio)))[0];

            if (futureTurn) {
                return futureTurn.fecha;
            }

            const firstTurn = [...turns]
                .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora_inicio).localeCompare(String(b.hora_inicio)))[0];

            return firstTurn ? firstTurn.fecha : today;
        }

        function filteredTurns() {
            return turns.filter((turn) => {
                const patient = patientByTurn(turn);
                const patientName = patient ? fullName(patient) : "";
                const stateMatches = !filters.state.value || normalizeState(turn.estado) === normalizeState(filters.state.value);
                const priorityMatches = !filters.priority.value || priorityLabel(turn.prioridad) === filters.priority.value;
                const dniMatches = !filters.dni.value || (patient && String(patient.dni).includes(filters.dni.value.trim()));
                const patientMatches = !filters.patient.value || normalizeText(patientName).includes(normalizeText(filters.patient.value));

                return (!filters.date.value || turn.fecha === filters.date.value)
                    && stateMatches
                    && priorityMatches
                    && dniMatches
                    && patientMatches;
            }).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || timeToMinutes(a.hora_inicio) - timeToMinutes(b.hora_inicio));
        }

        function isLongAttention(turn) {
            if (normalizeState(turn.estado) !== "en atencion") {
                return false;
            }

            const startDate = attentionStartDate(turn);
            return startDate ? Date.now() - startDate.getTime() > 60 * 60 * 1000 : false;
        }

        function renderAlerts() {
            if (presentAlert) {
                presentAlert.classList.toggle("d-none", !turns.some((turn) => normalizeState(turn.estado) === "presente"));
            }

            if (longAttentionAlert) {
                longAttentionAlert.classList.toggle("d-none", !turns.some(isLongAttention));
            }
        }

        function actionButtons(turn) {
            const state = normalizeState(turn.estado);
            const startButton = state === "presente"
                ? `<button type="button" class="btn btn-success btn-sm" data-action="start" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-play-circle me-1"></i>Iniciar consulta
                    </button>`
                : "";
            const finishButton = state === "en atencion"
                ? `<button type="button" class="btn btn-success btn-sm" data-action="finish" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-clipboard2-check me-1"></i>Finalizar consulta
                    </button>`
                : "";

            return `
                <div class="d-grid d-xl-flex gap-2">
                    <button type="button" class="btn btn-outline-primary btn-sm" data-action="detail" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-eye me-1"></i>Ver detalle
                    </button>
                    ${startButton}
                    ${finishButton}
                </div>
            `;
        }

        function renderTable() {
            const visibleTurns = filteredTurns();

            renderAlerts();

            if (visibleTurns.length === 0) {
                tableBody.innerHTML = renderTableEmptyRow(9, "No hay turnos para los filtros seleccionados.");
                return;
            }

            tableBody.innerHTML = visibleTurns.map((turn) => {
                const patient = patientByTurn(turn);
                const priority = priorityLabel(turn.prioridad);

                return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(turn.hora_inicio)}</td>
                        <td>${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(patient ? patient.obra_social : "-")}</td>
                        <td><span class="badge ${priorityClass(priority)}">${escapeHtml(priority)}</span></td>
                        <td>${escapeHtml(turn.puntaje_triaje || "-")}</td>
                        <td>${escapeHtml(turn.duracion_estimada || "-")} minutos</td>
                        <td>${renderStateText(turn.estado, escapeHtml)}</td>
                        <td>${actionButtons(turn)}</td>
                    </tr>
                `;
            }).join("");
        }

        function openActionModal(type, turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));
            const state = turn ? normalizeState(turn.estado) : "";
            const isOwnTurn = turn && String(turn.id_medico) === String(doctorId());
            const isValidAction = (type === "start" && state === "presente")
                || (type === "finish" && state === "en atencion");

            if (!turn || !isOwnTurn || !isValidAction || !actionModal) {
                return;
            }

            selectedAction = {
                type,
                turnId: turn.id_turno
            };

            if (type === "start") {
                actionTitle.textContent = "Iniciar consulta";
                actionText.textContent = "Confirme el inicio de atencion para el paciente seleccionado.";
            } else {
                actionTitle.textContent = "Finalizar consulta";
                actionText.textContent = "Confirme la finalizacion de la consulta seleccionada.";
            }

            showModal(actionModal);
        }

        function applySelectedAction() {
            if (!selectedAction) {
                return;
            }

            const now = new Date();
            const currentHour = currentTimeValue(now);
            let actionApplied = false;

            turns = turns.map((turn) => {
                if (String(turn.id_turno) !== String(selectedAction.turnId)) {
                    return turn;
                }

                if (String(turn.id_medico) !== String(doctorId())) {
                    return turn;
                }

                if (selectedAction.type === "start" && normalizeState(turn.estado) === "presente") {
                    actionApplied = true;

                    return {
                        ...turn,
                        estado: "En atención",
                        fecha_inicio_atencion: now.toISOString(),
                        hora_inicio_atencion: currentHour
                    };
                }

                if (selectedAction.type === "finish" && normalizeState(turn.estado) === "en atencion") {
                    actionApplied = true;

                    return {
                        ...turn,
                        estado: "Completado",
                        fecha_cierre: now.toISOString(),
                        hora_cierre: currentHour,
                        tiempo_atencion_minutos: attentionDurationMinutes(turn, now)
                    };
                }

                return turn;
            });

            if (!actionApplied) {
                if (actionModal) {
                    hideModal(actionModal);
                }

                showMessage("warning", "La accion no esta disponible para el estado actual del turno.");
                selectedAction = null;
                return;
            }

            persistTurns();
            renderTable();

            if (actionModal) {
                hideModal(actionModal);
            }

            showMessage(
                "success",
                selectedAction.type === "start" ? "Consulta iniciada correctamente." : "Consulta finalizada correctamente."
            );
            selectedAction = null;
        }

        function renderDetail(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || !detailContent || !detailModal) {
                return;
            }

            const patient = patientByTurn(turn);
            const priority = priorityLabel(turn.prioridad);
            const attentionMinutes = turn.tiempo_atencion_minutos ?? attentionDurationMinutes(turn);

            detailContent.innerHTML = `
                <dl class="row mb-4">
                    <dt class="col-sm-4 text-secondary">Paciente</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? fullName(patient) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">DNI</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.dni : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Obra social</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.obra_social : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Medico</dt>
                    <dd class="col-sm-8">${escapeHtml(fullName(doctor))}</dd>
                    <dt class="col-sm-4 text-secondary">Especialidad</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor.especialidad || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Fecha</dt>
                    <dd class="col-sm-8">${formatDate(turn.fecha)}</dd>
                    <dt class="col-sm-4 text-secondary">Horario</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.hora_inicio)} a ${escapeHtml(turn.hora_fin || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Prioridad</dt>
                    <dd class="col-sm-8"><span class="badge ${priorityClass(priority)}">${escapeHtml(priority)}</span></dd>
                    <dt class="col-sm-4 text-secondary">Puntaje de triaje</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.puntaje_triaje || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Duracion estimada</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.duracion_estimada || "-")} minutos</dd>
                    <dt class="col-sm-4 text-secondary">Estado</dt>
                    <dd class="col-sm-8">${renderStateText(turn.estado, escapeHtml)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de llegada</dt>
                    <dd class="col-sm-8">${escapeHtml(arrivalValue(turn))}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de inicio</dt>
                    <dd class="col-sm-8">${escapeHtml(consultationStartValue(turn) || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de cierre</dt>
                    <dd class="col-sm-8">${escapeHtml(consultationEndValue(turn) || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Tiempo de atencion</dt>
                    <dd class="col-sm-8">${escapeHtml(formatDuration(attentionMinutes))}</dd>
                </dl>
                <h3 class="h6 fw-semibold">Respuestas del triaje</h3>
                ${renderTriageResponses(turn.respuestas_triaje)}
                ${turn.recomendacion_triaje ? `<p class="text-secondary mt-3 mb-0">${escapeHtml(turn.recomendacion_triaje)}</p>` : ""}
            `;

            showModal(detailModal);
        }

        setText("agendaMedicaNavbar", fullName(doctor));
        setText("agendaMedicaEspecialidad", doctor.especialidad || "-");

        if (filters.date) {
            filters.date.value = defaultAgendaDate();
        }

        Object.values(filters).forEach((field) => {
            if (field) {
                field.addEventListener("input", () => {
                    hideMessage();
                    renderTable();
                });
                field.addEventListener("change", () => {
                    hideMessage();
                    renderTable();
                });
            }
        });

        if (form) {
            form.addEventListener("reset", () => {
                setTimeout(() => {
                    filters.date.value = defaultAgendaDate();
                    hideMessage();
                    renderTable();
                }, 0);
            });
        }

        tableBody.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            if (button.dataset.action === "detail") {
                renderDetail(button.dataset.turnId);
            } else {
                openActionModal(button.dataset.action, button.dataset.turnId);
            }
        });

        if (confirmActionButton) {
            confirmActionButton.addEventListener("click", applySelectedAction);
        }

        renderTable();
    }

    async function initDoctorMassReschedule() {
        const form = document.querySelector('[data-form="doctor-mass-reschedule"]');

        if (!form) {
            return;
        }

        const [usuarios, medicosData, turnosData, disponibilidadData, triajeData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
            loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad),
            loadMock(MOCK_PATHS.TRIAGE, fallbackData.triaje)
        ]);
        const loggedUser = currentUser();
        const message = document.getElementById("reprogramacionMedicoMensaje");
        const affectedTable = document.getElementById("reprogramacionMedicoAfectadosTabla");
        const proposalTable = document.getElementById("reprogramacionMedicoPropuestasTabla");
        const notificationContainer = document.getElementById("reprogramacionMedicoNotificaciones");
        const waitlistTable = document.getElementById("reprogramacionMedicoEsperaTabla");
        const availabilityWarning = document.getElementById("reprogramacionMedicoDisponibilidadAviso");
        const availabilityWarningText = document.getElementById("reprogramacionMedicoDisponibilidadTexto");
        const availabilityLoadButton = document.getElementById("reprogramacionMedicoCargarDisponibilidadBtn");
        const availabilityWarningElements = {
            container: availabilityWarning,
            text: availabilityWarningText,
            loadButton: availabilityLoadButton
        };
        const executeButton = document.getElementById("ejecutarReprogramacionMedicoBtn");
        const searchButton = document.getElementById("buscarAfectadosMedicoBtn");
        const confirmButton = document.getElementById("confirmarReprogramacionMedicoBtn");
        const confirmModalElement = document.getElementById("confirmarReprogramacionMedicoModal");
        const confirmModal = getBootstrapModal(confirmModalElement);
        const fields = {
            date: document.getElementById("reprogramacionMedicoFecha"),
            start: document.getElementById("reprogramacionMedicoHoraInicio"),
            end: document.getElementById("reprogramacionMedicoHoraFin"),
            reason: document.getElementById("reprogramacionMedicoMotivo")
        };
        let affectedTurns = [];
        let proposals = [];
        let waitlist = [];

        if (!loggedUser || !roleMatches(loggedUser, "medico")) {
            renderUnauthorized();
            form.classList.add("d-none");
            affectedTable.innerHTML = renderTableEmptyRow(6, "No hay informacion disponible para este usuario.");
            return;
        }

        const doctors = doctorsFromData(usuarios, medicosData);
        const mockDoctor = doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(loggedUser.id_medico))
            || loggedUser;
        const storedDoctor = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_PROFILE, null);
        const doctor = storedDoctor && String(storedDoctor.id_medico) === String(mockDoctor.id_medico || mockDoctor.id)
            ? { ...mockDoctor, ...loggedUser, ...storedDoctor, matricula: mockDoctor.matricula, especialidad: mockDoctor.especialidad }
            : { ...mockDoctor, ...loggedUser, matricula: mockDoctor.matricula, especialidad: mockDoctor.especialidad };
        const doctorId = doctor.id_medico || doctor.id;
        const patients = patientsFromUsers(usuarios);
        const triajes = Array.isArray(triajeData.triajes) ? triajeData.triajes : [];
        let turns = mergeStoredDoctorTurns(turnosList(turnosData))
            .filter((turn) => String(turn.id_medico) === String(doctorId))
            .map((turn) => {
                const triaje = triajeByTurnId(triajes, turn.id_turno);

                return {
                    ...turn,
                    especialidad: turn.especialidad || doctor.especialidad,
                    prioridad: reschedulePriority({ ...turn, especialidad: turn.especialidad || doctor.especialidad,
                        ...(!Object.hasOwn(turn, "prioridad") ? { prioridad: triaje?.prioridad ?? null } : {}) }),
                    color_prioridad: turn.color_prioridad || (triaje ? triaje.color_prioridad : ""),
                    duracion_estimada: turn.duracion_estimada || (triaje ? triaje.duracion_estimada : "")
                };
            });
        let availability = mergeAllStoredAvailability(Array.isArray(disponibilidadData) ? disponibilidadData : []);
        const storedProcess = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_RESCHEDULE, {});

        if (storedProcess && String(storedProcess.id_medico) === String(doctorId)) {
            try {
                proposals = restoreRescheduleItems(Array.isArray(storedProcess.proposals) ? storedProcess.proposals : [], turns);
                waitlist = restoreRescheduleItems(Array.isArray(storedProcess.waitlist) ? storedProcess.waitlist : [], turns);
                orderRescheduleTurns([...proposals, ...waitlist]);
            } catch (error) {
                proposals = []; waitlist = [];
                showAlert(message, "warning", error.message);
            }
        }

        function patientByTurn(turn) {
            return patientById(patients, turn.id_paciente);
        }

        function setFieldError(fieldName, text) {
            const errorIds = {
                date: "reprogramacionMedicoFechaError",
                start: "reprogramacionMedicoHoraInicioError",
                end: "reprogramacionMedicoHoraFinError",
                reason: "reprogramacionMedicoMotivoError"
            };
            applyFieldError(fields, fieldName, text, (name) => document.getElementById(errorIds[name]));
        }

        function clearErrors() {
            clearFieldErrors(fields, setFieldError, {
                onClear: () => hideAlert(message)
            });
        }

        function showMessage(type, text) {
            showAlert(message, type, text);
        }

        function validateBlock() {
            let isValid = true;

            clearErrors();

            if (fields.date.value === "") {
                setFieldError("date", "Seleccione la fecha afectada.");
                isValid = false;
            }

            if (fields.start.value === "") {
                setFieldError("start", "Indique la hora de inicio.");
                isValid = false;
            }

            if (fields.end.value === "") {
                setFieldError("end", "Indique la hora de fin.");
                isValid = false;
            }

            if (fields.start.value !== "" && fields.end.value !== ""
                && timeToMinutes(fields.start.value) >= timeToMinutes(fields.end.value)) {
                setFieldError("start", "La hora de inicio debe ser menor.");
                setFieldError("end", "Revise el rango horario.");
                isValid = false;
            }

            if (fields.reason.value === "") {
                setFieldError("reason", "Seleccione un motivo.");
                isValid = false;
            }

            return isValid;
        }

        function rescheduleCriteria() {
            return {
                doctorId,
                date: fields.date.value,
                start: fields.start.value,
                end: fields.end.value
            };
        }

        function currentRescheduleSlots() {
            return getAvailableSlotsForReschedule(availability, rescheduleCriteria());
        }

        function turnLabel(turn) {
            return `${formatDate(turn.fecha)} ${turn.hora_inicio}`;
        }

        function slotLabel(slot) {
            return slot ? `${formatDate(slot.fecha)} ${slot.hora_inicio} - ${slot.hora_fin}` : "Lista de espera";
        }

        function persistState() {
            writeStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_TURNS, turns);
            writeStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_AVAILABILITY, availability);
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY, availability);
            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, availability);
            writeStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_RESCHEDULE, {
                id_medico: doctorId,
                proposals,
                waitlist
            });
        }

        function renderAffectedState() {
            renderDoctorAffected({
                affectedTable,
                affectedTurns,
                executeButton,
                patientByTurn,
                fullName,
                priorityLabel
            });
        }

        function renderAll() {
            renderAffectedState();
            renderDoctorProposals({
                proposalTable,
                proposals,
                waitlist,
                slotLabel,
                warningElements: availabilityWarningElements
            });
            renderDoctorNotifications({
                notificationContainer,
                proposals,
                slotLabel
            });
            renderDoctorWaitlist({
                waitlistTable,
                waitlist
            });
        }

        function searchAffectedTurns() {
            if (!validateBlock()) {
                return;
            }

            try {
                affectedTurns = orderRescheduleTurns(turns.filter((turn) => isRescheduleAffectedTurn(turn, rescheduleCriteria())));
            } catch (error) {
                affectedTurns = [];
                renderAffectedState();
                showMessage("warning", error.message);
                return;
            }
            proposals = [];
            waitlist = [];
            persistState();
            renderAll();
            showMessage("info", `${affectedTurns.length} turno(s) afectado(s) encontrados.`);
        }

        function executeReschedule() {
            if (affectedTurns.length === 0) {
                showMessage("warning", "Debe buscar turnos afectados antes de ejecutar la reprogramacion.");
                return;
            }

            const slots = currentRescheduleSlots();

            if (slots.length === 0) {
                showRescheduleAvailabilityWarning(availabilityWarningElements, "No existen horarios alternativos cargados para su agenda. Debe cargar una nueva disponibilidad antes de ejecutar la reprogramacion masiva.", true);
                showMessage("warning", "No existen horarios alternativos cargados para su agenda.");

                if (confirmModal) {
                    hideModal(confirmModal);
                }

                return;
            }

            let nextProcess;
            try {
                nextProcess = buildRescheduleProposals({
                    affectedTurns,
                    slots,
                    patientByTurn,
                    fullName,
                    turnLabel,
                    reason: fields.reason.value,
                    proposalIdPrefix: "propuesta-medico-",
                    waitlistIdPrefix: "espera-medico-",
                    notificationStatus: "Pendiente de respuesta"
                });
            } catch (error) {
                showMessage("warning", error.message);
                return;
            }

            proposals = nextProcess.proposals;
            waitlist = nextProcess.waitlist;
            persistState();
            renderAll();

            if (confirmModal) {
                hideModal(confirmModal);
            }

            showMessage("success", "Propuestas generadas y notificaciones simuladas enviadas.");
        }

        function confirmProposal(proposalId) {
            const nextState = confirmRescheduleProposal({
                turns,
                availability,
                proposals,
                proposalId,
                doctorId
            });

            if (!nextState) {
                showMessage("warning", "No se pudo confirmar: revise que turno y horario pertenezcan a la misma agenda.");
                return;
            }

            turns = nextState.turns;
            availability = nextState.availability;
            proposals = nextState.proposals;
            persistState();
            renderAll();
            showMessage("success", "Cambio confirmado y turno actualizado correctamente.");
        }

        function rejectProposal(proposalId) {
            const nextState = rejectRescheduleProposal({
                proposals,
                waitlist,
                proposalId,
                waitlistIdPrefix: "espera-rechazo-medico-"
            });

            if (!nextState) {
                return;
            }

            proposals = nextState.proposals;
            waitlist = nextState.waitlist;
            persistState();
            renderAll();
            showMessage("warning", "El paciente fue agregado a lista de espera prioritaria.");
        }

        setText("reprogramacionMedicoNavbar", fullName(doctor));
        renderAll();

        Object.values(fields).forEach((field) => {
            field.addEventListener("input", () => {
                affectedTurns = [];
                executeButton.disabled = true;
                renderAffectedState();
            });
            field.addEventListener("change", () => {
                affectedTurns = [];
                executeButton.disabled = true;
                renderAffectedState();
            });
        });

        searchButton.addEventListener("click", searchAffectedTurns);
        executeButton.addEventListener("click", () => {
            if (affectedTurns.length === 0) {
                showMessage("warning", "Debe buscar turnos afectados antes de ejecutar la reprogramacion.");
                return;
            }

            if (currentRescheduleSlots().length === 0) {
                showRescheduleAvailabilityWarning(availabilityWarningElements, "No existen horarios alternativos cargados para su agenda. Debe cargar una nueva disponibilidad antes de ejecutar la reprogramacion masiva.", true);
                showMessage("warning", "No existen horarios alternativos cargados para su agenda.");
                return;
            }

            if (confirmModal) {
                showModal(confirmModal);
            }
        });

        if (confirmButton) {
            confirmButton.addEventListener("click", executeReschedule);
        }

        notificationContainer.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            if (button.dataset.action === "confirm-proposal") {
                confirmProposal(button.dataset.proposalId);
            }

            if (button.dataset.action === "reject-proposal") {
                rejectProposal(button.dataset.proposalId);
            }
        });
    }

    async function initDoctorDashboard() {
        const agendaTable = document.getElementById("medicoAgendaDia");

        if (!agendaTable) {
            return;
        }

        const [usuarios, medicosData, turnosData, triajeData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
            loadMock(MOCK_PATHS.TRIAGE, fallbackData.triaje)
        ]);
        const loggedUser = currentUser();

        if (!loggedUser || !roleMatches(loggedUser, "medico")) {
            renderUnauthorized();
            agendaTable.innerHTML = renderTableEmptyRow(7, "No hay informacion disponible para este usuario.");
            return;
        }

        const doctors = doctorsFromData(usuarios, medicosData);
        const mockDoctor = doctors.find((item) => String(item.id_medico || item.id) === String(loggedUser.id_medico))
            || loggedUser;
        const storedDoctor = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_PROFILE, null);
        const doctor = storedDoctor && String(storedDoctor.id_medico) === String(mockDoctor.id_medico || mockDoctor.id)
            ? {
                ...mockDoctor,
                ...loggedUser,
                ...storedDoctor,
                matricula: mockDoctor.matricula,
                especialidad: mockDoctor.especialidad
            }
            : {
                ...mockDoctor,
                ...loggedUser,
                matricula: mockDoctor.matricula,
                especialidad: mockDoctor.especialidad
            };
        const patients = patientsFromUsers(usuarios);
        const triajes = Array.isArray(triajeData.triajes) ? triajeData.triajes : [];
        const turns = mergeStoredDoctorTurns(turnosList(turnosData))
            .filter((turn) => String(turn.id_medico) === String(doctor.id_medico || doctor.id))
            .map((turn) => {
                const triaje = triajeByTurnId(triajes, turn.id_turno);

                return {
                    ...turn,
                    prioridad: turn.prioridad || (triaje ? triaje.prioridad : ""),
                    color_prioridad: turn.color_prioridad || (triaje ? triaje.color_prioridad : ""),
                    duracion_estimada: turn.duracion_estimada || (triaje ? triaje.duracion_estimada : "")
                };
            });
        const today = todayInputValue();
        const dayTurns = turns
            .filter((turn) => turn.fecha === today)
            .sort((a, b) => String(a.hora_inicio).localeCompare(String(b.hora_inicio)));
        const nextTurn = dayTurns.find((turn) => {
            const state = normalizeState(turn.estado);

            return state === "reservado" || state === "presente" || state === "en atencion";
        }) || null;
        const nextTurnPatient = nextTurn ? patientById(patients, nextTurn.id_paciente) : null;

        setText("medicoNombreNavbar", fullName(doctor));
        setText("medicoFechaActual", formatToday());
        setText("medicoEspecialidadResumen", doctor.especialidad || "-");
        setText("medicoMetricTurnosDia", dayTurns.length);
        setText("medicoMetricPresentes", dayTurns.filter((turn) => normalizeState(turn.estado) === "presente").length);
        setText("medicoMetricAtencion", dayTurns.filter((turn) => normalizeState(turn.estado) === "en atencion").length);
        setText("medicoMetricCompletadas", dayTurns.filter((turn) => normalizeState(turn.estado) === "completado").length);
        setText("medicoMetricProximo", nextTurn ? `${nextTurn.hora_inicio} - ${nextTurnPatient ? fullName(nextTurnPatient) : "Paciente"}` : "Sin turnos");

        if (dayTurns.length === 0) {
            agendaTable.innerHTML = '<tr><td colspan="7" class="text-secondary">No hay turnos asignados para el dia de hoy.</td></tr>';
            return;
        }

        agendaTable.innerHTML = dayTurns.map((turn) => {
            const patient = patientById(patients, turn.id_paciente);
            const priority = turn.prioridad || turn.color_prioridad || "Baja";

            return `
                <tr>
                    <td class="fw-semibold">${escapeHtml(turn.hora_inicio)}</td>
                    <td>${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                    <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                    <td><span class="badge ${priorityClass(priority)}">${escapeHtml(priority)}</span></td>
                    <td>${renderStateText(turn.estado, escapeHtml)}</td>
                    <td>${escapeHtml(turn.duracion_estimada || "-")} minutos</td>
                    <td>
                        <a href="agenda-medica.html" class="btn btn-outline-primary btn-sm">
                            <i class="bi bi-eye me-1"></i>Ver agenda
                        </a>
                    </td>
                </tr>
            `;
        }).join("");
    }

    await initDoctorDashboard();
    await initDoctorProfile();
    await initDoctorAvailabilityFeature({
        currentUser,
        doctorsFromData,
        fallbackData,
        fullName,
        renderUnauthorized,
        roleMatches,
        setText
    });
    await initDoctorAgenda();
    await initDoctorMassReschedule();
});
