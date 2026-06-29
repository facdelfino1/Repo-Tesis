const coreModuleBaseUrl = new URL("../core/", document.currentScript.src).href;

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
        triaje: {
            triajes: []
        },
        disponibilidad: []
    };

    const [
        { LOCAL_STORAGE_KEYS, MOCK_PATHS, SESSION_STORAGE_KEYS },
        { clearStoredJson, loadMock, readStoredJson, writeStoredJson },
        { removeSessionItem },
        { escapeHtml, normalizeState, normalizeText },
        { currentTimeValue, formatDate, formatToday, priorityLabel, priorityRank, todayInputValue },
        { isStrongPassword, isValidEmail }
    ] = await Promise.all([
        import(`${coreModuleBaseUrl}constants.js`),
        import(`${coreModuleBaseUrl}storage.js`),
        import(`${coreModuleBaseUrl}session.js`),
        import(`${coreModuleBaseUrl}helpers.js`),
        import(`${coreModuleBaseUrl}formatters.js`),
        import(`${coreModuleBaseUrl}validators.js`)
    ]);

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
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
        return readStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, null);
    }

    function currentSecretary(usuarios) {
        const loggedUser = currentUser();
        const users = usuarios.usuarios || [];
        const storedSecretary = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_PROFILE, null);
        let secretary = null;

        if (loggedUser && roleMatches(loggedUser, "secretaria")) {
            secretary = users.find((user) => user.id_secretaria === loggedUser.id_secretaria) || loggedUser;
        } else {
            secretary = users.find((user) => roleMatches(user, "secretaria"))
                || usuarios.secretariaActual
                || {};
        }

        if (storedSecretary && String(storedSecretary.id_secretaria) === String(secretary.id_secretaria)) {
            return {
                ...secretary,
                ...storedSecretary,
                legajo: secretary.legajo
            };
        }

        return secretary;
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

    function triajesList(triaje) {
        return Array.isArray(triaje.triajes) ? triaje.triajes : [];
    }

    function doctorById(usuarios, idMedico) {
        return doctorsFromUsers(usuarios).find((doctor) => doctor.id_medico === idMedico) || null;
    }

    function patientById(usuarios, idPaciente) {
        return patientsFromUsers(usuarios).find((patient) => patient.id_paciente === idPaciente) || null;
    }

    function stateText(state) {
        return `<strong class="fw-semibold">${escapeHtml(state || "-")}</strong>`;
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
                <td>${stateText(turno.estado)}</td>
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
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
            loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad)
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
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad)
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
        let availability = mergeStoredAvailability(LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY, disponibilidadMock, doctors);
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
                return `
                    <tr>
                        <td>${item.medico}</td>
                        <td>${item.especialidad}</td>
                        <td>${formatDate(item.fecha)}</td>
                        <td>${item.hora_inicio}</td>
                        <td>${item.hora_fin}</td>
                        <td>${stateText(item.estado)}</td>
                        <td>${item.origen || "Mock"}</td>
                    </tr>
                `;
            }).join("");
        }

        function persistAvailability() {
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY, availability);
            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, availability);
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
            removeSessionItem(SESSION_STORAGE_KEYS.SECRETARY_TEMP_AVAILABILITY);
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

    async function initSecretaryAppointments() {
        const tableBody = document.getElementById("GestiónTurnosTabla");

        if (!tableBody) {
            return;
        }

        const [usuarios, medicosData, turnosData, disponibilidadData, triajeData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
            loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad),
            loadMock(MOCK_PATHS.TRIAGE, fallbackData.triaje)
        ]);
        const secretary = currentSecretary(usuarios);
        const doctors = Array.isArray(medicosData.medicos) && medicosData.medicos.length > 0
            ? medicosData.medicos
            : doctorsFromUsers(usuarios);
        const basePatients = patientsFromUsers(usuarios);
        let simulatedPatients = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_PATIENTS, []);

        if (!Array.isArray(simulatedPatients)) {
            simulatedPatients = [];
            clearStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_PATIENTS);
        }
        let turns = mergeStoredTurns(turnosList(turnosData));
        let triages = mergeStoredTriages(triajesList(triajeData));
        let availability = mergeStoredAvailability(
            LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY,
            Array.isArray(disponibilidadData) ? disponibilidadData : [],
            doctors
        );
        let selectedTurnId = null;

        const filters = {
            dni: document.getElementById("filtroDniTurno"),
            patient: document.getElementById("filtroPacienteTurno"),
            doctor: document.getElementById("filtroMedicoTurno"),
            specialty: document.getElementById("filtroEspecialidadTurno"),
            date: document.getElementById("filtroFechaTurno"),
            state: document.getElementById("filtroEstadoTurno")
        };
        const createFields = {
            dni: document.getElementById("asignarPacienteDni"),
            name: document.getElementById("asignarPacienteNombre"),
            surname: document.getElementById("asignarPacienteApellido"),
            phone: document.getElementById("asignarPacienteTelefono"),
            insurance: document.getElementById("asignarPacienteObraSocial"),
            specialty: document.getElementById("asignarEspecialidad"),
            doctor: document.getElementById("asignarMedico"),
            pain: document.getElementById("asignarRangoDolor"),
            slot: document.getElementById("asignarDisponibilidad")
        };
        const editFields = {
            specialty: document.getElementById("modificarEspecialidad"),
            doctor: document.getElementById("modificarMedico"),
            slot: document.getElementById("modificarDisponibilidad")
        };
        const message = document.getElementById("GestiónTurnosMensaje");
        const createModal = new bootstrap.Modal(document.getElementById("asignarTurnoModal"));
        const editModal = new bootstrap.Modal(document.getElementById("modificarTurnoModal"));
        const cancelModal = new bootstrap.Modal(document.getElementById("cancelarTurnoModal"));
        const detailModal = new bootstrap.Modal(document.getElementById("detalleTurnoModal"));

        function doctorFullName(doctor) {
            return `${doctor.nombre} ${doctor.apellido}`;
        }

        function priorityColor(priority) {
            if (priority === "Alta") {
                return "Rojo";
            }

            if (priority === "Media") {
                return "Amarillo";
            }

            return "Verde";
        }

        function allPatients() {
            return [...basePatients, ...simulatedPatients];
        }

        function patientByTurn(turn) {
            return allPatients().find((patient) => String(patient.id_paciente) === String(turn.id_paciente)) || null;
        }

        function doctorByTurn(turn) {
            return doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(turn.id_medico)) || null;
        }

        function getTriage(turn) {
            return triages.find((item) => String(item.id_triaje) === String(turn.id_triaje)
                || String(item.id_turno) === String(turn.id_turno)) || null;
        }

        function readRadioValue(name) {
            const selected = document.querySelector(`input[name="${name}"]:checked`);
            return selected ? selected.value : "";
        }

        function calculateTriage() {
            const answers = {
                fiebre: readRadioValue("asignarFiebre"),
                dolor_intenso: readRadioValue("asignarDolorIntenso"),
                dificultad_respiratoria: readRadioValue("asignarRespiratoria"),
                rango_dolor: Number.parseInt(createFields.pain.value, 10)
            };
            let score = 0;

            if (answers.fiebre === "si") {
                score += 1;
            }

            if (answers.dolor_intenso === "si") {
                score += 3;
            }

            if (answers.dificultad_respiratoria === "si") {
                score += 8;
            }

            if (answers.rango_dolor >= 0 && answers.rango_dolor <= 3) {
                score += 2;
            } else if (answers.rango_dolor >= 4 && answers.rango_dolor <= 6) {
                score += 4;
            } else if (answers.rango_dolor >= 7 && answers.rango_dolor <= 10) {
                score += 6;
            }

            if (score <= 3) {
                return { answers, score, priority: "Baja", color: "Verde", duration: 20 };
            }

            if (score <= 7) {
                return { answers, score, priority: "Media", color: "Amarillo", duration: 30 };
            }

            return { answers, score, priority: "Alta", color: "Rojo", duration: 40 };
        }

        function timeToMinutes(timeValue) {
            const [hours, minutes] = String(timeValue).split(":").map(Number);
            return (hours * 60) + minutes;
        }

        function minutesToTime(totalMinutes) {
            const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
            const minutes = (totalMinutes % 60).toString().padStart(2, "0");
            return `${hours}:${minutes}`;
        }

        function addMinutes(timeValue, minutes) {
            return minutesToTime(timeToMinutes(timeValue) + minutes);
        }

        function availabilityDateTime(item) {
            return new Date(`${item.fecha}T${item.hora_inicio}:00`).getTime();
        }

        function isCompatibleTurn(turn) {
            const validStates = ["reservado", "presente", "en atencion", "completado", "cancelado", "ausente"];

            return turn
                && turn.id_turno !== undefined
                && turn.id_paciente !== undefined
                && turn.id_medico !== undefined
                && turn.fecha
                && turn.hora_inicio
                && validStates.includes(normalizeState(turn.estado));
        }

        function mergeStoredTurns(baseTurns) {
            const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
            const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
            const base = Array.isArray(baseTurns) ? baseTurns : [];
            const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
            const convertedPatientTurns = Array.isArray(storedPatientTurns)
                ? storedPatientTurns.map((turn) => ({
                    id_turno: turn.id,
                    id_paciente: turn.pacienteId,
                    id_medico: turn.medicoId,
                    id_disponibilidad: turn.disponibilidadId,
                    id_triaje: turn.idTriaje,
                    fecha: turn.fecha,
                    hora_inicio: turn.hora,
                    hora_fin: turn.horaFin || addMinutes(turn.hora, 20),
                    estado: turn.estado,
                    prioridad: priorityLabel(turn.prioridad),
                    color_prioridad: priorityColor(priorityLabel(turn.prioridad)),
                    duracion_estimada: Number.parseInt(turn.tiempoEstimado, 10) || 20,
                    fecha_solicitud: turn.fechaSolicitud || new Date().toISOString(),
                    origen: turn.origen || "Paciente"
                }))
                : [];
            const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

            [...stored, ...convertedPatientTurns].filter(isCompatibleTurn).forEach((turn) => {
                byId.set(String(turn.id_turno), turn);
            });

            return [...byId.values()];
        }

        function mergeStoredTriages(baseTriages) {
            const stored = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TRIAGES, null);
            const byId = new Map((Array.isArray(baseTriages) ? baseTriages : []).map((item) => [String(item.id_triaje), item]));

            if (Array.isArray(stored)) {
                stored.forEach((item) => {
                    if (item && item.id_triaje !== undefined && item.id_turno !== undefined) {
                        byId.set(String(item.id_triaje), item);
                    }
                });
            }

            return [...byId.values()];
        }

        function persistState() {
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, turns);
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TRIAGES, triages);
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_PATIENTS, simulatedPatients);
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY, availability);
            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, availability);
        }

        function showMessage(type, text) {
            message.className = `alert alert-${type}`;
            message.textContent = text;
            message.classList.remove("d-none");
            message.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }

        function renderSelect(select, firstLabel, items, valueFactory, labelFactory) {
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

        function specialties() {
            return [...new Set(doctors.map((doctor) => doctor.especialidad))].sort();
        }

        function fillDoctorOptions(select, specialty = "") {
            const filteredDoctors = specialty === ""
                ? doctors
                : doctors.filter((doctor) => doctor.especialidad === specialty);

            renderSelect(
                select,
                "Seleccione un medico",
                filteredDoctors,
                (doctor) => String(doctor.id_medico || doctor.id),
                (doctor) => `${doctorFullName(doctor)} - ${doctor.especialidad}`
            );
        }

        function fillSpecialtyOptions(select, firstLabel) {
            renderSelect(
                select,
                firstLabel,
                specialties(),
                (specialty) => specialty,
                (specialty) => specialty
            );
        }

        function selectedCreateDoctor() {
            return doctors.find((doctor) => String(doctor.id_medico || doctor.id) === createFields.doctor.value) || null;
        }

        function selectedEditDoctor() {
            return doctors.find((doctor) => String(doctor.id_medico || doctor.id) === editFields.doctor.value) || null;
        }

        function availableSlots({ specialty, doctorId, priority, includeOverbooking }) {
            const slots = availability
                .filter((item) => item.estado === "Disponible")
                .filter((item) => specialty === "" || item.especialidad === specialty)
                .filter((item) => doctorId === "" || String(item.id_medico) === String(doctorId))
                .sort((a, b) => availabilityDateTime(a) - availabilityDateTime(b));

            if (includeOverbooking && priority === "Alta" && specialty !== "") {
                const referenceDoctor = doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(doctorId))
                    || doctors.find((doctor) => doctor.especialidad === specialty);

                if (referenceDoctor && slots.length === 0) {
                    const now = new Date();
                    const syntheticStart = `${String(now.getHours()).padStart(2, "0")}:00`;
                    slots.push({
                        id_disponibilidad: `sobreturno-${Date.now()}`,
                        id_medico: referenceDoctor.id_medico || referenceDoctor.id,
                        medico: doctorFullName(referenceDoctor),
                        especialidad: referenceDoctor.especialidad,
                        fecha: now.toISOString().slice(0, 10),
                        hora_inicio: syntheticStart,
                        hora_fin: addMinutes(syntheticStart, 40),
                        estado: "Disponible",
                        origen: "Sobreturno simulado",
                        esSobreturno: true
                    });
                }
            }

            return priority === "Alta" ? slots : slots.sort((a, b) => availabilityDateTime(a) - availabilityDateTime(b));
        }

        function renderSlotOptions(select, slots, emptyText) {
            select.innerHTML = "";

            if (slots.length === 0) {
                const option = document.createElement("option");
                option.value = "";
                option.textContent = emptyText;
                select.appendChild(option);
                select.disabled = true;
                return;
            }

            select.disabled = false;
            const firstOption = document.createElement("option");
            firstOption.value = "";
            firstOption.textContent = "Seleccione un horario";
            select.appendChild(firstOption);
            slots.forEach((slot) => {
                const option = document.createElement("option");
                option.value = String(slot.id_disponibilidad);
                option.textContent = `${formatDate(slot.fecha)} ${slot.hora_inicio} a ${slot.hora_fin} - ${slot.medico} (${slot.origen || "Disponible"})`;
                option.dataset.slot = JSON.stringify(slot);
                select.appendChild(option);
            });
        }

        function refreshCreateSlots() {
            const triaje = calculateTriage();
            const doctor = selectedCreateDoctor();
            const specialty = doctor ? doctor.especialidad : createFields.specialty.value;
            const slots = availableSlots({
                specialty,
                doctorId: doctor ? String(doctor.id_medico || doctor.id) : "",
                priority: triaje.priority,
                includeOverbooking: true
            });
            const help = document.getElementById("asignarDisponibilidadAyuda");

            renderSlotOptions(createFields.slot, slots, "No hay horarios disponibles para el criterio seleccionado.");
            help.textContent = triaje.priority === "Alta"
                ? "Prioridad alta: se priorizan los horarios mas proximos y puede aparecer un sobreturno simulado."
                : "Horarios disponibles segun disponibilidad cargada.";
        }

        function refreshTriageResult() {
            const triaje = calculateTriage();
            const resultBox = document.getElementById("asignarTriajeResultado");
            const badge = document.getElementById("asignarTriajePrioridad");

            document.getElementById("asignarRangoDolorValor").textContent = createFields.pain.value;
            resultBox.className = `triage-result triage-result-${triaje.priority === "Alta" ? "danger" : triaje.priority === "Media" ? "warning" : "success"} rounded-3 p-3 h-100`;
            badge.textContent = triaje.priority;
            badge.className = `badge ${priorityClass(triaje.priority)}`;
            setText("asignarTriajePuntaje", triaje.score);
            setText("asignarTriajeDuracion", triaje.duration);
            refreshCreateSlots();
        }

        function currentPatientFromCreateForm() {
            const dni = createFields.dni.value.trim();
            const existingPatient = allPatients().find((patient) => patient.dni === dni);

            if (existingPatient) {
                return existingPatient;
            }

            const maxId = allPatients().reduce((maxValue, patient) => Math.max(maxValue, Number(patient.id_paciente) || 0), 0);
            const patient = {
                id_paciente: maxId + 1,
                nombre: createFields.name.value.trim(),
                apellido: createFields.surname.value.trim(),
                dni,
                telefono: createFields.phone.value.trim(),
                obra_social: createFields.insurance.value.trim(),
                rol: "paciente",
                origenInterfaz: true
            };

            simulatedPatients = [...simulatedPatients, patient];
            return patient;
        }

        function occupyAvailability(slot, turnId) {
            if (slot.esSobreturno) {
                const maxId = availability.reduce((maxValue, item) => Math.max(maxValue, Number(item.id_disponibilidad) || 0), 0);
                const createdSlot = {
                    ...slot,
                    id_disponibilidad: maxId + 1,
                    estado: "Ocupado",
                    id_turno: turnId
                };

                availability = [...availability, createdSlot];
                return createdSlot;
            }

            availability = availability.map((item) => {
                if (String(item.id_disponibilidad) === String(slot.id_disponibilidad)) {
                    return {
                        ...item,
                        estado: "Ocupado",
                        id_turno: turnId
                    };
                }

                return item;
            });

            return slot;
        }

        function releaseAvailability(disponibilidadId) {
            availability = availability.map((item) => {
                if (String(item.id_disponibilidad) === String(disponibilidadId)) {
                    const released = { ...item, estado: "Disponible" };
                    delete released.id_turno;
                    return released;
                }

                return item;
            });
        }

        function filteredTurns() {
            return turns.filter((turn) => {
                const patient = patientByTurn(turn);
                const doctor = doctorByTurn(turn);
                const patientName = patient ? fullName(patient) : "";
                const doctorName = doctor ? doctorFullName(doctor) : "";
                const specialty = doctor ? doctor.especialidad : turn.especialidad;

                return (!filters.dni.value || (patient && patient.dni.includes(filters.dni.value.trim())))
                    && (!filters.patient.value || normalizeText(patientName).includes(normalizeText(filters.patient.value)))
                    && (!filters.doctor.value || normalizeText(doctorName).includes(normalizeText(filters.doctor.value)))
                    && (!filters.specialty.value || specialty === filters.specialty.value)
                    && (!filters.date.value || turn.fecha === filters.date.value)
                    && (!filters.state.value || normalizeState(turn.estado) === normalizeState(filters.state.value));
            }).sort((a, b) => new Date(`${b.fecha}T${b.hora_inicio}:00`) - new Date(`${a.fecha}T${a.hora_inicio}:00`));
        }

        function renderAppointmentSummary() {
            setText("GestiónTurnosResumen", `${turns.length} turnos registrados`);
        }

        function actionButtons(turn) {
            const state = normalizeState(turn.estado);
            const canEdit = state === "reservado" || state === "presente";

            return `
                <div class="btn-group btn-group-sm" role="group" aria-label="Acciones del turno">
                    <button type="button" class="btn btn-outline-primary" data-action="detail" data-turn-id="${turn.id_turno}" title="Ver detalle">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button type="button" class="btn btn-outline-secondary" data-action="edit" data-turn-id="${turn.id_turno}" ${canEdit ? "" : "disabled"} title="${canEdit ? "Modificar" : "No modificable por estado"}">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <button type="button" class="btn btn-outline-danger" data-action="cancel" data-turn-id="${turn.id_turno}" ${canEdit ? "" : "disabled"} title="${canEdit ? "Cancelar" : "No cancelable por estado"}">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </div>
            `;
        }

        function renderTable() {
            const visibleTurns = filteredTurns();

            renderAppointmentSummary();

            if (visibleTurns.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="10" class="text-secondary">No se encontraron turnos con los filtros seleccionados.</td></tr>';
                return;
            }

            tableBody.innerHTML = visibleTurns.map((turn) => {
                const patient = patientByTurn(turn);
                const doctor = doctorByTurn(turn);
                const specialty = doctor ? doctor.especialidad : turn.especialidad;
                const patientName = patient ? fullName(patient) : "Paciente simulado";
                const doctorName = doctor ? doctorFullName(doctor) : "Medico";

                return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patientName)}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(doctorName)}</td>
                        <td>${escapeHtml(specialty || "-")}</td>
                        <td>${formatDate(turn.fecha)}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td><span class="badge ${priorityClass(turn.prioridad)}">${escapeHtml(turn.prioridad)}</span></td>
                        <td>${stateText(turn.estado)}</td>
                        <td>${escapeHtml(turn.origen || "Mock")}</td>
                        <td>${actionButtons(turn)}</td>
                    </tr>
                `;
            }).join("");
        }

        function renderDetail(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn) {
                return;
            }

            const patient = patientByTurn(turn);
            const doctor = doctorByTurn(turn);
            const triage = getTriage(turn);
            const answers = triage && triage.respuestas ? triage.respuestas : {};
            const content = document.getElementById("detalleTurnoContenido");

            content.innerHTML = `
                <dl class="row mb-0">
                    <dt class="col-sm-4 text-secondary">Paciente</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? fullName(patient) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">DNI</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.dni : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Telefono</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.telefono : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Obra social</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.obra_social : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Medico</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Especialidad</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctor.especialidad : turn.especialidad || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Fecha y hora</dt>
                    <dd class="col-sm-8">${formatDate(turn.fecha)} ${escapeHtml(turn.hora_inicio)} a ${escapeHtml(turn.hora_fin)}</dd>
                    <dt class="col-sm-4 text-secondary">Estado</dt>
                    <dd class="col-sm-8">${stateText(turn.estado)}</dd>
                    <dt class="col-sm-4 text-secondary">Prioridad</dt>
                    <dd class="col-sm-8"><span class="badge ${priorityClass(turn.prioridad)}">${escapeHtml(turn.prioridad)}</span></dd>
                    <dt class="col-sm-4 text-secondary">Puntaje triaje</dt>
                    <dd class="col-sm-8">${escapeHtml(triage ? triage.puntaje : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Duracion estimada</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.duracion_estimada || (triage ? triage.duracion_estimada : "-"))} minutos</dd>
                    <dt class="col-sm-4 text-secondary">Origen</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.origen || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Respuestas triaje</dt>
                    <dd class="col-sm-8 mb-0">
                        Fiebre: ${escapeHtml(answers.fiebre || "-")}<br>
                        Dolor intenso: ${escapeHtml(answers.dolor_intenso || "-")}<br>
                        Dificultad respiratoria: ${escapeHtml(answers.dificultad_respiratoria || "-")}<br>
                        Rango de dolor: ${escapeHtml(answers.rango_dolor ?? "-")}
                    </dd>
                </dl>
            `;
            detailModal.show();
        }

        function openEditModal(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || !["reservado", "presente"].includes(normalizeState(turn.estado))) {
                return;
            }

            const patient = patientByTurn(turn);
            const doctor = doctorByTurn(turn);
            selectedTurnId = turn.id_turno;
            document.getElementById("modificarPacienteResumen").textContent = patient ? `${fullName(patient)} - DNI ${patient.dni}` : "-";
            const priorityBadge = document.getElementById("modificarPrioridadResumen");
            priorityBadge.textContent = turn.prioridad;
            priorityBadge.className = `badge ${priorityClass(turn.prioridad)}`;
            editFields.specialty.value = doctor ? doctor.especialidad : "";
            fillDoctorOptions(editFields.doctor, editFields.specialty.value);
            editFields.doctor.value = doctor ? String(doctor.id_medico || doctor.id) : "";
            refreshEditSlots();
            editModal.show();
        }

        function refreshEditSlots() {
            const doctor = selectedEditDoctor();
            const specialty = doctor ? doctor.especialidad : editFields.specialty.value;
            const slots = availableSlots({
                specialty,
                doctorId: doctor ? String(doctor.id_medico || doctor.id) : "",
                priority: "Baja",
                includeOverbooking: false
            });

            renderSlotOptions(editFields.slot, slots, "No hay horarios disponibles para modificar el turno.");
        }

        function openCancelModal(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || !["reservado", "presente"].includes(normalizeState(turn.estado))) {
                return;
            }

            selectedTurnId = turn.id_turno;
            cancelModal.show();
        }

        function createAppointment(event) {
            event.preventDefault();

            const doctor = selectedCreateDoctor();
            const selectedSlotOption = createFields.slot.selectedOptions[0];
            const slot = selectedSlotOption && selectedSlotOption.dataset.slot
                ? JSON.parse(selectedSlotOption.dataset.slot)
                : null;

            if (!doctor || !slot || createFields.dni.value.trim() === "" || createFields.name.value.trim() === "" || createFields.surname.value.trim() === "") {
                showMessage("danger", "Complete paciente, medico y horario antes de confirmar.");
                return;
            }

            const patient = currentPatientFromCreateForm();
            const triageResult = calculateTriage();
            const nextTurnId = turns.reduce((maxValue, turn) => Math.max(maxValue, Number(turn.id_turno) || 0), 1000) + 1;
            const nextTriageId = triages.reduce((maxValue, item) => Math.max(maxValue, Number(item.id_triaje) || 0), 500) + 1;
            const occupiedSlot = occupyAvailability(slot, nextTurnId);
            const newTurn = {
                id_turno: nextTurnId,
                id_paciente: patient.id_paciente,
                id_medico: doctor.id_medico || doctor.id,
                id_disponibilidad: occupiedSlot.id_disponibilidad,
                id_triaje: nextTriageId,
                fecha: occupiedSlot.fecha,
                hora_inicio: occupiedSlot.hora_inicio,
                hora_fin: addMinutes(occupiedSlot.hora_inicio, triageResult.duration),
                estado: "Reservado",
                prioridad: triageResult.priority,
                color_prioridad: triageResult.color,
                duracion_estimada: triageResult.duration,
                fecha_solicitud: new Date().toISOString(),
                origen: "Secretaria"
            };
            const newTriage = {
                id_triaje: nextTriageId,
                id_turno: nextTurnId,
                id_paciente: patient.id_paciente,
                puntaje: triageResult.score,
                prioridad: triageResult.priority,
                color_prioridad: triageResult.color,
                duracion_estimada: triageResult.duration,
                respuestas: triageResult.answers,
                recomendacion: "Triaje registrado por secretaria segun respuestas informadas por el paciente.",
                fecha: new Date().toISOString().slice(0, 10)
            };

            turns = [...turns, newTurn];
            triages = [...triages, newTriage];
            persistState();
            event.target.reset();
            createFields.pain.value = "0";
            fillDoctorOptions(createFields.doctor);
            refreshTriageResult();
            renderTable();
            createModal.hide();
            showMessage("success", "Turno asignado correctamente.");
        }

        function saveEditedAppointment(event) {
            event.preventDefault();

            const turn = turns.find((item) => String(item.id_turno) === String(selectedTurnId));
            const doctor = selectedEditDoctor();
            const selectedSlotOption = editFields.slot.selectedOptions[0];
            const slot = selectedSlotOption && selectedSlotOption.dataset.slot
                ? JSON.parse(selectedSlotOption.dataset.slot)
                : null;

            if (!turn || !doctor || !slot) {
                showMessage("danger", "Seleccione medico y horario disponible para modificar.");
                return;
            }

            releaseAvailability(turn.id_disponibilidad);
            occupyAvailability(slot, turn.id_turno);
            turns = turns.map((item) => {
                if (String(item.id_turno) === String(turn.id_turno)) {
                    return {
                        ...item,
                        id_medico: doctor.id_medico || doctor.id,
                        id_disponibilidad: slot.id_disponibilidad,
                        fecha: slot.fecha,
                        hora_inicio: slot.hora_inicio,
                        hora_fin: addMinutes(slot.hora_inicio, item.duracion_estimada || 20)
                    };
                }

                return item;
            });
            persistState();
            renderTable();
            editModal.hide();
            showMessage("success", "Turno modificado correctamente.");
        }

        function cancelSelectedTurn() {
            const turn = turns.find((item) => String(item.id_turno) === String(selectedTurnId));

            if (!turn) {
                return;
            }

            turns = turns.map((item) => {
                if (String(item.id_turno) === String(selectedTurnId)) {
                    return {
                        ...item,
                        estado: "Cancelado",
                        fecha_cancelacion: new Date().toISOString()
                    };
                }

                return item;
            });
            releaseAvailability(turn.id_disponibilidad);
            persistState();
            renderTable();
            cancelModal.hide();
            showMessage("success", "Turno cancelado correctamente. El horario quedo disponible para otros pacientes.");
        }

        function fillPatientFromDni() {
            const patient = allPatients().find((item) => item.dni === createFields.dni.value.trim());
            const fieldsAreReadOnly = Boolean(patient);

            if (patient) {
                createFields.name.value = patient.nombre || "";
                createFields.surname.value = patient.apellido || "";
                createFields.phone.value = patient.telefono || "";
                createFields.insurance.value = patient.obra_social || "";
            }

            [createFields.name, createFields.surname, createFields.phone, createFields.insurance].forEach((field) => {
                field.readOnly = fieldsAreReadOnly;
            });
        }

        function initFiltersAndSelectors() {
            setText("GestiónTurnosSecretariaNavbar", fullName(secretary));
            fillSpecialtyOptions(filters.specialty, "Todas");
            renderSelect(
                filters.doctor,
                "Todos",
                doctors,
                (doctor) => doctorFullName(doctor),
                (doctor) => doctorFullName(doctor)
            );
            fillSpecialtyOptions(createFields.specialty, "Seleccione una especialidad");
            fillSpecialtyOptions(editFields.specialty, "Seleccione una especialidad");
            fillDoctorOptions(createFields.doctor);
            fillDoctorOptions(editFields.doctor);
        }

        initFiltersAndSelectors();
        refreshTriageResult();
        renderTable();

        Object.values(filters).forEach((field) => {
            field.addEventListener("input", renderTable);
            field.addEventListener("change", renderTable);
        });
        createFields.dni.addEventListener("input", fillPatientFromDni);
        createFields.specialty.addEventListener("change", () => {
            createFields.doctor.value = "";
            fillDoctorOptions(createFields.doctor, createFields.specialty.value);
            refreshCreateSlots();
        });
        createFields.doctor.addEventListener("change", () => {
            const doctor = selectedCreateDoctor();

            if (doctor) {
                createFields.specialty.value = doctor.especialidad;
                fillDoctorOptions(createFields.doctor, doctor.especialidad);
                createFields.doctor.value = String(doctor.id_medico || doctor.id);
            }

            refreshCreateSlots();
        });
        document.querySelectorAll('input[name="asignarFiebre"], input[name="asignarDolorIntenso"], input[name="asignarRespiratoria"], #asignarRangoDolor').forEach((field) => {
            field.addEventListener("input", refreshTriageResult);
            field.addEventListener("change", refreshTriageResult);
        });
        editFields.specialty.addEventListener("change", () => {
            editFields.doctor.value = "";
            fillDoctorOptions(editFields.doctor, editFields.specialty.value);
            refreshEditSlots();
        });
        editFields.doctor.addEventListener("change", () => {
            const doctor = selectedEditDoctor();

            if (doctor) {
                editFields.specialty.value = doctor.especialidad;
                fillDoctorOptions(editFields.doctor, doctor.especialidad);
                editFields.doctor.value = String(doctor.id_medico || doctor.id);
            }

            refreshEditSlots();
        });
        tableBody.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button || button.disabled) {
                return;
            }

            const turnId = button.dataset.turnId;

            if (button.dataset.action === "detail") {
                renderDetail(turnId);
            } else if (button.dataset.action === "edit") {
                openEditModal(turnId);
            } else if (button.dataset.action === "cancel") {
                openCancelModal(turnId);
            }
        });
        document.getElementById("asignarTurnoForm").addEventListener("submit", createAppointment);
        document.getElementById("modificarTurnoForm").addEventListener("submit", saveEditedAppointment);
        document.getElementById("confirmarCancelarTurnoBtn").addEventListener("click", cancelSelectedTurn);
        persistState();
    }

    async function initSecretaryProfile() {
        const form = document.querySelector('[data-form="secretary-profile"]');

        if (!form) {
            return;
        }

        const usuarios = await loadMock(MOCK_PATHS.USERS, fallbackData.usuarios);
        const mockSecretary = currentSecretary(usuarios);
        const storedSecretary = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_PROFILE, null);
        const secretary = storedSecretary && String(storedSecretary.id_secretaria) === String(mockSecretary.id_secretaria)
            ? { ...mockSecretary, ...storedSecretary, legajo: mockSecretary.legajo }
            : mockSecretary;
        const message = document.getElementById("perfilSecretariaMensaje");
        const fields = {
            nombre: document.getElementById("perfilSecretariaNombre"),
            apellido: document.getElementById("perfilSecretariaApellido"),
            dni: document.getElementById("perfilSecretariaDni"),
            email: document.getElementById("perfilSecretariaEmail"),
            telefono: document.getElementById("perfilSecretariaTelefono"),
            legajo: document.getElementById("perfilSecretariaLegajo"),
            passwordActual: document.getElementById("perfilSecretariaPasswordActual"),
            passwordNueva: document.getElementById("perfilSecretariaPasswordNueva"),
            passwordConfirmar: document.getElementById("perfilSecretariaPasswordConfirmar")
        };

        function fillForm(secretaryData) {
            fields.nombre.value = secretaryData.nombre || "";
            fields.apellido.value = secretaryData.apellido || "";
            fields.dni.value = secretaryData.dni || "";
            fields.email.value = secretaryData.email || "";
            fields.telefono.value = secretaryData.telefono || "";
            fields.legajo.value = secretaryData.legajo || "";
            fields.passwordActual.value = "";
            fields.passwordNueva.value = "";
            fields.passwordConfirmar.value = "";
            setText("perfilSecretariaNavbar", fullName(secretaryData));
        }

        function setFieldError(fieldName, text) {
            const field = fields[fieldName];
            const error = document.getElementById(`perfilSecretaria${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}Error`);

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
                    const isVisible = input.type === "text";

                    input.type = isVisible ? "password" : "text";
                    icon.className = isVisible ? "bi bi-eye" : "bi bi-eye-slash";
                    button.setAttribute("aria-label", isVisible ? "Mostrar contraseña" : "Ocultar contraseña");
                });
            });
        }

        fillForm(secretary);
        initPasswordToggles();

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            if (!validateProfile()) {
                showMessage("danger", "Revise los campos marcados antes de guardar.");
                return;
            }

            const updatedSecretary = {
                ...secretary,
                id_usuario: mockSecretary.id_usuario,
                id_secretaria: mockSecretary.id_secretaria,
                rol: "secretaria",
                legajo: mockSecretary.legajo,
                nombre: fields.nombre.value.trim(),
                apellido: fields.apellido.value.trim(),
                dni: fields.dni.value.trim(),
                email: fields.email.value.trim(),
                telefono: fields.telefono.value.trim()
            };

            if (fields.passwordNueva.value !== "") {
                updatedSecretary.passwordActualizada = true;
            }

            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_PROFILE, updatedSecretary);
            const currentLoggedUser = currentUser();

            if (currentLoggedUser && roleMatches(currentLoggedUser, "secretaria")) {
                writeStoredJson(LOCAL_STORAGE_KEYS.CURRENT_USER, {
                    ...currentLoggedUser,
                    ...updatedSecretary,
                    legajo: mockSecretary.legajo
                });
            }

            fillForm(updatedSecretary);
            clearErrors();
            showMessage("success", "Perfil actualizado correctamente.");
        });

        form.addEventListener("reset", () => {
            setTimeout(() => {
                const storedProfile = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_PROFILE, null);
                const secretaryData = storedProfile && String(storedProfile.id_secretaria) === String(mockSecretary.id_secretaria)
                    ? { ...mockSecretary, ...storedProfile, legajo: mockSecretary.legajo }
                    : mockSecretary;

                fillForm(secretaryData);
                clearErrors();
            }, 0);
        });
    }

    async function initSecretaryPresence() {
        const tableBody = document.getElementById("presenciaTabla");

        if (!tableBody) {
            return;
        }

        const [usuarios, medicosData, turnosData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos)
        ]);
        const secretary = currentSecretary(usuarios);
        const doctors = Array.isArray(medicosData.medicos) && medicosData.medicos.length > 0
            ? medicosData.medicos
            : doctorsFromUsers(usuarios);
        const patients = patientsFromUsers(usuarios);
        let turns = mergeStoredPresenceTurns(turnosList(turnosData));
        let selectedTurnId = null;

        const filters = {
            dni: document.getElementById("presenciaFiltroDni"),
            patient: document.getElementById("presenciaFiltroPaciente"),
            doctor: document.getElementById("presenciaFiltroMedico"),
            specialty: document.getElementById("presenciaFiltroEspecialidad"),
            date: document.getElementById("presenciaFiltroFecha")
        };
        const confirmModal = new bootstrap.Modal(document.getElementById("presenciaConfirmarModal"));
        const detailModal = new bootstrap.Modal(document.getElementById("presenciaDetalleModal"));
        const message = document.getElementById("presenciaMensaje");

        function doctorFullName(doctor) {
            return `${doctor.nombre} ${doctor.apellido}`;
        }

        function patientByTurn(turn) {
            return patients.find((patient) => String(patient.id_paciente) === String(turn.id_paciente)) || null;
        }

        function doctorByTurn(turn) {
            return doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(turn.id_medico)) || null;
        }

        function priorityColor(priority) {
            if (priority === "Alta") {
                return "Rojo";
            }

            if (priority === "Media") {
                return "Amarillo";
            }

            return "Verde";
        }

        function timeToMinutes(timeValue) {
            const [hours, minutes] = String(timeValue).split(":").map(Number);
            return (hours * 60) + minutes;
        }

        function minutesToTime(totalMinutes) {
            const hours = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
            const minutes = (totalMinutes % 60).toString().padStart(2, "0");
            return `${hours}:${minutes}`;
        }

        function addMinutes(timeValue, minutes) {
            return minutesToTime(timeToMinutes(timeValue) + minutes);
        }

        function compatiblePresenceTurn(turn) {
            return turn
                && turn.id_turno !== undefined
                && turn.id_paciente !== undefined
                && turn.id_medico !== undefined
                && turn.fecha
                && turn.hora_inicio
                && turn.estado;
        }

        function mergeStoredPresenceTurns(baseTurns) {
            const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
            const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
            const base = Array.isArray(baseTurns) ? baseTurns : [];
            const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
            const convertedPatientTurns = Array.isArray(storedPatientTurns)
                ? storedPatientTurns.map((turn) => ({
                    id_turno: turn.id,
                    id_paciente: turn.pacienteId,
                    id_medico: turn.medicoId,
                    id_disponibilidad: turn.disponibilidadId,
                    id_triaje: turn.idTriaje,
                    fecha: turn.fecha,
                    hora_inicio: turn.hora,
                    hora_fin: turn.horaFin || addMinutes(turn.hora, 20),
                    estado: turn.estado,
                    prioridad: priorityLabel(turn.prioridad),
                    color_prioridad: priorityColor(priorityLabel(turn.prioridad)),
                    duracion_estimada: Number.parseInt(turn.tiempoEstimado, 10) || 20,
                    fecha_solicitud: turn.fechaSolicitud || new Date().toISOString(),
                    origen: turn.origen || "Paciente"
                }))
                : [];
            const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

            [...stored, ...convertedPatientTurns].filter(compatiblePresenceTurn).forEach((turn) => {
                byId.set(String(turn.id_turno), turn);
            });

            return [...byId.values()];
        }

        function persistTurns() {
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, turns);
        }

        function showMessage(type, text) {
            message.className = `alert alert-${type}`;
            message.textContent = text;
            message.classList.remove("d-none");
        }

        function renderSelect(select, firstLabel, items, valueFactory, labelFactory) {
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

        function selectedDateTurns() {
            return turns.filter((turn) => turn.fecha === filters.date.value);
        }

        function filteredDateTurns() {
            return selectedDateTurns().filter((turn) => {
                const patient = patientByTurn(turn);
                const doctor = doctorByTurn(turn);
                const patientName = patient ? fullName(patient) : "";
                const doctorName = doctor ? doctorFullName(doctor) : "";
                const specialty = doctor ? doctor.especialidad : turn.especialidad;

                return (!filters.dni.value || (patient && patient.dni.includes(filters.dni.value.trim())))
                    && (!filters.patient.value || normalizeText(patientName).includes(normalizeText(filters.patient.value)))
                    && (!filters.doctor.value || normalizeText(doctorName).includes(normalizeText(filters.doctor.value)))
                    && (!filters.specialty.value || specialty === filters.specialty.value);
            }).sort((a, b) => String(a.hora_inicio).localeCompare(String(b.hora_inicio)));
        }

        function renderMetrics() {
            const dateTurns = selectedDateTurns();
            const scheduledTurns = dateTurns.filter((turn) => {
                const state = normalizeState(turn.estado);
                return state !== "cancelado" && state !== "ausente";
            });
            const presentTurns = dateTurns.filter((turn) => normalizeState(turn.estado) === "presente");
            const pendingTurns = dateTurns.filter((turn) => normalizeState(turn.estado) === "reservado");

            setText("presenciaMetricReservados", scheduledTurns.length);
            setText("presenciaMetricPresentes", presentTurns.length);
            setText("presenciaMetricPendientes", pendingTurns.length);
        }

        function arrivalTime(turn) {
            if (turn.hora_llegada) {
                return turn.hora_llegada;
            }

            if (turn.fecha_arribo) {
                return new Date(turn.fecha_arribo).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit"
                });
            }

            return "-";
        }

        function actionButtons(turn) {
            const canRegister = normalizeState(turn.estado) === "reservado";
            const registerButton = canRegister
                ? `<button type="button" class="btn btn-success btn-sm" data-action="register" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-person-check me-1"></i>Registrar llegada
                    </button>`
                : "";

            return `
                <div class="d-grid d-sm-flex gap-2">
                    <button type="button" class="btn btn-outline-primary btn-sm" data-action="detail" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-eye me-1"></i>Ver detalle
                    </button>
                    ${registerButton}
                </div>
            `;
        }

        function renderTable() {
            const visibleTurns = filteredDateTurns();

            renderMetrics();

            if (visibleTurns.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="9" class="text-secondary">No hay turnos para la fecha y filtros seleccionados.</td></tr>';
                return;
            }

            tableBody.innerHTML = visibleTurns.map((turn) => {
                const patient = patientByTurn(turn);
                const doctor = doctorByTurn(turn);
                const specialty = doctor ? doctor.especialidad : turn.especialidad;

                return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</td>
                        <td>${escapeHtml(specialty || "-")}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td><span class="badge ${priorityClass(turn.prioridad)}">${escapeHtml(priorityLabel(turn.prioridad))}</span></td>
                        <td>${stateText(turn.estado)}</td>
                        <td>${escapeHtml(arrivalTime(turn))}</td>
                        <td>${actionButtons(turn)}</td>
                    </tr>
                `;
            }).join("");
        }

        function openConfirmModal(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || normalizeState(turn.estado) !== "reservado") {
                return;
            }

            selectedTurnId = turn.id_turno;
            confirmModal.show();
        }

        function registerSelectedPresence() {
            const now = new Date();
            const arrivalHour = now.toLocaleTimeString("es-AR", {
                hour: "2-digit",
                minute: "2-digit"
            });

            turns = turns.map((turn) => {
                if (String(turn.id_turno) === String(selectedTurnId) && normalizeState(turn.estado) === "reservado") {
                    return {
                        ...turn,
                        estado: "Presente",
                        fecha_arribo: now.toISOString(),
                        hora_llegada: arrivalHour
                    };
                }

                return turn;
            });
            persistTurns();
            renderTable();
            confirmModal.hide();
            showMessage("success", "Presencia registrada correctamente.");
        }

        function renderDetail(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn) {
                return;
            }

            const patient = patientByTurn(turn);
            const doctor = doctorByTurn(turn);
            const content = document.getElementById("presenciaDetalleContenido");

            content.innerHTML = `
                <dl class="row mb-0">
                    <dt class="col-sm-4 text-secondary">Paciente</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? fullName(patient) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">DNI</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.dni : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Telefono</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.telefono : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Medico</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Especialidad</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctor.especialidad : turn.especialidad || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Fecha</dt>
                    <dd class="col-sm-8">${formatDate(turn.fecha)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.hora_inicio)} a ${escapeHtml(turn.hora_fin || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Prioridad</dt>
                    <dd class="col-sm-8"><span class="badge ${priorityClass(turn.prioridad)}">${escapeHtml(priorityLabel(turn.prioridad))}</span></dd>
                    <dt class="col-sm-4 text-secondary">Estado</dt>
                    <dd class="col-sm-8">${stateText(turn.estado)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de llegada</dt>
                    <dd class="col-sm-8">${escapeHtml(arrivalTime(turn))}</dd>
                    <dt class="col-sm-4 text-secondary">Origen</dt>
                    <dd class="col-sm-8 mb-0">${escapeHtml(turn.origen || "-")}</dd>
                </dl>
            `;
            detailModal.show();
        }

        function initFilters() {
            const specialties = [...new Set(doctors.map((doctor) => doctor.especialidad))].sort();

            setText("presenciaSecretariaNavbar", fullName(secretary));
            filters.date.value = todayInputValue();
            renderSelect(
                filters.doctor,
                "Todos",
                doctors,
                (doctor) => doctorFullName(doctor),
                (doctor) => doctorFullName(doctor)
            );
            renderSelect(
                filters.specialty,
                "Todas",
                specialties,
                (specialty) => specialty,
                (specialty) => specialty
            );
        }

        initFilters();
        renderTable();

        Object.values(filters).forEach((filter) => {
            filter.addEventListener("input", renderTable);
            filter.addEventListener("change", renderTable);
        });
        tableBody.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            if (button.dataset.action === "register") {
                openConfirmModal(button.dataset.turnId);
            }

            if (button.dataset.action === "detail") {
                renderDetail(button.dataset.turnId);
            }
        });
        document.getElementById("presenciaConfirmarBtn").addEventListener("click", registerSelectedPresence);
    }

    async function initSecretaryConsultationClosure() {
        const tableBody = document.getElementById("finalizacionTabla");

        if (!tableBody) {
            return;
        }

        const [usuarios, medicosData, turnosData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos)
        ]);
        const secretary = currentSecretary(usuarios);
        const doctors = Array.isArray(medicosData.medicos) && medicosData.medicos.length > 0
            ? medicosData.medicos
            : doctorsFromUsers(usuarios);
        const patients = patientsFromUsers(usuarios);
        let turns = mergeStoredClosureTurns(turnosList(turnosData));
        let selectedTurnId = null;

        const filters = {
            dni: document.getElementById("finalizacionFiltroDni"),
            patient: document.getElementById("finalizacionFiltroPaciente"),
            doctor: document.getElementById("finalizacionFiltroMedico"),
            specialty: document.getElementById("finalizacionFiltroEspecialidad"),
            date: document.getElementById("finalizacionFiltroFecha")
        };
        const confirmModal = new bootstrap.Modal(document.getElementById("finalizacionConfirmarModal"));
        const detailModal = new bootstrap.Modal(document.getElementById("finalizacionDetalleModal"));
        const message = document.getElementById("finalizacionMensaje");

        function doctorFullName(doctor) {
            return `${doctor.nombre} ${doctor.apellido}`;
        }

        function patientByTurn(turn) {
            return patients.find((patient) => String(patient.id_paciente) === String(turn.id_paciente)) || null;
        }

        function doctorByTurn(turn) {
            return doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(turn.id_medico)) || null;
        }

        function priorityColor(priority) {
            if (priority === "Alta") {
                return "Rojo";
            }

            if (priority === "Media") {
                return "Amarillo";
            }

            return "Verde";
        }

        function addMinutes(timeValue, minutes) {
            return minutesToTime(timeToMinutes(timeValue) + minutes);
        }

        function consultationStartValue(turn) {
            return turn.hora_inicio_atencion || turn.hora_inicio_consulta || turn.hora_inicio || "-";
        }

        function consultationEndValue(turn) {
            return turn.hora_cierre || turn.hora_fin_atencion || "-";
        }

        function compatibleClosureTurn(turn) {
            return turn
                && turn.id_turno !== undefined
                && turn.id_paciente !== undefined
                && turn.id_medico !== undefined
                && turn.fecha
                && turn.hora_inicio
                && turn.estado;
        }

        function mergeStoredClosureTurns(baseTurns) {
            const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
            const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
            const base = Array.isArray(baseTurns) ? baseTurns : [];
            const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
            const convertedPatientTurns = Array.isArray(storedPatientTurns)
                ? storedPatientTurns.map((turn) => ({
                    id_turno: turn.id,
                    id_paciente: turn.pacienteId,
                    id_medico: turn.medicoId,
                    id_disponibilidad: turn.disponibilidadId,
                    id_triaje: turn.idTriaje,
                    fecha: turn.fecha,
                    hora_inicio: turn.hora,
                    hora_fin: turn.horaFin || addMinutes(turn.hora, 20),
                    estado: turn.estado,
                    prioridad: priorityLabel(turn.prioridad),
                    color_prioridad: priorityColor(priorityLabel(turn.prioridad)),
                    duracion_estimada: Number.parseInt(turn.tiempoEstimado, 10) || 20,
                    fecha_solicitud: turn.fechaSolicitud || new Date().toISOString(),
                    origen: turn.origen || "Paciente"
                }))
                : [];
            const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

            [...stored, ...convertedPatientTurns].filter(compatibleClosureTurn).forEach((turn) => {
                byId.set(String(turn.id_turno), turn);
            });

            return [...byId.values()];
        }

        function persistTurns() {
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, turns);
        }

        function showMessage(type, text) {
            message.className = `alert alert-${type}`;
            message.textContent = text;
            message.classList.remove("d-none");
        }

        function renderSelect(select, firstLabel, items, valueFactory, labelFactory) {
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
                const patient = patientByTurn(turn);
                const doctor = doctorByTurn(turn);
                const patientName = patient ? fullName(patient) : "";
                const doctorName = doctor ? doctorFullName(doctor) : "";
                const specialty = doctor ? doctor.especialidad : turn.especialidad;

                return (!filters.dni.value || (patient && patient.dni.includes(filters.dni.value.trim())))
                    && (!filters.patient.value || normalizeText(patientName).includes(normalizeText(filters.patient.value)))
                    && (!filters.doctor.value || normalizeText(doctorName).includes(normalizeText(filters.doctor.value)))
                    && (!filters.specialty.value || specialty === filters.specialty.value)
                    && (!filters.date.value || turn.fecha === filters.date.value);
            }).sort((a, b) => new Date(`${b.fecha}T${b.hora_inicio}:00`) - new Date(`${a.fecha}T${a.hora_inicio}:00`));
        }

        function attentionStartDate(turn) {
            const start = consultationStartValue(turn);

            if (start === "-") {
                return null;
            }

            return new Date(`${turn.fecha}T${start}:00`);
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

        function renderMetrics() {
            const visibleTurns = filteredTurns();
            const activeTurns = visibleTurns.filter((turn) => normalizeState(turn.estado) === "en atencion");
            const completedTurns = visibleTurns.filter((turn) => normalizeState(turn.estado) === "completado");

            setText("finalizacionMetricAtencion", activeTurns.length);
            setText("finalizacionMetricCompletadas", completedTurns.length);
            setText("finalizacionMetricPendientes", activeTurns.length);
        }

        function actionButtons(turn) {
            const canFinish = normalizeState(turn.estado) === "en atencion";
            const finishButton = canFinish
                ? `<button type="button" class="btn btn-success btn-sm" data-action="finish" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-clipboard2-check me-1"></i>Finalizar consulta
                    </button>`
                : "";

            return `
                <div class="d-grid d-sm-flex gap-2">
                    <button type="button" class="btn btn-outline-primary btn-sm" data-action="detail" data-turn-id="${turn.id_turno}">
                        <i class="bi bi-eye me-1"></i>Ver detalle
                    </button>
                    ${finishButton}
                </div>
            `;
        }

        function renderTable() {
            const visibleTurns = filteredTurns();

            renderMetrics();

            if (visibleTurns.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="10" class="text-secondary">No hay consultas para los filtros seleccionados.</td></tr>';
                return;
            }

            tableBody.innerHTML = visibleTurns.map((turn) => {
                const patient = patientByTurn(turn);
                const doctor = doctorByTurn(turn);
                const specialty = doctor ? doctor.especialidad : turn.especialidad;

                return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</td>
                        <td>${escapeHtml(specialty || "-")}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td><span class="badge ${priorityClass(turn.prioridad)}">${escapeHtml(priorityLabel(turn.prioridad))}</span></td>
                        <td>${stateText(turn.estado)}</td>
                        <td>${escapeHtml(consultationStartValue(turn))}</td>
                        <td>${escapeHtml(consultationEndValue(turn))}</td>
                        <td>${actionButtons(turn)}</td>
                    </tr>
                `;
            }).join("");
        }

        function openConfirmModal(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || normalizeState(turn.estado) !== "en atencion") {
                return;
            }

            selectedTurnId = turn.id_turno;
            confirmModal.show();
        }

        function finishSelectedConsultation() {
            const now = new Date();
            const closingHour = currentTimeValue(now);

            turns = turns.map((turn) => {
                if (String(turn.id_turno) === String(selectedTurnId) && normalizeState(turn.estado) === "en atencion") {
                    const attentionMinutes = attentionDurationMinutes(turn, now);

                    return {
                        ...turn,
                        estado: "Completado",
                        fecha_cierre: now.toISOString(),
                        hora_cierre: closingHour,
                        tiempo_atencion_minutos: attentionMinutes
                    };
                }

                return turn;
            });
            persistTurns();
            renderTable();
            confirmModal.hide();
            showMessage("success", "Consulta finalizada correctamente.");
        }

        function renderDetail(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn) {
                return;
            }

            const patient = patientByTurn(turn);
            const doctor = doctorByTurn(turn);
            const content = document.getElementById("finalizacionDetalleContenido");
            const duration = turn.tiempo_atencion_minutos ?? attentionDurationMinutes(turn);
            const triageSummary = turn.id_triaje
                ? `Triaje asociado #${turn.id_triaje}. Prioridad ${turn.prioridad || "-"}, duracion estimada ${turn.duracion_estimada || "-"} minutos.`
                : `Prioridad ${turn.prioridad || "-"}, duracion estimada ${turn.duracion_estimada || "-"} minutos.`;

            content.innerHTML = `
                <dl class="row mb-0">
                    <dt class="col-sm-4 text-secondary">Paciente</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? fullName(patient) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">DNI</dt>
                    <dd class="col-sm-8">${escapeHtml(patient ? patient.dni : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Medico</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Especialidad</dt>
                    <dd class="col-sm-8">${escapeHtml(doctor ? doctor.especialidad : turn.especialidad || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Fecha</dt>
                    <dd class="col-sm-8">${formatDate(turn.fecha)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.hora_inicio)} a ${escapeHtml(turn.hora_fin || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Prioridad</dt>
                    <dd class="col-sm-8"><span class="badge ${priorityClass(turn.prioridad)}">${escapeHtml(priorityLabel(turn.prioridad))}</span></dd>
                    <dt class="col-sm-4 text-secondary">Estado</dt>
                    <dd class="col-sm-8">${stateText(turn.estado)}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de inicio</dt>
                    <dd class="col-sm-8">${escapeHtml(consultationStartValue(turn))}</dd>
                    <dt class="col-sm-4 text-secondary">Hora de cierre</dt>
                    <dd class="col-sm-8">${escapeHtml(consultationEndValue(turn))}</dd>
                    <dt class="col-sm-4 text-secondary">Tiempo de atencion</dt>
                    <dd class="col-sm-8">${escapeHtml(formatDuration(duration))}</dd>
                    <dt class="col-sm-4 text-secondary">Origen</dt>
                    <dd class="col-sm-8">${escapeHtml(turn.origen || "-")}</dd>
                    <dt class="col-sm-4 text-secondary">Triaje</dt>
                    <dd class="col-sm-8 mb-0">${escapeHtml(triageSummary)}</dd>
                </dl>
            `;
            detailModal.show();
        }

        function initFilters() {
            const specialties = [...new Set(doctors.map((doctor) => doctor.especialidad))].sort();

            setText("finalizacionSecretariaNavbar", fullName(secretary));
            renderSelect(
                filters.doctor,
                "Todos",
                doctors,
                (doctor) => doctorFullName(doctor),
                (doctor) => doctorFullName(doctor)
            );
            renderSelect(
                filters.specialty,
                "Todas",
                specialties,
                (specialty) => specialty,
                (specialty) => specialty
            );
        }

        initFilters();
        renderTable();

        Object.values(filters).forEach((filter) => {
            filter.addEventListener("input", renderTable);
            filter.addEventListener("change", renderTable);
        });
        tableBody.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");

            if (!button) {
                return;
            }

            if (button.dataset.action === "finish") {
                openConfirmModal(button.dataset.turnId);
            }

            if (button.dataset.action === "detail") {
                renderDetail(button.dataset.turnId);
            }
        });
        document.getElementById("finalizacionConfirmarBtn").addEventListener("click", finishSelectedConsultation);
    }

    async function initSecretaryMassReschedule() {
        const form = document.querySelector('[data-form="secretary-mass-reschedule"]');

        if (!form) {
            return;
        }

        const [usuarios, medicosData, turnosData, disponibilidadData] = await Promise.all([
            loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
            loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
            loadMock(MOCK_PATHS.APPOINTMENTS, fallbackData.turnos),
            loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad)
        ]);
        const secretary = currentSecretary(usuarios);
        const doctors = Array.isArray(medicosData.medicos) && medicosData.medicos.length > 0
            ? medicosData.medicos
            : doctorsFromUsers(usuarios);
        const patients = patientsFromUsers(usuarios);
        const loggedUser = currentUser();
        const loggedDoctor = loggedUser && roleMatches(loggedUser, "medico")
            ? doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(loggedUser.id_medico))
            : null;
        const selectableDoctors = loggedDoctor ? [loggedDoctor] : doctors;
        let turns = mergeStoredMassTurns(turnosList(turnosData));
        let availability = mergeStoredAvailability(
            LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY,
            Array.isArray(disponibilidadData) ? disponibilidadData : [],
            doctors
        );
        const storedProcess = readStoredJson(LOCAL_STORAGE_KEYS.MASS_RESCHEDULE, {});
        let affectedTurns = [];
        let proposals = Array.isArray(storedProcess.proposals) ? storedProcess.proposals : [];
        let waitlist = Array.isArray(storedProcess.waitlist) ? storedProcess.waitlist : [];

        const fields = {
            specialty: document.getElementById("reprogramacionEspecialidad"),
            doctor: document.getElementById("reprogramacionMedico"),
            date: document.getElementById("reprogramacionFecha"),
            start: document.getElementById("reprogramacionHoraInicio"),
            end: document.getElementById("reprogramacionHoraFin"),
            reason: document.getElementById("reprogramacionMotivo")
        };
        const message = document.getElementById("reprogramacionMensaje");
        const affectedTable = document.getElementById("reprogramacionAfectadosTabla");
        const proposalTable = document.getElementById("reprogramacionPropuestasTabla");
        const notificationContainer = document.getElementById("reprogramacionNotificaciones");
        const waitlistTable = document.getElementById("reprogramacionEsperaTabla");
        const availabilityWarning = document.getElementById("reprogramacionDisponibilidadAviso");
        const availabilityWarningText = document.getElementById("reprogramacionDisponibilidadTexto");
        const availabilityLoadButton = document.getElementById("reprogramacionCargarDisponibilidadBtn");
        const searchButton = document.getElementById("buscarAfectadosBtn");
        const executeButton = document.getElementById("ejecutarReprogramacionBtn");
        const confirmModal = new bootstrap.Modal(document.getElementById("confirmarReprogramacionModal"));

        function doctorFullName(doctor) {
            return `${doctor.nombre} ${doctor.apellido}`;
        }

        function patientByTurn(turn) {
            return patients.find((patient) => String(patient.id_paciente) === String(turn.id_paciente)) || null;
        }

        function doctorByTurn(turn) {
            return doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(turn.id_medico)) || null;
        }

        function priorityColor(priority) {
            if (priority === "Alta") {
                return "Rojo";
            }

            if (priority === "Media") {
                return "Amarillo";
            }

            return "Verde";
        }

        function addMinutes(timeValue, minutes) {
            const total = timeToMinutes(timeValue) + minutes;
            const hours = Math.floor(total / 60).toString().padStart(2, "0");
            const mins = (total % 60).toString().padStart(2, "0");
            return `${hours}:${mins}`;
        }

        function slotDateTime(slot) {
            return new Date(`${slot.fecha}T${slot.hora_inicio}:00`).getTime();
        }

        function compatibleMassTurn(turn) {
            return turn
                && turn.id_turno !== undefined
                && turn.id_paciente !== undefined
                && turn.id_medico !== undefined
                && turn.fecha
                && turn.hora_inicio
                && turn.estado;
        }

        function mergeStoredMassTurns(baseTurns) {
            const storedSecretaryTurns = readStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, null);
            const storedPatientTurns = readStoredJson(LOCAL_STORAGE_KEYS.PATIENT_TURNS, []);
            const base = Array.isArray(baseTurns) ? baseTurns : [];
            const stored = Array.isArray(storedSecretaryTurns) ? storedSecretaryTurns : [];
            const convertedPatientTurns = Array.isArray(storedPatientTurns)
                ? storedPatientTurns.map((turn) => ({
                    id_turno: turn.id,
                    id_paciente: turn.pacienteId,
                    id_medico: turn.medicoId,
                    id_disponibilidad: turn.disponibilidadId,
                    id_triaje: turn.idTriaje,
                    fecha: turn.fecha,
                    hora_inicio: turn.hora,
                    hora_fin: turn.horaFin || addMinutes(turn.hora, 20),
                    estado: turn.estado,
                    prioridad: priorityLabel(turn.prioridad),
                    color_prioridad: priorityColor(priorityLabel(turn.prioridad)),
                    duracion_estimada: Number.parseInt(turn.tiempoEstimado, 10) || 20,
                    fecha_solicitud: turn.fechaSolicitud || new Date().toISOString(),
                    origen: turn.origen || "Paciente"
                }))
                : [];
            const byId = new Map(base.map((turn) => [String(turn.id_turno), turn]));

            [...stored, ...convertedPatientTurns].filter(compatibleMassTurn).forEach((turn) => {
                byId.set(String(turn.id_turno), turn);
            });

            return [...byId.values()];
        }

        function persistState() {
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, turns);
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_AVAILABILITY, availability);
            writeStoredJson(LOCAL_STORAGE_KEYS.PATIENT_AVAILABILITY, availability);
            writeStoredJson(LOCAL_STORAGE_KEYS.MASS_RESCHEDULE, {
                proposals,
                waitlist
            });
        }

        function showMessage(type, text) {
            message.className = `alert alert-${type}`;
            message.textContent = text;
            message.classList.remove("d-none");
        }

        function setFieldError(fieldName, text) {
            const errorIds = {
                specialty: "reprogramacionEspecialidadError",
                doctor: "reprogramacionMedicoError",
                date: "reprogramacionFechaError",
                start: "reprogramacionHoraInicioError",
                end: "reprogramacionHoraFinError",
                reason: "reprogramacionMotivoError"
            };
            const error = document.getElementById(errorIds[fieldName]);
            const fieldMap = {
                specialty: fields.specialty,
                doctor: fields.doctor,
                date: fields.date,
                start: fields.start,
                end: fields.end,
                reason: fields.reason
            };
            const field = fieldMap[fieldName];

            if (!field || !error) {
                return;
            }

            field.classList.toggle("is-invalid", text !== "");
            error.textContent = text;
        }

        function clearErrors() {
            ["specialty", "doctor", "date", "start", "end", "reason"].forEach((fieldName) => setFieldError(fieldName, ""));
            message.classList.add("d-none");
        }

        function validateBlock() {
            let isValid = true;

            clearErrors();

            if (fields.specialty.value === "") {
                setFieldError("specialty", "Seleccione una especialidad.");
                isValid = false;
            }

            if (fields.doctor.value === "") {
                setFieldError("doctor", "Seleccione un medico.");
                isValid = false;
            }

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

        function renderSelect(select, firstLabel, items, valueFactory, labelFactory) {
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

        function fillSpecialties() {
            const specialties = [...new Set(selectableDoctors.map((doctor) => doctor.especialidad))].sort();

            renderSelect(
                fields.specialty,
                "Seleccione una especialidad",
                specialties,
                (specialty) => specialty,
                (specialty) => specialty
            );
        }

        function fillDoctors(specialty = "") {
            const filteredDoctors = specialty === ""
                ? selectableDoctors
                : selectableDoctors.filter((doctor) => doctor.especialidad === specialty);

            renderSelect(
                fields.doctor,
                "Seleccione un medico",
                filteredDoctors,
                (doctor) => String(doctor.id_medico || doctor.id),
                (doctor) => `${doctorFullName(doctor)} - ${doctor.especialidad}`
            );
        }

        function selectedDoctor() {
            return selectableDoctors.find((doctor) => String(doctor.id_medico || doctor.id) === fields.doctor.value) || null;
        }

        function isAffectedTurn(turn) {
            const state = normalizeState(turn.estado);
            const start = timeToMinutes(fields.start.value);
            const end = timeToMinutes(fields.end.value);
            const turnStart = timeToMinutes(turn.hora_inicio);
            const turnEnd = timeToMinutes(turn.hora_fin || turn.hora_inicio);

            return String(turn.id_medico) === fields.doctor.value
                && turn.fecha === fields.date.value
                && (state === "reservado" || state === "presente")
                && turnStart < end
                && turnEnd > start;
        }

        function sortedByPriority(items) {
            return [...items].sort((a, b) => {
                const rankDiff = priorityRank(a.prioridad || a.priority) - priorityRank(b.prioridad || b.priority);

                if (rankDiff !== 0) {
                    return rankDiff;
                }

                return String(a.hora_inicio || "").localeCompare(String(b.hora_inicio || ""));
            });
        }

        function blockContainsSlot(slot) {
            const slotStart = timeToMinutes(slot.hora_inicio);
            const slotEnd = timeToMinutes(slot.hora_fin || slot.hora_inicio);

            return String(slot.id_medico) === fields.doctor.value
                && slot.fecha === fields.date.value
                && slotStart < timeToMinutes(fields.end.value)
                && slotEnd > timeToMinutes(fields.start.value);
        }

        function availableSlotsForReschedule() {
            return availability
                .filter((slot) => slot.estado === "Disponible")
                .filter((slot) => String(slot.id_medico) === fields.doctor.value)
                .filter((slot) => slot.especialidad === fields.specialty.value)
                .filter((slot) => !blockContainsSlot(slot))
                .sort((a, b) => slotDateTime(a) - slotDateTime(b));
        }

        function showAvailabilityWarning(text, showLoadButton) {
            availabilityWarningText.textContent = text;
            availabilityLoadButton.classList.toggle("d-none", !showLoadButton);
            availabilityWarning.classList.remove("d-none");
        }

        function hideAvailabilityWarning() {
            availabilityWarning.classList.add("d-none");
            availabilityLoadButton.classList.add("d-none");
        }

        function hasAlternativeAvailability() {
            return availableSlotsForReschedule().length > 0;
        }

        function turnLabel(turn) {
            return `${formatDate(turn.fecha)} ${turn.hora_inicio}`;
        }

        function slotLabel(slot) {
            if (!slot) {
                return "Lista de espera";
            }

            return `${formatDate(slot.fecha)} ${slot.hora_inicio} - ${slot.medico}`;
        }

        function renderAffected() {
            executeButton.disabled = affectedTurns.length === 0;

            if (affectedTurns.length === 0) {
                affectedTable.innerHTML = '<tr><td colspan="9" class="text-secondary">No se encontraron turnos Reservados o Presentes dentro del bloque seleccionado.</td></tr>';
                return;
            }

            affectedTable.innerHTML = affectedTurns.map((turn) => {
                const patient = patientByTurn(turn);
                const doctor = doctorByTurn(turn);

                return `
                    <tr>
                        <td class="fw-semibold">${escapeHtml(patient ? fullName(patient) : "Paciente")}</td>
                        <td>${escapeHtml(patient ? patient.dni : "-")}</td>
                        <td>${escapeHtml(doctor ? doctorFullName(doctor) : "-")}</td>
                        <td>${escapeHtml(doctor ? doctor.especialidad : turn.especialidad || "-")}</td>
                        <td>${formatDate(turn.fecha)}</td>
                        <td>${escapeHtml(turn.hora_inicio)}</td>
                        <td><span class="badge ${priorityClass(turn.prioridad)}">${escapeHtml(turn.color_prioridad || turn.prioridad)}</span></td>
                        <td>${stateText(turn.estado)}</td>
                        <td>${escapeHtml(turn.origen || "-")}</td>
                    </tr>
                `;
            }).join("");
        }

        function proposalStateText(status) {
            return `<strong class="fw-semibold">${escapeHtml(status)}</strong>`;
        }

        function renderProposals() {
            if (waitlist.some((item) => item.reason === "Sin disponibilidad suficiente")) {
                showAvailabilityWarning(
                    "No hay disponibilidad suficiente para reprogramar todos los turnos. Los pacientes restantes seran colocados en lista de espera prioritaria.",
                    false
                );
            } else {
                hideAvailabilityWarning();
            }

            if (proposals.length === 0) {
                proposalTable.innerHTML = '<tr><td colspan="5" class="text-secondary">Ejecute la reprogramacion para generar propuestas.</td></tr>';
                return;
            }

            proposalTable.innerHTML = sortedByPriority(proposals).map((proposal) => `
                <tr>
                    <td class="fw-semibold">${escapeHtml(proposal.patientName)}</td>
                    <td><span class="badge ${priorityClass(proposal.priority)}">${escapeHtml(proposal.priority)}</span></td>
                    <td>${escapeHtml(proposal.previousLabel)}</td>
                    <td>${escapeHtml(slotLabel(proposal.slot))}</td>
                    <td>${proposalStateText(proposal.status)}</td>
                </tr>
            `).join("");
        }

        function renderNotifications() {
            if (proposals.length === 0) {
                notificationContainer.innerHTML = `
                    <div class="col-12">
                        <div class="alert alert-info mb-0" role="alert">
                            Las notificaciones se mostraran luego de generar propuestas con disponibilidad.
                        </div>
                    </div>
                `;
                return;
            }

            notificationContainer.innerHTML = proposals.map((proposal) => {
                const canAnswer = proposal.status === "Pendiente de confirmacion";
                const messageText = `Su turno fue reprogramado. Nueva fecha: ${formatDate(proposal.slot.fecha)}, horario: ${proposal.slot.hora_inicio}.`;

                return `
                    <div class="col-12 col-lg-6">
                        <article class="card appointment-card border h-100">
                            <div class="card-body">
                                <div class="d-flex justify-content-between gap-3 mb-3">
                                    <div>
                                        <p class="text-secondary small mb-1">${escapeHtml(proposal.contact || "Sin contacto")}</p>
                                        <h3 class="h6 fw-semibold mb-0">${escapeHtml(proposal.patientName)}</h3>
                                    </div>
                                    <strong class="fw-semibold">${escapeHtml(proposal.notificationStatus)}</strong>
                                </div>
                                <p class="small mb-3">${escapeHtml(messageText)}</p>
                                <div class="d-grid d-sm-flex gap-2 justify-content-sm-end">
                                    <button type="button" class="btn btn-outline-success btn-sm" data-action="confirm-proposal" data-proposal-id="${proposal.id}" ${canAnswer ? "" : "disabled"}>
                                        Confirmar cambio
                                    </button>
                                    <button type="button" class="btn btn-outline-danger btn-sm" data-action="reject-proposal" data-proposal-id="${proposal.id}" ${canAnswer ? "" : "disabled"}>
                                        Rechazar cambio
                                    </button>
                                </div>
                            </div>
                        </article>
                    </div>
                `;
            }).join("");
        }

        function renderWaitlist() {
            const sortedWaitlist = sortedByPriority(waitlist.map((item) => ({
                ...item,
                prioridad: item.priority
            })));

            if (sortedWaitlist.length === 0) {
                waitlistTable.innerHTML = '<tr><td colspan="5" class="text-secondary">No hay pacientes en espera prioritaria.</td></tr>';
                return;
            }

            waitlistTable.innerHTML = sortedWaitlist.map((item) => `
                <tr>
                    <td class="fw-semibold">${escapeHtml(item.patientName)}</td>
                    <td>${escapeHtml(item.dni || "-")}</td>
                    <td><span class="badge ${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span></td>
                    <td>${escapeHtml(item.reason)}</td>
                    <td><strong class="fw-semibold">En espera prioritaria</strong></td>
                </tr>
            `).join("");
        }

        function renderAll() {
            renderAffected();
            renderProposals();
            renderNotifications();
            renderWaitlist();
        }

        function searchAffectedTurns() {
            if (!validateBlock()) {
                return;
            }

            affectedTurns = sortedByPriority(turns.filter(isAffectedTurn));
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

            const slots = availableSlotsForReschedule();

            if (slots.length === 0) {
                showAvailabilityWarning(
                    "No existen horarios alternativos cargados para este medico. Debe cargarse una nueva disponibilidad medica antes de ejecutar la reprogramacion masiva.",
                    true
                );
                showMessage("warning", "No existen horarios alternativos cargados para este medico.");
                confirmModal.hide();
                return;
            }

            const nextProposals = [];
            const nextWaitlist = [];

            affectedTurns.forEach((turn, index) => {
                const patient = patientByTurn(turn);
                const slot = slots[index] || null;
                const priority = priorityLabel(turn.prioridad);

                if (!slot) {
                    nextWaitlist.push({
                        id: `espera-${turn.id_turno}`,
                        turnId: turn.id_turno,
                        patientName: patient ? fullName(patient) : "Paciente",
                        dni: patient ? patient.dni : "-",
                        priority,
                        reason: "Sin disponibilidad suficiente",
                        status: "En espera prioritaria"
                    });
                    return;
                }

                nextProposals.push({
                    id: `propuesta-${turn.id_turno}`,
                    turnId: turn.id_turno,
                    slot,
                    oldAvailabilityId: turn.id_disponibilidad,
                    patientName: patient ? fullName(patient) : "Paciente",
                    dni: patient ? patient.dni : "-",
                    contact: patient ? patient.telefono : "",
                    priority,
                    previousLabel: turnLabel(turn),
                    status: "Pendiente de confirmacion",
                    notificationStatus: "Enviada - Pendiente de respuesta",
                    reason: fields.reason.value
                });
            });

            proposals = nextProposals;
            waitlist = nextWaitlist;
            persistState();
            renderAll();
            confirmModal.hide();
            showMessage("success", "Propuestas generadas y notificaciones simuladas enviadas.");
        }

        function releaseAvailability(disponibilidadId) {
            availability = availability.map((slot) => {
                if (String(slot.id_disponibilidad) === String(disponibilidadId)) {
                    const released = { ...slot, estado: "Disponible" };
                    delete released.id_turno;
                    return released;
                }

                return slot;
            });
        }

        function occupyAvailability(disponibilidadId, turnId) {
            availability = availability.map((slot) => {
                if (String(slot.id_disponibilidad) === String(disponibilidadId)) {
                    return {
                        ...slot,
                        estado: "Ocupado",
                        id_turno: turnId
                    };
                }

                return slot;
            });
        }

        function confirmProposal(proposalId) {
            const proposal = proposals.find((item) => item.id === proposalId);

            if (!proposal || proposal.status !== "Pendiente de confirmacion") {
                return;
            }

            const slot = proposal.slot;
            turns = turns.map((turn) => {
                if (String(turn.id_turno) === String(proposal.turnId)) {
                    return {
                        ...turn,
                        id_medico: slot.id_medico,
                        id_disponibilidad: slot.id_disponibilidad,
                        fecha: slot.fecha,
                        hora_inicio: slot.hora_inicio,
                        hora_fin: slot.hora_fin,
                        estado: "Reservado",
                        motivo_reprogramacion: proposal.reason,
                        reprogramado: true
                    };
                }

                return turn;
            });
            releaseAvailability(proposal.oldAvailabilityId);
            occupyAvailability(slot.id_disponibilidad, proposal.turnId);
            proposals = proposals.map((item) => (
                item.id === proposalId
                    ? { ...item, status: "Confirmada", notificationStatus: "Confirmada por paciente" }
                    : item
            ));
            persistState();
            renderAll();
            showMessage("success", "Cambio confirmado y turno actualizado correctamente.");
        }

        function rejectProposal(proposalId) {
            const proposal = proposals.find((item) => item.id === proposalId);

            if (!proposal || proposal.status !== "Pendiente de confirmacion") {
                return;
            }

            proposals = proposals.map((item) => (
                item.id === proposalId
                    ? { ...item, status: "Rechazada", notificationStatus: "Rechazada por paciente" }
                    : item
            ));
            waitlist = [
                ...waitlist,
                {
                    id: `espera-rechazo-${proposal.turnId}`,
                    turnId: proposal.turnId,
                    patientName: proposal.patientName,
                    dni: proposal.dni,
                    priority: proposal.priority,
                    reason: "Paciente rechazo la propuesta",
                    status: "En espera prioritaria"
                }
            ];
            persistState();
            renderAll();
            showMessage("warning", "El paciente fue agregado a lista de espera prioritaria.");
        }

        setText("reprogramacionSecretariaNavbar", loggedDoctor ? doctorFullName(loggedDoctor) : fullName(secretary));
        fillSpecialties();
        fillDoctors();
        if (loggedDoctor) {
            fields.specialty.value = loggedDoctor.especialidad;
            fillDoctors(loggedDoctor.especialidad);
            fields.doctor.value = String(loggedDoctor.id_medico || loggedDoctor.id);
            fields.specialty.disabled = true;
            fields.doctor.disabled = true;
        }
        renderAll();

        fields.specialty.addEventListener("change", () => {
            if (loggedDoctor) {
                return;
            }

            fields.doctor.value = "";
            fillDoctors(fields.specialty.value);
            affectedTurns = [];
            executeButton.disabled = true;
            renderAffected();
        });
        fields.doctor.addEventListener("change", () => {
            if (loggedDoctor) {
                return;
            }

            const doctor = selectedDoctor();

            if (doctor) {
                fields.specialty.value = doctor.especialidad;
                fillDoctors(doctor.especialidad);
                fields.doctor.value = String(doctor.id_medico || doctor.id);
            }

            affectedTurns = [];
            executeButton.disabled = true;
            renderAffected();
        });
        [fields.date, fields.start, fields.end, fields.reason].forEach((field) => {
            field.addEventListener("input", () => {
                affectedTurns = [];
                executeButton.disabled = true;
                renderAffected();
            });
            field.addEventListener("change", () => {
                affectedTurns = [];
                executeButton.disabled = true;
                renderAffected();
            });
        });
        searchButton.addEventListener("click", searchAffectedTurns);
        executeButton.addEventListener("click", () => {
            if (affectedTurns.length === 0) {
                showMessage("warning", "Debe buscar turnos afectados antes de ejecutar la reprogramacion.");
                return;
            }

            if (!hasAlternativeAvailability()) {
                showAvailabilityWarning(
                    "No existen horarios alternativos cargados para este medico. Debe cargarse una nueva disponibilidad medica antes de ejecutar la reprogramacion masiva.",
                    true
                );
                showMessage("warning", "No existen horarios alternativos cargados para este medico.");
                return;
            }

            confirmModal.show();
        });
        document.getElementById("confirmarReprogramacionBtn").addEventListener("click", executeReschedule);
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

    await initSecretaryDashboard();
    await initSecretaryAvailability();
    await initSecretaryAppointments();
    await initSecretaryPresence();
    await initSecretaryConsultationClosure();
    await initSecretaryMassReschedule();
    await initSecretaryProfile();
});
