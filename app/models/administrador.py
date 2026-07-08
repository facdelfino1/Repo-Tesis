from models.usuario import Usuario


class Administrador(Usuario):
    def __init__(self, id_usuario, dni, nombre, apellido, email, contraseña, telefono, id_administrador):
        super().__init__(id_usuario, dni, nombre, apellido, email, contraseña, telefono)
        self.id_administrador = id_administrador

    def datos_administrador(self):
        return {
            "id_usuario": self.id_usuario,
            "dni": self.dni,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "email": self.email,
            "telefono": self.telefono,
            "id_administrador": self.id_administrador,
            "rol": "Administrador",
        }
    