document.addEventListener("DOMContentLoaded", async () => {
    const fallbackData = {
        usuarios: {
            pacienteActual: {
                nombre: "Sofia",
                apellido: "Martinez"
            }
        },
        turnos: {
            proximoTurno: {
                especialidad: "Clinica Medica",
                medico: "Dra. Laura Fernandez",
                fecha: "2026-06-28",
                hora: "09:30",
                estado: "Confirmado",
                esperaEstimada: "18 minutos",
                duracionEstimada: "25 minutos"
            },
            historial: [
                {
                    fecha: "2026-05-21",
                    especialidad: "Cardiologia",
                    medico: "Dr. Pablo Ruiz",
                    estado: "Atendido"
                },
                {
                    fecha: "2026-04-12",
                    especialidad: "Clinica Medica",
                    medico: "Dra. Laura Fernandez",
                    estado: "Atendido"
                },
                {
                    fecha: "2026-03-18",
                    especialidad: "Dermatologia",
                    medico: "Dra. Ana Lopez",
                    estado: "Cancelado"
                }
            ]
        },
        triaje: {
            ultimoTriaje: {
                prioridad: "Media",
                color: "Amarillo",
                puntaje: 62,
                recomendacion: "Mantener el turno asignado y consultar antes si aparecen sintomas de alarma."
            }
        },
        medicos: {
            medicos: [
                {
                    id: 1,
                    nombre: "Laura",
                    apellido: "Fernandez",
                    especialidad: "Clinica Medica"
                },
                {
                    id: 2,
                    nombre: "Pablo",
                    apellido: "Ruiz",
                    especialidad: "Cardiologia"
                },
                {
                    id: 3,
                    nombre: "Ana",
                    apellido: "Lopez",
                    especialidad: "Dermatologia"
                },
                {
                    id: 4,
                    nombre: "Martin",
                    apellido: "Pereyra",
                    especialidad: "Traumatologia"
                },
                {
                    id: 5,
                    nombre: "Valeria",
                    apellido: "Gomez",
                    especialidad: "Clinica Medica"
                }
            ]
        },
        disponibilidad: [
            {
                id_disponibilidad: 1,
                id_medico: 1,
                medico: "Laura Fernandez",
                especialidad: "Clinica Medica",
                fecha: "2026-06-24",
                hora_inicio: "09:00",
                hora_fin: "09:30",
                estado: "Disponible",
                tipo: "Turno"
            },
            {
                id_disponibilidad: 2,
                id_medico: 2,
                medico: "Pablo Ruiz",
                especialidad: "Cardiologia",
                fecha: "2026-06-24",
                hora_inicio: "10:30",
                hora_fin: "11:00",
                estado: "Disponible",
                tipo: "Turno"
            },
            {
                id_disponibilidad: 3,
                id_medico: 3,
                medico: "Ana Lopez",
                especialidad: "Dermatologia",
                fecha: "2026-06-25",
                hora_inicio: "14:00",
                hora_fin: "14:30",
                estado: "Disponible",
                tipo: "Turno"
            }
        ]
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

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
    }

    function formatDate(dateValue) {
        const date = new Date(`${dateValue}T00:00:00`);

        return new Intl.DateTimeFormat("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(date);
    }

    function priorityClass(priority) {
        const normalizedPriority = priority.toLowerCase();

        if (normalizedPriority === "alta" || normalizedPriority === "rojo") {
            return "text-bg-danger";
        }

        if (normalizedPriority === "media" || normalizedPriority === "amarillo") {
            return "text-bg-warning";
        }
        
        if (normalizedPriority === "baja" || normalizedPriority === "verde") {
            return "text-bg-success";
        }

        return "text-bg-success";
    }

    function borderPriorityClass(priorityColor) {
        const normalizedPriority = priorityColor.toLowerCase();

        if (normalizedPriority === "rojo") {
            return "triage-result-danger";
        }

        if (normalizedPriority === "amarillo") {
            return "triage-result-warning";
        }

        return "triage-result-success";
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
                <td><span class="badge ${turno.estado === "Cancelado" ? "text-bg-secondary" : "text-bg-success"}">${turno.estado}</span></td>
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

    function stateClass(state) {
        const normalizedState = state.toLowerCase();

        if (normalizedState === "reservado" || normalizedState === "completado") {
            return "text-bg-success";
        }

        if (normalizedState === "pendiente") {
            return "text-bg-warning";
        }

        if (normalizedState === "cancelado") {
            return "text-bg-secondary";
        }

        if (normalizedState === "ausente") {
            return "text-bg-danger";
        }

        return "text-bg-primary";
    }

    async function initDashboard() {
        if (!document.getElementById("historialTurnos")) {
            return;
        }

        const [usuarios, turnos, triaje] = await Promise.all([
            loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios),
            loadMock("../../assets/mock/turnos.json", fallbackData.turnos),
            loadMock("../../assets/mock/triaje.json", fallbackData.triaje)
        ]);

        const paciente = usuarios.pacienteActual;
        const proximoTurno = turnos.proximoTurno;
        const ultimoTriaje = triaje.ultimoTriaje;
        const nombreCompleto = `${paciente.nombre} ${paciente.apellido}`;

        setText("pacienteNavbar", nombreCompleto);
        setText("pacienteNombre", paciente.nombre);
        setText("heroProximoTurno", `${formatDate(proximoTurno.fecha)} - ${proximoTurno.hora}`);

        setText("turnoEspecialidad", proximoTurno.especialidad);
        setText("turnoMedico", proximoTurno.medico);
        setText("turnoFecha", formatDate(proximoTurno.fecha));
        setText("turnoHora", proximoTurno.hora);
        setText("turnoEstado", proximoTurno.estado);

        setText("triajePrioridad", `${ultimoTriaje.prioridad} (${ultimoTriaje.color})`);
        setText("triajePuntaje", ultimoTriaje.puntaje);
        setText("triajeRecomendacion", ultimoTriaje.recomendacion);

        const priorityBadge = document.getElementById("triajePrioridad");

        if (priorityBadge) {
            priorityBadge.className = `badge ${priorityClass(ultimoTriaje.prioridad)}`;
        }

        setText("esperaEstimada", proximoTurno.esperaEstimada);
        setText("duracionEstimada", proximoTurno.duracionEstimada);

        renderHistory(turnos.historial);
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
        const cancelRequestModal = new bootstrap.Modal(cancelRequestModalElement);
        let lastRequest = null;
        let selectedAvailability = null;

        const [medicosData, disponibilidadData] = await Promise.all([
            loadMock("../../assets/mock/medicos.json", fallbackData.medicos),
            loadMock("../../assets/mock/disponibilidad.json", fallbackData.disponibilidad)
        ]);
        const medicosMock = medicosData.medicos;
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

            return [buildOverbooking(result, selectedDoctor(), request.especialidad), ...ordered];
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

            sessionStorage.setItem("solicitudTurnoPaciente", JSON.stringify(lastRequest));
            sessionStorage.setItem("turnoReservadoPaciente", JSON.stringify(reservedAppointment));

            const storedTurns = readStoredJson("turnosPacienteMock", []);
            const storedAvailability = readStoredJson("disponibilidadPacienteMock", disponibilidadMock);
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
                pacienteId: 1,
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
                disponibilidadId: reservedAppointment.disponibilidadId
            };

            localStorage.setItem("turnosPacienteMock", JSON.stringify([...storedTurns, patientTurn]));
            localStorage.setItem("disponibilidadPacienteMock", JSON.stringify(updatedAvailability));
            window.location.href = "turno-reservado.html";
        }

        function exitAppointmentRequest() {
            sessionStorage.removeItem("solicitudTurnoPaciente");
            sessionStorage.removeItem("turnoReservadoPaciente");
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
                cancelRequestModal.show();
            });
        });
        confirmExitRequestButton.addEventListener("click", exitAppointmentRequest);
        confirmarTurnoBtn.addEventListener("click", confirmAppointment);
        renderDoctorsBySpecialty(especialidad.value);
    }

    async function initPatientAppointments() {
        const reservedList = document.getElementById("turnosReservadosLista");
        const historyTable = document.getElementById("historialPacienteTabla");

        if (!reservedList || !historyTable) {
            return;
        }

        const [usuarios, turnosMock, disponibilidadData] = await Promise.all([
            loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios),
            loadMock("../../assets/mock/turnos.json", fallbackData.turnos),
            loadMock("../../assets/mock/disponibilidad.json", fallbackData.disponibilidad)
        ]);
        const currentPatient = usuarios.pacienteActual;
        const currentPatientId = currentPatient.id || 1;
        const patientName = `${currentPatient.nombre} ${currentPatient.apellido}`;
        const reservedEmpty = document.getElementById("turnosReservadosVacio");
        const historyEmpty = document.getElementById("historialPacienteVacio");
        const message = document.getElementById("misTurnosMensaje");
        const cancelModalElement = document.getElementById("cancelarTurnoModal");
        const modifyModalElement = document.getElementById("modificarTurnoModal");
        const cancelModal = new bootstrap.Modal(cancelModalElement);
        const modifyModal = new bootstrap.Modal(modifyModalElement);
        const confirmCancelButton = document.getElementById("confirmarCancelacionBtn");
        const confirmModifyButton = document.getElementById("confirmarModificacionBtn");
        const modifyList = document.getElementById("modificarDisponibilidadLista");
        const modifyError = document.getElementById("modificarTurnoError");
        let selectedTurnId = null;
        let selectedAvailabilityId = null;
        let appointments = [];
        let availability = [];

        function normalizeMockAppointments() {
            const nextTurn = turnosMock.proximoTurno;
            const history = turnosMock.historial || [];

            return [
                {
                    id: nextTurn.id || 101,
                    pacienteId: currentPatientId,
                    especialidad: nextTurn.especialidad,
                    medico: nextTurn.medico.replace("Dra. ", "").replace("Dr. ", ""),
                    medicoId: 1,
                    fecha: nextTurn.fecha,
                    hora: nextTurn.hora,
                    horaFin: "10:00",
                    estado: "Reservado",
                    prioridad: "Amarillo",
                    puntaje: 6,
                    tiempoEstimado: nextTurn.duracionEstimada || "25 minutos",
                    disponibilidadId: 9
                },
                {
                    id: 102,
                    pacienteId: currentPatientId,
                    especialidad: "Cardiologia",
                    medico: "Pablo Ruiz",
                    medicoId: 2,
                    fecha: "2026-06-23",
                    hora: "23:30",
                    horaFin: "00:00",
                    estado: "Pendiente",
                    prioridad: "Verde",
                    puntaje: 3,
                    tiempoEstimado: "20 minutos",
                    disponibilidadId: 10
                },
                ...history.map((turno, index) => ({
                    id: turno.id || 200 + index,
                    pacienteId: currentPatientId,
                    especialidad: turno.especialidad,
                    medico: turno.medico.replace("Dra. ", "").replace("Dr. ", ""),
                    medicoId: null,
                    fecha: turno.fecha,
                    hora: index === 0 ? "10:00" : index === 1 ? "09:00" : "16:00",
                    horaFin: index === 0 ? "10:30" : index === 1 ? "09:30" : "16:30",
                    estado: turno.estado === "Atendido" ? "Completado" : turno.estado,
                    prioridad: index === 0 ? "Amarillo" : index === 1 ? "Verde" : "Rojo",
                    puntaje: index === 0 ? 6 : index === 1 ? 2 : 10,
                    tiempoEstimado: index === 0 ? "30 minutos" : index === 1 ? "20 minutos" : "40 minutos",
                    disponibilidadId: null
                }))
            ];
        }

        function persistState() {
            localStorage.setItem("turnosPacienteMock", JSON.stringify(appointments));
            localStorage.setItem("disponibilidadPacienteMock", JSON.stringify(availability));
        }

        function showMessage(type, text) {
            message.className = `alert alert-${type}`;
            message.textContent = text;
            message.classList.remove("d-none");
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
                                <span class="badge align-self-start ${stateClass(turn.estado)}">${turn.estado}</span>
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
                    <td><span class="badge ${stateClass(turn.estado)}">${turn.estado}</span></td>
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
                cancelModal.hide();
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
            cancelModal.hide();
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
            modifyModal.show();
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
            modifyModal.hide();
            showMessage("success", "Turno modificado correctamente. Se libero el horario anterior y se ocupo el nuevo horario seleccionado.");
        }

        setText("misTurnosPaciente", patientName);
        appointments = readStoredJson("turnosPacienteMock", normalizeMockAppointments());
        availability = readStoredJson("disponibilidadPacienteMock", disponibilidadData);

        reservedList.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            selectedTurnId = Number.parseInt(button.dataset.turnId, 10);

            if (button.dataset.action === "cancel") {
                cancelModal.show();
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

        const usuarios = await loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios);
        const mockPatient = usuarios.pacienteActual;
        const storedPatient = readStoredJson("perfilPacienteMock", mockPatient);
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
            fields.obraSocial.value = patient.obraSocial || "";
            fields.passwordActual.value = "";
            fields.passwordNueva.value = "";
            fields.passwordConfirmar.value = "";
            setText("perfilPacienteNavbar", fullName(patient));
        }

        function setFieldError(fieldName, text) {
            const field = fields[fieldName];
            const error = document.getElementById(`perfil${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}Error`);

            if (!field || !error) {
                return;
            }

            field.classList.toggle("is-invalid", text !== "");
            error.textContent = text;
        }

        function clearErrors() {
            Object.keys(fields).forEach((fieldName) => setFieldError(fieldName, ""));
            message.classList.add("d-none");
        }

        function isValidEmail(value) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        }

        function isStrongPassword(value) {
            return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(value);
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
                    setFieldError("passwordActual", "Ingrese la contrasena actual.");
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

        function showSuccess() {
            message.className = "alert alert-success";
            message.textContent = "Perfil actualizado correctamente.";
            message.classList.remove("d-none");
        }

        function initPasswordToggles() {
            form.querySelectorAll('[data-action="toggle-password"]').forEach((button) => {
                button.addEventListener("click", () => {
                    const input = document.getElementById(button.dataset.target);
                    const icon = button.querySelector("i");
                    const isVisible = input.type === "text";

                    input.type = isVisible ? "password" : "text";
                    icon.className = isVisible ? "bi bi-eye" : "bi bi-eye-slash";
                    button.setAttribute("aria-label", isVisible ? "Mostrar contrasena" : "Ocultar contrasena");
                });
            });
        }

        fillForm(storedPatient);
        initPasswordToggles();

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            if (!validateProfile()) {
                return;
            }

            const updatedPatient = {
                ...storedPatient,
                id: mockPatient.id || storedPatient.id || 1,
                nombre: fields.nombre.value.trim(),
                apellido: fields.apellido.value.trim(),
                dni: fields.dni.value.trim(),
                email: fields.email.value.trim(),
                telefono: fields.telefono.value.trim(),
                obraSocial: fields.obraSocial.value.trim()
            };

            if (fields.passwordNueva.value !== "") {
                updatedPatient.passwordActualizada = true;
            }

            localStorage.setItem("perfilPacienteMock", JSON.stringify(updatedPatient));
            fillForm(updatedPatient);
            clearErrors();
            showSuccess();
        });

        form.addEventListener("reset", () => {
            fillForm(readStoredJson("perfilPacienteMock", mockPatient));
            clearErrors();
        });
    }

    function initReservedAppointment() {
        const detail = document.getElementById("turnoReservadoDetalle");
        const emptyState = document.getElementById("turnoReservadoVacio");

        if (!detail || !emptyState) {
            return;
        }

        const storedAppointment = sessionStorage.getItem("turnoReservadoPaciente");

        if (!storedAppointment) {
            emptyState.classList.remove("d-none");
            return;
        }

        const appointment = JSON.parse(storedAppointment);
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
