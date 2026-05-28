from services.triaje import calcular_prioridad, preguntas
from models.medico import Medico
from models.paciente import Paciente
from models.secretaria import Secretaria
from models.turno import Turno


pacientes = [
    Paciente(1, "40111222", 1, "Juan", "Perez", "juan@email.com", "1234", "1122334455", "OSDE"),
    Paciente(2, "38222333", 2, "Maria", "Gomez", "maria@email.com", "1234", "1166677788", "Swiss Medical"),
    Paciente(3, "35777444", 3, "Lucas", "Fernandez", "lucas@email.com", "1234", "1199988877", "PAMI"),
    Paciente(4, "42999555", 4, "Sofia", "Martinez", "sofia@email.com", "1234", "1155512345", "IOMA"),
]

medico1 = Medico(
    id_usuario=2,
    dni=87654321,
    nombre="Maria",
    apellido="Gomez",
    email="maria.gomez@email.com",
    contraseña="contraseña123",
    telefono="987654321",
    id_medico=1,
    matricula="MAT123",
    especialidad="Cardiologia",
)

secretaria1 = Secretaria(
    id_usuario=3,
    dni=11223344,
    nombre="Ana",
    apellido="Lopez",
    email="ana.lopez@email.com",
    contraseña="contraseña123",
    telefono="555555555",
    id_secretaria=1,
    legajo="LEG456",
)

bd_turnos = []

for id_turno, paciente in enumerate(pacientes, start=1):
    print(f"\nCargando triaje para {paciente.nombre} {paciente.apellido}")

    preguntas1 = preguntas()
    color_prioridad, prioridad, duracion_turno = calcular_prioridad(*preguntas1)

    turno = Turno(
        id_turno=id_turno,
        fecha="2026-06-21",
        estado="Pendiente",
        duracion_turno=duracion_turno,
        fecha_hora_creacion="2026-06-21",
        fecha_hora_arribo=None,
        fecha_hora_inicio=None,
        fecha_hora_cierre=None,
        medico=medico1,
        paciente=paciente,
        color_prioridad=color_prioridad,
        prioridad=prioridad,
    )

    bd_turnos.append(turno)

bd_turnos.sort(key=lambda turno: turno.prioridad, reverse=True)

print("\nCola de atencion:")
for posicion, turno in enumerate(bd_turnos, start=1):
    print(
        f"{posicion}. paciente: {turno.paciente.nombre} {turno.paciente.apellido}, "
        f"prioridad: {turno.color_prioridad}, puntaje: {turno.prioridad}, "
        f"duracion: {turno.duracion_turno} minutos"
    )
