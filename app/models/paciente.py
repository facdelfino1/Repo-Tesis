from models.usuario import Usuario

class Paciente(Usuario):
    
    def __init__(self, id_usuario, dni, id_paciente, nombre, apellido, email, contraseña, telefono, obra_social):
        super().__init__(id_usuario, dni, nombre, apellido, email, contraseña, telefono)
        self.id_paciente = id_paciente
        self.obra_social = obra_social
    

    def datos_paciente(self):
        
        paciente = {
            "id": self.id_usuario,
            "dni": self.dni,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "email": self.email,
            "contraseña": self.contraseña,
            "telefono": self.telefono,
            "obra_social": self.obra_social,
            "id_paciente": self.id_paciente
        }
        return paciente
        