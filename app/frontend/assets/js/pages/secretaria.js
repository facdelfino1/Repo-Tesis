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
        if (priority === "Rojo") {
            return "text-bg-danger";
        }

        if (priority === "Amarillo") {
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
                prioridad: "Amarillo",
                estado: "Presente"
            },
            {
                hora: "09:00",
                paciente: "Sofia Martinez",
                medico: normalizeDoctorName(proximoTurno.medico || "Laura Fernandez"),
                especialidad: proximoTurno.especialidad || "Clinica Medica",
                prioridad: "Verde",
                estado: "Reservado"
            },
            {
                hora: "09:30",
                paciente: "Marcos Diaz",
                medico: "Ana Lopez",
                especialidad: "Dermatologia",
                prioridad: "Rojo",
                estado: "En atencion"
            },
            {
                hora: "10:30",
                paciente: "Elena Rojas",
                medico: "Martin Pereyra",
                especialidad: "Traumatologia",
                prioridad: "Amarillo",
                estado: "Completado"
            },
            {
                hora: "11:00",
                paciente: "Camila Torres",
                medico: "Valeria Gomez",
                especialidad: "Clinica Medica",
                prioridad: "Verde",
                estado: "Cancelado"
            },
            {
                hora: "12:00",
                paciente: "Roberto Molina",
                medico: "Pablo Ruiz",
                especialidad: "Cardiologia",
                prioridad: "Rojo",
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
                prioridad: index === 0 ? "Verde" : "Amarillo",
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
            end: document.getElementById("disponibilidadHoraFin"),
            duration: document.getElementById("disponibilidadDuracion")
        };
        const generateButton = document.getElementById("generarBloquesBtn");
        const preview = document.getElementById("bloquesPreview");
        const emptyPreview = document.getElementById("bloquesVacio");
        const tableBody = document.getElementById("disponibilidadTabla");
        const message = document.getElementById("disponibilidadMensaje");
        const blockedWarning = document.getElementById("disponibilidadBloqueoWarning");
        const editBadge = document.getElementById("modoEdicionDisponibilidad");
        let availability = readStoredJson("disponibilidadSecretariaMock", disponibilidadMock);
        let generatedBlocks = [];
        let editingAvailabilityId = null;

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
                end: "disponibilidadHoraFinError",
                duration: "disponibilidadDuracionError"
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
            blockedWarning.classList.add("d-none");
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

            if (fields.specialty.value === "") {
                setFieldError("specialty", "Seleccione una especialidad.");
                isValid = false;
            }

            if (!selectedDoctor()) {
                setFieldError("doctor", "Seleccione un medico.");
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

            if (fields.duration.value === "") {
                setFieldError("duration", "Seleccione una duracion por consulta.");
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
            const start = timeToMinutes(fields.start.value);
            const end = timeToMinutes(fields.end.value);
            const duration = Number.parseInt(fields.duration.value, 10);
            const blocks = [];

            for (let current = start; current + duration <= end; current += duration) {
                blocks.push({
                    id_medico: doctor.id,
                    medico: doctorFullName(doctor),
                    especialidad: doctor.especialidad,
                    fecha: fields.date.value,
                    hora_inicio: minutesToTime(current),
                    hora_fin: minutesToTime(current + duration),
                    duracion_turno: duration,
                    estado: "Disponible",
                    origen: "Secretaria"
                });
            }

            generatedBlocks = blocks;
            renderPreview();
        }

        function hasReservedTurn(item) {
            if (item.estado === "Ocupado" || item.estado === "Reservado") {
                return true;
            }

            const patientTurns = readStoredJson("turnosPacienteMock", []);
            return patientTurns.some((turn) => String(turn.disponibilidadId) === String(item.id_disponibilidad)
                && (turn.estado === "Reservado" || turn.estado === "Pendiente"));
        }

        function renderAvailabilityTable() {
            if (availability.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="8" class="text-secondary">No hay disponibilidad cargada.</td></tr>';
                return;
            }

            tableBody.innerHTML = availability.map((item) => {
                const blocked = hasReservedTurn(item);
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
                        <td class="text-end">
                            <div class="btn-group btn-group-sm" role="group">
                                <button type="button" class="btn btn-outline-primary" data-action="edit" data-id="${item.id_disponibilidad}" ${blocked ? "data-blocked=\"true\"" : ""}>
                                    <i class="bi bi-pencil-square"></i>
                                </button>
                                <button type="button" class="btn btn-outline-danger" data-action="delete" data-id="${item.id_disponibilidad}" ${blocked ? "data-blocked=\"true\"" : ""}>
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </td>
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

            if (editingAvailabilityId !== null) {
                availability = availability.filter((item) => String(item.id_disponibilidad) !== String(editingAvailabilityId));
            }

            const maxId = availability.reduce((maxValue, item) => Math.max(maxValue, Number(item.id_disponibilidad) || 0), 0);
            const blocksToSave = generatedBlocks.map((block, index) => ({
                id_disponibilidad: maxId + index + 1,
                ...block
            }));

            availability = [...availability, ...blocksToSave];
            persistAvailability();
            generatedBlocks = [];
            editingAvailabilityId = null;
            form.reset();
            renderDoctors();
            renderPreview();
            renderAvailabilityTable();
            editBadge.classList.add("d-none");
            showMessage("success", "Disponibilidad medica cargada correctamente.");
        }

        function showBlockedWarning() {
            blockedWarning.classList.remove("d-none");
            blockedWarning.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        function editAvailability(id) {
            const item = availability.find((availabilityItem) => String(availabilityItem.id_disponibilidad) === String(id));

            if (!item) {
                return;
            }

            editingAvailabilityId = item.id_disponibilidad;
            fields.specialty.value = item.especialidad;
            renderDoctors(item.especialidad);
            fields.doctor.value = String(item.id_medico);
            fields.date.value = item.fecha;
            fields.start.value = item.hora_inicio;
            fields.end.value = item.hora_fin;
            fields.duration.value = String(item.duracion_turno || 30);
            generatedBlocks = [];
            renderPreview();
            editBadge.classList.remove("d-none");
            showMessage("info", "Modifique los datos, genere nuevos bloques y guarde para reemplazar esta disponibilidad.");
        }

        function deleteAvailability(id) {
            availability = availability.filter((item) => String(item.id_disponibilidad) !== String(id));
            persistAvailability();
            renderAvailabilityTable();
            showMessage("success", "Disponibilidad eliminada correctamente.");
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
        });

        [fields.date, fields.start, fields.end, fields.duration].forEach((field) => {
            field.addEventListener("input", () => {
                generatedBlocks = [];
                renderPreview();
            });
        });

        generateButton.addEventListener("click", generateBlocks);
        form.addEventListener("submit", saveAvailability);
        tableBody.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            if (button.dataset.blocked === "true") {
                showBlockedWarning();
                return;
            }

            if (button.dataset.action === "edit") {
                editAvailability(button.dataset.id);
            }

            if (button.dataset.action === "delete") {
                deleteAvailability(button.dataset.id);
            }
        });
    }

    await initSecretaryDashboard();
    await initSecretaryAvailability();
});
