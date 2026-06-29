export async function loadMock(path, fallback) {
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
    localStorage.setItem(key, JSON.stringify(value));
}

export function clearStoredJson(key) {
    localStorage.removeItem(key);
}
