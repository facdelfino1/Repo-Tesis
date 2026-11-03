import { getBootstrapModal, showModal } from '../../components/modals.js';
import { request, errorMessage } from '../../core/api.js';
import { getCurrentUser, pageMessage } from '../../core/session.js';
import { bindDoctorSelectors, getAvailability } from '../catalog/catalog-service.js';
import { buildAvailabilityBlocks } from './availability-service.js';
import { escapeHtml } from '../../core/helpers.js';
import { formatDate, timeToMinutes } from '../../core/formatters.js';
import { updateTriageQuestionnaire } from '../triage/triage-ui.js';

async function initAvailability(doctorMode) {
    const form=document.querySelector(`[data-form="${doctorMode?'doctor':'secretary'}-availability"]`);
    if(!form)return;
    const user=getCurrentUser();
    const fields=doctorMode ? {date:'disponibilidadMedicoFecha',start:'disponibilidadMedicoHoraInicio',end:'disponibilidadMedicoHoraFin'}
        :{date:'disponibilidadFecha',start:'disponibilidadHoraInicio',end:'disponibilidadHoraFin'};
    Object.keys(fields).forEach(key=>fields[key]=document.getElementById(fields[key]));
    const table=document.getElementById(doctorMode?'disponibilidadMedicoTabla':'disponibilidadTabla');
    const preview=document.getElementById(doctorMode?'bloquesMedicoPreview':'bloquesPreview');
    const empty=document.getElementById(doctorMode?'bloquesMedicoVacio':'bloquesVacio');
    const message=document.getElementById(doctorMode?'disponibilidadMedicoMensaje':'disponibilidadMensaje');
    const generate=document.getElementById(doctorMode?'generarBloquesMedicoBtn':'generarBloquesBtn');
    let selected=doctorMode?{id:user.perfil.id,nombre:user.nombre,apellido:user.apellido,especialidad:user.perfil.especialidad}:null;
    let blocks=[], generatedFor=null, sequence=0;
    function feedback(text,type='danger'){message.className=`alert alert-${type}`;message.textContent=text;}
    function clearPreview(){blocks=[];generatedFor=null;preview.replaceChildren();empty.classList.remove('d-none');}
    async function refresh(){
        const current=++sequence;
        if(!selected){table.innerHTML=`<tr><td colspan="${doctorMode?5:7}">Seleccione un médico para consultar su disponibilidad.</td></tr>`;return;}
        const doctor=selected;
        table.innerHTML=`<tr><td colspan="${doctorMode?5:7}">Consultando disponibilidad...</td></tr>`;
        const rows=await getAvailability(doctor.id);
        if(current!==sequence)return;
        table.innerHTML=rows.length?rows.map(row=>{
            const state={DISPONIBLE:'Disponible',BLOQUEADO:'Bloqueado',OCUPADO:'Ocupado'}[row.estado]||row.estado;
            const actions=row.estado==='OCUPADO'?'Sin acciones':
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-slot="${row.id}" data-operation="${row.estado==='BLOQUEADO'?'desbloquear':'bloquear'}">${row.estado==='BLOQUEADO'?'Desbloquear':'Bloquear'}</button>
                 <button type="button" class="btn btn-sm btn-outline-danger" data-slot="${row.id}" data-operation="eliminar">Eliminar</button>`;
            return `<tr>${doctorMode?'':`<td>${escapeHtml(doctor.nombre+' '+doctor.apellido)}</td><td>${escapeHtml(doctor.especialidad.nombre)}</td>`}
                <td>${formatDate(row.fecha)}</td><td>${escapeHtml(row.hora_inicio.slice(0,5))}</td><td>${escapeHtml(row.hora_fin.slice(0,5))}</td><td>${escapeHtml(state)}</td><td>${actions}</td></tr>`;
        }).join(''):`<tr><td colspan="${doctorMode?5:7}">No hay disponibilidad registrada para este médico.</td></tr>`;
    }
    if(!doctorMode){
        await bindDoctorSelectors(document.getElementById('disponibilidadEspecialidad'),document.getElementById('disponibilidadMedico'),async(doctor,error)=>{
            selected=doctor;clearPreview();
            if(error){feedback(errorMessage(error));return;}
            try{await refresh();}catch(err){feedback(errorMessage(err));}
        });
    }
    generate.addEventListener('click',event=>{
        event.preventDefault();clearPreview();
        if(!selected||!fields.date.value||!fields.start.value||!fields.end.value){feedback('Complete médico, fecha y ambas horas.');return;}
        if(timeToMinutes(fields.start.value)>=timeToMinutes(fields.end.value)){feedback('La hora de fin debe ser posterior al inicio.');return;}
        blocks=buildAvailabilityBlocks({doctorId:selected.id,doctorName:selected.nombre+' '+selected.apellido,
            specialty:selected.especialidad.nombre,date:fields.date.value,start:fields.start.value,end:fields.end.value,slotDuration:20});
        if(!blocks.length){feedback('El intervalo debe permitir al menos un bloque de 20 minutos.');return;}
        generatedFor=JSON.stringify([selected.id,fields.date.value,fields.start.value,fields.end.value]);
        empty.classList.add('d-none');
        preview.innerHTML=blocks.map(b=>`<div class="col-12 col-sm-6 col-xl-3"><div class="metric-box rounded-3 p-3"><p class="mb-0">${formatDate(b.fecha)} ${escapeHtml(b.hora_inicio)}–${escapeHtml(b.hora_fin)}</p></div></div>`).join('');
        feedback('Revise los bloques y confirme para guardarlos. El servidor validará la agenda.','info');
    });
    Object.values(fields).forEach(field=>field.addEventListener('input',clearPreview));
    form.addEventListener('submit',async event=>{
        event.preventDefault();
        if(!selected||!blocks.length||generatedFor!==JSON.stringify([selected.id,fields.date.value,fields.start.value,fields.end.value])){feedback('Genere nuevamente los bloques antes de guardar.');return;}
        const button=form.querySelector('[type="submit"]');button.disabled=true;
        try{
            await request(`medicos/${selected.id}/disponibilidades/lote/`,{method:'POST',body:{bloques:blocks.map(b=>({fecha:b.fecha,hora_inicio:b.hora_inicio,hora_fin:b.hora_fin}))}});
            clearPreview();await refresh();feedback('Disponibilidad guardada correctamente.','success');
        }catch(error){feedback(errorMessage(error));}
        finally{button.disabled=false;}
    });
    table.addEventListener('click',async event=>{
        const button=event.target.closest('[data-operation]');if(!button||!selected)return;
        const operation=button.dataset.operation;
        if(operation==='eliminar'&&!window.confirm('¿Eliminar este bloque de disponibilidad?'))return;
        button.disabled=true;
        try{
            await request(`medicos/${selected.id}/disponibilidades/${button.dataset.slot}/${operation==='eliminar'?'':operation+'/'}`,{method:operation==='eliminar'?'DELETE':'POST',...(operation==='eliminar'?{}:{body:{}})});
            await refresh();feedback('Disponibilidad actualizada.','success');
        }catch(error){feedback(errorMessage(error));button.disabled=false;}
    });
    const exitModal=getBootstrapModal(document.getElementById(doctorMode?'salirSinGuardarMedicoModal':'salirSinGuardarModal'));
    document.getElementById(doctorMode?'cancelarDisponibilidadMedicoBtn':'cancelarDisponibilidadBtn')?.addEventListener('click',event=>{
        event.preventDefault();
        if(blocks.length && exitModal) showModal(exitModal);
        else window.location.assign('dashboard.html');
    });
    document.getElementById(doctorMode?'confirmarSalirSinGuardarMedicoBtn':'confirmarSalirSinGuardarBtn')?.addEventListener('click',()=>{
        clearPreview();window.location.assign('dashboard.html');
    });
    await refresh();
}
export const initDoctorAvailability=()=>initAvailability(true);
export const initSecretaryAvailability=()=>initAvailability(false);

export async function initPatientAvailabilityBrowser(){
    const form=document.querySelector('[data-form="appointment-request"]');if(!form)return;
    const specialty=document.getElementById('especialidad'),doctor=document.getElementById('medico');
    const list=document.getElementById('disponibilidadLista'),section=document.getElementById('disponibilidadSection');
    const confirm=document.getElementById('confirmarTurnoBtn');confirm.disabled=true;
    const consult=form.querySelector('[type="submit"]');consult.disabled=true;
    const error=document.getElementById('disponibilidadError');
    let selected=null,sequence=0;
    const controls=await bindDoctorSelectors(specialty,doctor,async(value,err)=>{
        selected=value;consult.disabled=!value;list.replaceChildren();section.classList.add('d-none');++sequence;
        const key=value?.especialidad.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replaceAll(' ','_')||'';
        updateTriageQuestionnaire(form,key);
        if(err)pageMessage(errorMessage(err),'danger');
    });
    updateTriageQuestionnaire(form,'');
    form.addEventListener('submit',async event=>{
        event.preventDefault();selected=controls.getDoctor();
        if(doctor.disabled||!selected){pageMessage('Seleccione un médico para consultar sus horarios.');return;}
        const current=++sequence;const id=selected.id;
        try{
            const rows=await getAvailability(id);
            if(current!==sequence)return;
            section.classList.remove('d-none');
            error.classList.add('d-none');
            document.getElementById('sinDisponibilidad').classList.toggle('d-none',rows.length>0);
            list.innerHTML=rows.map(row=>`<div class="col-12 col-md-6"><div class="card border h-100"><div class="card-body"><p class="fw-semibold">${formatDate(row.fecha)} ${escapeHtml(row.hora_inicio.slice(0,5))}–${escapeHtml(row.hora_fin.slice(0,5))}</p><p>${escapeHtml(selected.nombre+' '+selected.apellido)}</p><span class="badge text-bg-success">Disponible</span></div></div></div>`).join('');
            pageMessage('Horarios consultados. La confirmación de turnos aún no está habilitada en esta pantalla.','info');
        }catch(err){pageMessage(errorMessage(err),'danger');}
    });
}
