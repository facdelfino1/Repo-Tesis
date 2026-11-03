import { getCurrentUser, legacyUser } from './session.js';
import { getDoctors, legacyDoctor } from '../features/catalog/catalog-service.js';

const retired = new Set(['usuarioActualMock','usuariosAdminMock','perfilAdminMock','perfilMedicoMock','perfilSecretariaMock','perfilPacienteMock','disponibilidadPacienteMock','disponibilidadMedicoMock','disponibilidadSecretariaMock','turnosPacienteMock']);
export async function loadMock(path, fallback) {
    // Transitional reads for pages not yet integrated; no simulated catalog or inventory.
    if (path.endsWith('/disponibilidad.json')) return [];
    if (path.endsWith('/medicos.json')) return { medicos: (await getDoctors()).map(legacyDoctor) };
    if (path.endsWith('/usuarios.json')) {
        const response = await fetch(new URL(path,document.baseURI));
        if (!response.ok) throw new Error('No se pudieron cargar los datos de demostracion.');
        const data = await response.json();
        const user = legacyUser(getCurrentUser());
        const doctors = (await getDoctors()).map(legacyDoctor);
        const people = (data.usuarios || []).filter(person => String(person.rol).toLowerCase() !== 'medico'
            && String(person.id_usuario) !== String(user?.id_usuario));
        const clean = people.map(person => { const { ['contraseña']: ignored, password, ...safe }=person; return safe; });
        return { usuarios: [...clean, ...doctors, ...(user ? [user] : [])] };
    }

    try {
        const response = await fetch(new URL(path, document.baseURI));

        if (!response.ok) {
            throw new Error("No se pudo leer el archivo mock.");
        }

        return await response.json();
    } catch (error) {
        return fallback;
    }
}

export function readStoredJson(key, fallback) {
    if (retired.has(key)) return fallback;
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

export function writeStoredJson(key, value) {
    if (retired.has(key)) return;
    localStorage.setItem(key, JSON.stringify(value));
}

export function clearStoredJson(key) {
    localStorage.removeItem(key);
}
