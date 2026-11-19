# Backend Django y guía técnica del sistema

Este documento describe la implementación actual del Sistema de Triaje Automatizado y Optimización Adaptativa de Consultas Médicas. Sustituye la descripción acumulada por bloques de desarrollo y distingue el comportamiento implementado de la evidencia de pruebas disponible.

El backend activo es Django con Django REST Framework y PostgreSQL. El desarrollo funcional se considera finalizado para su alcance actual; la validación global no se declara aprobada: existen ocho fallos frontend previamente reportados cuya causa sigue sin confirmarse.

## 1. Arquitectura y responsabilidades

| Ubicación | Responsabilidad |
| --- | --- |
| `config/settings.py` | Entorno, PostgreSQL, autenticación, correo y configuración Django/DRF. |
| `config/urls.py`, `config/frontend.py` | API bajo `/api/` y entrega local de `../frontend/` bajo `/frontend/`, solo con `DEBUG=true`. |
| `dominio/models.py`, `managers.py` | Entidades ORM, relaciones, restricciones y creación de usuarios. |
| `dominio/authentication.py`, `permissions.py`, `password_validation.py` | Autenticación, autorización y política de contraseñas. |
| `dominio/serializers.py`, `views.py`, `urls.py` | Validación, representación, coordinación de solicitudes y rutas. |
| `dominio/agenda.py` | Gestión transaccional de disponibilidad. |
| `dominio/turnos.py` | Reservas y ciclo operativo de atención. |
| `dominio/triage.py`, `triaje_preliminar.py` | Clasificación por reglas y evaluación preliminar. |
| `dominio/reprogramacion.py` | Selección de destinos, propuestas y resolución de pendientes. |
| `dominio/demora.py` | Estimaciones informativas de demora y espera. |
| `dominio/metricas.py`, `nacimiento.py` | Agregaciones administrativas y utilidades de nacimiento/edad. |
| `dominio/migrations/` | Evolución del esquema y catálogo inicial. |
| `dominio/templates/dominio/` | Correo de recuperación en texto y HTML. |
| `dominio/test*.py` | Pruebas automatizadas del backend. |

Hay una aplicación Django propia, `dominio`, además de las aplicaciones de infraestructura de Django y DRF. `config` es el paquete de configuración del proyecto.

En el frontend, `assets/js/pages/` comprueba el rol e inicializa funcionalidades de `features/`. Estas utilizan `core/api.js`, `core/session.js` y componentes de `components/`. Las solicitudes JSON llegan a vistas DRF, que validan permisos y entradas antes de invocar servicios y ORM. PostgreSQL es la fuente de verdad del dominio.

El frontend utiliza HTML, CSS, Bootstrap 5 y ES Modules sin compilación. Bootstrap e iconos se cargan desde CDN. Autenticación y API usan el mismo origen; no hay JWT ni identidad acreditada por almacenamiento local.

### Prototipo histórico

`../main.py`, `../models/` y `../services/triaje.py` pertenecen a un prototipo de consola con clases y estructuras en memoria. El backend Django activo no importa esos paquetes. No son modelos ORM, migraciones, fixtures ni un método de arranque del sistema web. Sus datos no deben copiarse a una base real ni utilizarse como credenciales de demostración.

## 2. Requisitos

- Python 3.10 o superior compatible con las dependencias fijadas.
- PostgreSQL 14 o superior, con una base de desarrollo y permisos sobre su esquema.
- Navegador moderno con soporte de ES Modules y acceso a los recursos CDN.
- PowerShell para los ejemplos; todos parten de la raíz del repositorio.
- Para pruebas frontend: Node.js con `node:test`, `vm.SourceTextModule` y las APIs utilizadas por los scripts.
- Para pruebas de navegador: además, Chrome y Node con `WebSocket` global.

`requirements.txt` fija Django 5.2.18, Django REST Framework 3.16.1, psycopg con binarios 3.3.6 y python-dotenv 1.2.4. No hay instalación npm necesaria para ejecutar la interfaz.

Se recomienda Node.js 22.15 o superior de la rama 22, o una versión posterior compatible, como punto de partida para las herramientas de prueba. La versión de referencia debe fijarse después de validarla; esta guía no certifica una matriz de versiones probadas.

## 3. Preparación del entorno y PostgreSQL

### Entorno Python

Desde la raíz, crear un único entorno `.venv` y utilizar sus ejecutables explícitamente:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r app/backend/requirements.txt
Copy-Item app/backend/.env.example app/backend/.env
```

Si ya existe `app/backend/.env`, conservarlo y revisar su configuración; no sobrescribirlo con la plantilla. Si el entorno virtual está en otro directorio, ajustar consistentemente las rutas de los comandos.

Generar una clave privada aleatoria y copiarla al campo `DJANGO_SECRET_KEY` del archivo local:

```powershell
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(64))"
```

Este comando genera una clave nueva; no recupera credenciales existentes. No publicar su salida ni el `.env` real.

### Base de datos

Crear previamente una base de desarrollo y un usuario autorizado sobre ella y su esquema. Las migraciones crean las tablas, no el servidor, el rol ni la base de desarrollo. Completar las variables PostgreSQL con parámetros propios.

El motor es `django.db.backends.postgresql`; no hay fallback a SQLite ni lectura de `DATABASE_URL`. Las credenciales se configuran mediante variables separadas. Un proveedor remoto, incluido Supabase, requiere sus parámetros reales de conexión o pooler y política SSL.

`POSTGRES_SSLMODE=prefer` es el valor predeterminado para desarrollo local. Para conexiones remotas, configurar `require` o `verify-full` según los requisitos del proveedor.

### Variables de entorno

Django carga `app/backend/.env` mediante python-dotenv. Las variables definidas en el proceso prevalecen sobre ese archivo. `.env.example` no contiene credenciales utilizables.

| Variable | Uso y valor predeterminado |
| --- | --- |
| `DJANGO_SECRET_KEY` | Clave privada obligatoria. Vacía: la configuración falla explícitamente. |
| `DJANGO_DEBUG` | `false`. Usar `true` para servir el frontend local por HTTP. |
| `DJANGO_ALLOWED_HOSTS` | Hosts separados por comas; por defecto `localhost,127.0.0.1`. No son URLs. |
| `POSTGRES_DB` | Nombre de base; debe completarse para conectar. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | Usuario y contraseña privados de PostgreSQL. |
| `POSTGRES_HOST`, `POSTGRES_PORT` | Por defecto `localhost` y `5432`. |
| `POSTGRES_SSLMODE` | Por defecto `prefer`; ajustar al servidor. |
| `POSTGRES_TEST_DB` | Nombre opcional exclusivo de base de pruebas, distinto de desarrollo/producción. |
| `DJANGO_SESSION_COOKIE_SECURE`, `DJANGO_CSRF_COOKIE_SECURE` | Por defecto, inverso de `DEBUG`. Activar para HTTPS. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | Orígenes confiables separados por comas. Vacía por defecto; no requiere otro origen para el arranque local propuesto. |
| `PASSWORD_RESET_BASE_URL` | Origen confiable de recuperación; por defecto `http://localhost:8000`. Sin ruta, credenciales, consulta ni fragmento. |
| `EMAIL_BACKEND` | Consola con `DEBUG=true`, SMTP con `DEBUG=false`, salvo configuración explícita. La plantilla fija consola. |
| `DEFAULT_FROM_EMAIL` | Remitente; por defecto `no-reply@localhost`. Usar uno autorizado para SMTP. |
| `EMAIL_HOST`, `EMAIL_PORT` | Servidor SMTP y puerto; por defecto `localhost` y `587`. |
| `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | Credenciales SMTP privadas, vacías por defecto. |
| `EMAIL_USE_TLS`, `EMAIL_USE_SSL` | Por defecto `true` y `false`. Elegir según proveedor, sin activar ambas. |

El tiempo de conexión PostgreSQL es de tres segundos, el timeout de correo es de diez segundos y el vencimiento de recuperación es de 3600 segundos. Están fijados en el código; no son variables de entorno expuestas actualmente.

Para HTTP local, configurar `DJANGO_DEBUG=true` y usar coherentemente `localhost` o `127.0.0.1` en navegador y origen de recuperación. La plantilla tiene `DEBUG=false`: copiarla sin ajustar no habilita la entrega local del frontend.

## 4. Inicialización y ejecución local

Los comandos siguientes son instrucciones de preparación y ejecución; no representan acciones ejecutadas durante esta actualización documental.

Una vez creada la base y completado el entorno, desde la raíz:

```powershell
.\.venv\Scripts\python.exe app/backend/manage.py migrate
.\.venv\Scripts\python.exe app/backend/manage.py createsuperuser
.\.venv\Scripts\python.exe app/backend/manage.py runserver
```

`createsuperuser` solicita email, datos obligatorios y contraseña privada. El manager crea un usuario `ADMINISTRADOR`, activo y con los flags técnicos correspondientes; no crea un perfil separado. La interfaz administrativa propia está en `frontend/pages/admin/`; esta configuración no habilita una ruta `/admin/` de Django.

Abrir `http://localhost:8000/frontend/pages/auth/login.html`. La raíz `/` no tiene pantalla de inicio. No abrir los HTML con `file://` ni utilizar un servidor estático separado. Django entrega frontend y API bajo el mismo origen, conservando CSRF.

### Demostración desde una base vacía

1. Aplicar migraciones y crear el administrador inicial.
2. Desde administración, crear médicos con matrícula/especialidad y secretarias con legajo; las altas internas requieren fecha de nacimiento.
3. Registrar pacientes desde el formulario público, con nacimiento obligatorio.
4. Cargar bloques futuros de disponibilidad desde médico o secretaría.
5. Reservar y completar el cuestionario cuando la especialidad lo requiera.
6. Para atención del día, registrar presencia desde secretaría, iniciar desde médico y finalizar desde médico o secretaría.

La migración `0003_catalogo_especialidades.py` provisiona Clínica Médica, Pediatría y Cardiología. No hay un comando general de datos demo ni credenciales públicas predeterminadas. Los datos internos de pruebas no se cargan en desarrollo. Utilizar identidades sintéticas para demostraciones.

## 5. Modelo y persistencia

| Modelo | Responsabilidad y relaciones |
| --- | --- |
| `Usuario` | Email único sin distinguir mayúsculas, datos personales, nacimiento opcional en el modelo, rol, actividad, contador de fallos y permisos Django. |
| `Paciente` | Perfil uno a uno; obra social opcional. |
| `Medico` | Perfil uno a uno; matrícula única y especialidad obligatoria. |
| `Secretaria` | Perfil uno a uno; legajo único. |
| `Especialidad` | Catálogo con nombre único. |
| `Disponibilidad` | Médico, fecha, intervalo y estado `DISPONIBLE`, `OCUPADO` o `BLOQUEADO`. |
| `Turno` | Paciente, médico, bloque, fecha/hora, origen, duración, estado, marcas de atención y actor de cierre. |
| `Triaje` | Uno a uno con turno; respuestas JSON, prioridad y fecha de evaluación. |
| `PropuestaReprogramacion` | Turno, origen, destino, motivo, creador, estado y resolución. |

Administrador es un rol de Usuario, sin tabla ORM propia. Los perfiles deben ser consistentes con el rol; la aplicación rechaza perfiles faltantes, múltiples o incompatibles. Las escrituras externas deben respetar estos contratos.

Las claves foráneas protegen relaciones históricas. Hay restricciones e índices; agenda, reserva y reprogramación usan transacciones y bloqueos para coordinar cambios concurrentes. La unicidad del email está respaldada por PostgreSQL. La protección de DNI en registro público no equivale a una restricción global única de DNI en el modelo.

Deben conservarse y aplicarse las siete migraciones, de `0001_initial.py` a `0007_usuario_fecha_nacimiento.py`. El nacimiento admite valores históricos ausentes en el modelo, aunque registro público y altas internas actuales lo exigen.

## 6. Autenticación, perfiles y pacientes

### Sesiones y contraseñas

La API utiliza sesiones Django, `SessionAuthentication` y CSRF. `core/api.js` obtiene un token con `GET /api/auth/csrf/`, envía cookies del mismo origen e incorpora `X-CSRFToken` en escrituras. El login devuelve un token actualizado. El servidor comprueba usuario activo y perfil válido; las pantallas comprueban además el rol.

El email identifica la cuenta. Las contraseñas se guardan mediante hashing Django, no en texto plano. La política exige al menos ocho caracteres, mayúscula, minúscula, número y carácter especial que no sea espacio, junto con los validadores nativos configurados.

Cinco fallos consecutivos bloquean nuevos ingresos por contraseña. Solicitar un enlace o dejarlo vencer no elimina ese bloqueo. Confirmar recuperación válida reinicia el contador. El cambio autenticado requiere la contraseña actual y conserva la sesión actual mediante `update_session_auth_hash`; la recuperación no crea sesión y el cambio de hash invalida las anteriores.

Login, recuperación y registro público tienen throttling complementario de diez solicitudes por minuto/IP por ámbito. No equivale a protección completa frente a abuso distribuido.

### Registro y edición propia

El registro público crea transaccionalmente Usuario PACIENTE y perfil Paciente; no permite elegir roles internos ni inicia sesión automáticamente. Exige nombre, apellido, DNI, teléfono, email, fecha de nacimiento y contraseña/confirmación; obra social es opcional. DNI y teléfono son numéricos y el nacimiento no puede ser futuro.

`GET /api/auth/me/` devuelve la identidad autenticada. `PATCH` modifica únicamente:

| Rol | Campos admitidos |
| --- | --- |
| Paciente | `nombre`, `apellido`, `telefono`, `obra_social`. |
| Médico | `nombre`, `apellido`, `telefono`. |
| Secretaria | `nombre`, `apellido`, `telefono`. |
| Administrador | No autorizado para esta edición propia. |

El objetivo procede de la sesión, no de un ID enviado por el cliente. Se revalidan actividad, rol y perfil bajo bloqueo. Se rechazan campos adicionales antes de guardar: email, DNI, nacimiento, rol, actividad, contraseña, datos profesionales y perfiles anidados. Un campo protegido produce HTTP 400 sin guardar parcialmente los demás.

El teléfono exige dígitos ASCII. Omitir obra social conserva su valor; enviar cadena vacía la elimina. El frontend reutiliza `features/auth/patient-profile-ui.js` para los tres roles y separa datos personales de contraseña. Email y datos de identidad/profesionales permanecen de solo lectura; nacimiento se muestra como DD-MM-YYYY o «No registrada».

### Administración y activación de pacientes

`/api/admin/usuarios/` administra exclusivamente médicos y secretarias: alta, consulta y actualización de campos permitidos. No ofrece eliminación física ni cambio de contraseñas ajenas desde la gestión existente.

`/api/admin/pacientes/` es exclusivo de administrador:

- `GET` lista pacientes y `GET {id}/` consulta uno, con identificador de Usuario.
- `PATCH {id}/` acepta únicamente `is_active`.
- No admite alta, `PUT`, eliminación ni acceso a usuarios de otros roles por esa ruta.

Desactivar modifica solo `Usuario.is_active`. Conserva relaciones, turnos, disponibilidad e historial; no cancela reservas futuras. Una cuenta inactiva no puede ingresar, operar con una sesión previa, recibir recuperación ni confirmar un token.

Reactivar habilita nuevamente una cuenta con perfil válido, pero no cambia su contraseña ni reinicia intentos fallidos. La inactividad no revoca permanentemente sesiones: una sesión anterior todavía válida podría volver a utilizarse tras reactivar si no cambió el hash.

## 7. Recuperación mediante correo electrónico

1. `frontend/pages/auth/recuperar-password.html` solicita recuperación mediante `POST /api/auth/password-reset/` con `email` y CSRF.
2. Django utiliza `PasswordResetForm` y responde uniformemente, sin revelar si la cuenta existe o permite recuperación.
3. Para una cuenta activa con contraseña utilizable, genera asunto y cuerpos de texto/HTML desde `templates/dominio/password_reset_*`.
4. El enlace abre la pantalla frontend con `uid` y `token`. Su origen procede de `PASSWORD_RESET_BASE_URL`, nunca del Host recibido del cliente.
5. La confirmación usa `POST /api/auth/password-reset/confirm/`, con `uid`, `token`, `password_nueva` y `password_confirmacion`.
6. El servidor comprueba actividad, token y política de contraseña, actualiza el hash y reinicia los intentos. El usuario vuelve a iniciar sesión.

El token vence a la hora y deja de ser válido tras un restablecimiento exitoso. La pantalla retira sus parámetros de la barra de direcciones y los conserva en memoria.

### Consola y SMTP

En desarrollo sin envíos externos, utilizar `django.core.mail.backends.console.EmailBackend`: el mensaje aparece en la consola y no llega a una casilla real. Incluye un enlace de recuperación que no debe publicarse como log de ejemplo.

Para correo real, configurar en el archivo privado:

- `EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend`.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER` y `EMAIL_HOST_PASSWORD`.
- `EMAIL_USE_TLS` y `EMAIL_USE_SSL` según proveedor, sin activar ambas.
- `DEFAULT_FROM_EMAIL` autorizado y `PASSWORD_RESET_BASE_URL` correspondiente al origen del navegador.

Si el proveedor requiere contraseña de aplicación, guardarla únicamente en el entorno privado; nunca en README, código, capturas o informes. La existencia del flujo no demuestra entrega SMTP en una configuración concreta: depende del entorno y no se verificó durante esta actualización.

## 8. Turnos, triaje, disponibilidad y reprogramación

La disponibilidad se gestiona por médico mediante intervalos reales, validación de fechas, solapamientos y estados. Reservar valida paciente, médico y bloque, ocupa el bloque y persiste el turno; guarda triaje cuando la especialidad lo requiere.

El ciclo principal es `RESERVADO → PRESENTE → EN_ATENCION → COMPLETADO`. Secretaría registra presencia en la fecha programada; el médico inicia. Médico o secretaría finalizan una consulta en atención, registrando `cerrado_por`. No se permite iniciar otra consulta si el médico ya tiene una en curso. Modificar y cancelar tienen restricciones según estado y asignación. `PENDIENTE` representa turnos sin asignación resuelta; `AUSENTE` se conserva como estado histórico, no como nueva transición automática.

### Triaje

`triage.py` valida respuestas y aplica reglas deterministas, sin aprendizaje automático. Clínica Médica considera fiebre, dificultad respiratoria y dolor. Pediatría considera nacimiento, fiebre/duración, respiración, agitación, vómitos y estado general. La edad relevante puede depender de la fecha de atención. La evaluación preliminar utiliza el mismo clasificador sin reservar ni persistir un turno.

Las prioridades son `ALTA`, `MEDIA` y `BAJA`. Cardiología no utiliza cuestionario ni recibe una prioridad clínica inventada. El resultado es orientativo y no sustituye diagnóstico o atención profesional.

### Reprogramación

Requiere fecha de destino explícita y bloques válidos existentes de la misma agenda. Para especialidades con triaje ordena por prioridad, creación e identificador; para el flujo convencional, por fecha, hora e identificador. Puede utilizar fechas de la misma jornada si los bloques cumplen las condiciones del servicio.

Las propuestas persisten origen y destino, creador, motivo y resolución. El paciente acepta o rechaza las propias; aceptar revalida el destino. Los estados son `EN_ESPERA`, `ACEPTADA`, `RECHAZADA`, `ANULADA` e `INVALIDADA`. Hay restricciones de propuesta abierta por turno y destino. No se crean bloques automáticamente ni se garantiza capacidad inexistente.

## 9. Demora y espera estimadas

`GET /api/turnos/{id}/demora/` permite al paciente propietario consultar una estimación de `dominio/demora.py`. No persiste el cálculo ni cambia el turno. Aplica a `RESERVADO` o `PRESENTE` de la jornada actual, sujetos a consistencia temporal.

Sean `H` el horario programado, `N` la hora actual del servidor y `M` la media sin redondear de duraciones válidas de consultas completadas del mismo médico. Exige inicio/cierre válidos, duración positiva y cierre no futuro.

La carga restante `R` suma el tiempo restante de una consulta en curso y `cantidad_presentes_anteriores × M`. Los presentes anteriores se ordenan por hora y, en empate, identificador; los meramente reservados no integran esa cola.

```text
inicio base = max(H, N + R)
demora_estimada_minutos = max(0, ceil((inicio base - H) / un minuto))
inicio_estimado = H + demora_estimada_minutos expresados en minutos
espera_estimada_minutos = ceil(R / un minuto), si existe M
```

El dashboard muestra **espera estimada**: carga pendiente desde ahora, sin contar los minutos hasta el horario reservado. `promedio_consulta_minutos` es la media histórica redondeada hacia arriba, no la demora actual.

| Situación | Comportamiento |
| --- | --- |
| Cola válida y media disponible | Calcula carga restante; `ESTIMADA` o `SIN_DEMORA` según demora respecto de H. |
| Sin media válida | Promedio y espera son `null`; con trabajo por delante devuelve `SIN_DATOS`. Sin cola puede conservar demora cero o calculable, sin inventar promedio ni espera. |
| Consulta en curso que alcanza o supera M | `CONSULTA_DEMORADA`, con tiempo restante, demora e inicio indeterminados. |
| Otra fecha, llegada inválida, varias atenciones en curso o consulta anterior aún abierta del mismo médico | `SIN_DATOS`, según la condición y motivo devuelto. |
| Turno que ya no espera inicio | `NO_APLICA`. |

Cancelados, ausentes y turnos de otros médicos no integran la carga pendiente. La consulta en curso no entra en la media hasta completarse y cumplir sus filtros. El promedio puede estar disponible aunque no pueda calcularse la espera. `null` no equivale a cero.

El panel consulta el próximo turno cada 60 segundos, actualiza el contexto cuando cambia y libera el temporizador al abandonar la página. La estimación puede variar: no garantiza una hora ni modifica el orden operativo o las prioridades.

## 10. Métricas administrativas

`GET /api/admin/metricas/`, exclusivo del administrador, utiliza agregaciones ORM. Admite `desde`, `hasta`, `medico`, `especialidad` y `estado`; rechaza filtros desconocidos o inválidos.

- Cuenta turnos por estado, médico y prioridad persistida; ausencia de triaje se muestra separada.
- Reservas activas: `RESERVADO + PRESENTE + EN_ATENCION`.
- Espera observada media: inicio menos arribo, con marcas ordenadas, en atención o completados.
- Atención observada media: cierre menos inicio, con marcas ordenadas, en completados.
- Informa muestras válidas; sin muestras devuelve `null`. Cero puede ser duración observada válida en métricas.
- Ausentismo histórico: `100 × AUSENTE / (AUSENTE + COMPLETADO)`; sin denominador devuelve `null`.
- Cuenta propuestas `EN_ESPERA` de los turnos filtrados, sin inferir procesos no modelados.
- Los conteos globales de usuarios no cambian con filtros de turnos.

Las medias descriptivas no son idénticas al estimador de espera, que exige duraciones positivas y condiciones adicionales. La respuesta no entrega documentos ni respuestas clínicas individuales.

## 11. Rutas principales de la API

Todas llevan prefijo `/api/`. `{id}` identifica el recurso de cada ruta; en administración de pacientes es el ID de Usuario. Los listados paginados utilizan `results` y `next`; el frontend los recorre mediante `listAll()`.

| Método y ruta | Uso y autorización principal |
| --- | --- |
| `GET auth/csrf/` | Obtener CSRF. |
| `POST auth/login/`, `POST auth/logout/` | Iniciar/cerrar sesión. |
| `POST auth/registro-paciente/` | Registro público exclusivo de pacientes. |
| `GET auth/me/`, `PATCH auth/me/` | Identidad y edición propia por rol/campo. |
| `POST auth/password/` | Cambio autenticado de contraseña. |
| `POST auth/password-reset/`, `POST auth/password-reset/confirm/` | Solicitar/confirmar recuperación. |
| `GET/POST admin/usuarios/`, `GET/PUT/PATCH admin/usuarios/{id}/` | Administrar médicos y secretarias. |
| `GET admin/pacientes/`, `GET/PATCH admin/pacientes/{id}/` | Consultar/activar pacientes. |
| `GET admin/especialidades/`, `GET admin/metricas/` | Catálogo y métricas para administrador. |
| `GET especialidades/`, `GET medicos/`, `GET medicos/{id}/` | Catálogo/directorio según permisos. |
| `GET/POST medicos/{medico}/disponibilidades/` | Listar/crear bloques según permisos. |
| `POST medicos/{medico}/disponibilidades/lote/` | Crear por lote. |
| `GET/PATCH/DELETE medicos/{medico}/disponibilidades/{id}/` | Consultar/actualizar/eliminar cuando el estado lo permite. |
| `POST medicos/{medico}/disponibilidades/{id}/bloquear/` o `desbloquear/` | Cambiar bloqueo. |
| `GET turnos/`, `GET turnos/{id}/` | Turnos propios del paciente. |
| `GET turnos/{id}/demora/` | Estimación para el propietario. |
| `POST turnos/{id}/cancelar/`, `modificar/` o `reasignar/` | Operar turno propio según estado. |
| `GET/POST medicos/{medico}/turnos/` | Consultar agenda u originar reserva según rol; el médico no reserva desde esta operación. |
| `GET medicos/{medico}/turnos/{id}/` | Detalle autorizado de agenda. |
| `POST medicos/{medico}/turnos/{id}/presencia/`, `iniciar/` o `finalizar/` | Ciclo operativo según rol. |
| `POST medicos/{medico}/turnos/{id}/cancelar/`, `modificar/` o `reasignar/` | Gestión por secretaría según estado. |
| `GET pacientes/` | Búsqueda operativa para secretaría. |
| `POST medicos/{medico}/triaje-preliminar/` | Evaluación sin reserva, para paciente. |
| `GET medicos/{medico}/reprogramacion/afectados/` o `fechas/` | Consultar alcance/destinos para gestores. |
| `POST medicos/{medico}/reprogramacion/` | Generar reprogramación. |
| `POST medicos/{medico}/turnos/{id}/propuestas/` | Proponer destino a pendiente. |
| `GET medicos/{medico}/propuestas/` o `pendientes/` | Seguimiento de agenda. |
| `GET propuestas/`, `GET propuestas/{id}/` | Propuestas propias. |
| `POST propuestas/{id}/aceptar/` o `rechazar/` | Resolver propuesta propia. |

Las rutas no conceden autorización por sí mismas: vistas, serializers y servicios verifican rol, propiedad, estado y consistencia. Los errores distinguen validación, autenticación/permisos, recurso inexistente, conflicto y límite de solicitudes. `core/api.js` concentra HTTP y no reintenta mutaciones silenciosamente.

## 12. Pruebas automatizadas y reproducibilidad

### Backend

Las pruebas están en `dominio/test*.py`: modelo, autenticación, permisos, perfiles, pacientes, reservas, disponibilidad, triaje, atención, reprogramación, demora, métricas y entrega del frontend.

Las pruebas con base requieren un servidor PostgreSQL exclusivamente de desarrollo/pruebas, permisos `CREATEDB` y acceso al esquema. Django crea y destruye una base separada. `POSTGRES_TEST_DB`, si se define, debe ser exclusivo de pruebas, nunca el nombre de desarrollo o producción. Revisar el destino efectivo antes de ejecutar; no reutilizar cuentas de producción.

Ejemplo futuro desde la raíz, una vez verificado el aislamiento:

```powershell
$env:POSTGRES_TEST_DB = 'test_tesis_' + [guid]::NewGuid().ToString('N')
.\.venv\Scripts\python.exe app/backend/manage.py test dominio
Remove-Item Env:POSTGRES_TEST_DB
```

Una comprobación estructural sin base PostgreSQL es:

```powershell
.\.venv\Scripts\python.exe app/backend/manage.py test dominio.tests.EstructuraTests
```

La clave Django sigue siendo necesaria para cargar configuración. Los tests de concurrencia que requieren bloqueos PostgreSQL no pueden validarse sustituyendo el motor por SQLite.

### Frontend con Node

`../frontend/tests/*.test.mjs` utiliza `node:test`, aserciones nativas y, en varios casos, `vm.SourceTextModule`, que requiere la opción de VM experimental. No requiere instalar un framework npm.

Ejemplo futuro desde la raíz, pasando archivos explícitos para evitar diferencias de expansión de comodines entre shells:

```powershell
$frontendTestFiles = @(Get-ChildItem app/frontend/tests -Filter '*.test.mjs' | ForEach-Object { $_.FullName })
node --experimental-vm-modules --test $frontendTestFiles
```

No incluye los scripts `*.browser.mjs`.

### Navegador

Los cuatro scripts `*.browser.mjs` usan Chrome headless y Chrome DevTools Protocol. Contienen la ruta `C:/Program Files/Google/Chrome/Application/chrome.exe`; otros entornos requieren adaptar esa dependencia en una tarea de código posterior. Necesitan Node con `WebSocket` global y puertos locales disponibles. Algunos levantan servidores locales y crean perfiles/artefactos temporales.

`internal-users-cache.browser.mjs` lee un commit histórico mediante Git; un clon superficial sin ese objeto no es suficiente. Otras pruebas de navegador utilizan respuestas API simuladas y no sustituyen una integración real con PostgreSQL.

`dominio.test_gestion_pacientes_browser` utiliza Django `LiveServerTestCase`, PostgreSQL de pruebas, correo en memoria y `patient-management.browser.mjs`. Está omitida salvo que `RUN_PATIENT_BROWSER_TESTS=1`. El test Django prepara cuentas y transmite origen e identificadores al script; no debe invocarse el script aislado contra una base habitual.

Ejemplo futuro, solo después de comprobar aislamiento y requisitos:

```powershell
$env:POSTGRES_TEST_DB = 'test_tesis_browser_' + [guid]::NewGuid().ToString('N')
$env:RUN_PATIENT_BROWSER_TESTS = '1'
.\.venv\Scripts\python.exe app/backend/manage.py test dominio.test_gestion_pacientes_browser
Remove-Item Env:RUN_PATIENT_BROWSER_TESTS
Remove-Item Env:POSTGRES_TEST_DB
```

Estos comandos crean recursos de prueba y arrancan un servidor local durante la ejecución. Son únicamente instrucciones; no se ejecutaron durante esta actualización. Logs, resultados JSON y perfiles temporales no son código de pruebas ni datos demo de la aplicación.

### Estado conocido

Existen **ocho fallos frontend previamente reportados en `availability-date-filter.test.mjs` cuya causa todavía no se confirmó**. La presencia de fechas fijas y relojes simulados no permite atribuirles una causa definitiva sin diagnóstico. No se declara aprobada la suite global ni se extrapolan resultados de subconjuntos a todo el sistema.

Esta documentación se contrastó inspeccionando código, sin ejecutar pruebas, servidores, migraciones ni operaciones de base de datos. Los informes históricos describen ejecuciones previas con alcances y entornos específicos; algunos dependen de ejecutores temporales locales no distribuidos. No equivalen a validar una instalación nueva ni el recorrido de migraciones actual.

## 13. Alcance y pendientes

La ejecución descrita es local. Un despliegue requiere entrega estática del frontend y enrutamiento de `/api/` bajo el mismo origen, con `DEBUG=false`, HTTPS, cookies seguras, correo y política de proxy/throttling adecuados. La vista de desarrollo de `/frontend/` devuelve 404 con `DEBUG=false`. No hay un procedimiento de producción validado en esta guía.

Quedan pendientes diagnosticar los ocho fallos frontend, fijar un entorno de pruebas reproducible y portable, documentar una carga demo si se incorpora y validar separadamente cada configuración SMTP o despliegue concreto. No se implementa verificación de propiedad del email en el registro. La clasificación por reglas y las estimaciones operativas no acreditan validación clínica.
