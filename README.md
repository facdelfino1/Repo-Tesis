# Sistema de Triaje Automatizado y Optimización Adaptativa de Consultas Médicas

Proyecto de tesis de Ingeniería en Software. Sistema web para gestionar consultas médicas, clasificar solicitudes mediante reglas de triaje y reprogramar turnos sobre la disponibilidad real de cada médico.

El desarrollo funcional se considera finalizado para el alcance implementado. Esto no equivale a una certificación clínica ni a una aprobación completa de las pruebas: siguen pendientes de diagnóstico ocho fallos frontend previamente reportados.

## Tecnologías

- Frontend: HTML5, CSS3, Bootstrap 5, Bootstrap Icons y JavaScript Vanilla con ES Modules.
- Backend: Python, Django 5.2 y Django REST Framework.
- Persistencia: Django ORM y PostgreSQL. Supabase puede utilizarse como proveedor de PostgreSQL mediante los parámetros de conexión del entorno.
- Autenticación: sesiones Django y protección CSRF; frontend y API bajo el mismo origen.

Las versiones exactas de las dependencias Python están en [requirements.txt](app/backend/requirements.txt). El frontend no requiere compilación ni instalación npm; Bootstrap e iconos se cargan desde CDN.

## Funcionalidades implementadas

| Rol | Funcionalidades |
| --- | --- |
| Paciente | Registro público, inicio y cierre de sesión, perfil personal editable, cambio y recuperación de contraseña, solicitud y consulta de turnos, triaje cuando corresponde, modificación y cancelación según estado, respuesta a propuestas de reprogramación, historial y espera estimada. |
| Médico | Agenda propia, consulta de triajes, gestión de disponibilidad, inicio y finalización de consultas, reprogramación sobre bloques existentes y edición de datos personales. |
| Secretaria | Búsqueda de pacientes, reserva y gestión de turnos, registro de presencia, cierre de consultas en atención con registro del actor, gestión de disponibilidad, reprogramación y edición de datos personales. |
| Administrador | Alta y edición de médicos y secretarias, activación de cuentas internas, consulta y activación/desactivación de pacientes, métricas agregadas y panel administrativo. |

El triaje aplica reglas para Clínica Médica y Pediatría y devuelve prioridad alta, media o baja. Cardiología sigue un flujo convencional sin cuestionario de triaje. La clasificación es orientativa y no reemplaza una evaluación profesional.

La reprogramación utiliza una fecha de destino explícita y bloques existentes de la misma agenda. Para especialidades con triaje considera prioridad y antigüedad; no crea capacidad médica ni utiliza aprendizaje automático.

### Perfiles editables

La edición propia utiliza `PATCH /api/auth/me/` y siempre actúa sobre la cuenta autenticada.

| Perfil | Campos editables |
| --- | --- |
| Paciente | Nombre, apellido, teléfono y obra social. |
| Médico | Nombre, apellido y teléfono. |
| Secretaria | Nombre, apellido y teléfono. |

Email, DNI, fecha de nacimiento, rol y datos profesionales permanecen protegidos frente a esta operación. El backend rechaza campos no admitidos, incluido el email aunque se envíe sin cambios. La contraseña se modifica desde un formulario y endpoint independientes. El administrador no dispone de edición personal mediante este `PATCH`.

### Recuperación de contraseña

La pantalla de recuperación solicita un correo con un enlace temporal generado por Django. Se envían versiones HTML y texto mediante el backend de correo configurado. El enlace vence en una hora; confirmarlo cambia la contraseña y reinicia el contador de intentos fallidos, sin iniciar sesión automáticamente.

En desarrollo, el backend de consola permite consultar el enlace sin enviar correo real. Para entrega por correo electrónico debe configurarse SMTP en el `.env` privado. Las cuentas inactivas no reciben recuperación ni pueden confirmar un token. La respuesta de solicitud no revela si una cuenta existe.

### Activación y desactivación de pacientes

La pantalla de gestión de usuarios permite al administrador consultar pacientes y cambiar únicamente su estado activo mediante `/api/admin/pacientes/`. La desactivación impide el acceso y las operaciones autenticadas mientras la cuenta permanezca inactiva. Conserva los turnos, el historial y los triajes; no cancela automáticamente las reservas futuras.

Reactivar no cambia la contraseña ni reinicia el bloqueo por intentos. El control se basa en la actividad actual de la cuenta: no equivale a revocar permanentemente todas las sesiones anteriores.

### Espera y demora estimadas

El backend implementa `dominio/demora.py`, accesible al paciente propietario mediante `GET /api/turnos/{id}/demora/`. Utiliza duraciones observadas del mismo médico, pacientes presentes anteriores y la consulta en curso para estimar la carga pendiente de la jornada actual.

El panel del paciente presenta la **espera estimada desde ahora**. La API distingue ese valor de la demora respecto del horario programado y del promedio histórico de duración. Cuando faltan datos o el tiempo restante es indeterminado, informa el motivo y no inventa una duración. La estimación es informativa, puede cambiar y no garantiza una hora de atención.

## Arquitectura

```text
app/
├── backend/
│   ├── config/                 # Configuración, rutas y entrega local del frontend
│   ├── dominio/                # Aplicación Django y reglas del dominio
│   │   ├── migrations/
│   │   ├── templates/dominio/  # Correo de recuperación
│   │   └── test*.py
│   ├── manage.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── pages/                  # Páginas HTML por rol
│   ├── assets/css/
│   ├── assets/img/
│   ├── assets/js/
│   │   ├── core/               # API, sesión y utilidades
│   │   ├── components/         # Componentes reutilizables
│   │   ├── features/           # Funcionalidades y servicios
│   │   └── pages/              # Inicialización de pantallas por rol
│   └── tests/
├── main.py                     # Prototipo histórico de consola
├── models/                     # Clases del prototipo
└── services/triaje.py           # Triaje del prototipo
```

Las páginas cargan módulos funcionales que consumen `/api/` mediante `core/api.js`. Django valida permisos y entradas, ejecuta los servicios y persiste los cambios mediante ORM en PostgreSQL. La sesión y los datos del dominio tienen su fuente de verdad en el servidor; `localStorage` no acredita identidad.

`app/main.py`, `app/models/` y `app/services/triaje.py` pertenecen al prototipo histórico. No son modelos ORM, no proporcionan la API y no deben utilizarse para iniciar el sistema web ni como fuente de usuarios de demostración.

## Configuración y ejecución local

Requisitos: Python 3.10 o superior compatible con las versiones fijadas, PostgreSQL 14 o superior, un navegador moderno y acceso a los CDN utilizados. Node.js se necesita para las pruebas frontend, no para servir la aplicación.

La [guía del backend](app/backend/README.md) detalla todas las variables, contratos, reglas y requisitos de pruebas. Secuencia básica en PowerShell, desde la raíz del repositorio:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r app/backend/requirements.txt
Copy-Item app/backend/.env.example app/backend/.env
```

Crear previamente una base PostgreSQL de desarrollo y un usuario con permisos para crear sus tablas. Completar el `.env` privado con una clave Django aleatoria, los parámetros PostgreSQL y `DJANGO_DEBUG=true` para la entrega local por HTTP. El archivo de ejemplo no contiene credenciales utilizables. Si ya existe `.env`, conservarlo y revisar sus variables en lugar de sobrescribirlo.

Una vez configurado el entorno:

```powershell
.\.venv\Scripts\python.exe app/backend/manage.py migrate
.\.venv\Scripts\python.exe app/backend/manage.py createsuperuser
.\.venv\Scripts\python.exe app/backend/manage.py runserver
```

Abrir `http://localhost:8000/frontend/pages/auth/login.html`. La raíz `/` no es la pantalla de inicio. Usar el mismo host y puerto para frontend, API y origen de recuperación; no abrir los HTML con `file://` ni utilizar Live Server separado.

Las migraciones incluyen el catálogo inicial de especialidades. El administrador inicial crea médicos y secretarias desde la interfaz; los pacientes utilizan el registro público. Después se carga disponibilidad para poder reservar. No existe una carga general de datos de demostración documentada; utilizar exclusivamente identidades sintéticas para una demo.

Los comandos anteriores son instrucciones de instalación y arranque; no representan verificaciones ejecutadas durante esta actualización documental.

## Pruebas y estado de validación

- Backend: pruebas Django en `app/backend/dominio/test*.py`, con PostgreSQL de pruebas separado y permisos de creación de base.
- Frontend: pruebas Node en `app/frontend/tests/*.test.mjs`, con `node:test` y, en varios casos, `vm.SourceTextModule`.
- Navegador: scripts `*.browser.mjs`; requieren Chrome, Node con `WebSocket` global y condiciones específicas indicadas en la guía backend. La integración de perfiles es optativa mediante `RUN_PATIENT_BROWSER_TESTS=1`.

Se recomienda Node.js 22.15 o superior de la rama 22, o una versión posterior compatible; todavía debe fijarse y validar una versión de referencia para reproducibilidad. Las pruebas de navegador contienen una ruta de Chrome para Windows y algunas requieren commits históricos disponibles.

**Existen ocho fallos frontend previamente reportados en `availability-date-filter.test.mjs`; su causa todavía no está confirmada.** No se presenta la suite global como aprobada. En esta actualización se inspeccionó el código sin ejecutar pruebas, servidores ni migraciones. Los informes de ejecuciones anteriores son antecedentes y no certifican el estado de una instalación nueva.

## Documentación técnica

Consultar [app/backend/README.md](app/backend/README.md) para preparación de PostgreSQL, variables de entorno, recuperación por correo, contratos API, persistencia, cálculo de espera y requisitos de validación.
