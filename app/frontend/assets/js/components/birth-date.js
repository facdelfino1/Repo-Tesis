import { todayInputValue } from '../core/formatters.js';

export function validateBirthDate(input) {
    input.required = true;
    input.max = todayInputValue();
    const value = input.value;
    let message = '';
    if (!value) {
        message = 'Ingrese la fecha de nacimiento.';
    } else {
        const date = new Date(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')
            || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
            message = 'Ingrese una fecha de nacimiento válida.';
        } else if (value > input.max) {
            message = 'La fecha de nacimiento no puede ser futura.';
        }
    }
    input.setCustomValidity(message);
    return message;
}
