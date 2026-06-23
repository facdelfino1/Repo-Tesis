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
        }
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
        const triajeSection = document.getElementById("triajeSection");
        const seleccionError = document.getElementById("seleccionTurnoError");
        const triajeError = document.getElementById("triajeError");
        const rangoDolor = document.getElementById("rangoDolor");
        const resultBox = document.getElementById("triajeResultado");
        const resultColor = document.getElementById("resultadoColor");
        let lastResult = null;
        const medicosData = await loadMock("../../assets/mock/medicos.json", fallbackData.medicos);
        const medicosMock = medicosData.medicos;

        function createDoctorOption(value, label) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            return option;
        }

        function doctorFullName(doctor) {
            return `${doctor.nombre} ${doctor.apellido}`;
        }

        function renderDoctorsBySpecialty(specialty) {
            medico.replaceChildren();
            medico.appendChild(createDoctorOption("", "Seleccione un medico"));

            const filteredDoctors = specialty === ""
                ? medicosMock
                : medicosMock.filter((doctor) => doctor.especialidad === specialty);
            medico.disabled = false;

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

        function showTriageIfReady(showSelectionError = false) {
            const shouldShow = hasAppointmentSelection();
            triajeSection.classList.toggle("d-none", !shouldShow);
            seleccionError.classList.toggle("d-none", shouldShow || !showSelectionError);
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

        function clearResult() {
            lastResult = null;
            resultBox.classList.add("d-none");
            resultBox.classList.remove("triage-result-success", "triage-result-warning", "triage-result-danger");
        }

        function renderResult(result) {
            lastResult = result;
            resultBox.classList.remove("d-none", "triage-result-success", "triage-result-warning", "triage-result-danger");
            resultBox.classList.add(borderPriorityClass(result.color));

            resultColor.textContent = result.color;
            resultColor.className = `badge ${priorityClass(result.color)}`;
            setText("resultadoPuntaje", result.puntaje);
            setText("resultadoDuracion", result.duracionTurno);
        }

        function updatePreview() {
            showTriageIfReady();
            triajeError.classList.add("d-none");

            if (!hasAppointmentSelection()) {
                clearResult();
                return;
            }

            const answers = readAnswers();

            if (!isTriageComplete(answers)) {
                clearResult();
                return;
            }

            renderResult(calculateTriage(answers));
        }

        rangoDolor.addEventListener("input", updatePreview);
        especialidad.addEventListener("change", () => {
            medico.value = "";
            renderDoctorsBySpecialty(especialidad.value);
            updatePreview();
        });
        medico.addEventListener("change", () => {
            const doctor = selectedDoctor();

            if (doctor && especialidad.value !== doctor.especialidad) {
                especialidad.value = doctor.especialidad;
                renderDoctorsBySpecialty(doctor.especialidad);
                medico.value = String(doctor.id);
            }

            updatePreview();
        });
        form.querySelectorAll('input[type="radio"]').forEach((radio) => {
            radio.addEventListener("change", updatePreview);
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            showTriageIfReady(true);

            if (!hasAppointmentSelection()) {
                clearResult();
                return;
            }

            const answers = readAnswers();

            if (!isTriageComplete(answers)) {
                triajeError.classList.remove("d-none");
                clearResult();
                return;
            }

            const result = lastResult || calculateTriage(answers);
            const doctor = selectedDoctor();
            const appointmentRequest = {
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
                estado: "Pendiente de confirmacion",
                fechaSolicitud: new Date().toISOString()
            };

            sessionStorage.setItem("solicitudTurnoPaciente", JSON.stringify(appointmentRequest));
            window.location.href = "resultado-triaje.html";
        });

        renderDoctorsBySpecialty(especialidad.value);
        showTriageIfReady();
    }

    await initDashboard();
    await initAppointmentRequest();
});
