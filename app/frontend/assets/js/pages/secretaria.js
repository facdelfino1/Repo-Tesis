document.addEventListener("DOMContentLoaded", async () => {
    const fallbackData = {
        usuarios: {
            secretariaActual: {
                nombre: "Carla",
                apellido: "Suarez"
            },
            usuarios: [
                {
                    id: 1,
                    nombre: "Laura",
                    apellido: "Fernandez",
                    rol: "Medico",
                    especialidad: "Clinica Medica"
                },
                {
                    id: 2,
                    nombre: "Pablo",
                    apellido: "Ruiz",
                    rol: "Medico",
                    especialidad: "Cardiologia"
                },
                {
                    id: 3,
                    nombre: "Ana",
                    apellido: "Lopez",
                    rol: "Medico",
                    especialidad: "Dermatologia"
                },
                {
                    id: 4,
                    nombre: "Martin",
                    apellido: "Pereyra",
                    rol: "Medico",
                    especialidad: "Traumatologia"
                },
                {
                    id: 5,
                    nombre: "Valeria",
                    apellido: "Gomez",
                    rol: "Medico",
                    especialidad: "Clinica Medica"
                }
            ]
        },
        turnos: {
            proximoTurno: {
                especialidad: "Clinica Medica",
                medico: "Laura Fernandez",
                fecha: "2026-06-28",
                hora: "09:30",
                estado: "Reservado"
            },
            historial: []
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

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value;
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

    function formatDate(dateValue) {
        const date = new Date(`${dateValue}T00:00:00`);

        return new Intl.DateTimeFormat("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(date);
    }

    function formatToday() {
        return new Intl.DateTimeFormat("es-AR", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).format(new Date());
    }

    function stateClass(state) {
        if (state === "Reservado") {
            return "text-bg-primary";
        }

        if (state === "Presente") {
            return "text-bg-info";
        }

        if (state === "En atencion") {
            return "text-bg-warning";
        }

        if (state === "Completado") {
            return "text-bg-success";
        }

        if (state === "Cancelado") {
            return "text-bg-secondary";
        }

        return "text-bg-light";
    }

    function priorityClass(priority) {
        if (priority === "Alta") {
            return "text-bg-danger";
        }

        if (priority === "Media") {
            return "text-bg-warning";
        }

        return "text-bg-success";
    }

    function normalizeDoctorName(name) {
        return name.replace("Dra. ", "").replace("Dr. ", "");
    }

    function buildAgenda(turnos, disponibilidad) {
        const proximoTurno = turnos.proximoTurno || fallbackData.turnos.proximoTurno;
        const baseAgenda = [
            {
                hora: "08:30",
                paciente: "Juan Perez",
                medico: "Pablo Ruiz",
                especialidad: "Cardiologia",
                prioridad: "Media",
                estado: "Presente"
            },
            {
                hora: "09:00",
                paciente: "Sofia Martinez",
                medico: normalizeDoctorName(proximoTurno.medico || "Laura Fernandez"),
                especialidad: proximoTurno.especialidad || "Clinica Medica",
                prioridad: "Baja",
                estado: "Reservado"
            },
            {
                hora: "09:30",
                paciente: "Marcos Diaz",
                medico: "Ana Lopez",
                especialidad: "Dermatologia",
                prioridad: "Alta",
                estado: "En atencion"
            },
            {
                hora: "10:30",
                paciente: "Elena Rojas",
                medico: "Martin Pereyra",
                especialidad: "Traumatologia",
                prioridad: "Media",
                estado: "Completado"
            },
            {
                hora: "11:00",
                paciente: "Camila Torres",
                medico: "Valeria Gomez",
                especialidad: "Clinica Medica",
                prioridad: "Baja",
                estado: "Cancelado"
            },
            {
                hora: "12:00",
                paciente: "Roberto Molina",
                medico: "Pablo Ruiz",
                especialidad: "Cardiologia",
                prioridad: "Alta",
                estado: "En atencion"
            }
        ];

        const availableBlocks = disponibilidad
            .filter((item) => item.estado === "Disponible")
            .slice(0, 2)
            .map((item, index) => ({
                hora: item.hora_inicio,
                paciente: index === 0 ? "Turno sin asignar" : "Demanda espontanea",
                medico: item.medico,
                especialidad: item.especialidad,
                prioridad: index === 0 ? "Baja" : "Media",
                estado: "Reservado"
            }));

        return [...baseAgenda, ...availableBlocks].sort((a, b) => a.hora.localeCompare(b.hora));
    }

    function renderMetrics(agenda) {
        const metrics = {
            turnosDia: agenda.length,
            presentes: agenda.filter((turno) => turno.estado === "Presente").length,
            pendientes: agenda.filter((turno) => turno.estado === "Reservado").length,
            atencion: agenda.filter((turno) => turno.estado === "En atencion").length,
            completados: agenda.filter((turno) => turno.estado === "Completado").length,
            cancelados: agenda.filter((turno) => turno.estado === "Cancelado").length
        };

        setText("metricTurnosDia", metrics.turnosDia);
        setText("metricPresentes", metrics.presentes);
        setText("metricPendientes", metrics.pendientes);
        setText("metricAtencion", metrics.atencion);
        setText("metricCompletados", metrics.completados);
        setText("metricCancelados", metrics.cancelados);
        setText("secretariaResumenJornada", `${metrics.turnosDia} turnos programados`);
    }

    function renderAgenda(agenda) {
        const tableBody = document.getElementById("secretariaAgendaDia");

        if (!tableBody) {
            return;
        }

        tableBody.innerHTML = agenda.map((turno) => `
            <tr>
                <td class="fw-semibold">${turno.hora}</td>
                <td>${turno.paciente}</td>
                <td>${turno.medico}</td>
                <td>${turno.especialidad}</td>
                <td><span class="badge ${priorityClass(turno.prioridad)}">${turno.prioridad}</span></td>
                <td><span class="badge ${stateClass(turno.estado)}">${turno.estado}</span></td>
            </tr>
        `).join("");
    }

    function renderAlerts() {
        const alerts = [
            {
                type: "info",
                icon: "bi-person-check",
                text: "Paciente Juan Perez se encuentra en sala de espera."
            },
            {
                type: "warning",
                icon: "bi-clock-history",
                text: "Consulta del Dr. Gomez permanece abierta desde hace 1 hora y 20 minutos."
            },
            {
                type: "danger",
                icon: "bi-calendar-x",
                text: "Bloque de Cardiologia cancelado. Se requiere reprogramacion masiva."
            }
        ];
        const alertContainer = document.getElementById("secretariaAlertasOperativas");

        if (!alertContainer) {
            return;
        }

        alertContainer.innerHTML = alerts.map((alert) => `
            <div class="alert alert-${alert.type} mb-0 d-flex gap-3 align-items-start" role="alert">
                <i class="bi ${alert.icon} mt-1"></i>
                <span>${alert.text}</span>
            </div>
        `).join("");
    }

    async function initSecretaryDashboard() {
        if (!document.getElementById("secretariaAgendaDia")) {
            return;
        }

        const [usuarios, turnos, disponibilidad] = await Promise.all([
            loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios),
            loadMock("../../assets/mock/turnos.json", fallbackData.turnos),
            loadMock("../../assets/mock/disponibilidad.json", fallbackData.disponibilidad)
        ]);
        const secretaria = usuarios.secretariaActual || fallbackData.usuarios.secretariaActual;
        const agenda = buildAgenda(turnos, Array.isArray(disponibilidad) ? disponibilidad : []);

        setText("secretariaNombreNavbar", `${secretaria.nombre} ${secretaria.apellido}`);
        setText("secretariaFechaActual", formatToday());
        renderMetrics(agenda);
        renderAgenda(agenda);
        renderAlerts();
    }

    async function initSecretaryAvailability() {
        const form = document.querySelector('[data-form="secretary-availability"]');

        if (!form) {
            return;
        }

        const [usuarios, disponibilidadMock] = await Promise.all([
            loadMock("../../assets/mock/usuarios.json", fallbackData.usuarios),
            loadMock("../../assets/mock/disponibilidad.json", fallbackData.disponibilidad)
        ]);
        const secretaria = usuarios.secretariaActual || fallbackData.usuarios.secretariaActual;
        const doctors = (usuarios.usuarios || fallbackData.usuarios.usuarios)
            .filter((user) => user.rol === "Medico");
        const fields = {
            specialty: document.getElementById("disponibilidadEspecialidad"),
            doctor: document.getElementById("disponibilidadMedico"),
            date: document.getElementById("disponibilidadFecha"),
            start: document.getElementById("disponibilidadHoraInicio"),
            end: document.getElementById("disponibilidadHoraFin")
        };
        const baseSlotDuration = 20;
        const generateButton = document.getElementById("generarBloquesBtn");
        const cancelButton = document.getElementById("cancelarDisponibilidadBtn");
        const confirmExitButton = document.getElementById("confirmarSalirSinGuardarBtn");
        const exitModalElement = document.getElementById("salirSinGuardarModal");
        const exitModal = exitModalElement && window.bootstrap
            ? new bootstrap.Modal(exitModalElement)
            : null;
        const preview = document.getElementById("bloquesPreview");
        const emptyPreview = document.getElementById("bloquesVacio");
        const tableBody = document.getElementById("disponibilidadTabla");
        const message = document.getElementById("disponibilidadMensaje");
        let availability = readStoredJson("disponibilidadSecretariaMock", disponibilidadMock);
        let generatedBlocks = [];

        function doctorFullName(doctor) {
            return `${doctor.nombre} ${doctor.apellido}`;
        }

        function setFieldError(field, text) {
            const input = fields[field];
            const errorIds = {
                specialty: "disponibilidadEspecialidadError",
                doctor: "disponibilidadMedicoError",
                date: "disponibilidadFechaError",
                start: "disponibilidadHoraInicioError",
                end: "disponibilidadHoraFinError"
            };
            const errorId = errorIds[field];
            const error = document.getElementById(errorId);

            if (!input || !error) {
                return;
            }

            input.classList.toggle("is-invalid", text !== "");
            error.textContent = text;
        }

        function clearErrors() {
            Object.keys(fields).forEach((field) => setFieldError(field, ""));
            message.classList.add("d-none");
        }

        function showMessage(type, text) {
            message.className = `alert alert-${type}`;
            message.textContent = text;
            message.classList.remove("d-none");
        }

        function timeToMinutes(timeValue) {
            const [hours, minutes] = timeValue.split(":").map(Number);
            return hours * 60 + minutes;
        }

        function minutesToTime(totalMinutes) {
            const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
            const minutes = (totalMinutes % 60).toString().padStart(2, "0");
            return `${hours}:${minutes}`;
        }

        function selectedDoctor() {
            const doctorId = Number.parseInt(fields.doctor.value, 10);
            return doctors.find((doctor) => doctor.id === doctorId) || null;
        }

        function currentAvailabilityFilter() {
            const doctor = selectedDoctor();

            if (doctor) {
                return {
                    type: "doctor",
                    value: String(doctor.id)
                };
            }

            if (fields.specialty.value !== "") {
                return {
                    type: "specialty",
                    value: fields.specialty.value
                };
            }

            return null;
        }

        function renderSpecialties() {
            const specialties = [...new Set(doctors.map((doctor) => doctor.especialidad))].sort();
            fields.specialty.innerHTML = '<option value="">Seleccione una especialidad</option>';
            specialties.forEach((specialty) => {
                const option = document.createElement("option");
                option.value = specialty;
                option.textContent = specialty;
                fields.specialty.appendChild(option);
            });
        }

        function renderDoctors(specialty = "") {
            const filteredDoctors = specialty === ""
                ? doctors
                : doctors.filter((doctor) => doctor.especialidad === specialty);
            fields.doctor.innerHTML = '<option value="">Seleccione un medico</option>';
            filteredDoctors.forEach((doctor) => {
                const option = document.createElement("option");
                option.value = String(doctor.id);
                option.textContent = `${doctorFullName(doctor)} - ${doctor.especialidad}`;
                fields.doctor.appendChild(option);
            });
        }

        function validateForm() {
            let isValid = true;
            clearErrors();

            if (fields.specialty.value === "" && !selectedDoctor()) {
                setFieldError("specialty", "Seleccione una especialidad o un medico.");
                setFieldError("doctor", "Seleccione una especialidad o un medico.");
                isValid = false;
            }

            if (fields.date.value === "") {
                setFieldError("date", "La fecha es obligatoria.");
                isValid = false;
            }

            if (fields.start.value === "") {
                setFieldError("start", "La hora de inicio es obligatoria.");
                isValid = false;
            }

            if (fields.end.value === "") {
                setFieldError("end", "La hora de finalizacion es obligatoria.");
                isValid = false;
            }

            if (fields.start.value !== "" && fields.end.value !== ""
                && timeToMinutes(fields.start.value) >= timeToMinutes(fields.end.value)) {
                setFieldError("start", "La hora de inicio debe ser menor que la hora de finalizacion.");
                setFieldError("end", "Revise el rango horario.");
                isValid = false;
            }

            if (fields.start.value !== "" && fields.end.value !== ""
                && timeToMinutes(fields.end.value) - timeToMinutes(fields.start.value) < baseSlotDuration) {
                setFieldError("end", "El rango horario debe permitir al menos un bloque de 20 minutos.");
                isValid = false;
            }

            return isValid;
        }

        function renderPreview() {
            emptyPreview.classList.toggle("d-none", generatedBlocks.length > 0);
            preview.innerHTML = generatedBlocks.map((block) => `
                <div class="col-12 col-sm-6 col-xl-3">
                    <div class="metric-box rounded-3 p-3 h-100">
                        <p class="text-secondary small mb-1">${formatDate(block.fecha)}</p>
                        <p class="fw-semibold mb-0">${block.hora_inicio} - ${block.hora_fin}</p>
                    </div>
                </div>
            `).join("");
        }

        function generateBlocks() {
            if (!validateForm()) {
                generatedBlocks = [];
                renderPreview();
                return;
            }

            const doctor = selectedDoctor();

            generatedBlocks = buildAvailabilityBlocks({
                doctorId: doctor ? doctor.id : null,
                doctorName: doctor ? doctorFullName(doctor) : "Sin medico asignado",
                specialty: doctor ? doctor.especialidad : fields.specialty.value,
                date: fields.date.value,
                start: fields.start.value,
                end: fields.end.value,
                origin: "Secretaria"
            });
            renderPreview();
        }

        function buildAvailabilityBlocks({ doctorId, doctorName, specialty, date, start, end, origin }) {
            const startMinutes = timeToMinutes(start);
            const endMinutes = timeToMinutes(end);
            const blocks = [];

            for (let current = startMinutes; current + baseSlotDuration <= endMinutes; current += baseSlotDuration) {
                blocks.push({
                    id_medico: doctorId,
                    medico: doctorName,
                    especialidad: specialty,
                    fecha: date,
                    hora_inicio: minutesToTime(current),
                    hora_fin: minutesToTime(current + baseSlotDuration),
                    duracion_turno: baseSlotDuration,
                    estado: "Disponible",
                    origen: origin || "Secretaria"
                });
            }

            return blocks;
        }

        function renderAvailabilityTable() {
            const filter = currentAvailabilityFilter();

            if (!filter) {
                tableBody.innerHTML = '<tr><td colspan="7" class="text-secondary">Seleccione un m&eacute;dico o una especialidad para consultar la disponibilidad cargada.</td></tr>';
                return;
            }

            const filteredAvailability = availability.filter((item) => {
                if (filter.type === "doctor") {
                    return String(item.id_medico) === filter.value;
                }

                return item.especialidad === filter.value;
            });

            if (filteredAvailability.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="7" class="text-secondary">No existen horarios cargados para el criterio seleccionado.</td></tr>';
                return;
            }

            tableBody.innerHTML = filteredAvailability.map((item) => {
                const stateClassName = item.estado === "Disponible" ? "text-bg-success" : "text-bg-secondary";

                return `
                    <tr>
                        <td>${item.medico}</td>
                        <td>${item.especialidad}</td>
                        <td>${formatDate(item.fecha)}</td>
                        <td>${item.hora_inicio}</td>
                        <td>${item.hora_fin}</td>
                        <td><span class="badge ${stateClassName}">${item.estado}</span></td>
                        <td>${item.origen || "Mock"}</td>
                    </tr>
                `;
            }).join("");
        }

        function persistAvailability() {
            localStorage.setItem("disponibilidadSecretariaMock", JSON.stringify(availability));
            localStorage.setItem("disponibilidadPacienteMock", JSON.stringify(availability));
        }

        function saveAvailability(event) {
            event.preventDefault();

            if (generatedBlocks.length === 0) {
                showMessage("danger", "Debe generar bloques antes de guardar la disponibilidad.");
                return;
            }

            const maxId = availability.reduce((maxValue, item) => Math.max(maxValue, Number(item.id_disponibilidad) || 0), 0);
            const blocksToSave = generatedBlocks.map((block, index) => ({
                id_disponibilidad: maxId + index + 1,
                ...block
            }));

            availability = [...availability, ...blocksToSave];
            persistAvailability();
            generatedBlocks = [];
            fields.date.value = "";
            fields.start.value = "";
            fields.end.value = "";
            renderPreview();
            renderAvailabilityTable();
            showMessage("success", "Disponibilidad medica cargada correctamente.");
        }

        function clearTemporaryAvailabilityData() {
            generatedBlocks = [];
            form.reset();
            renderDoctors();
            renderPreview();
            renderAvailabilityTable();
            sessionStorage.removeItem("disponibilidadSecretariaTemporal");
        }

        setText("disponibilidadSecretariaNavbar", `${secretaria.nombre} ${secretaria.apellido}`);
        renderSpecialties();
        renderDoctors();
        renderPreview();
        renderAvailabilityTable();

        fields.specialty.addEventListener("change", () => {
            fields.doctor.value = "";
            renderDoctors(fields.specialty.value);
            generatedBlocks = [];
            renderPreview();
            renderAvailabilityTable();
        });

        fields.doctor.addEventListener("change", () => {
            const doctor = selectedDoctor();

            if (doctor) {
                fields.specialty.value = doctor.especialidad;
                renderDoctors(doctor.especialidad);
                fields.doctor.value = String(doctor.id);
            }

            generatedBlocks = [];
            renderPreview();
            renderAvailabilityTable();
        });

        [fields.date, fields.start, fields.end].forEach((field) => {
            field.addEventListener("input", () => {
                generatedBlocks = [];
                renderPreview();
            });
        });

        generateButton.addEventListener("click", generateBlocks);
        cancelButton.addEventListener("click", () => {
            if (exitModal) {
                exitModal.show();
                return;
            }

            clearTemporaryAvailabilityData();
            window.location.href = "dashboard.html";
        });
        confirmExitButton.addEventListener("click", () => {
            clearTemporaryAvailabilityData();
            window.location.href = "dashboard.html";
        });
        form.addEventListener("submit", saveAvailability);
    }

    await initSecretaryDashboard();
    await initSecretaryAvailability();
});
