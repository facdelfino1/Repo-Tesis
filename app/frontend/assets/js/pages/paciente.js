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
        medicos: {
            medicos: []
        },
        disponibilidad: []
    };

    const [
        { LOCAL_STORAGE_KEYS, MOCK_PATHS, SESSION_STORAGE_KEYS },
        { loadMock, readStoredJson, writeStoredJson },
        { readSessionJson, removeSessionItem, writeSessionJson },
        { formatDate },
        { isStrongPassword, isValidEmail },
        { hideAlert, showAlert },
        { priorityClass, stateText: renderStateText },
        { clearErrors: clearFieldErrors, initPasswordToggles: componentInitPasswordToggles, setFieldError: applyFieldError },
        { getBootstrapModal, showModal },
        {
            availabilityDateTime,
            availabilityDurationMinutes,
            persistAvailabilityChanges,
            mergeAllStoredAvailability,
        },
        {
            mergeStoredTurns,
            occupyPatientAppointmentAvailability,
            persistPatientTurns,
            nextPatientTurn,
            patientAppointments,
        },
        {
            calculateTriagePriority,
            validateTriageInput
        },
        {
            readAnswers,
            updateTriageQuestionnaire,
            renderTriageErrors,
            triageFormErrors,
            renderResult
        },
        { initPatientAppointments }
    ] = await Promise.all([
        import(`${coreModuleBaseUrl}constants.js`),
        import(`${coreModuleBaseUrl}storage.js`),
        import(`${coreModuleBaseUrl}session.js`),
        import(`${coreModuleBaseUrl}formatters.js`),
        import(`${coreModuleBaseUrl}validators.js`),
        import(`${componentModuleBaseUrl}alerts.js`),
        import(`${componentModuleBaseUrl}badges.js`),
        import(`${componentModuleBaseUrl}forms.js`),
        import(`${componentModuleBaseUrl}modals.js`),
        import(`${featureModuleBaseUrl}availability/availability-service.js`),
        import(`${featureModuleBaseUrl}appointments/appointments-service.js`),
        import(`${featureModuleBaseUrl}triage/triage-service.js`),
        import(`${featureModuleBaseUrl}triage/triage-ui.js`),
        import(`${featureModuleBaseUrl}appointments/appointments-ui.js`)
    ]);

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
    }

    function renderHistory(history) {
        const tableBody = document.getElementById("historialTurnos");

        if (!tableBody) {
            return;
        }

        tableBody.innerHTML = history.map((turno) => `
            <tr>
                <td>${formatDate(turno.fecha)}</td>
                <td>${turno.especialidad}</td>
                <td>${turno.medico}</td>
                <td>${renderStateText(turno.estado)}</td>
            </tr>
        `).join("");
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

    function currentPatient(usuarios) {
        const loggedUser = currentUser();
        const users = usuarios.usuarios || [];

        if (loggedUser && loggedUser.id_paciente) {
            return users.find((user) => user.id_paciente === loggedUser.id_paciente) || loggedUser;
        }

        return users.find((user) => user.id_paciente === 1)
            || usuarios.pacienteActual
            || users.find((user) => roleMatches(user, "paciente"))
            || {};
    }

    function doctorsFromUsers(usuarios) {
        return (usuarios.usuarios || [])
            .filter((user) => roleMatches(user, "medico"))
            .map((doctor) => ({
                id: doctor.id_medico,
                id_medico: doctor.id_medico,
                nombre: doctor.nombre,
                apellido: doctor.apellido,
                especialidad: doctor.especialidad
            }));
    }

    async function initDashboard() {
        if (!document.getElementById("historialTurnos")) {
            return;
        }

        const [usuarios, turnosData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos)
        ]);

        const paciente = currentPatient(usuarios);
        const turnos = { turnos: mergeStoredTurns(turnosData.turnos) };
        const proximoTurno = nextPatientTurn(turnos, usuarios, paciente.id_paciente);
        const pendingRequests = patientAppointments(turnos, usuarios, paciente.id_paciente)
            .filter((turn) => turn.estado === "Pendiente");
        const pendingNotice = document.getElementById("solicitudesPendientesAviso");
        if (pendingNotice) {
            pendingNotice.classList.toggle("d-none", pendingRequests.length === 0);
            setText("solicitudesPendientesResumen", `${pendingRequests.length} solicitud(es) pendiente(s) de nueva asignación o reprogramación. La fecha y hora anteriores no constituyen una reserva confirmada.`);
        }
        const nombreCompleto = fullName(paciente);

        setText("pacienteNavbar", nombreCompleto);
        setText("pacienteNombre", paciente.nombre);
        setText("heroProximoTurno", proximoTurno ? `${formatDate(proximoTurno.fecha)} - ${proximoTurno.hora}`
            : pendingRequests.length ? "Solicitud pendiente de nueva asignación" : "Sin turnos reservados");

        setText("turnoEspecialidad", proximoTurno ? proximoTurno.especialidad : "-");
        setText("turnoMedico", proximoTurno ? proximoTurno.medico : "-");
        setText("turnoFecha", proximoTurno ? formatDate(proximoTurno.fecha) : "-");
        setText("turnoHora", proximoTurno ? proximoTurno.hora : "-");
        setText("turnoEstado", proximoTurno ? proximoTurno.estado : "-");

        const priority = proximoTurno?.prioridad ?? null;
        setText("triajePrioridad", proximoTurno ? (priority || "Sin triaje espec\u00edfico") : "Sin turno asignado");

        const priorityBadge = document.getElementById("triajePrioridad");

        if (priorityBadge) {
            priorityBadge.className = `badge ${priority ? priorityClass(priority) : "text-bg-secondary"}`;
        }

        setText("esperaEstimada", "-");
        setText("duracionEstimada", proximoTurno ? (proximoTurno.duracionEstimada || proximoTurno.tiempoEstimado) : "-");

        renderHistory(patientAppointments(turnos, usuarios, paciente.id_paciente).filter((turn) => (
            turn.estado === "Completado" || turn.estado === "Cancelado" || turn.estado === "Ausente"
        )));
    }

    async function initAppointmentRequest() {
        const form = document.querySelector('[data-form="appointment-request"]');

        if (!form) {
            return;
        }

        const especialidad = document.getElementById("especialidad");
        const medico = document.getElementById("medico");
        const seleccionError = document.getElementById("seleccionTurnoError");
        const triajeError = document.getElementById("triajeError");
        const resultBox = document.getElementById("triajeResultado");
        const resultColor = document.getElementById("resultadoPrioridad");
        const disponibilidadSection = document.getElementById("disponibilidadSection");
        const disponibilidadLista = document.getElementById("disponibilidadLista");
        const disponibilidadError = document.getElementById("disponibilidadError");
        const sinDisponibilidad = document.getElementById("sinDisponibilidad");
        const confirmarTurnoBtn = document.getElementById("confirmarTurnoBtn");
        const cancelRequestButtons = document.querySelectorAll('[data-action="cancelar-solicitud"]');
        const cancelRequestModalElement = document.getElementById("cancelarSolicitudModal");
        const confirmExitRequestButton = document.getElementById("confirmarSalidaSolicitudBtn");
        const cancelRequestModal = getBootstrapModal(cancelRequestModalElement);
        let lastRequest = null;
        let requestCreationDate = null;
        let selectedAvailability = null;

        const [usuariosData, medicosData, disponibilidadData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
            loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad)
        ]);
        const patient = currentPatient(usuariosData);
        const medicosMock = Array.isArray(medicosData.medicos) ? medicosData.medicos : [];
        const disponibilidadMock = Array.isArray(disponibilidadData)
            ? disponibilidadData
            : fallbackData.disponibilidad;

        function createDoctorOption(value, label) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            return option;
        }

        function doctorFullName(doctor) {
            return `${doctor.nombre} ${doctor.apellido}`;
        }

        function renderSpecialties() {
            const specialties = [...new Set(medicosMock.map((doctor) => doctor.especialidad))].sort();
            especialidad.replaceChildren();
            especialidad.appendChild(createDoctorOption("", "Seleccione una especialidad"));

            specialties.forEach((specialty) => {
                especialidad.appendChild(createDoctorOption(specialty, specialty));
            });
        }

        function renderDoctorsBySpecialty(specialty) {
            medico.replaceChildren();
            medico.appendChild(createDoctorOption("", "Seleccione un medico"));

            const filteredDoctors = specialty === ""
                ? medicosMock
                : medicosMock.filter((doctor) => doctor.especialidad === specialty);

            filteredDoctors.forEach((doctor) => {
                medico.appendChild(createDoctorOption(String(doctor.id), `${doctorFullName(doctor)} - ${doctor.especialidad}`));
            });
        }

        function selectedDoctor() {
            const doctorId = Number.parseInt(medico.value, 10);
            return medicosMock.find((doctor) => doctor.id === doctorId) || null;
        }

        function hasAppointmentSelection() {
            return especialidad.value !== "" || selectedDoctor() !== null;
        }

        function triageSpecialty() {
            const label = selectedDoctor()?.especialidad || especialidad.value;
            const normalized = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
            return ({ "clinica medica": "clinica_medica", pediatria: "pediatria" })[normalized] || normalized;
        }

        function clearAvailabilityStep() {
            updateTriageQuestionnaire(form, triageSpecialty());
            lastRequest = null;
            selectedAvailability = null;
            confirmarTurnoBtn.disabled = true;
            disponibilidadSection.classList.add("d-none");
            disponibilidadLista.innerHTML = "";
            disponibilidadError.classList.add("d-none");
            sinDisponibilidad.classList.add("d-none");
            resultBox.classList.add("d-none");
            resultBox.classList.remove("triage-result-success", "triage-result-warning", "triage-result-danger");
        }

        function filterAvailability(request, priority) {
            const now = Date.now();
            const availability = mergeAllStoredAvailability(disponibilidadMock, {
                conservative: true,
                doctors: medicosMock
            });
            const filtered = availability.filter((item) => {
                const isAvailable = item.estado === "Disponible";
                const matchesDoctor = request.medicoId
                    ? String(item.id_medico) === String(request.medicoId)
                    : true;
                const matchesSpecialty = item.especialidad === request.especialidad;

                return isAvailable && matchesDoctor && matchesSpecialty && availabilityDateTime(item) > now;
            });

            return priority === "Media" || priority === "Alta"
                ? filtered.sort((a, b) => availabilityDateTime(a) - availabilityDateTime(b))
                : filtered;
        }

        function renderAvailability(items, priority) {
            selectedAvailability = null;
            confirmarTurnoBtn.disabled = true;
            disponibilidadLista.innerHTML = "";
            disponibilidadError.classList.add("d-none");
            sinDisponibilidad.classList.toggle("d-none", items.length > 0);
            sinDisponibilidad.textContent = priority === "Alta"
                ? "No hay horarios compatibles disponibles. La solicitud requiere revisión de agenda. No se ha reservado un turno; la gestión de esa revisión queda pendiente."
                : "No hay horarios disponibles para la seleccion realizada.";

            items.forEach((item, index) => {
                const optionId = `disponibilidad-${index}`;
                const column = document.createElement("div");
                column.className = "col-12 col-md-6 col-xl-4";
                column.innerHTML = `
                    <label class="appointment-slot card border h-100" for="${optionId}">
                        <div class="card-body">
                            <div class="form-check">
                                <input class="form-check-input" type="radio" name="disponibilidad" id="${optionId}" value="${index}">
                                <span class="form-check-label fw-semibold">${formatDate(item.fecha)} - ${item.hora_inicio}</span>
                            </div>
                            <p class="text-secondary small mb-2">${item.hora_inicio} a ${item.hora_fin}</p>
                            <p class="mb-2">${item.medico}</p>
                            <p class="text-secondary small mb-2">${item.especialidad}</p>
                            <span class="badge text-bg-success">Disponible</span>
                        </div>
                    </label>
                `;

                disponibilidadLista.appendChild(column);
            });

            disponibilidadLista.querySelectorAll('input[name="disponibilidad"]').forEach((radio) => {
                radio.addEventListener("change", () => {
                    selectedAvailability = items[Number.parseInt(radio.value, 10)];
                    confirmarTurnoBtn.disabled = !selectedAvailability;
                    disponibilidadError.classList.add("d-none");
                });
            });
        }

        function submitInitialRequest() {
            seleccionError.classList.toggle("d-none", hasAppointmentSelection());
            triajeError.classList.add("d-none");

            if (!hasAppointmentSelection()) {
                clearAvailabilityStep();
                return;
            }

            const specialty = triageSpecialty();
            const input = ["clinica_medica", "pediatria"].includes(specialty) ? readAnswers(form, specialty) : null;
            if (input) {
                const validation = validateTriageInput(input);
                if (!validation.valid) {
                    clearAvailabilityStep();
                    renderTriageErrors(triajeError, triageFormErrors(form, specialty, { submitted: true }));
                    return;
                }
            }
            const result = input ? calculateTriagePriority(input) : null;
            const doctor = selectedDoctor();
            requestCreationDate ??= new Date().toISOString();
            lastRequest = {
                especialidad: especialidad.value || (doctor ? doctor.especialidad : ""),
                medico: doctor ? doctorFullName(doctor) : "",
                medicoId: doctor ? doctor.id : null,
                triaje: input ? { ...input, prioridad: result } : null,
                estado: "Pendiente",
                fecha_hora_creacion: requestCreationDate
            };
            if (result) renderResult(result, { resultBox, resultColor });
            else resultBox.classList.add("d-none");
            disponibilidadSection.classList.remove("d-none");
            renderAvailability(filterAvailability(lastRequest, result), result);
            disponibilidadSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        function confirmAppointment() {
            if (!lastRequest || !selectedAvailability) {
                disponibilidadError.classList.remove("d-none");
                return;
            }

            if (typeof lastRequest.fecha_hora_creacion !== "string"
                || !Number.isFinite(Date.parse(lastRequest.fecha_hora_creacion))) {
                disponibilidadError.textContent = "No fue posible verificar la solicitud. Vuelva a enviarla antes de reservar un horario.";
                disponibilidadError.classList.remove("d-none");
                return;
            }

            const priority = lastRequest.triaje?.prioridad ?? null;
            const candidates = filterAvailability(lastRequest, priority);
            const slot = candidates.find((item) => String(item.id_disponibilidad) === String(selectedAvailability.id_disponibilidad)
                && ["id_medico", "especialidad", "fecha", "hora_inicio", "hora_fin"]
                    .every((field) => String(item[field]) === String(selectedAvailability[field])));
            const duration = slot ? availabilityDurationMinutes(slot.hora_inicio, slot.hora_fin) : null;
            if (!slot || duration === null) {
                renderAvailability(candidates, priority);
                disponibilidadError.textContent = "El horario seleccionado ya no esta disponible o cambio. Seleccione nuevamente un horario válido.";
                disponibilidadError.classList.remove("d-none");
                return;
            }

            const previousTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
            const storedTurns = Array.isArray(previousTurns) ? previousTurns : [];
            const storedAvailability = mergeAllStoredAvailability(disponibilidadMock, { conservative: true, doctors: medicosMock });
            const idTurno = Math.max(Date.now(), ...storedTurns.map((turn) => (Number(turn?.id) || 0) + 1),
                ...storedAvailability.map((item) => (Number(item.id_turno) || 0) + 1));
            const reservedAppointment = {
                ...lastRequest,
                id: idTurno,
                id_turno: idTurno,
                prioridad: priority,
                medico: slot.medico,
                medicoId: slot.id_medico,
                especialidad: slot.especialidad,
                fecha: slot.fecha,
                hora: slot.hora_inicio,
                horaFin: slot.hora_fin,
                duracion_estimada: duration,
                disponibilidadId: slot.id_disponibilidad,
                tipo: slot.tipo || "Consulta",
                estado: "Reservado",
                fechaConfirmacion: new Date().toISOString()
            };
            const patientId = patient.id_paciente || 1;
            const updatedAvailability = occupyPatientAppointmentAvailability(storedAvailability, slot.id_disponibilidad, idTurno);
            const patientTurn = {
                id: idTurno,
                id_turno: idTurno,
                pacienteId: patientId,
                especialidad: reservedAppointment.especialidad,
                medico: reservedAppointment.medico,
                medicoId: reservedAppointment.medicoId,
                fecha: reservedAppointment.fecha,
                hora: reservedAppointment.hora,
                horaFin: reservedAppointment.horaFin,
                estado: "Reservado",
                prioridad: priority,
                triaje: reservedAppointment.triaje,
                fecha_hora_creacion: reservedAppointment.fecha_hora_creacion,
                duracion_estimada: duration,
                tiempoEstimado: `${duration} minutos`,
                disponibilidadId: reservedAppointment.disponibilidadId,
                origenInterfaz: true
            };

            try {
                persistPatientTurns(LOCAL_STORAGE_KEYS.PATIENT_TURNS,
                    [...storedTurns.filter((turn) => turn && String(turn.pacienteId) === String(patientId)), patientTurn], patientId);
                persistAvailabilityChanges(updatedAvailability.filter((item) => String(item.id_disponibilidad) === String(slot.id_disponibilidad)));
            } catch (error) {
                // Recuperacion local minima; la atomicidad real corresponde al backend.
                try { writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, previousTurns); } catch (_) { /* El almacenamiento puede seguir inaccesible. */ }
                removeSessionItem(SESSION_STORAGE_KEYS.PATIENT_RESERVED_APPOINTMENT);
                disponibilidadError.textContent = "No se pudo completar la reserva. Revise sus turnos antes de volver a intentar.";
                disponibilidadError.classList.remove("d-none");
                selectedAvailability = null;
                confirmarTurnoBtn.disabled = true;
                return;
            }
            // La pantalla de confirmacion solo recibe datos despues de guardar turno y bloque.
            requestCreationDate = null;
            selectedAvailability = null;
            confirmarTurnoBtn.disabled = true;
            try {
                writeSessionJson(SESSION_STORAGE_KEYS.PATIENT_APPOINTMENT_REQUEST, lastRequest);
                writeSessionJson(SESSION_STORAGE_KEYS.PATIENT_RESERVED_APPOINTMENT, reservedAppointment);
            } catch (error) {
                removeSessionItem(SESSION_STORAGE_KEYS.PATIENT_RESERVED_APPOINTMENT);
                disponibilidadError.textContent = "El turno fue reservado. Consulte Mis turnos; no se pudo guardar la pantalla de confirmaci\u00f3n.";
                disponibilidadError.classList.remove("d-none");
                return;
            }
            window.location.href = "turno-reservado.html";
        }

        function exitAppointmentRequest() {
            removeSessionItem(SESSION_STORAGE_KEYS.PATIENT_APPOINTMENT_REQUEST);
            removeSessionItem(SESSION_STORAGE_KEYS.PATIENT_RESERVED_APPOINTMENT);
            lastRequest = null;
            requestCreationDate = null;
            selectedAvailability = null;
            window.location.href = "dashboard.html";
        }

        especialidad.addEventListener("change", () => {
            medico.value = "";
            renderDoctorsBySpecialty(especialidad.value);
            seleccionError.classList.add("d-none");
            clearAvailabilityStep();
        });

        medico.addEventListener("change", () => {
            const doctor = selectedDoctor();

            if (doctor && especialidad.value !== doctor.especialidad) {
                especialidad.value = doctor.especialidad;
                renderDoctorsBySpecialty(doctor.especialidad);
                medico.value = String(doctor.id);
            }

            seleccionError.classList.add("d-none");
            clearAvailabilityStep();
        });

        form.querySelectorAll("[data-triage-specialty] input, [data-triage-specialty] select").forEach(field => field.addEventListener("input", () => {
            triajeError.classList.add("d-none");
            clearAvailabilityStep();
        }));

        form.querySelectorAll('input[type="radio"]').forEach((radio) => {
            radio.addEventListener("change", () => {
                triajeError.classList.add("d-none");
                clearAvailabilityStep();
            });
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            submitInitialRequest();
        });

        cancelRequestButtons.forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                showModal(cancelRequestModal);
            });
        });
        confirmExitRequestButton.addEventListener("click", exitAppointmentRequest);
        confirmarTurnoBtn.addEventListener("click", confirmAppointment);
        renderSpecialties();
        renderDoctorsBySpecialty(especialidad.value);
        updateTriageQuestionnaire(form, triageSpecialty());
        confirmarTurnoBtn.disabled = true;
    }


    async function initPatientProfile() {
        const form = document.querySelector('[data-form="patient-profile"]');

        if (!form) {
            return;
        }

        const usuarios = await loadMock(MOCK_PATHS.USERS, fallbackData.usuarios);
        const mockPatient = currentPatient(usuarios);
        const storedPatient = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_PROFILE, mockPatient);
        const message = document.getElementById("perfilMensaje");
        const fields = {
            nombre: document.getElementById("perfilNombre"),
            apellido: document.getElementById("perfilApellido"),
            dni: document.getElementById("perfilDni"),
            email: document.getElementById("perfilEmail"),
            telefono: document.getElementById("perfilTelefono"),
            obraSocial: document.getElementById("perfilObraSocial"),
            passwordActual: document.getElementById("perfilPasswordActual"),
            passwordNueva: document.getElementById("perfilPasswordNueva"),
            passwordConfirmar: document.getElementById("perfilPasswordConfirmar")
        };

        function fullName(patient) {
            return `${patient.nombre} ${patient.apellido}`;
        }

        function fillForm(patient) {
            fields.nombre.value = patient.nombre || "";
            fields.apellido.value = patient.apellido || "";
            fields.dni.value = patient.dni || "";
            fields.email.value = patient.email || "";
            fields.telefono.value = patient.telefono || "";
            fields.obraSocial.value = patient.obra_social || patient.obraSocial || "";
            fields.passwordActual.value = "";
            fields.passwordNueva.value = "";
            fields.passwordConfirmar.value = "";
            setText("perfilPacienteNavbar", fullName(patient));
        }

        function setFieldError(fieldName, text) {
            applyFieldError(
                fields,
                fieldName,
                text,
                (name) => document.getElementById(`perfil${name.charAt(0).toUpperCase()}${name.slice(1)}Error`)
            );
        }

        function clearErrors() {
            clearFieldErrors(fields, setFieldError, {
                onClear: () => hideAlert(message)
            });
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

            if (fields.email.value.trim() === "") {
                setFieldError("email", "El correo electronico es obligatorio.");
                isValid = false;
            } else if (!isValidEmail(fields.email.value.trim())) {
                setFieldError("email", "Ingrese un correo electronico valido.");
                isValid = false;
            }

            if (fields.telefono.value.trim() === "") {
                setFieldError("telefono", "El telefono es obligatorio.");
                isValid = false;
            } else if (!/^\d+$/.test(fields.telefono.value.trim())) {
                setFieldError("telefono", "El telefono debe contener solo numeros.");
                isValid = false;
            }

            if (wantsPasswordChange) {
                if (fields.passwordActual.value === "") {
                    setFieldError("passwordActual", "Ingrese la contraseÃ±a actual.");
                    isValid = false;
                }

                if (fields.passwordNueva.value === "") {
                    setFieldError("passwordNueva", "Ingrese la nueva contraseÃ±a.");
                    isValid = false;
                } else if (!isStrongPassword(fields.passwordNueva.value)) {
                    setFieldError("passwordNueva", "La contraseÃ±a debe cumplir los requisitos de seguridad.");
                    isValid = false;
                }

                if (fields.passwordConfirmar.value === "") {
                    setFieldError("passwordConfirmar", "Confirme la nueva contraseÃ±a.");
                    isValid = false;
                } else if (fields.passwordConfirmar.value !== fields.passwordNueva.value) {
                    setFieldError("passwordConfirmar", "La confirmacion no coincide con la nueva contraseÃ±a.");
                    isValid = false;
                }
            }

            return isValid;
        }

        function showSuccess() {
            showAlert(message, "success", "Perfil actualizado correctamente.");
        }

        function initPasswordToggles() {
            form.querySelectorAll('[data-action="toggle-password"]').forEach((button) => {
                button.addEventListener("click", () => {
                    const input = document.getElementById(button.dataset.target);
                    const icon = button.querySelector("i");
                    const isVisible = input.type === "text";

                    input.type = isVisible ? "password" : "text";
                    icon.className = isVisible ? "bi bi-eye" : "bi bi-eye-slash";
                    button.setAttribute("aria-label", isVisible ? "Mostrar contraseÃ±a" : "Ocultar contraseÃ±a");
                });
            });
        }

        fillForm(storedPatient);
        componentInitPasswordToggles(form);

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            if (!validateProfile()) {
                return;
            }

            const updatedPatient = {
                ...storedPatient,
                id_paciente: mockPatient.id_paciente || storedPatient.id_paciente || 1,
                id_usuario: mockPatient.id_usuario || storedPatient.id_usuario,
                nombre: fields.nombre.value.trim(),
                apellido: fields.apellido.value.trim(),
                dni: fields.dni.value.trim(),
                email: fields.email.value.trim(),
                telefono: fields.telefono.value.trim(),
                obra_social: fields.obraSocial.value.trim()
            };

            if (fields.passwordNueva.value !== "") {
                updatedPatient.passwordActualizada = true;
            }

            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_PROFILE, updatedPatient);
            fillForm(updatedPatient);
            clearErrors();
            showSuccess();
        });

        form.addEventListener("reset", () => {
            fillForm(readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_PROFILE, mockPatient));
            clearErrors();
        });
    }

    function initReservedAppointment() {
        const detail = document.getElementById("turnoReservadoDetalle");
        const emptyState = document.getElementById("turnoReservadoVacio");

        if (!detail || !emptyState) {
            return;
        }

        const appointment = readSessionJson(SESSION_STORAGE_KEYS.PATIENT_RESERVED_APPOINTMENT, null);

        if (!appointment) {
            emptyState.classList.remove("d-none");
            return;
        }

        const priorityBadge = document.getElementById("turnoReservadoPrioridad");
        const appointmentType = appointment.esSobreturno ? "Consulta" : appointment.tipo;

        detail.classList.remove("d-none");
        setText("turnoReservadoEspecialidad", appointment.especialidad);
        setText("turnoReservadoMedico", appointment.medico);
        setText("turnoReservadoFecha", formatDate(appointment.fecha));
        setText("turnoReservadoHora", `${appointment.hora} a ${appointment.horaFin}`);
        setText("turnoReservadoTipo", appointmentType);
        setText("turnoReservadoDuracion", availabilityDurationMinutes(appointment.hora, appointment.horaFin) ?? "-");

        if (priorityBadge) {
            priorityBadge.textContent = appointment.triaje?.prioridad ? `Prioridad ${appointment.triaje.prioridad}` : "Sin triaje específico";
            priorityBadge.className = `badge align-self-start ${appointment.triaje?.prioridad ? priorityClass(appointment.triaje.prioridad) : "text-bg-secondary"}`;
        }
    }

    await initDashboard();
    await initAppointmentRequest();
    await initPatientAppointments({
        currentPatient,
        fallbackData,
        fullName,
        setText
    });
    await initPatientProfile();
    initReservedAppointment();
});
