document.addEventListener("DOMContentLoaded", async () => {
    const fallbackData = {
        usuarios: {
            usuarios: []
        },
        turnos: {
            turnos: []
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

    function writeStoredJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function clearStoredJson(key) {
        localStorage.removeItem(key);
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

    function roleMatches(user, role) {
        return String(user.rol || "").toLowerCase() === role;
    }

    function fullName(person) {
        return `${person.nombre} ${person.apellido}`;
    }

    function currentUser() {
        return readStoredJson("usuarioActualMock", null);
    }

    function currentSecretary(usuarios) {
        const loggedUser = currentUser();
        const users = usuarios.usuarios || [];

        if (loggedUser && roleMatches(loggedUser, "secretaria")) {
            return users.find((user) => user.id_secretaria === loggedUser.id_secretaria) || loggedUser;
        }

        return users.find((user) => roleMatches(user, "secretaria"))
            || usuarios.secretariaActual
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

    function patientsFromUsers(usuarios) {
        return (usuarios.usuarios || []).filter((user) => roleMatches(user, "paciente"));
    }

    function turnosList(turnos) {
        return Array.isArray(turnos.turnos) ? turnos.turnos : [];
    }

    function doctorById(usuarios, idMedico) {
        return doctorsFromUsers(usuarios).find((doctor) => doctor.id_medico === idMedico) || null;
    }

    function patientById(usuarios, idPaciente) {
        return patientsFromUsers(usuarios).find((patient) => patient.id_paciente === idPaciente) || null;
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
        const normalizedState = String(state || "").toLowerCase();

        if (normalizedState === "reservado") {
            return "text-bg-primary";
        }

        if (normalizedState === "presente") {
            return "text-bg-info";
        }

        if (normalizedState === "en atencion" || normalizedState === "en atenci\u00f3n") {
            return "text-bg-warning";
        }

        if (normalizedState === "completado") {
            return "text-bg-success";
        }

        if (normalizedState === "cancelado") {
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

    function buildAgenda(turnos, disponibilidad, usuarios) {
        const normalizedTurns = turnosList(turnos);

        if (normalizedTurns.length > 0) {
            return normalizedTurns
                .map((turno) => {
                    const patient = patientById(usuarios, turno.id_paciente);
                    const doctor = doctorById(usuarios, turno.id_medico);

                    return {
                        hora: turno.hora_inicio,
                        paciente: patient ? fullName(patient) : "Paciente",
                        medico: doctor ? fullName(doctor) : "Medico",
                        especialidad: doctor ? doctor.especialidad : turno.especialidad,
                        prioridad: turno.prioridad,
                        estado: turno.estado
                    };
                })
                .sort((a, b) => a.hora.localeCompare(b.hora));
        }

        return disponibilidad
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
    }

    function renderMetrics(agenda) {
        const metrics = {
            turnosDia: agenda.length,
            presentes: agenda.filter((turno) => turno.estado === "Presente").length,
            pendientes: agenda.filter((turno) => turno.estado === "Reservado").length,
            atencion: agenda.filter((turno) => turno.estado === "En atencion" || turno.estado === "En atención").length,
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

    function renderAlerts(turnos, disponibilidad, usuarios) {
        const normalizedTurns = turnosList(turnos);
        const alerts = [];
        const presentTurn = normalizedTurns.find((turno) => turno.estado === "Presente");
        const activeTurn = normalizedTurns.find((turno) => turno.estado === "En atencion" || turno.estado === "En atenci\u00f3n");
        const canceledTurn = normalizedTurns.find((turno) => turno.estado === "Cancelado");
        const availableSlots = disponibilidad.filter((item) => item.estado === "Disponible");

        if (presentTurn) {
            const patient = patientById(usuarios, presentTurn.id_paciente);
            alerts.push({
                type: "info",
                icon: "bi-person-check",
                text: patient
                    ? `Paciente ${fullName(patient)} se encuentra en sala de espera.`
                    : "Hay un paciente presente en sala de espera."
            });
        }

        if (activeTurn) {
            const doctor = doctorById(usuarios, activeTurn.id_medico);
            alerts.push({
                type: "warning",
                icon: "bi-clock-history",
                text: doctor
                    ? `Consulta de ${fullName(doctor)} figura en atencion.`
                    : "Hay una consulta en atencion."
            });
        }

        if (canceledTurn) {
            const doctor = doctorById(usuarios, canceledTurn.id_medico);
            alerts.push({
                type: "danger",
                icon: "bi-calendar-x",
                text: doctor
                    ? `Turno cancelado para ${doctor.especialidad}. Revisar disponibilidad para reprogramacion.`
                    : "Hay turnos cancelados pendientes de revision."
            });
        }

        if (alerts.length === 0 && availableSlots.length > 0) {
            alerts.push({
                type: "info",
                icon: "bi-calendar-check",
                text: `${availableSlots.length} bloques disponibles para asignar turnos.`
            });
        }

        if (alerts.length === 0) {
            alerts.push({
                type: "info",
                icon: "bi-info-circle",
                text: "No hay alertas operativas pendientes."
            });
        }
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
        const secretaria = currentSecretary(usuarios);
        const agenda = buildAgenda(turnos, Array.isArray(disponibilidad) ? disponibilidad : [], usuarios);

        setText("secretariaNombreNavbar", fullName(secretaria));
        setText("secretariaFechaActual", formatToday());
        renderMetrics(agenda);
        renderAgenda(agenda);
        renderAlerts(turnos, Array.isArray(disponibilidad) ? disponibilidad : [], usuarios);
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
        const secretaria = currentSecretary(usuarios);
        const doctors = doctorsFromUsers(usuarios);
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
        let availability = mergeStoredAvailability("disponibilidadSecretariaMock", disponibilidadMock, doctors);
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
            writeStoredJson("disponibilidadSecretariaMock", availability);
            writeStoredJson("disponibilidadPacienteMock", availability);
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
                ...block,
                origenInterfaz: true
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

        setText("disponibilidadSecretariaNavbar", fullName(secretaria));
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
