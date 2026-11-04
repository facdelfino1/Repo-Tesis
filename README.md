# Sistema de Triaje Automatizado y Optimización Adaptativa de Consultas Médicas

El proyecto consiste en el desarrollo de un sistema web orientado a optimizar la gestión de consultas médicas mediante un proceso de triaje automatizado, la asignación inteligente de turnos y herramientas de administración para el personal de salud.

---

# Tecnologías utilizadas

## Frontend

* HTML5
* CSS3
* Bootstrap 5
* JavaScript (ES Modules)
* API Django/DRF con sesión y CSRF

## Backend

* Python
* Programación Orientada a Objetos
* Django 5.2 + Django REST Framework
* PostgreSQL / Supabase

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
* Consulta del estado de atención (el Médico inicia/finaliza)
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

El frontend fue desarrollado siguiendo una arquitectura modular para facilitar el mantenimiento, la escalabilidad y la integración con el backend.


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

# Estado de la integración

Django/PostgreSQL es la fuente de verdad para sesión, cuentas internas,
catálogos, disponibilidad, turnos, triaje y propuestas de reprogramación.
Administrador es un rol de Usuario; no existe una tabla/perfil Administrador.
La reprogramación usa una nueva fecha explícita y bloques reales de la misma
agenda, sin predicción ni creación automática de capacidad.

B7.5 conecta Administración y métricas agregadas reales y retira los mocks y
la persistencia local de dominio. B7.6A conecta el registro público exclusivo de
pacientes con Django. La edición propia de datos personales permanece deshabilitada.
El cambio/recuperación de contraseña sí utiliza Django.

Las medias observadas requieren timestamps válidos. No hay un algoritmo aprobado
de demora estimada: el indicador informa ausencia de datos y no muestra una
predicción ficticia. Si la estimación es un objetivo obligatorio del TFG,
necesita definición y validación funcional antes de implementarse.

Para ejecución local, contratos, definiciones de métricas y verificaciones,
consultar [la documentación backend](app/backend/README.md). El frontend y
`/api/` se sirven desde el mismo origen; no se utiliza Live Server separado.
La validación integral B8 sigue pendiente.

---

# Autor

Facundo Delfino

Trabajo Final de Grado — Ingeniería en Software.
