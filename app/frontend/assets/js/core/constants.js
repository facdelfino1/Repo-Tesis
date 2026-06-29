export const LOCAL_STORAGE_KEYS = {
    CURRENT_USER: "usuarioActualMock",
    ADMIN_USERS: "usuariosAdminMock",
    SECRETARY_TURNS: "turnosSecretariaMock",
    DOCTOR_TURNS: "turnosMedicoMock",
    PATIENT_TURNS: "turnosPacienteMock",
    SECRETARY_AVAILABILITY: "disponibilidadSecretariaMock",
    DOCTOR_AVAILABILITY: "disponibilidadMedicoMock",
    PATIENT_AVAILABILITY: "disponibilidadPacienteMock",
    SECRETARY_PATIENTS: "pacientesSecretariaMock",
    SECRETARY_TRIAGES: "triajesSecretariaMock",
    ADMIN_PROFILE: "perfilAdminMock",
    DOCTOR_PROFILE: "perfilMedicoMock",
    SECRETARY_PROFILE: "perfilSecretariaMock",
    PATIENT_PROFILE: "perfilPacienteMock",
    DOCTOR_RESCHEDULE: "reprogramacionMedicoMock",
    MASS_RESCHEDULE: "reprogramacionMasivaMock"
};

export const SESSION_STORAGE_KEYS = {
    PATIENT_APPOINTMENT_REQUEST: "solicitudTurnoPaciente",
    PATIENT_RESERVED_APPOINTMENT: "turnoReservadoPaciente",
    SECRETARY_TEMP_AVAILABILITY: "disponibilidadSecretariaTemporal",
    DOCTOR_TEMP_AVAILABILITY: "disponibilidadMedicoTemporal"
};

export const MOCK_PATHS = {
    USERS: "../../assets/mock/usuarios.json",
    DOCTORS: "../../assets/mock/medicos.json",
    APPOINTMENTS: "../../assets/mock/turnos.json",
    AVAILABILITY: "../../assets/mock/disponibilidad.json",
    TRIAGE: "../../assets/mock/triaje.json"
};

export const PRIORITY_LABELS = {
    HIGH: "Alta",
    MEDIUM: "Media",
    LOW: "Baja"
};

export const PRIORITY_COLORS = {
    HIGH: "Rojo",
    MEDIUM: "Amarillo",
    LOW: "Verde"
};
