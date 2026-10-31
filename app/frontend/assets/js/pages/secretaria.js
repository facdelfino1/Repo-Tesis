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
        triaje: {
            triajes: []
        },
        disponibilidad: []
    };

    const [
        { LOCAL_STORAGE_KEYS, MOCK_PATHS },
        { clearStoredJson, loadMock, readStoredJson, writeStoredJson },
        { escapeHtml, normalizeState, normalizeText },
        { currentTimeValue, formatDate, formatToday, priorityLabel, timeToMinutes },
        { isStrongPassword, isValidEmail },
        { hideAlert, renderEmptyState, showAlert },
        { priorityClass, stateText: renderStateText },
        { clearErrors: clearFieldErrors, initPasswordToggles: componentInitPasswordToggles, setFieldError: applyFieldError },
        { getBootstrapModal, hideModal, showModal },
        { fillSelect: renderSelect },
        {
            availabilityDateTime,
            availabilityDurationMinutes,
            mergeAllStoredAvailability,
            mergeStoredAvailability
        },
        {
            finishConsultation,
            mergeStoredClosureTurns,
            mergeStoredPresenceTurns,
            mergeStoredSecretaryTurns: mergeStoredTurns,
            registerPresence,
            patientAvailableSlotsForTurn,
            turnCreationDate,
            preserveTurnCreationDate,
            turnosList
        },
        {
            calculateTriagePriority,
            validateTriageInput,
            normalizeTriageSpecialty,
            hasTriageSpecialty,
            triagePriorityForTurn,
            getTriage,
            triajesList
        },
        {
            renderSecretaryAppointmentDetail,
            renderSecretaryAppointmentsTable,
            renderSlotOptions
        },
        {
            initConsultationWorkflowFilters,
            initPresenceWorkflowFilters,
            renderConsultationWorkflowDetail,
            renderConsultationWorkflowTable,
            renderPresenceWorkflowDetail,
            renderPresenceWorkflowTable
        },
        { readAnswers, updateTriageQuestionnaire, renderTriageErrors },
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
            renderSecretaryAffected,
            renderSecretaryNotifications,
            renderSecretaryProposals,
            renderSecretaryWaitlist,
            showAvailabilityWarning: showRescheduleAvailabilityWarning
        },
        { initSecretaryAvailability: initSecretaryAvailabilityFeature }
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
        import(`${componentModuleBaseUrl}selects.js`),
        import(`${featureModuleBaseUrl}availability/availability-service.js`),
        import(`${featureModuleBaseUrl}appointments/appointments-service.js`),
        import(`${featureModuleBaseUrl}triage/triage-service.js`),
        import(`${featureModuleBaseUrl}appointments/appointments-ui.js`),
        import(`${featureModuleBaseUrl}appointments/appointments-workflow-ui.js`),
        import(`${featureModuleBaseUrl}triage/triage-ui.js`),
        import(`${featureModuleBaseUrl}rescheduling/rescheduling-service.js`),
        import(`${featureModuleBaseUrl}rescheduling/rescheduling-ui.js`),
        import(`${featureModuleBaseUrl}availability/availability-ui.js`)
    ]);

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

    function doctorById(usuarios, idMedico) {
        return doctorsFromUsers(usuarios).find((doctor) => doctor.id_medico === idMedico) || null;
    }

    function patientById(usuarios, idPaciente) {
        return patientsFromUsers(usuarios).find((patient) => patient.id_paciente === idPaciente) || null;
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
                <td>${renderStateText(turno.estado, escapeHtml)}</td>
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
        let turns = mergeStoredTurns(turnosList(turnosData)).map((turn) => {
            const doctor = doctors.find((item) => String(item.id_medico || item.id) === String(turn.id_medico));
            const specialty = doctor?.especialidad || turn.especialidad;
            return { ...turn, especialidad: specialty, prioridad: triagePriorityForTurn(turn, specialty),
                triaje: hasTriageSpecialty(specialty) ? turn.triaje : null };
        });
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
        const createForm = document.getElementById("asignarTurnoForm");
        const createConfirmButton = createForm.querySelector('[type="submit"]');
        const createModal = getBootstrapModal(document.getElementById("asignarTurnoModal"));
        const editModal = getBootstrapModal(document.getElementById("modificarTurnoModal"));
        const cancelModal = getBootstrapModal(document.getElementById("cancelarTurnoModal"));
        const detailModal = getBootstrapModal(document.getElementById("detalleTurnoModal"));

        function doctorFullName(doctor) {
            return `${doctor.nombre} ${doctor.apellido}`;
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

        function calculateTriage() {
            const doctor = selectedCreateDoctor();
            if (!doctor || !hasTriageSpecialty(doctor.especialidad)) return null;
            const input = readAnswers(createForm, normalizeTriageSpecialty(doctor.especialidad));
            return validateTriageInput(input).valid ? { ...input, prioridad: calculateTriagePriority(input) } : null;
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
            showAlert(message, type, text, {
                scrollIntoView: true
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

        function availableSlots({ specialty, doctorId, excludeId }) {
            availability = mergeAllStoredAvailability(Array.isArray(disponibilidadData) ? disponibilidadData : [],
                { conservative: true, doctors });
            return patientAvailableSlotsForTurn(availability, {
                medicoId: doctorId, especialidad: specialty, disponibilidadId: excludeId
            });
        }

        function refreshCreateSlots() {
            const doctor = selectedCreateDoctor();
            const patientReady = createFields.dni.value.trim() && createFields.name.value.trim() && createFields.surname.value.trim();
            const ready = patientReady && doctor && (!hasTriageSpecialty(doctor.especialidad) || calculateTriage());
            const slots = ready ? availableSlots({ specialty: doctor.especialidad, doctorId: doctor.id_medico || doctor.id }) : [];
            renderSlotOptions(createFields.slot, slots, "No hay horarios disponibles para el criterio seleccionado.");
            createConfirmButton.disabled = true;
            document.getElementById("asignarDisponibilidadAyuda").textContent = ready && slots.length === 0
                ? "No hay horarios compatibles. Se requiere revisión de agenda; no se ha reservado un turno."
                : "Complete paciente, médico y el cuestionario correspondiente para consultar horarios.";
        }

        function refreshTriageResult() {
            const doctor = selectedCreateDoctor();
            const patientReady = createFields.dni.value.trim() && createFields.name.value.trim() && createFields.surname.value.trim();
            const specialty = doctor && patientReady ? normalizeTriageSpecialty(doctor.especialidad) : "";
            updateTriageQuestionnaire(createForm, specialty);
            const triage = specialty ? calculateTriage() : null;
            const resultBox = document.getElementById("asignarTriajeResultado");
            resultBox.classList.toggle("d-none", !triage);
            const errors = hasTriageSpecialty(specialty)
                ? validateTriageInput(readAnswers(createForm, specialty)).errors : {};
            renderTriageErrors(document.getElementById("asignarTriajeError"), errors);
            if (triage) {
                const badge = document.getElementById("asignarTriajePrioridad");
                badge.textContent = triage.prioridad;
                badge.className = "badge " + priorityClass(triage.prioridad);
            }
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
            availability = availability.map((item) => String(item.id_disponibilidad) === String(slot.id_disponibilidad)
                ? { ...item, estado: "Ocupado", id_turno: turnId } : item);
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

        function renderTable() {
            renderSecretaryAppointmentsTable({
                tableBody,
                visibleTurns: filteredTurns(),
                totalTurns: turns.length,
                patientByTurn,
                doctorByTurn,
                fullName,
                doctorFullName,
                setText
            });
        }

        function renderDetail(turnId) {
            renderSecretaryAppointmentDetail({
                turnId,
                turns,
                triages,
                detailModal,
                getTriage,
                patientByTurn,
                doctorByTurn,
                fullName,
                doctorFullName
            });
        }

        function openEditModal(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || !["reservado", "presente", "pendiente"].includes(normalizeState(turn.estado))) {
                return;
            }

            const patient = patientByTurn(turn);
            const doctor = doctorByTurn(turn);
            selectedTurnId = turn.id_turno;
            document.getElementById("modificarPacienteResumen").textContent = patient ? `${fullName(patient)} - DNI ${patient.dni}` : "-";
            const priorityBadge = document.getElementById("modificarPrioridadResumen");
            priorityBadge.textContent = turn.prioridad ?? "Sin prioridad";
            priorityBadge.className = `badge ${priorityClass(turn.prioridad)}`;
            editFields.specialty.value = doctor ? doctor.especialidad : "";
            fillDoctorOptions(editFields.doctor, editFields.specialty.value);
            editFields.doctor.value = doctor ? String(doctor.id_medico || doctor.id) : "";
            refreshEditSlots();
            showModal(editModal);
        }

        function refreshEditSlots() {
            const turn = turns.find((item) => String(item.id_turno) === String(selectedTurnId));
            const doctor = turn && doctorByTurn(turn);
            const slots = turn && doctor ? availableSlots({
                specialty: turn.especialidad || doctor.especialidad, doctorId: turn.id_medico,
                excludeId: turn.id_disponibilidad
            }) : [];
            renderSlotOptions(editFields.slot, slots, "No hay horarios disponibles para modificar el turno.");
        }

        function openCancelModal(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || !["reservado", "presente", "pendiente"].includes(normalizeState(turn.estado))) {
                return;
            }

            selectedTurnId = turn.id_turno;
            showModal(cancelModal);
        }

        function createAppointment(event) {
            event.preventDefault();
            const doctor = selectedCreateDoctor();
            const option = createFields.slot.selectedOptions[0];
            const displayed = option?.dataset.slot ? JSON.parse(option.dataset.slot) : null;
            if (!doctor || !displayed || !createFields.dni.value.trim() || !createFields.name.value.trim() || !createFields.surname.value.trim()) {
                showMessage("danger", "Complete paciente, médico y horario antes de confirmar.");
                return;
            }
            const triageResult = calculateTriage();
            if (hasTriageSpecialty(doctor.especialidad) && !triageResult) {
                refreshTriageResult();
                showMessage("danger", "Complete las respuestas válidas del triaje.");
                return;
            }
            const slot = availableSlots({ specialty: doctor.especialidad, doctorId: doctor.id_medico || doctor.id })
                .find((item) => String(item.id_disponibilidad) === String(displayed.id_disponibilidad)
                    && ["id_medico", "especialidad", "fecha", "hora_inicio", "hora_fin"]
                        .every((field) => String(item[field]) === String(displayed[field])));
            if (!slot) {
                refreshCreateSlots();
                showMessage("warning", "El horario cambió o ya no está disponible. Seleccione otro horario.");
                return;
            }
            const patient = currentPatientFromCreateForm();
            const nextTurnId = turns.reduce((max, turn) => Math.max(max, Number(turn.id_turno) || 0), 1000) + 1;
            const nextTriageId = triageResult ? triages.reduce((max, item) => Math.max(max, Number(item.id_triaje) || 0), 500) + 1 : null;
            const creationDate = new Date().toISOString();
            occupyAvailability(slot, nextTurnId);
            const newTurn = {
                id_turno: nextTurnId, id_paciente: patient.id_paciente, id_medico: doctor.id_medico || doctor.id,
                especialidad: doctor.especialidad, id_disponibilidad: slot.id_disponibilidad, id_triaje: nextTriageId,
                fecha: slot.fecha, hora_inicio: slot.hora_inicio, hora_fin: slot.hora_fin,
                estado: "Reservado", prioridad: triageResult?.prioridad ?? null, triaje: triageResult,
                duracion_estimada: availabilityDurationMinutes(slot.hora_inicio, slot.hora_fin),
                fecha_hora_creacion: creationDate, fecha_solicitud: creationDate, origen: "Secretaria"
            };
            turns = [...turns, newTurn];
            if (triageResult) triages = [...triages, {
                id_triaje: nextTriageId, id_turno: nextTurnId, id_paciente: patient.id_paciente,
                ...triageResult, fecha: creationDate.slice(0, 10)
            }];
            persistState();
            event.target.reset();
            fillDoctorOptions(createFields.doctor);
            refreshTriageResult();
            renderTable();
            hideModal(createModal);
            showMessage("success", "Turno asignado correctamente.");
        }

        function saveEditedAppointment(event) {
            event.preventDefault();
            const turn = turns.find((item) => String(item.id_turno) === String(selectedTurnId));
            const doctor = turn && doctorByTurn(turn);
            const option = editFields.slot.selectedOptions[0];
            const displayed = option?.dataset.slot ? JSON.parse(option.dataset.slot) : null;
            if (!turn || !doctor || !displayed || !["reservado", "presente", "pendiente"].includes(normalizeState(turn.estado))
                || (turn.especialidad && turn.especialidad !== doctor.especialidad)) {
                showMessage("danger", "El turno no permite modificar su horario.");
                return;
            }
            const slot = availableSlots({ specialty: turn.especialidad || doctor.especialidad,
                doctorId: turn.id_medico, excludeId: turn.id_disponibilidad })
                .find((item) => String(item.id_disponibilidad) === String(displayed.id_disponibilidad)
                    && ["id_medico", "especialidad", "fecha", "hora_inicio", "hora_fin"]
                        .every((field) => String(item[field]) === String(displayed[field])));
            const oldSlot = availability.find((item) => String(item.id_disponibilidad) === String(turn.id_disponibilidad));
            if (!slot || (oldSlot?.id_turno != null && String(oldSlot.id_turno) !== String(turn.id_turno))) {
                refreshEditSlots();
                showMessage("warning", "El horario ya no está disponible o tiene una asociación incompatible.");
                return;
            }
            releaseAvailability(turn.id_disponibilidad);
            occupyAvailability(slot, turn.id_turno);
            turns = turns.map((item) => item === turn ? {
                ...item, id_disponibilidad: slot.id_disponibilidad, fecha: slot.fecha,
                hora_inicio: slot.hora_inicio, hora_fin: slot.hora_fin,
                duracion_estimada: availabilityDurationMinutes(slot.hora_inicio, slot.hora_fin)
            } : item);
            persistState();
            renderTable();
            hideModal(editModal);
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
            hideModal(cancelModal);
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
        createFields.dni.addEventListener("input", () => { fillPatientFromDni(); refreshTriageResult(); });
        [createFields.name, createFields.surname].forEach((field) => field.addEventListener("input", refreshTriageResult));
        createFields.slot.addEventListener("change", () => { createConfirmButton.disabled = !createFields.slot.value; });
        createFields.specialty.addEventListener("change", () => {
            createFields.doctor.value = "";
            fillDoctorOptions(createFields.doctor, createFields.specialty.value);
            refreshTriageResult();
        });
        createFields.doctor.addEventListener("change", () => {
            const doctor = selectedCreateDoctor();

            if (doctor) {
                createFields.specialty.value = doctor.especialidad;
                fillDoctorOptions(createFields.doctor, doctor.especialidad);
                createFields.doctor.value = String(doctor.id_medico || doctor.id);
            }

            refreshTriageResult();
        });
        createForm.querySelectorAll("[data-triage-specialty] input, [data-triage-specialty] select").forEach((field) => {
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
            applyFieldError(
                fields,
                fieldName,
                text,
                (name) => document.getElementById(`perfilSecretaria${name.charAt(0).toUpperCase()}${name.slice(1)}Error`)
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
        componentInitPasswordToggles(form);

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
        const confirmModal = getBootstrapModal(document.getElementById("presenciaConfirmarModal"));
        const detailModal = getBootstrapModal(document.getElementById("presenciaDetalleModal"));
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

        function persistTurns() {
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, turns);
        }

        function showMessage(type, text) {
            showAlert(message, type, text);
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

        function renderTable() {
            renderPresenceWorkflowTable({
                tableBody,
                dateTurns: selectedDateTurns(),
                visibleTurns: filteredDateTurns(),
                patientByTurn,
                doctorByTurn,
                fullName,
                doctorFullName,
                setText
            });
        }

        function openConfirmModal(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || normalizeState(turn.estado) !== "reservado") {
                return;
            }

            selectedTurnId = turn.id_turno;
            showModal(confirmModal);
        }

        function registerSelectedPresence() {
            turns = registerPresence(turns, selectedTurnId, new Date());
            persistTurns();
            renderTable();
            hideModal(confirmModal);
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

            renderPresenceWorkflowDetail({
                content,
                turn,
                patient,
                doctor,
                fullName,
                doctorFullName
            });
            showModal(detailModal);
        }

        function initFilters() {
            initPresenceWorkflowFilters({
                filters,
                doctors,
                secretary,
                fullName,
                doctorFullName,
                setText
            });
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
        const confirmModal = getBootstrapModal(document.getElementById("finalizacionConfirmarModal"));
        const detailModal = getBootstrapModal(document.getElementById("finalizacionDetalleModal"));
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

        function persistTurns() {
            writeStoredJson(LOCAL_STORAGE_KEYS.SECRETARY_TURNS, turns);
        }

        function showMessage(type, text) {
            showAlert(message, type, text);
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

        function renderTable() {
            renderConsultationWorkflowTable({
                tableBody,
                visibleTurns: filteredTurns(),
                patientByTurn,
                doctorByTurn,
                fullName,
                doctorFullName,
                setText
            });
        }

        function openConfirmModal(turnId) {
            const turn = turns.find((item) => String(item.id_turno) === String(turnId));

            if (!turn || normalizeState(turn.estado) !== "en atencion") {
                return;
            }

            selectedTurnId = turn.id_turno;
            showModal(confirmModal);
        }

        function finishSelectedConsultation() {
            const now = new Date();

            turns = finishConsultation(turns, selectedTurnId, now, currentTimeValue(now));
            persistTurns();
            renderTable();
            hideModal(confirmModal);
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
            renderConsultationWorkflowDetail({
                content,
                turn,
                patient,
                doctor,
                fullName,
                doctorFullName
            });
            showModal(detailModal);
        }

        function initFilters() {
            initConsultationWorkflowFilters({
                filters,
                doctors,
                secretary,
                fullName,
                doctorFullName,
                setText
            });
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
        const message = document.getElementById("reprogramacionMensaje");
        const storedProcess = readStoredJson(LOCAL_STORAGE_KEYS.MASS_RESCHEDULE, {});
        let affectedTurns = [];
        let proposals = [];
        let waitlist = [];
        try {
            proposals = restoreRescheduleItems(Array.isArray(storedProcess.proposals) ? storedProcess.proposals : [], turns);
            waitlist = restoreRescheduleItems(Array.isArray(storedProcess.waitlist) ? storedProcess.waitlist : [], turns);
            orderRescheduleTurns([...proposals, ...waitlist]);
        } catch (error) {
            proposals = []; waitlist = [];
            showAlert(message, "warning", error.message);
        }

        const fields = {
            specialty: document.getElementById("reprogramacionEspecialidad"),
            doctor: document.getElementById("reprogramacionMedico"),
            date: document.getElementById("reprogramacionFecha"),
            start: document.getElementById("reprogramacionHoraInicio"),
            end: document.getElementById("reprogramacionHoraFin"),
            reason: document.getElementById("reprogramacionMotivo")
        };
        const affectedTable = document.getElementById("reprogramacionAfectadosTabla");
        const proposalTable = document.getElementById("reprogramacionPropuestasTabla");
        const notificationContainer = document.getElementById("reprogramacionNotificaciones");
        const waitlistTable = document.getElementById("reprogramacionEsperaTabla");
        const availabilityWarning = document.getElementById("reprogramacionDisponibilidadAviso");
        const availabilityWarningText = document.getElementById("reprogramacionDisponibilidadTexto");
        const availabilityLoadButton = document.getElementById("reprogramacionCargarDisponibilidadBtn");
        const availabilityWarningElements = {
            container: availabilityWarning,
            text: availabilityWarningText,
            loadButton: availabilityLoadButton
        };
        const searchButton = document.getElementById("buscarAfectadosBtn");
        const executeButton = document.getElementById("ejecutarReprogramacionBtn");
        const confirmModal = getBootstrapModal(document.getElementById("confirmarReprogramacionModal"));

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
                    especialidad: turn.especialidad,
                    prioridad: turn.prioridad,
                    duracion_estimada: Number.parseInt(turn.tiempoEstimado, 10) || 20,
                    fecha_hora_creacion: turnCreationDate(turn),
                    fecha_solicitud: turnCreationDate(turn),
                    origen: turn.origen || "Paciente"
                }))
                : [];
            const byId = new Map();
            base.forEach((turn) => byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn)));

            [...stored, ...convertedPatientTurns].filter(compatibleMassTurn).forEach((turn) => {
                byId.set(String(turn.id_turno), preserveTurnCreationDate(byId.get(String(turn.id_turno)), turn));
            });

            return [...byId.values()].map((turn) => {
                const doctor = doctors.find((item) => String(item.id_medico || item.id) === String(turn.id_medico));
                const specialty = turn.especialidad || doctor?.especialidad;
                return { ...preserveTurnCreationDate(null, turn), especialidad: specialty,
                    prioridad: reschedulePriority({ ...turn, especialidad: specialty }) };
            });
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
            showAlert(message, type, text);
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
            const fieldMap = {
                specialty: fields.specialty,
                doctor: fields.doctor,
                date: fields.date,
                start: fields.start,
                end: fields.end,
                reason: fields.reason
            };
            applyFieldError(fieldMap, fieldName, text, (name) => document.getElementById(errorIds[name]));
        }

        function clearErrors() {
            clearFieldErrors(
                {
                    specialty: fields.specialty,
                    doctor: fields.doctor,
                    date: fields.date,
                    start: fields.start,
                    end: fields.end,
                    reason: fields.reason
                },
                setFieldError,
                {
                    onClear: () => hideAlert(message)
                }
            );
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

        function rescheduleCriteria() {
            return {
                doctorId: fields.doctor.value,
                specialty: fields.specialty.value,
                date: fields.date.value,
                start: fields.start.value,
                end: fields.end.value
            };
        }

        function currentRescheduleSlots() {
            availability = mergeAllStoredAvailability(Array.isArray(disponibilidadData) ? disponibilidadData : [],
                { conservative: true, doctors });
            return getAvailableSlotsForReschedule(availability, rescheduleCriteria());
        }

        function hasAlternativeAvailability() {
            return currentRescheduleSlots().length > 0;
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

        function renderAffectedState() {
            renderSecretaryAffected({
                affectedTable,
                affectedTurns,
                executeButton,
                patientByTurn,
                doctorByTurn,
                fullName,
                doctorFullName
            });
        }

        function renderAll() {
            renderAffectedState();
            renderSecretaryProposals({
                proposalTable,
                proposals,
                waitlist,
                slotLabel,
                warningElements: availabilityWarningElements
            });
            renderSecretaryNotifications({
                notificationContainer,
                proposals
            });
            renderSecretaryWaitlist({
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
                renderAll();
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
                showRescheduleAvailabilityWarning(
                    availabilityWarningElements,
                    "No existen horarios alternativos cargados para este medico. Debe cargarse una nueva disponibilidad medica antes de ejecutar la reprogramacion masiva.",
                    true
                );
                showMessage("warning", "No existen horarios alternativos cargados para este medico.");
                hideModal(confirmModal);
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
                    proposalIdPrefix: "propuesta-",
                    waitlistIdPrefix: "espera-",
                    notificationStatus: "Enviada - Pendiente de respuesta"
                });
            } catch (error) {
                showMessage("warning", error.message);
                return;
            }

            proposals = nextProcess.proposals;
            waitlist = nextProcess.waitlist;
            persistState();
            renderAll();
            hideModal(confirmModal);
            showMessage("success", "Propuestas generadas y notificaciones simuladas enviadas.");
        }

        function confirmProposal(proposalId) {
            availability = mergeAllStoredAvailability(Array.isArray(disponibilidadData) ? disponibilidadData : [],
                { conservative: true, doctors });
            const nextState = confirmRescheduleProposal({
                turns,
                availability,
                proposals,
                proposalId
            });

            if (!nextState) {
                showMessage("warning", "No se pudo confirmar: el horario cambió, está ocupado o no corresponde a la agenda.");
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
                turns,
                proposals,
                waitlist,
                proposalId,
                waitlistIdPrefix: "espera-rechazo-"
            });

            if (!nextState) {
                return;
            }

            turns = nextState.turns;
            proposals = nextState.proposals;
            waitlist = nextState.waitlist;
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
            renderAffectedState();
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
            renderAffectedState();
        });
        [fields.date, fields.start, fields.end, fields.reason].forEach((field) => {
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

            if (!hasAlternativeAvailability()) {
                showRescheduleAvailabilityWarning(
                    availabilityWarningElements,
                    "No existen horarios alternativos cargados para este medico. Debe cargarse una nueva disponibilidad medica antes de ejecutar la reprogramacion masiva.",
                    true
                );
                showMessage("warning", "No existen horarios alternativos cargados para este medico.");
                return;
            }

            showModal(confirmModal);
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
    await initSecretaryAvailabilityFeature({
        currentSecretary,
        doctorsFromUsers,
        fallbackData,
        fullName,
        setText
    });
    await initSecretaryAppointments();
    await initSecretaryPresence();
    await initSecretaryConsultationClosure();
    await initSecretaryMassReschedule();
    await initSecretaryProfile();
});
