class Usuario:
    
    def __init__(self,id_usuario ,  dni, nombre, apellido, email, contraseña, telefono):
        self.id_usuario = id_usuario
        self.dni = dni
        self.nombre = nombre
        self.apellido = apellido
        self.email = email
        self.contraseña = contraseña
        self.telefono = telefono
    
    def datos_usuario(self):
        usuario = {
            "id": self.id_usuario,
            "dni": self.dni,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "email": self.email,
            "contraseña": self.contraseña,
            "telefono": self.telefono
        }
        return usuario

