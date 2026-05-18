from models.usuario import Usuario

class Medico(Usuario):
    def __init__(self, id_usuario, dni, nombre, apellido, email, contraseña, telefono, id_medico, matricula, especialidad):
        super().__init__(id_usuario, dni, nombre, apellido, email, contraseña, telefono)
        self.id_medico = id_medico
        self.matricula = matricula
        self.especialidad = especialidad
    

    def datos_medico(self):
        medico = {
            "id" : self.id_usuario,
            "dni": self.dni,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "email": self.email,
            "contraseña": self.contraseña,
            "telefono": self.telefono,
            "id_medico": self.id_medico,
            "matricula": self.matricula,
            "especialidad": self.especialidad
        }
        return medico