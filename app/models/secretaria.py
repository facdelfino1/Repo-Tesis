from models.usuario import Usuario

class Secretaria(Usuario):
    def __init__(self, id_usuario, dni, nombre, apellido, email, contraseña, telefono, id_secretaria, legajo):
        super().__init__(id_usuario, dni, nombre, apellido, email, contraseña, telefono)
        self.id_secretaria = id_secretaria
        self.legajo = legajo


    
    def datos_secretaria(self):
        
        secretaria = {
            "id_usuario": self.id_usuario,
            "dni": self.dni,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "email": self.email,
            "contraseña": self.contraseña,
            "telefono": self.telefono,
            "id_secretaria": self.id_secretaria,
            "legajo": self.legajo
        }
        return secretaria
