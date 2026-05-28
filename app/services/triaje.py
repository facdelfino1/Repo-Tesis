
def datos_paciente(id, dni, nombre, apellido, email, contraseña, telefono, obra_social, id_paciente):
   
    paciente = {
        "id": id,
        "dni": dni,
        "nombre": nombre,
        "apellido": apellido,
        "email": email,
        "contraseña": contraseña,
        "telefono": telefono,
        "obra_social": obra_social,
        "id_paciente": id_paciente
    }
    return paciente



    
def preguntas():
        

        sintomas = str(input("¿Tienes fiebre? (sí/no): ")).lower()
        dolor_intenso = str(input("¿Tienes dolor intenso? (si/no): ")).lower()
        cuesta_respirar = str(input("¿Te cuesta respirar? (si/no): ")).lower()
        rango_dolor = int(input("En una escala del 0 al 10, ¿cuánto dolor sientes? "))
    
        return sintomas, dolor_intenso, cuesta_respirar, rango_dolor

def calcular_prioridad(sintomas, dolor_intenso, cuesta_respirar, rango_dolor):
    
    
    
    prioridad = 0


    if sintomas == "si":
        prioridad += 1
    elif sintomas == "no":
        prioridad += 0
   

    if dolor_intenso == "si":
        prioridad += 3
    elif dolor_intenso == "no":
        prioridad += 0
    
   
    
    if cuesta_respirar == "si":
        prioridad +=8
    elif cuesta_respirar == "no":
        prioridad += 0
    
    
    if rango_dolor >= 0 and rango_dolor <= 3:
        prioridad += 2
            
    elif rango_dolor >= 4 and rango_dolor <= 6:
        prioridad += 4
        
            
    elif rango_dolor >= 7 and rango_dolor <= 10:
        prioridad += 6
            
    else:
        prioridad += 0
    
    
    if prioridad >= 0 and prioridad <= 3:
        color_prioridad = "Verde"
        duracion_turno = 20
    elif prioridad >= 4 and prioridad <= 7:
        color_prioridad = "Amarillo"
        duracion_turno = 30
    else:
        color_prioridad = "Rojo"
        duracion_turno = 40
    
    return  color_prioridad, prioridad, duracion_turno




    



if __name__ == "__main__":
    sintomas, dolor_intenso, cuesta_respirar, rango_dolor = preguntas()
    color_prioridad, prioridad, duracion_turno = calcular_prioridad(sintomas, dolor_intenso, cuesta_respirar, rango_dolor)

    print("Resultado del triaje:")
    print(f"Prioridad: {prioridad}")
    print(f"Color: {color_prioridad}")
    print(f"Duración del turno: {duracion_turno} minutos")