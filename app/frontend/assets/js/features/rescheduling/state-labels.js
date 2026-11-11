const proposalLabels = {
    EN_ESPERA: 'Pendiente de respuesta',
    ACEPTADA: 'Aceptada',
    RECHAZADA: 'Rechazada',
    ANULADA: 'Anulada',
    INVALIDADA: 'Sin vigencia',
};

const appointmentLabels = {
    RESERVADO: 'Reservado',
    PENDIENTE: 'Pendiente de reasignación',
    PRESENTE: 'Presente',
    EN_ATENCION: 'En atención',
    COMPLETADO: 'Completado',
    CANCELADO: 'Cancelado',
    AUSENTE: 'Ausente',
};

// Presentation only: callers retain backend codes for all decisions and requests.
export function proposalStateLabel(state) {
    return Object.hasOwn(proposalLabels, state) ? proposalLabels[state] : 'Estado no disponible';
}

export function appointmentStateLabel(state) {
    return Object.hasOwn(appointmentLabels, state) ? appointmentLabels[state] : 'Estado no disponible';
}
