
from models.medico import  Medico
from models.paciente import Paciente
from models.secretaria import Secretaria

#Crearemos un usuario
paciente1 = Paciente(id_usuario=1, dni=12345678, id_paciente=1, nombre="Juan", apellido="Perez", email="juan.perez@email.com", contraseña="contraseña123", telefono="123456789", obra_social="Mutual medica")
medico1 = Medico(id_usuario=2, dni=87654321, nombre="Maria", apellido="Gomez", email="maria.gomez@email.com", contraseña="contraseña123", telefono="987654321", id_medico=1, matricula="MAT123", especialidad="Cardiologia")
secretaria1 = Secretaria(id_usuario=3, dni=11223344, nombre="Ana", apellido="Lopez", email="ana.lopez@email.com", contraseña="contraseña123", telefono="555555555", id_secretaria=1, legajo="LEG456")
print(paciente1.datos_paciente())
print(medico1.datos_medico())
print(secretaria1.datos_secretaria())
