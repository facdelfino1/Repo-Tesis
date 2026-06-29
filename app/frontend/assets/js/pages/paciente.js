const coreModuleBaseUrl = new URL("../core/", document.currentScript.src).href;
const componentModuleBaseUrl = new URL("../components/", document.currentScript.src).href;

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
        { clearStoredJson, loadMock, readStoredJson, writeStoredJson },
        { readSessionJson, removeSessionItem, writeSessionJson },
        { formatDate },
        { isStrongPassword, isValidEmail },
        { hideAlert, showAlert },
        { borderPriorityClass, priorityClass, stateText: renderStateText },
        { clearErrors: clearFieldErrors, initPasswordToggles: componentInitPasswordToggles, setFieldError: applyFieldError },
        { getBootstrapModal, hideModal, showModal }
    ] = await Promise.all([
        import(`${coreModuleBaseUrl}constants.js`),
        import(`${coreModuleBaseUrl}storage.js`),
        import(`${coreModuleBaseUrl}session.js`),
        import(`${coreModuleBaseUrl}formatters.js`),
        import(`${coreModuleBaseUrl}validators.js`),
        import(`${componentModuleBaseUrl}alerts.js`),
        import(`${componentModuleBaseUrl}badges.js`),
        import(`${componentModuleBaseUrl}forms.js`),
        import(`${componentModuleBaseUrl}modals.js`)
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

    function getRadioValue(form, name) {
        const checkedOption = form.querySelector(`input[name="${name}"]:checked`);
        return checkedOption ? checkedOption.value : "";
    }

    function calculateTriage({ fiebre, dolorIntenso, dificultadRespirar, rangoDolor }) {
        let puntaje = 0;

        if (fiebre === "si") {
            puntaje += 1;
        }

        if (dolorIntenso === "si") {
            puntaje += 3;
        }

        if (dificultadRespirar === "si") {
            puntaje += 8;
        }

        if (rangoDolor >= 0 && rangoDolor <= 3) {
            puntaje += 2;
        } else if (rangoDolor >= 4 && rangoDolor <= 6) {
            puntaje += 4;
        } else if (rangoDolor >= 7 && rangoDolor <= 10) {
            puntaje += 6;
        }

        if (puntaje >= 0 && puntaje <= 3) {
            return {
                color: "Verde",
                puntaje,
                duracionTurno: 20
            };
        }

        if (puntaje >= 4 && puntaje <= 7) {
            return {
                color: "Amarillo",
                puntaje,
                duracionTurno: 30
            };
        }

        return {
            color: "Rojo",
            puntaje,
            duracionTurno: 40
        };
    }

    function doctorMatchesAvailability(item, doctors) {
        if (!item) {
            return false;
        }

        const specialties = new Set(doctors.map((doctor) => doctor.especialidad));
        const doctor = doctors.find((currentDoctor) => String(currentDoctor.id) === String(item.id_medico));

        if (doctor) {
            return item.especialidad === doctor.especialidad;
        }

        return !item.id_medico && specialties.has(item.especialidad);
    }

    function compatibleAvailability(item, doctors) {
        const validStates = ["Disponible", "Ocupado"];

        return item
            && item.id_disponibilidad !== undefined
            && validStates.includes(item.estado)
            && doctorMatchesAvailability(item, doctors)
            && item.fecha
            && item.hora_inicio
            && item.hora_fin;
    }

    function mergeStoredAvailability(key, baseAvailability, doctors) {
        const base = Array.isArray(baseAvailability) ? baseAvailability : [];
        const stored = readStoredJson(key, null);

        if (!stored) {
            return base;
        }

        if (!Array.isArray(stored)) {
            clearStoredJson(key);
            return base;
        }

        const storedById = new Map(stored.map((item) => [String(item.id_disponibilidad), item]));
        const baseIds = new Set(base.map((item) => String(item.id_disponibilidad)));
        const mergedBase = base.map((item) => {
            const storedItem = storedById.get(String(item.id_disponibilidad));

            if (!compatibleAvailability(storedItem, doctors)) {
                return item;
            }

            return {
                ...item,
                estado: storedItem.estado,
                id_turno: storedItem.id_turno || item.id_turno
            };
        });
        const extraItems = stored.filter((item) => (
            !baseIds.has(String(item.id_disponibilidad))
            && compatibleAvailability(item, doctors)
        ));
        const merged = [...mergedBase, ...extraItems];

        writeStoredJson(key, merged);
        return merged;
    }

    function compatiblePatientTurn(turn, doctors, currentPatientId) {
        const validStates = ["Reservado", "Cancelado", "Completado", "Ausente"];

        if (!turn) {
            return false;
        }

        const doctor = doctors.find((currentDoctor) => String(currentDoctor.id) === String(turn.medicoId));

        return turn.origenInterfaz === true
            && turn.pacienteId === currentPatientId
            && doctor
            && turn.especialidad === doctor.especialidad
            && validStates.includes(turn.estado)
            && turn.fecha
            && turn.hora;
    }

    function mergeStoredPatientTurns(key, baseTurns, doctors, currentPatientId) {
        const stored = readStoredJson(key, null);

        if (!stored) {
            return baseTurns;
        }

        if (!Array.isArray(stored)) {
            clearStoredJson(key);
            return baseTurns;
        }

        const baseIds = new Set(baseTurns.map((turn) => String(turn.id)));
        const compatibleStoredTurns = stored.filter((turn) => (
            !baseIds.has(String(turn.id))
            && compatiblePatientTurn(turn, doctors, currentPatientId)
        ));

        writeStoredJson(key, compatibleStoredTurns);
        return [...baseTurns, ...compatibleStoredTurns];
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

    function turnosList(turnos) {
        return Array.isArray(turnos.turnos) ? turnos.turnos : [];
    }

    function triajesList(triaje) {
        return Array.isArray(triaje.triajes) ? triaje.triajes : [];
    }

    function doctorById(usuarios, idMedico) {
        return (usuarios.usuarios || []).find((user) => user.id_medico === idMedico) || null;
    }

    function appointmentFromTurn(turn, usuarios) {
        const doctor = doctorById(usuarios, turn.id_medico);

        return {
            id: turn.id_turno,
            pacienteId: turn.id_paciente,
            especialidad: doctor ? doctor.especialidad : turn.especialidad,
            medico: doctor ? fullName(doctor) : turn.medico,
            medicoId: turn.id_medico,
            fecha: turn.fecha,
            hora: turn.hora_inicio,
            horaFin: turn.hora_fin,
            estado: turn.estado,
            prioridad: turn.color_prioridad || turn.prioridad,
            puntaje: turn.puntaje,
            tiempoEstimado: `${turn.duracion_estimada} minutos`,
            disponibilidadId: turn.id_disponibilidad,
            idTriaje: turn.id_triaje
        };
    }

    function patientAppointments(turnos, usuarios, patientId) {
        return turnosList(turnos)
            .filter((turn) => turn.id_paciente === patientId)
            .map((turn) => appointmentFromTurn(turn, usuarios));
    }

    function nextPatientTurn(turnos, usuarios, patientId) {
        return patientAppointments(turnos, usuarios, patientId)
            .filter((turn) => turn.estado === "Reservado" || turn.estado === "Presente" || turn.estado === "En atenci\u00f3n")
            .sort((a, b) => new Date(`${a.fecha}T${a.hora}:00`) - new Date(`${b.fecha}T${b.hora}:00`))[0] || null;
    }

    function latestTriageForPatient(triaje, turnos, patientId) {
        const patientTurnIds = turnosList(turnos)
            .filter((turn) => turn.id_paciente === patientId)
            .map((turn) => turn.id_turno);

        return triajesList(triaje)
            .filter((item) => item.id_paciente === patientId || patientTurnIds.includes(item.id_turno))
            .sort((a, b) => new Date(`${b.fecha}T00:00:00`) - new Date(`${a.fecha}T00:00:00`))[0] || triaje.ultimoTriaje;
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
        const ultimoTriaje = latestTriageForPatient(triaje, turnos, paciente.id_paciente) || triaje.ultimoTriaje;
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
        const rangoDolor = document.getElementById("rangoDolor");
        const resultBox = document.getElementById("triajeResultado");
        const resultColor = document.getElementById("resultadoColor");
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

        function availabilityDateTime(item) {
            return new Date(`${item.fecha}T${item.hora_inicio}:00`).getTime();
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

        function readAnswers() {
            const painValue = Number.parseInt(rangoDolor.value, 10);

            return {
                fiebre: getRadioValue(form, "fiebre"),
                dolorIntenso: getRadioValue(form, "dolorIntenso"),
                dificultadRespirar: getRadioValue(form, "dificultadRespirar"),
                rangoDolor: painValue
            };
        }

        function isTriageComplete(answers) {
            return answers.fiebre !== ""
                && answers.dolorIntenso !== ""
                && answers.dificultadRespirar !== ""
                && Number.isInteger(answers.rangoDolor)
                && answers.rangoDolor >= 0
                && answers.rangoDolor <= 10;
        }

        function renderResult(result) {
            resultBox.classList.remove("d-none", "triage-result-success", "triage-result-warning", "triage-result-danger");
            resultBox.classList.add(borderPriorityClass(result.color));

            resultColor.textContent = result.color;
            resultColor.className = `badge ${priorityClass(result.color)}`;
            setText("resultadoPuntaje", result.puntaje);
            setText("resultadoDuracion", result.duracionTurno);
        }

        function clearAvailabilityStep() {
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
                esSobreturno: true,
                duracionTurno: result.duracionTurno
            };
        }

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

            if (result.color === "Verde") {
                return filtered;
            }

            const ordered = [...filtered].sort((a, b) => availabilityDateTime(a) - availabilityDateTime(b));

            if (result.color !== "Rojo") {
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

            const answers = readAnswers();

            if (!isTriageComplete(answers)) {
                triajeError.classList.remove("d-none");
                clearAvailabilityStep();
                return;
            }

            const doctor = selectedDoctor();
            const result = calculateTriage(answers);
            lastRequest = {
                especialidad: especialidad.value || (doctor ? doctor.especialidad : ""),
                medico: doctor ? doctorFullName(doctor) : "",
                medicoId: doctor ? doctor.id : null,
                triaje: {
                    fiebre: answers.fiebre,
                    dolorIntenso: answers.dolorIntenso,
                    dificultadRespirar: answers.dificultadRespirar,
                    rangoDolor: answers.rangoDolor,
                    colorPrioridad: result.color,
                    puntaje: result.puntaje,
                    duracionTurno: result.duracionTurno
                },
                estado: "Pendiente de horario",
                fechaSolicitud: new Date().toISOString()
            };

            renderResult(result);
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
                prioridad: reservedAppointment.triaje.colorPrioridad,
                puntaje: reservedAppointment.triaje.puntaje,
                tiempoEstimado: `${reservedAppointment.triaje.duracionTurno} minutos`,
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

        rangoDolor.addEventListener("input", () => {
            triajeError.classList.add("d-none");
            clearAvailabilityStep();
        });

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
    }

    async function initPatientAppointments() {
        const reservedList = document.getElementById("turnosReservadosLista");
        const historyTable = document.getElementById("historialPacienteTabla");

        if (!reservedList || !historyTable) {
            return;
        }

        const [usuarios, turnosMock, disponibilidadData, medicosData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
            loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos)
        ]);
        const currentPatientData = currentPatient(usuarios);
        const currentPatientId = currentPatientData.id_paciente || 1;
        const patientName = fullName(currentPatientData);
        const medicosMock = Array.isArray(medicosData.medicos) ? medicosData.medicos : [];
        const reservedEmpty = document.getElementById("turnosReservadosVacio");
        const historyEmpty = document.getElementById("historialPacienteVacio");
        const message = document.getElementById("misTurnosMensaje");
        const cancelModalElement = document.getElementById("cancelarTurnoModal");
        const modifyModalElement = document.getElementById("modificarTurnoModal");
        const cancelModal = getBootstrapModal(cancelModalElement);
        const modifyModal = getBootstrapModal(modifyModalElement);
        const confirmCancelButton = document.getElementById("confirmarCancelacionBtn");
        const confirmModifyButton = document.getElementById("confirmarModificacionBtn");
        const modifyList = document.getElementById("modificarDisponibilidadLista");
        const modifyError = document.getElementById("modificarTurnoError");
        let selectedTurnId = null;
        let selectedAvailabilityId = null;
        let appointments = [];
        let availability = [];

        function normalizeMockAppointments() {
            const normalizedTurns = patientAppointments(turnosMock, usuarios, currentPatientId);

            if (normalizedTurns.length > 0) {
                return normalizedTurns;
            }

            return [];
        }

        function persistState() {
            const baseIds = new Set(normalizeMockAppointments().map((turn) => String(turn.id)));
            const localAppointments = appointments.filter((turn) => (
                !baseIds.has(String(turn.id))
                && compatiblePatientTurn(turn, medicosMock, currentPatientId)
            ));

            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, localAppointments);
            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, availability);
        }

        function showMessage(type, text) {
            showAlert(message, type, text);
        }

        function appointmentDateTime(turn) {
            return new Date(`${turn.fecha}T${turn.hora}:00`);
        }

        function isReservedTurn(turn) {
            return turn.estado === "Reservado" || turn.estado === "Pendiente";
        }

        function isHistoricalTurn(turn) {
            return turn.estado === "Completado" || turn.estado === "Cancelado" || turn.estado === "Ausente";
        }

        function priorityBadge(priority) {
            return `<span class="badge ${priorityClass(priority)}">${priority}</span>`;
        }

        function renderReserved(turns) {
            reservedList.innerHTML = "";
            reservedEmpty.classList.toggle("d-none", turns.length > 0);

            turns.forEach((turn) => {
                const column = document.createElement("div");
                column.className = "col-12 col-xl-6";
                column.innerHTML = `
                    <article class="card appointment-card border h-100">
                        <div class="card-body">
                            <div class="d-flex flex-column flex-sm-row justify-content-between gap-2 mb-3">
                                <div>
                                    <p class="text-secondary small mb-1">${turn.especialidad}</p>
                                    <h3 class="h5 fw-semibold mb-0">${turn.medico}</h3>
                                </div>
                                <strong class="fw-semibold align-self-start">${turn.estado}</strong>
                            </div>
                            <dl class="row small mb-3">
                                <dt class="col-5 text-secondary">Fecha</dt>
                                <dd class="col-7 fw-medium">${formatDate(turn.fecha)}</dd>
                                <dt class="col-5 text-secondary">Hora</dt>
                                <dd class="col-7 fw-medium">${turn.hora}</dd>
                                <dt class="col-5 text-secondary">Prioridad</dt>
                                <dd class="col-7">${priorityBadge(turn.prioridad)}</dd>
                                <dt class="col-5 text-secondary">Tiempo estimado</dt>
                                <dd class="col-7 fw-medium mb-0">${turn.tiempoEstimado}</dd>
                            </dl>
                            <div class="d-grid d-sm-flex gap-2 justify-content-sm-end">
                                <button type="button" class="btn btn-outline-primary btn-sm" data-action="modify" data-turn-id="${turn.id}">
                                    <i class="bi bi-pencil-square me-1"></i>Modificar
                                </button>
                                <button type="button" class="btn btn-outline-danger btn-sm" data-action="cancel" data-turn-id="${turn.id}">
                                    <i class="bi bi-x-circle me-1"></i>Cancelar
                                </button>
                            </div>
                        </div>
                    </article>
                `;
                reservedList.appendChild(column);
            });
        }

        function renderHistoryTable(turns) {
            historyTable.innerHTML = "";
            historyEmpty.classList.toggle("d-none", turns.length > 0);

            turns.forEach((turn) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${turn.especialidad}</td>
                    <td>${turn.medico}</td>
                    <td>${formatDate(turn.fecha)}</td>
                    <td>${turn.hora}</td>
                    <td>${renderStateText(turn.estado)}</td>
                    <td>${priorityBadge(turn.prioridad)}</td>
                `;
                historyTable.appendChild(row);
            });
        }

        function renderAppointments() {
            const ownAppointments = appointments.filter((turn) => turn.pacienteId === currentPatientId);
            const reservedTurns = ownAppointments
                .filter(isReservedTurn)
                .sort((a, b) => appointmentDateTime(a) - appointmentDateTime(b));
            const historicalTurns = ownAppointments
                .filter(isHistoricalTurn)
                .sort((a, b) => appointmentDateTime(b) - appointmentDateTime(a));

            renderReserved(reservedTurns);
            renderHistoryTable(historicalTurns);
        }

        function releaseAvailability(disponibilidadId) {
            availability = availability.map((item) => {
                if (String(item.id_disponibilidad) === String(disponibilidadId)) {
                    return {
                        ...item,
                        estado: "Disponible"
                    };
                }

                return item;
            });
        }

        function occupyAvailability(disponibilidadId) {
            availability = availability.map((item) => {
                if (String(item.id_disponibilidad) === String(disponibilidadId)) {
                    return {
                        ...item,
                        estado: "Ocupado"
                    };
                }

                return item;
            });
        }

        function cancelSelectedTurn() {
            const turn = appointments.find((item) => item.id === selectedTurnId);

            if (!turn) {
                return;
            }

            const millisecondsToTurn = appointmentDateTime(turn).getTime() - Date.now();
            const twoHoursInMilliseconds = 2 * 60 * 60 * 1000;

            if (millisecondsToTurn < twoHoursInMilliseconds) {
                hideModal(cancelModal);
                showMessage("warning", "No es posible cancelar este turno desde la pagina por encontrarse fuera del tiempo permitido. Comuniquese telefonicamente con la clinica.");
                return;
            }

            appointments = appointments.map((item) => {
                if (item.id === turn.id) {
                    return {
                        ...item,
                        estado: "Cancelado"
                    };
                }

                return item;
            });
            releaseAvailability(turn.disponibilidadId);
            persistState();
            renderAppointments();
            hideModal(cancelModal);
            showMessage("success", "Turno cancelado correctamente. El horario quedo disponible para otros pacientes.");
        }

        function availableSlotsForTurn(turn) {
            return availability
                .filter((item) => item.estado === "Disponible" && item.especialidad === turn.especialidad)
                .sort((a, b) => new Date(`${a.fecha}T${a.hora_inicio}:00`) - new Date(`${b.fecha}T${b.hora_inicio}:00`));
        }

        function renderModifyOptions(turn) {
            const slots = availableSlotsForTurn(turn);
            selectedAvailabilityId = null;
            modifyList.innerHTML = "";
            modifyError.classList.toggle("d-none", slots.length > 0);
            confirmModifyButton.disabled = slots.length === 0;

            slots.forEach((slot) => {
                const optionId = `modificar-${slot.id_disponibilidad}`;
                const column = document.createElement("div");
                column.className = "col-12 col-md-6";
                column.innerHTML = `
                    <label class="appointment-slot card border h-100" for="${optionId}">
                        <div class="card-body">
                            <div class="form-check">
                                <input class="form-check-input" type="radio" name="modificarDisponibilidad" id="${optionId}" value="${slot.id_disponibilidad}">
                                <span class="form-check-label fw-semibold">${formatDate(slot.fecha)} - ${slot.hora_inicio}</span>
                            </div>
                            <p class="text-secondary small mb-2">${slot.hora_inicio} a ${slot.hora_fin}</p>
                            <p class="mb-0">${slot.medico}</p>
                        </div>
                    </label>
                `;
                modifyList.appendChild(column);
            });

            modifyList.querySelectorAll('input[name="modificarDisponibilidad"]').forEach((radio) => {
                radio.addEventListener("change", () => {
                    selectedAvailabilityId = radio.value;
                });
            });
        }

        function openModifyModal(turnId) {
            const turn = appointments.find((item) => item.id === turnId);

            if (!turn) {
                return;
            }

            selectedTurnId = turnId;
            renderModifyOptions(turn);
            showModal(modifyModal);
        }

        function modifySelectedTurn() {
            const turn = appointments.find((item) => item.id === selectedTurnId);
            const selectedSlot = availability.find((item) => String(item.id_disponibilidad) === String(selectedAvailabilityId));

            if (!turn || !selectedSlot) {
                return;
            }

            releaseAvailability(turn.disponibilidadId);
            occupyAvailability(selectedSlot.id_disponibilidad);
            appointments = appointments.map((item) => {
                if (item.id === turn.id) {
                    return {
                        ...item,
                        especialidad: selectedSlot.especialidad,
                        medico: selectedSlot.medico,
                        medicoId: selectedSlot.id_medico,
                        fecha: selectedSlot.fecha,
                        hora: selectedSlot.hora_inicio,
                        horaFin: selectedSlot.hora_fin,
                        disponibilidadId: selectedSlot.id_disponibilidad
                    };
                }

                return item;
            });
            persistState();
            renderAppointments();
            hideModal(modifyModal);
            showMessage("success", "Turno modificado correctamente. Se libero el horario anterior y se ocupo el nuevo horario seleccionado.");
        }

        setText("misTurnosPaciente", patientName);
        appointments = mergeStoredPatientTurns(
            LOCAL_STORAGE_KEYS.PATIENT_TURNS,
            normalizeMockAppointments(),
            medicosMock,
            currentPatientId
        );
        availability = mergeStoredAvailability(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, disponibilidadData, medicosMock);

        reservedList.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            selectedTurnId = Number.parseInt(button.dataset.turnId, 10);

            if (button.dataset.action === "cancel") {
                showModal(cancelModal);
            }

            if (button.dataset.action === "modify") {
                openModifyModal(selectedTurnId);
            }
        });

        confirmCancelButton.addEventListener("click", cancelSelectedTurn);
        confirmModifyButton.addEventListener("click", modifySelectedTurn);
        persistState();
        renderAppointments();
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
                    setFieldError("passwordActual", "Ingrese la contraseña actual.");
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
                    button.setAttribute("aria-label", isVisible ? "Mostrar contraseña" : "Ocultar contraseña");
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
        setText("turnoReservadoDuracion", appointment.triaje.duracionTurno);

        if (priorityBadge) {
            priorityBadge.textContent = `Prioridad ${appointment.triaje.colorPrioridad}`;
            priorityBadge.className = `badge align-self-start ${priorityClass(appointment.triaje.colorPrioridad)}`;
        }
    }

    await initDashboard();
    await initAppointmentRequest();
    await initPatientAppointments();
    await initPatientProfile();
    initReservedAppointment();
});
