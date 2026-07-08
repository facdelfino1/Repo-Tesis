# Sistema de Triaje Automatizado y Optimización Adaptativa de Consultas Médicas

El proyecto consiste en el desarrollo de un sistema web orientado a optimizar la gestión de consultas médicas mediante un proceso de triaje automatizado, la asignación inteligente de turnos y herramientas de administración para el personal de salud.

---

# Tecnologías utilizadas

## Frontend

* HTML5
* CSS3
* Bootstrap 5
* JavaScript (ES Modules)
* JSON Mock Data

## Backend (en desarrollo)

* Python
* Programación Orientada a Objetos
* Django (próxima etapa)
* PostgreSQL (próxima etapa)

---

# Funcionalidades implementadas

## Paciente

* Inicio de sesión
* Solicitud de turnos
* Cuestionario de triaje
* Clasificación automática por prioridad
* Consulta de turnos asignados

## Secretaría

* Gestión de turnos
* Creación, edición y cancelación de turnos
* Registro de presencia del paciente
* Cierre de consultas
* Reprogramación masiva
* Gestión de disponibilidad médica

## Médico

* Agenda médica
* Gestión de disponibilidad
* Visualización de pacientes priorizados según el triaje

## Administrador

* Gestión de usuarios
* Visualización de métricas operativas

---

# Arquitectura del Frontend

El frontend fue desarrollado siguiendo una arquitectura modular para facilitar el mantenimiento, la escalabilidad y la futura integración con el backend.


assets/js/
│
├── core/
├── components/
├── features/
│   ├── appointments/
│   ├── availability/
│   ├── metrics/
│   ├── rescheduling/
│   ├── triage/
│   └── users/
└── pages/


Esta estructura separa la infraestructura compartida, los componentes reutilizables, la lógica funcional y los controladores de cada pantalla.

---

# Estado del Backend

Actualmente se encuentra implementada una primera capa de lógica de negocio desarrollada en Python mediante Programación Orientada a Objetos.

Se dispone de modelos para representar las principales entidades del sistema:

* Usuario
* Administrador
* Médico
* Paciente
* Secretaria
* Turno

Además, se implementó una primera versión del servicio de triaje capaz de calcular la prioridad del paciente y simular la generación de una cola de atención.

La integración con Django, PostgreSQL y el frontend forma parte de la siguiente etapa del proyecto.

---

# Estado del Proyecto

Actualmente el frontend utiliza datos simulados (*Mock Data*) para representar el comportamiento del sistema durante la etapa de desarrollo.

Esta estrategia permitió implementar, validar y refactorizar toda la interfaz de usuario, los flujos funcionales y la arquitectura modular sin depender de la disponibilidad del backend.

En las siguientes etapas, los datos simulados serán reemplazados progresivamente por información persistida mediante Django y PostgreSQL.


# Estado actual del desarrollo

* ✅ Frontend funcional.
* ✅ Arquitectura modular implementada.
* ✅ Flujos principales desarrollados.
* ✅ Primera capa de lógica backend iniciada.
* 🔄 Integración con Django en desarrollo.
* 🔄 Integración con PostgreSQL pendiente.
* 🔄 Comunicación Frontend–Backend pendiente.

---

# Autor

Facundo Delfino

Trabajo Final de Grado — Ingeniería en Software.
