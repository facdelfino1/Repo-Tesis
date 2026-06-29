export function getSessionItem(key) {
    return sessionStorage.getItem(key);
}

export function setSessionItem(key, value) {
    sessionStorage.setItem(key, value);
}

export function removeSessionItem(key) {
    sessionStorage.removeItem(key);
}

export function readSessionJson(key, fallback) {
    const storedValue = getSessionItem(key);

    if (!storedValue) {
        return fallback;
    }

    try {
        return JSON.parse(storedValue);
    } catch (error) {
        return fallback;
    }
}

export function writeSessionJson(key, value) {
    setSessionItem(key, JSON.stringify(value));
}
