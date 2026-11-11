import { request, listAll } from '../../core/api.js';

export const getSpecialties = () => listAll('especialidades/');
export const getDoctors = specialty => listAll(`medicos/${specialty ? '?especialidad=' + encodeURIComponent(specialty) : ''}`);
export const getDoctor = id => request(`medicos/${encodeURIComponent(id)}/`);
export const getAvailability = (doctorId, filters = {}) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([,v]) => v !== '' && v != null));
    return listAll(`medicos/${encodeURIComponent(doctorId)}/disponibilidades/${params.size ? '?' + params : ''}`);
};
export async function getAssignableAvailability(doctorId) {
    return getAvailability(doctorId, { estado: 'DISPONIBLE', futuros: true });
}
// A snapshot belongs only to one page initialization; subsequent changes fetch fresh data.
export const loadDoctorCatalog = async () => {
    const [specialties, doctors] = await Promise.all([getSpecialties(), getDoctors('')]);
    return { specialties, doctors };
};
export async function bindDoctorSelectors(specialtySelect, doctorSelect, onChange = () => {}, initialCatalog = null) {
    const specialties = initialCatalog ? initialCatalog.specialties : await getSpecialties();
    let doctors = [];
    let sequence = 0;
    const option = (value,label) => { const node = document.createElement('option'); node.value=value; node.textContent=label; return node; };
    specialtySelect.replaceChildren(option('', 'Seleccione una especialidad'), ...specialties.map(s => option(s.id,s.nombre)));
    async function render(specialty, selected='', initialRows = null) {
        const current = ++sequence;
        doctorSelect.disabled = true;
        const rows = initialRows ?? await getDoctors(specialty);
        if (current !== sequence) return;
        doctors = rows;
        doctorSelect.replaceChildren(option('', 'Seleccione un médico'), ...rows.map(d => option(d.id,`${d.nombre} ${d.apellido} - ${d.especialidad.nombre}`)));
        doctorSelect.value = String(selected);
        doctorSelect.disabled = false;
    }
    specialtySelect.addEventListener('change', async () => {
        try { doctorSelect.value=''; await onChange(null); await render(specialtySelect.value); }
        catch(error) { await onChange(null,error); }
    });
    doctorSelect.addEventListener('change', async () => {
        try {
            const id = doctorSelect.value;
            doctorSelect.disabled=true;
            await onChange(null);
            if (!id) { doctorSelect.disabled=false; return; }
            const doctor = await getDoctor(id);
            if (doctorSelect.value !== id) return;
            if (specialtySelect.value !== String(doctor.especialidad.id)) {
                specialtySelect.value = String(doctor.especialidad.id);
                await render(specialtySelect.value,doctor.id);
            }
            doctorSelect.disabled=false;
            await onChange(doctor);
        } catch(error) { doctorSelect.disabled=false; await onChange(null,error); }
    });
    await render('', '', initialCatalog?.doctors);
    return { getDoctor: () => doctors.find(d => String(d.id) === doctorSelect.value) || null };
}
