import { LOCAL_STORAGE_KEYS, MOCK_PATHS } from "../../core/constants.js";
import { loadMock, readStoredJson, writeStoredJson } from "../../core/storage.js";
import { normalizeText } from "../../core/helpers.js";
import { isStrongPassword, isValidEmail } from "../../core/validators.js";

export function roleMatches(user, role) {
    return String(user.rol || "").toLowerCase() === role;
}

export function fullName(person) {
    return `${person.nombre} ${person.apellido}`;
}

export function roleLabel(role) {
    const normalizedRole = String(role || "").toLowerCase();

    if (normalizedRole === "paciente") {
        return "Paciente";
    }

    if (normalizedRole === "medico") {
        return "Medico";
    }

    if (normalizedRole === "secretaria") {
        return "Secretaria";
    }

    if (normalizedRole === "administrador") {
        return "Administrador";
    }

    return role || "-";
}

export function statusLabel(user) {
    return user.estado || "Activo";
}

export function loadUsers(fallbackData) {
    return loadMock(MOCK_PATHS.USERS, fallbackData.usuarios);
}

export function loadUserManagementData(fallbackData) {
    return Promise.all([
        loadMock(MOCK_PATHS.USERS, fallbackData.usuarios),
        loadMock(MOCK_PATHS.DOCTORS, { medicos: [] })
    ]).then(([usuariosData]) => usuariosData);
}

export function mergeStoredUsers(baseUsers) {
    const base = Array.isArray(baseUsers) ? baseUsers : [];
    const stored = readStoredJson(LOCAL_STORAGE_KEYS.ADMIN_USERS, null);

    if (!Array.isArray(stored)) {
        return base.map((user) => ({ ...user, estado: user.estado || "Activo" }));
    }

    return stored.map((user) => ({ ...user, estado: user.estado || "Activo" }));
}

export function persistUsers(users) {
    writeStoredJson(LOCAL_STORAGE_KEYS.ADMIN_USERS, users);
}

export function getManagedUsers(users) {
    return users.filter((user) => !roleMatches(user, "administrador"));
}

export function filterUsers(users, filters = {}) {
    const query = normalizeText(String(filters.query || "").trim());
    const selectedRole = filters.role || "";
    const selectedStatus = filters.status || "";

    return getManagedUsers(users).filter((user) => {
        const searchable = normalizeText(`${user.nombre} ${user.apellido} ${user.dni} ${user.email}`);
        const matchesQuery = query === "" || searchable.includes(query);
        const matchesRole = selectedRole === "" || roleMatches(user, selectedRole);
        const matchesStatus = selectedStatus === "" || statusLabel(user) === selectedStatus;

        return matchesQuery && matchesRole && matchesStatus;
    });
}

export function userById(users, userId) {
    return users.find((user) => String(user.id_usuario) === String(userId)) || null;
}

export function adminByLoggedUser(users, loggedUser) {
    return users.find((user) => String(user.id_usuario) === String(loggedUser.id_usuario))
        || loggedUser;
}

export function nextUserId(users) {
    return users.reduce((maxValue, user) => Math.max(maxValue, Number(user.id_usuario) || 0), 0) + 1;
}

export function nextRoleId(users, key) {
    return users.reduce((maxValue, user) => Math.max(maxValue, Number(user[key]) || 0), 0) + 1;
}

export function validateCreateUser(values, users) {
    const errors = {};

    if (values.role === "") {
        errors.role = "Seleccione un rol.";
    }

    ["nombre", "apellido", "dni", "email", "telefono", "password"].forEach((fieldName) => {
        if (values[fieldName].trim() === "") {
            errors[fieldName] = "Campo obligatorio.";
        }
    });

    if (values.dni.trim() !== "" && !/^\d+$/.test(values.dni.trim())) {
        errors.dni = "El DNI debe ser numerico.";
    }

    if (values.telefono.trim() !== "" && !/^\d+$/.test(values.telefono.trim())) {
        errors.telefono = "El telefono debe ser numerico.";
    }

    if (values.email.trim() !== "" && !isValidEmail(values.email.trim())) {
        errors.email = "Ingrese un email valido.";
    } else if (users.some((user) => user.email === values.email.trim())) {
        errors.email = "El email ya existe.";
    }

    if (values.password !== "" && !isStrongPassword(values.password)) {
        errors.password = "La contraseña no cumple los requisitos.";
    }

    if (values.role === "medico") {
        if (values.matricula.trim() === "") {
            errors.matricula = "La matricula es obligatoria.";
        }

        if (values.especialidad.trim() === "") {
            errors.especialidad = "La especialidad es obligatoria.";
        }
    }

    if (values.role === "secretaria" && values.legajo.trim() === "") {
        errors.legajo = "El legajo es obligatorio.";
    }

    return errors;
}

export function validateEditUser(values, users, user) {
    const errors = {};

    ["nombre", "apellido", "email", "telefono"].forEach((fieldName) => {
        if (values[fieldName].trim() === "") {
            errors[fieldName] = "Campo obligatorio.";
        }
    });

    if (values.email.trim() !== "" && !isValidEmail(values.email.trim())) {
        errors.email = "Ingrese un email valido.";
    } else if (users.some((item) => item.email === values.email.trim() && String(item.id_usuario) !== String(user.id_usuario))) {
        errors.email = "El email ya existe.";
    }

    if (values.telefono.trim() !== "" && !/^\d+$/.test(values.telefono.trim())) {
        errors.telefono = "El telefono debe ser numerico.";
    }

    if (roleMatches(user, "medico")) {
        if (values.matricula.trim() === "") {
            errors.matricula = "La matricula es obligatoria.";
        }

        if (values.especialidad.trim() === "") {
            errors.especialidad = "La especialidad es obligatoria.";
        }
    }

    if (roleMatches(user, "secretaria") && values.legajo.trim() === "") {
        errors.legajo = "El legajo es obligatorio.";
    }

    return errors;
}

export function createInternalUser(users, values) {
    const role = values.role;
    const newUser = {
        id_usuario: nextUserId(users),
        nombre: values.nombre.trim(),
        apellido: values.apellido.trim(),
        dni: values.dni.trim(),
        email: values.email.trim(),
        contrasena: values.password,
        telefono: values.telefono.trim(),
        rol: role,
        estado: "Activo"
    };

    if (role === "medico") {
        newUser.id_medico = nextRoleId(users, "id_medico");
        newUser.matricula = values.matricula.trim();
        newUser.especialidad = values.especialidad.trim();
    }

    if (role === "secretaria") {
        newUser.id_secretaria = nextRoleId(users, "id_secretaria");
        newUser.legajo = values.legajo.trim();
    }

    return [...users, newUser];
}

export function updateUser(users, selectedUserId, values) {
    return users.map((item) => {
        if (String(item.id_usuario) !== String(selectedUserId)) {
            return item;
        }

        const updatedUser = {
            ...item,
            nombre: values.nombre.trim(),
            apellido: values.apellido.trim(),
            email: values.email.trim(),
            telefono: values.telefono.trim()
        };

        if (roleMatches(item, "medico")) {
            updatedUser.matricula = values.matricula.trim();
            updatedUser.especialidad = values.especialidad.trim();
        }

        if (roleMatches(item, "secretaria")) {
            updatedUser.legajo = values.legajo.trim();
        }

        if (roleMatches(item, "paciente")) {
            updatedUser.obra_social = values.obraSocial.trim();
        }

        return updatedUser;
    });
}

export function toggleUserStatus(users, selectedStatusUserId) {
    const user = userById(users, selectedStatusUserId);
    const nextStatus = statusLabel(user) === "Activo" ? "Inactivo" : "Activo";

    return {
        nextStatus,
        users: users.map((item) => (
            String(item.id_usuario) === String(selectedStatusUserId)
                ? { ...item, estado: nextStatus }
                : item
        ))
    };
}

export function validateAdminProfile(values, users, admin) {
    const errors = {};
    const wantsPasswordChange = values.passwordActual !== ""
        || values.passwordNueva !== ""
        || values.passwordConfirmar !== "";

    ["nombre", "apellido", "dni", "email", "telefono"].forEach((fieldName) => {
        if (values[fieldName].trim() === "") {
            errors[fieldName] = "Campo obligatorio.";
        }
    });

    if (values.dni.trim() !== "" && !/^\d+$/.test(values.dni.trim())) {
        errors.dni = "El DNI debe ser numerico.";
    }

    if (values.telefono.trim() !== "" && !/^\d+$/.test(values.telefono.trim())) {
        errors.telefono = "El telefono debe ser numerico.";
    }

    if (values.email.trim() !== "" && !isValidEmail(values.email.trim())) {
        errors.email = "Ingrese un email valido.";
    } else if (users.some((user) => user.email === values.email.trim() && String(user.id_usuario) !== String(admin.id_usuario))) {
        errors.email = "El email ya existe.";
    }

    if (wantsPasswordChange) {
        if (values.passwordActual === "") {
            errors.passwordActual = "Ingrese la contrasena actual.";
        } else if (admin.contrasena && values.passwordActual !== admin.contrasena) {
            errors.passwordActual = "La contrasena actual no coincide.";
        }

        if (values.passwordNueva === "") {
            errors.passwordNueva = "Ingrese la nueva contrasena.";
        } else if (!isStrongPassword(values.passwordNueva)) {
            errors.passwordNueva = "La contrasena debe cumplir los requisitos de seguridad.";
        }

        if (values.passwordConfirmar === "") {
            errors.passwordConfirmar = "Confirme la nueva contrasena.";
        } else if (values.passwordConfirmar !== values.passwordNueva) {
            errors.passwordConfirmar = "La confirmacion no coincide con la nueva contrasena.";
        }
    }

    return errors;
}

export function updateAdminProfile(users, admin, values) {
    const updatedAdmin = {
        ...admin,
        nombre: values.nombre.trim(),
        apellido: values.apellido.trim(),
        dni: values.dni.trim(),
        email: values.email.trim(),
        telefono: values.telefono.trim(),
        rol: "administrador"
    };

    if (values.passwordNueva !== "") {
        updatedAdmin.contrasena = values.passwordNueva;
        updatedAdmin.passwordActualizada = true;
    }

    return {
        updatedAdmin,
        users: users.map((user) => (
            String(user.id_usuario) === String(updatedAdmin.id_usuario)
                ? updatedAdmin
                : user
        ))
    };
}
