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
            ultimoTriaje: {
                prioridad: "Baja",
                color_prioridad: "Verde",
                puntaje: 2,
                recomendacion: "Sin triajes registrados."
            }
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
            mergeStoredAvailability
        },
        {
            compatiblePatientTurn,
            nextPatientTurn,
            patientAppointments,
            turnosList
        },
        {
            calculateTriagePriority,
            validateTriageInput,
            latestTriageForPatient
        },
        {
            readAnswers,
            updateTriageQuestionnaire,
            renderTriageErrors,
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

        const [usuarios, turnos, triaje] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
            loadMock(MOCK_PATHS.TRIAGE, fallbackData.triaje)
        ]);

        const paciente = currentPatient(usuarios);
        const proximoTurno = nextPatientTurn(turnos, usuarios, paciente.id_paciente);
        const ultimoTriaje = latestTriageForPatient(triaje, turnos, paciente.id_paciente, turnosList) || triaje.ultimoTriaje;
        const nombreCompleto = fullName(paciente);

        setText("pacienteNavbar", nombreCompleto);
        setText("pacienteNombre", paciente.nombre);
        setText("heroProximoTurno", proximoTurno ? `${formatDate(proximoTurno.fecha)} - ${proximoTurno.hora}` : "Sin turnos reservados");

        setText("turnoEspecialidad", proximoTurno ? proximoTurno.especialidad : "-");
        setText("turnoMedico", proximoTurno ? proximoTurno.medico : "-");
        setText("turnoFecha", proximoTurno ? formatDate(proximoTurno.fecha) : "-");
        setText("turnoHora", proximoTurno ? proximoTurno.hora : "-");
        setText("turnoEstado", proximoTurno ? proximoTurno.estado : "-");

        setText("triajePrioridad", `${ultimoTriaje.prioridad} (${ultimoTriaje.color_prioridad || ultimoTriaje.color})`);
        setText("triajePuntaje", ultimoTriaje.puntaje);
        setText("triajeRecomendacion", ultimoTriaje.recomendacion);

        const priorityBadge = document.getElementById("triajePrioridad");

        if (priorityBadge) {
            priorityBadge.className = `badge ${priorityClass(ultimoTriaje.prioridad)}`;
        }

        setText("esperaEstimada", proximoTurno ? (proximoTurno.esperaEstimada || "18 minutos") : "-");
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
            disponibilidadSection.classList.add("d-none");
            disponibilidadLista.innerHTML = "";
            disponibilidadError.classList.add("d-none");
            sinDisponibilidad.classList.add("d-none");
            resultBox.classList.add("d-none");
            resultBox.classList.remove("triage-result-success", "triage-result-warning", "triage-result-danger");
        }

        function buildOverbooking(result, requestDoctor, requestSpecialty) {
            const doctorForOverbooking = requestDoctor
                || medicosMock.find((doctor) => doctor.especialidad === requestSpecialty)
                || medicosMock[0];

            if (!doctorForOverbooking) {
                return null;
            }

            return {
                id_disponibilidad: `sobreturno-${Date.now()}`,
                id_medico: doctorForOverbooking.id,
                medico: doctorFullName(doctorForOverbooking),
                especialidad: doctorForOverbooking.especialidad,
                fecha: "2026-06-24",
                hora_inicio: "08:30",
                hora_fin: "09:00",
                estado: "Disponible",
                tipo: "Sobreturno",
                esSobreturno: true
            };
        }

        // Compatibilidad 2A: conserva la política anterior; recibe prioridad, nunca color.
        function filterAvailability(request, result) {
            const filtered = disponibilidadMock.filter((item) => {
                const isAvailable = item.estado === "Disponible";
                const matchesDoctor = request.medicoId
                    ? item.id_medico === request.medicoId
                    : true;
                const matchesSpecialty = request.medicoId
                    ? true
                    : item.especialidad === request.especialidad;

                return isAvailable && matchesDoctor && matchesSpecialty;
            });

            if (!result || result === "Baja") {
                return filtered;
            }

            const ordered = [...filtered].sort((a, b) => availabilityDateTime(a) - availabilityDateTime(b));

            if (result !== "Alta") {
                return ordered;
            }

            const immediateLimit = new Date("2026-06-25T23:59:59").getTime();
            const hasImmediateAvailability = ordered.some((item) => availabilityDateTime(item) <= immediateLimit);

            if (hasImmediateAvailability) {
                return ordered;
            }

            const overbooking = buildOverbooking(result, selectedDoctor(), request.especialidad);
            return overbooking ? [overbooking, ...ordered] : ordered;
        }

        function renderAvailability(items) {
            selectedAvailability = null;
            disponibilidadLista.innerHTML = "";
            disponibilidadError.classList.add("d-none");
            sinDisponibilidad.classList.toggle("d-none", items.length > 0);

            items.forEach((item, index) => {
                const optionId = `disponibilidad-${index}`;
                const badgeClass = item.esSobreturno ? "text-bg-danger" : "text-bg-success";
                const badgeText = item.esSobreturno ? "Sobreturno sugerido por prioridad alta" : "Disponible";
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
                            <span class="badge ${badgeClass}">${badgeText}</span>
                        </div>
                    </label>
                `;

                disponibilidadLista.appendChild(column);
            });

            disponibilidadLista.querySelectorAll('input[name="disponibilidad"]').forEach((radio) => {
                radio.addEventListener("change", () => {
                    selectedAvailability = items[Number.parseInt(radio.value, 10)];
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
                    renderTriageErrors(triajeError, validation.errors);
                    return;
                }
            }
            const result = input ? calculateTriagePriority(input) : null;
            const doctor = selectedDoctor();
            lastRequest = {
                especialidad: especialidad.value || (doctor ? doctor.especialidad : ""),
                medico: doctor ? doctorFullName(doctor) : "",
                medicoId: doctor ? doctor.id : null,
                triaje: input ? { ...input, prioridad: result } : null,
                estado: "Pendiente de horario",
                fechaSolicitud: new Date().toISOString()
            };
            if (result) renderResult(result, { resultBox, resultColor });
            else resultBox.classList.add("d-none");
            disponibilidadSection.classList.remove("d-none");
            renderAvailability(filterAvailability(lastRequest, result));
            disponibilidadSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        function confirmAppointment() {
            if (!lastRequest || !selectedAvailability) {
                disponibilidadError.classList.remove("d-none");
                return;
            }

            const reservedAppointment = {
                ...lastRequest,
                medico: selectedAvailability.medico,
                medicoId: selectedAvailability.id_medico,
                especialidad: selectedAvailability.especialidad,
                fecha: selectedAvailability.fecha,
                hora: selectedAvailability.hora_inicio,
                horaFin: selectedAvailability.hora_fin,
                disponibilidadId: selectedAvailability.id_disponibilidad,
                tipo: selectedAvailability.tipo,
                esSobreturno: Boolean(selectedAvailability.esSobreturno),
                estado: "Confirmado",
                fechaConfirmacion: new Date().toISOString()
            };

            writeSessionJson(SESSION_STORAGE_KEYS.PATIENT_APPOINTMENT_REQUEST, lastRequest);
            writeSessionJson(SESSION_STORAGE_KEYS.PATIENT_RESERVED_APPOINTMENT, reservedAppointment);

            const patientId = patient.id_paciente || 1;
            const storedTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, [])
                .filter((turn) => compatiblePatientTurn(turn, medicosMock, patientId));
            const storedAvailability = mergeStoredAvailability(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, disponibilidadMock, medicosMock);
            const updatedAvailability = storedAvailability.map((item) => {
                if (String(item.id_disponibilidad) === String(selectedAvailability.id_disponibilidad)) {
                    return {
                        ...item,
                        estado: "Ocupado"
                    };
                }

                return item;
            });
            const patientTurn = {
                id: Date.now(),
                pacienteId: patient.id_paciente || 1,
                especialidad: reservedAppointment.especialidad,
                medico: reservedAppointment.medico,
                medicoId: reservedAppointment.medicoId,
                fecha: reservedAppointment.fecha,
                hora: reservedAppointment.hora,
                horaFin: reservedAppointment.horaFin,
                estado: "Reservado",
                // Compatibilidad temporal 2A: estructura local existente; duración del bloque de agenda.
                prioridad: reservedAppointment.triaje?.prioridad ?? null,
                tiempoEstimado: `${(new Date(`2000-01-01T${reservedAppointment.horaFin}:00`) - new Date(`2000-01-01T${reservedAppointment.hora}:00`)) / 60000} minutos`,
                disponibilidadId: reservedAppointment.disponibilidadId,
                origenInterfaz: true
            };

            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, [...storedTurns, patientTurn]);
            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, updatedAvailability);
            window.location.href = "turno-reservado.html";
        }

        function exitAppointmentRequest() {
            removeSessionItem(SESSION_STORAGE_KEYS.PATIENT_APPOINTMENT_REQUEST);
            removeSessionItem(SESSION_STORAGE_KEYS.PATIENT_RESERVED_APPOINTMENT);
            lastRequest = null;
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
        const appointmentType = appointment.esSobreturno
            ? "Sobreturno sugerido por prioridad alta"
            : appointment.tipo;

        detail.classList.remove("d-none");
        setText("turnoReservadoEspecialidad", appointment.especialidad);
        setText("turnoReservadoMedico", appointment.medico);
        setText("turnoReservadoFecha", formatDate(appointment.fecha));
        setText("turnoReservadoHora", `${appointment.hora} a ${appointment.horaFin}`);
        setText("turnoReservadoTipo", appointmentType);
        setText("turnoReservadoDuracion", (new Date(`2000-01-01T${appointment.horaFin}:00`) - new Date(`2000-01-01T${appointment.hora}:00`)) / 60000);

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
