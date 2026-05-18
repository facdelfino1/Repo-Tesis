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

def calcular_prioridad():
    
    
    prioridad = 0

    try:
        sintomas = str(input("¿Tienes fiebre? (sí/no): "))
    except ValueError:
        print("Por favor, ingresa un número válido para la fiebre.")

    if sintomas == "si":
        prioridad += 1
    elif sintomas == "no":
        prioridad += 0
    try:
        dolor_intenso = str(input("¿Tienes dolor intenso? (si/no): "))
    except ValueError:
        print("Por favor, ingresa un valor válido para el dolor intenso.")

    if dolor_intenso == "si":
        prioridad += 3
    elif dolor_intenso == "no":
        prioridad += 0
    
    try:
        cuesta_respirar = str(input("¿Te cuesta respirar? (si/no): "))
    except ValueError:
        print("Por favor, ingresa un valor válido para la dificultad para respirar.")
    
    if cuesta_respirar == "si":
        prioridad += 4
    elif cuesta_respirar == "no":
        prioridad += 0
    
    
    
    
    try:
        rango_dolor = int(input("En una escala del 0 al 10, ¿cuánto dolor sientes? "))
        if rango_dolor >= 0 and rango_dolor <= 3:
            prioridad += 2
            
            
        elif rango_dolor >= 4 and rango_dolor <= 6:
            prioridad += 4
        
            
        elif rango_dolor >= 7 and rango_dolor <= 10:
            prioridad += 6
            
        else:
            prioridad += 0
    
    except ValueError:
        print("Por favor, ingresa un número válido para el rango de dolor.")
        
        

    if prioridad >= 0 and prioridad <= 3:
        color_prioridad = "Verde"
    elif prioridad >= 4 and prioridad <= 7:
        color_prioridad = "Amarillo"
    elif prioridad >= 8 and prioridad <= 10:
        color_prioridad = "Roja"
    
    return prioridad, color_prioridad







    



