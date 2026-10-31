import { LOCAL_STORAGE_KEYS, MOCK_PATHS, SESSION_STORAGE_KEYS } from "../../core/constants.js";
import { loadMock, readStoredJson, writeStoredJson } from "../../core/storage.js";
import { removeSessionItem } from "../../core/session.js";
import { escapeHtml } from "../../core/helpers.js";
import { formatDate, timeToMinutes } from "../../core/formatters.js";
import { hideAlert, showAlert } from "../../components/alerts.js";
import { stateText as renderStateText } from "../../components/badges.js";
import { clearErrors as clearFieldErrors, setFieldError as applyFieldError } from "../../components/forms.js";
import { getBootstrapModal, showModal } from "../../components/modals.js";
import { renderTableEmptyRow } from "../../components/tables.js";
import {
    buildAvailabilityBlocks,
    availabilityDurationMinutes,
    persistAvailabilityChanges,
    hasOverlap,
    mergeAllStoredAvailability,
    mergeStoredAvailability
} from "./availability-service.js";

export async function initDoctorAvailability(config) {
    const {
        currentUser,
        doctorsFromData,
        fallbackData,
        fullName,
        renderUnauthorized,
        roleMatches,
        setText
    } = config;
    const form = document.querySelector('[data-form="doctor-availability"]');

    if (!form) {
        return;
    }

    const [usuarios, medicosData, disponibilidadData] = await Promise.all([
        loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
        loadMock(MOCK_PATHS.DOCTORS, fallbackData.medicos),
        loadMock(MOCK_PATHS.AVAILABILITY, fallbackData.disponibilidad)
    ]);
    const loggedUser = currentUser();
    const message = document.getElementById("disponibilidadMedicoMensaje");
    const tableBody = document.getElementById("disponibilidadMedicoTabla");
    const generateButton = document.getElementById("generarBloquesMedicoBtn");
    const cancelButton = document.getElementById("cancelarDisponibilidadMedicoBtn");
    const confirmExitButton = document.getElementById("confirmarSalirSinGuardarMedicoBtn");
    const exitModalElement = document.getElementById("salirSinGuardarMedicoModal");
    const exitModal = getBootstrapModal(exitModalElement);
    const preview = document.getElementById("bloquesMedicoPreview");
    const emptyPreview = document.getElementById("bloquesMedicoVacio");
    const fields = {
        date: document.getElementById("disponibilidadMedicoFecha"),
        start: document.getElementById("disponibilidadMedicoHoraInicio"),
        end: document.getElementById("disponibilidadMedicoHoraFin")
    };
    const baseSlotDuration = 20;
    let generatedBlocks = [];

    if (!loggedUser || !roleMatches(loggedUser, "medico")) {
        renderUnauthorized();
        form.classList.add("d-none");

        if (tableBody) {
            tableBody.innerHTML = renderTableEmptyRow(5, "No hay informacion disponible para este usuario.");
        }

        return;
    }

    const doctors = doctorsFromData(usuarios, medicosData);
    const mockDoctor = doctors.find((doctor) => String(doctor.id_medico || doctor.id) === String(loggedUser.id_medico))
        || loggedUser;
    const storedDoctor = readStoredJson(LOCAL_STORAGE_KEYS.DOCTOR_PROFILE, null);
    const doctor = storedDoctor && String(storedDoctor.id_medico) === String(mockDoctor.id_medico || mockDoctor.id)
        ? {
            ...mockDoctor,
            ...loggedUser,
            ...storedDoctor,
            matricula: mockDoctor.matricula,
            especialidad: mockDoctor.especialidad
        }
        : {
            ...mockDoctor,
            ...loggedUser,
            matricula: mockDoctor.matricula,
            especialidad: mockDoctor.especialidad
        };
    let availability = mergeAllStoredAvailability(Array.isArray(disponibilidadData) ? disponibilidadData : []);

    function doctorId() {
        return doctor.id_medico || doctor.id;
    }

    function ownAvailability() {
        return availability
            .filter((item) => String(item.id_medico) === String(doctorId()))
            .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || timeToMinutes(a.hora_inicio) - timeToMinutes(b.hora_inicio));
    }

    function setFieldError(fieldName, text) {
        const errorIds = {
            date: "disponibilidadMedicoFechaError",
            start: "disponibilidadMedicoHoraInicioError",
            end: "disponibilidadMedicoHoraFinError"
        };
        applyFieldError(fields, fieldName, text, (name) => document.getElementById(errorIds[name]));
    }

    function clearErrors() {
        clearFieldErrors(fields, setFieldError, {
            onClear: () => hideAlert(message)
        });
    }

    function showMessage(type, text) {
        showAlert(message, type, text);
    }

    function validateForm() {
        let isValid = true;

        clearErrors();

        if (fields.date.value === "") {
            setFieldError("date", "La fecha es obligatoria.");
            isValid = false;
        }

        if (fields.start.value === "") {
            setFieldError("start", "La hora de inicio es obligatoria.");
            isValid = false;
        }

        if (fields.end.value === "") {
            setFieldError("end", "La hora fin es obligatoria.");
            isValid = false;
        }

        if (fields.start.value !== "" && fields.end.value !== ""
            && timeToMinutes(fields.start.value) >= timeToMinutes(fields.end.value)) {
            setFieldError("start", "La hora de inicio debe ser menor que la hora fin.");
            setFieldError("end", "Revise el rango horario.");
            isValid = false;
        }

        if (fields.start.value !== "" && fields.end.value !== ""
            && timeToMinutes(fields.end.value) - timeToMinutes(fields.start.value) < baseSlotDuration) {
            setFieldError("end", "El rango horario debe permitir al menos un bloque de 20 minutos.");
            isValid = false;
        }

        if (isValid && hasOverlap(ownAvailability(), fields.date.value, fields.start.value, fields.end.value)) {
            setFieldError("start", "El rango se superpone con disponibilidad existente.");
            setFieldError("end", "Seleccione un horario libre de su agenda.");
            isValid = false;
        }

        return isValid;
    }

    function renderPreview() {
        if (!preview || !emptyPreview) {
            return;
        }

        emptyPreview.classList.toggle("d-none", generatedBlocks.length > 0);
        preview.innerHTML = generatedBlocks.map((block) => `
            <div class="col-12 col-sm-6 col-xl-3">
                <div class="metric-box rounded-3 p-3 h-100">
                    <p class="text-secondary small mb-1">${formatDate(block.fecha)}</p>
                    <p class="fw-semibold mb-0">${escapeHtml(block.hora_inicio)} - ${escapeHtml(block.hora_fin)}</p>
                </div>
            </div>
        `).join("");
    }

    function renderAvailabilityTable() {
        const rows = ownAvailability();

        if (!tableBody) {
            return;
        }

        if (rows.length === 0) {
            tableBody.innerHTML = renderTableEmptyRow(5, "No existe disponibilidad cargada para su agenda profesional.");
            return;
        }

        tableBody.innerHTML = rows.map((item) => `
            <tr>
                <td>${formatDate(item.fecha)}</td>
                <td>${escapeHtml(item.hora_inicio)}</td>
                <td>${escapeHtml(item.hora_fin)}</td>
                <td>${renderStateText(item.estado, escapeHtml)}</td>
                <td>${escapeHtml(item.origen || "Mock")}</td>
            </tr>
        `).join("");
    }

    function persistAvailability(changedSlots) {
        persistAvailabilityChanges(changedSlots);
    }

    function generateBlocks() {
        if (!validateForm()) {
            generatedBlocks = [];
            renderPreview();
            return;
        }

        generatedBlocks = buildAvailabilityBlocks({
            doctorId: doctorId(),
            doctorName: fullName(doctor),
            specialty: doctor.especialidad,
            date: fields.date.value,
            start: fields.start.value,
            end: fields.end.value,
            origin: "Medico",
            slotDuration: baseSlotDuration
        });
        renderPreview();
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
        persistAvailability(blocksToSave);
        generatedBlocks = [];
        form.reset();
        renderPreview();
        renderAvailabilityTable();
        showMessage("success", "Disponibilidad medica cargada correctamente.");
    }

    function clearTemporaryData() {
        generatedBlocks = [];
        form.reset();
        renderPreview();
        clearErrors();
        removeSessionItem(SESSION_STORAGE_KEYS.DOCTOR_TEMP_AVAILABILITY);
    }

    setText("disponibilidadMedicoNavbar", fullName(doctor));
    renderPreview();
    renderAvailabilityTable();

    Object.values(fields).forEach((field) => {
        field.addEventListener("input", () => {
            generatedBlocks = [];
            renderPreview();
            clearErrors();
        });
    });

    if (generateButton) {
        generateButton.addEventListener("click", generateBlocks);
    }

    if (cancelButton) {
        cancelButton.addEventListener("click", () => {
            if (exitModal) {
                showModal(exitModal);
                return;
            }

            clearTemporaryData();
            window.location.href = "dashboard.html";
        });
    }

    if (confirmExitButton) {
        confirmExitButton.addEventListener("click", () => {
            clearTemporaryData();
            window.location.href = "dashboard.html";
        });
    }

    form.addEventListener("submit", saveAvailability);
}

export async function initSecretaryAvailability(config) {
    const {
        currentSecretary,
        doctorsFromUsers,
        fallbackData,
        fullName,
        setText
    } = config;
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
    const exitModal = getBootstrapModal(exitModalElement);
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
        const errorIds = {
            specialty: "disponibilidadEspecialidadError",
            doctor: "disponibilidadMedicoError",
            date: "disponibilidadFechaError",
            start: "disponibilidadHoraInicioError",
            end: "disponibilidadHoraFinError"
        };
        applyFieldError(fields, field, text, (name) => document.getElementById(errorIds[name]));
    }

    function clearErrors() {
        clearFieldErrors(fields, setFieldError, {
            onClear: () => hideAlert(message)
        });
    }

    function showMessage(type, text) {
        showAlert(message, type, text);
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

        const doctor = selectedDoctor();
        if (!doctor || fields.specialty.value !== doctor.especialidad) {
            setFieldError("doctor", "Seleccione un médico de la especialidad indicada.");
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

        const duration = availabilityDurationMinutes(fields.start.value, fields.end.value);
        if (fields.start.value !== "" && fields.end.value !== ""
            && (duration === null || duration < baseSlotDuration)) {
            setFieldError("end", "Ingrese un intervalo válido que permita al menos un bloque.");
            isValid = false;
        }
        if (doctor && isValid) {
            availability = mergeAllStoredAvailability(Array.isArray(disponibilidadMock) ? disponibilidadMock : []);
            const own = availability.filter((item) => String(item.id_medico) === String(doctor.id));
            if (hasOverlap(own, fields.date.value, fields.start.value, fields.end.value)) {
                setFieldError("start", "El rango se superpone con disponibilidad existente del médico.");
                isValid = false;
            }
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
            doctorId: doctor.id,
            doctorName: doctorFullName(doctor),
            specialty: doctor.especialidad,
            date: fields.date.value,
            start: fields.start.value,
            end: fields.end.value,
            origin: "Secretaria",
            slotDuration: baseSlotDuration
        });
        renderPreview();
    }

    function renderAvailabilityTable() {
        const filter = currentAvailabilityFilter();

        if (!filter) {
            tableBody.innerHTML = renderTableEmptyRow(7, "Seleccione un m&eacute;dico o una especialidad para consultar la disponibilidad cargada.");
            return;
        }

        const filteredAvailability = availability.filter((item) => {
            if (filter.type === "doctor") {
                return String(item.id_medico) === filter.value;
            }

            return item.especialidad === filter.value;
        });

        if (filteredAvailability.length === 0) {
            tableBody.innerHTML = renderTableEmptyRow(7, "No existen horarios cargados para el criterio seleccionado.");
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
                    <td>${renderStateText(item.estado, escapeHtml)}</td>
                    <td>${item.origen || "Mock"}</td>
                </tr>
            `;
        }).join("");
    }

    function persistAvailability(changedSlots) {
        persistAvailabilityChanges(changedSlots);
    }

    function saveAvailability(event) {
        event.preventDefault();

        if (generatedBlocks.length === 0) {
            showMessage("danger", "Debe generar bloques antes de guardar la disponibilidad.");
            return;
        }

        if (!validateForm()) return;
        const doctor = selectedDoctor();
        if (generatedBlocks.some((block) => String(block.id_medico) !== String(doctor.id)
            || block.especialidad !== doctor.especialidad || block.fecha !== fields.date.value)
            || generatedBlocks[0].hora_inicio !== fields.start.value
            || timeToMinutes(generatedBlocks[generatedBlocks.length - 1].hora_fin) > timeToMinutes(fields.end.value)) {
            showMessage("danger", "Los datos cambiaron. Genere nuevamente los bloques antes de guardar.");
            return;
        }
        const maxId = availability.reduce((maxValue, item) => Math.max(maxValue, Number(item.id_disponibilidad) || 0), 0);
        const blocksToSave = generatedBlocks.map((block, index) => ({
            id_disponibilidad: maxId + index + 1,
            ...block,
            origenInterfaz: true
        }));

        availability = [...availability, ...blocksToSave];
        persistAvailability(blocksToSave);
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
        clearErrors();
        fields.doctor.value = "";
        renderDoctors(fields.specialty.value);
        generatedBlocks = [];
        renderPreview();
        renderAvailabilityTable();
    });

    fields.doctor.addEventListener("change", () => {
        clearErrors();
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
            clearErrors();
            generatedBlocks = [];
            renderPreview();
        });
    });

    generateButton.addEventListener("click", generateBlocks);
    cancelButton.addEventListener("click", () => {
        if (exitModal) {
            showModal(exitModal);
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
