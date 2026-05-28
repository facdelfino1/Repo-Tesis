from models.medico import Medico
from models.paciente import Paciente
from services.triaje import calcular_prioridad, preguntas
class Turno:
    
    def __init__(self, id_turno, fecha, estado, duracion_turno, fecha_hora_creacion, fecha_hora_arribo, fecha_hora_inicio, fecha_hora_cierre, medico, paciente, color_prioridad, prioridad):
        
        self.id_turno = id_turno
        self.fecha = fecha
        self.estado = estado
        self.duracion_turno = duracion_turno
        self.fecha_hora_creacion = fecha_hora_creacion
        self.fecha_hora_arribo = fecha_hora_arribo
        self.fecha_hora_inicio = fecha_hora_inicio
        self.fecha_hora_cierre = fecha_hora_cierre
        self.medico = medico
        self.paciente = paciente
        

        self.id_medico = medico.id_medico
        self.id_paciente = paciente.id_paciente

        self.color_prioridad = color_prioridad
        self.prioridad = prioridad