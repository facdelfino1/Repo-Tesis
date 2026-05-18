from datos import datos_paciente, calcular_prioridad

paciente1 = datos_paciente(
                1, 
                "12345678",
                "Juan",
                "Pérez", 
                "juan@gmail.com",
                "contraseña123",
                "1234567890",
                "OSDE",
                1
            )

prioridad, color_prioridad = calcular_prioridad()
print(f"Paciente: {paciente1['nombre']} {paciente1['apellido']}")
print(f"Prioridad: {prioridad}")
print(f"Color de prioridad: {color_prioridad}")