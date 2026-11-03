# Backend - Bloques 1, 2 y 3

Proyecto Django 5.2 LTS y DRF con PostgreSQL como unico motor. Una app
`dominio` contiene el modelo relacional; `config` contiene infraestructura.
El Bloque 1 define el esquema. El Bloque 2 agrega autenticación por sesión,
identidad y administración de cuentas internas; no conecta el frontend.
El Bloque 3 agrega catálogo, directorio de médicos y disponibilidad por agenda,
sin reservar turnos ni implementar triaje o reprogramación.

## Auditoria inicial

- A, reutilizable: frontend como referencia funcional y `.gitignore` Python.
- B, historico: `app/main.py`, `app/models/*.py`, `app/services/triaje.py`.
  Son clases/listas y un programa de consola; no son modelos ORM ni API.
- C, reemplazable: identidad y persistencia mock del frontend. Este bloque
  no las conecta ni modifica.
- D, conflicto potencial: importar los antiguos `models`/`services`, copiar
  sus IDs/credenciales o su calculo de puntaje/color/duracion. El proyecto
  nuevo no importa esos paquetes.
- No existian `app/backend`, Django, requirements, migraciones ni
  configuracion MySQL, PostgreSQL o Supabase. `.env` ya estaba ignorado;
  ahora tambien se ignoran sus variantes privadas, conservando `.env.example`.

## Preparacion

Desde la raiz del repositorio, con Python 3.10 o superior compatible:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r app/backend/requirements.txt
Copy-Item app/backend/.env.example app/backend/.env
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(64))"
```

Completar el archivo privado con una clave generada y datos reales de una
base PostgreSQL de desarrollo. El comando de clave solo imprime un valor;
no crea credenciales demo. Variables del proceso prevalecen sobre `.env`.
Sin `DJANGO_SECRET_KEY` el proyecto falla explicitamente al iniciar.
Sin `POSTGRES_DB` los comandos que necesitan conexion fallan; no hay fallback.

| Variable | Uso |
| --- | --- |
| DJANGO_SECRET_KEY | Obligatoria; clave privada de Django |
| DJANGO_DEBUG | `false` por defecto; `true` solo en desarrollo |
| DJANGO_ALLOWED_HOSTS | Hosts separados por comas |
| POSTGRES_DB | Nombre real de la base, requerido para conectar |
| POSTGRES_USER / POSTGRES_PASSWORD | Credenciales segun el servidor |
| POSTGRES_HOST / POSTGRES_PORT | localhost / 5432 por defecto |
| POSTGRES_SSLMODE | prefer local; require o verify-full segun proveedor remoto |

Para Supabase utilizar los parametros reales proporcionados por el proyecto,
incluidos host de conexion/pooler y politica SSL; no se incluye ninguna cuenta.
Se requiere PostgreSQL 14 o superior para Django 5.2.

```powershell
cd app/backend
..\..\.venv\Scripts\python.exe manage.py check
..\..\.venv\Scripts\python.exe manage.py makemigrations --check
..\..\.venv\Scripts\python.exe manage.py migrate
..\..\.venv\Scripts\python.exe manage.py test dominio
```

Las pruebas de BD usan una base de test separada administrada por Django:
usar exclusivamente un servidor de desarrollo con permisos para crearla.
No ejecutar tests contra una cuenta de produccion. No cargan fixtures ni dejan
cuentas demo en la base normal.

Pruebas que no necesitan PostgreSQL:

```powershell
..\..\.venv\Scripts\python.exe manage.py test dominio.tests.EstructuraTests
```

WSGI y ASGI estan configurados. `manage.py runserver` puede iniciarse una vez
configurada la conexion; aun no hay rutas funcionales y `/` responde 404.

## Modelo y decisiones

Todos los modelos tienen PK estable BigAutoField; Turno y Triaje la nombran
`id_turno` e `id_triaje`. No se conservan los IDs independientes del prototipo
como nuevas identidades.

| Modelo | Campos y relaciones |
| --- | --- |
| Usuario | id, email unico, password/last_login heredados, nombre, apellido, dni, telefono, rol, is_active, is_staff, is_superuser, date_joined y permisos/grupos Django |
| Paciente | id, usuario 1:1 obligatorio, obra_social opcional |
| Medico | id, usuario 1:1 obligatorio, matricula unica, especialidad FK obligatoria |
| Secretaria | id, usuario 1:1 obligatorio, legajo unico |
| Especialidad | id, nombre unico; admite Clinica Medica, Cardiologia y Pediatria sin seed automatico |
| Disponibilidad | id, medico FK, fecha, hora_inicio, hora_fin, estado |
| Turno | id_turno, fecha, hora, estado, duracion_turno (minutos), fecha_hora_creacion, fecha_hora_arribo/inicio/cierre, paciente, medico, disponibilidad, secretaria |
| Triaje | id_triaje, turno 1:1 obligatorio, respuesta_sintomas, nivel_prioridad, fecha_hora_evaluacion |

- Usuario hereda AbstractBaseUser y PermissionsMixin. USERNAME_FIELD=email;
  AUTH_USER_MODEL se define antes de la migracion inicial. El manager usa
  set_password y normaliza email. UniqueConstraint(Lower(email)) asegura
  unicidad sin distinguir mayusculas incluso con escrituras fuera del manager.
  Las escrituras futuras deben usar el manager/set_password: el ORM no impide
  asignaciones directas al campo password. No hay tabla de credenciales paralela.
- Administrador es un rol; no posee perfil separado. is_staff/is_superuser son
  flags tecnicos de Django, no sustituyen el rol de dominio.
- Los perfiles solo guardan datos especificos. clean() valida su correspondencia
  de rol y limit_choices_to ayuda en formularios. No es un CHECK entre tablas:
  save()/bulk_create no ejecutan full_clean automaticamente. Bloque 2 debe
  validar y crear usuario/perfil atomicamente y controlar cambios de rol.
- Medico tiene una especialidad; las reglas clinicas quedan fuera del modelo.
- Disponibilidad diferencia DISPONIBLE, OCUPADO y BLOQUEADO. No se calcula
  ocupacion automaticamente ni se resuelven solapamientos en este bloque.
- Turno permite disponibilidad y secretaria NULL, ademas de los tres timestamps
  operativos NULL hasta que ocurren. Las demas relaciones son obligatorias.
  Disponibilidad es FK, no 1:1: un bloque puede conservar referencias de turnos
  cancelados y utilizarse posteriormente por otra reserva.
- fecha_hora_creacion usa default=timezone.now, no auto_now; actualizar estado
  no cambia la fecha. editable=False evita edicion en formularios, pero no
  vuelve inmutable el dato frente a escrituras ORM explicitas. El default
  permite importar una fecha historica real en una migracion futura.
- duracion_turno es positiva e independiente del triaje. La coincidencia de
  medico/fecha/hora/duracion con disponibilidad sera validada por el servicio
  transaccional de un bloque posterior, junto con concurrencia y revalidacion del bloque.
- Triaje usa JSONField (jsonb en PostgreSQL) para respuestas estructuradas de
  distintos cuestionarios. clean() exige objeto; no define reglas clinicas ni
  un esquema de sintomas que aun corresponda implementar en otro bloque.
- Turno puede no tener Triaje: Cardiologia no recibe prioridad BAJA artificial.
  El esquema no impone restricciones clinicas por especialidad; eso se validara
  posteriormente. No se agrega prioridad al Turno ni duracion al Triaje.
- AUSENTE permanece como compatibilidad historica, sin flujo nuevo.
- Las relaciones usan PROTECT para impedir borrados accidentales de historial.
  Activar/desactivar cuentas y cancelar turnos son cambios de estado.
- Un indice de agenda (medico, fecha, estado, fecha_hora_creacion) soporta
  consultas posteriores sin establecer ranking global ni ejecutar el desempate.

## Constraints y limites

BD: unicidad de email exacta y case insensitive, roles validos, perfiles 1:1,
nombre de especialidad/matricula/legajo unicos, FK protegidas, intervalo de
disponibilidad positivo, bloque exacto unico por medico/fecha/inicio/fin,
estados de disponibilidad y turno validos, duracion positiva, Turno-Triaje 1:1
y prioridad ALTA/MEDIA/BAJA valida.

No se agregan triggers ni exclusiones de intervalos ni validaciones entre
tablas dentro de CHECK. Estados de disponibilidad y reservas deben sincronizarse
mediante servicios transaccionales futuros. Las validaciones de clean requieren
full_clean o invocacion explicita por serializers/services.

## Alcance originalmente previsto para Bloque 2 (referencia del Bloque 1)

Autenticacion API, validacion de password en endpoints, permisos por rol,
administracion de cuentas sobre Usuario unico, manejo de sesion/token,
intentos fallidos/bloqueo/caducidad y recuperacion. Definir contratos y
servicios de operaciones que se habiliten: no implementar de golpe todos los
flujos ni migrar JSON sin una estrategia de seed acordada.

La politica completa de complejidad del prototipo debe acordarse y aplicarse
con validadores de password cuando se expongan altas/cambios. La base configura
los validadores estandar de Django; create_user no ejecuta validate_password.
Al cierre del Bloque 1 no habia integracion frontend, endpoints Admin, metricas definitivas, reglas
clinicas, modelos Reprogramacion/ListaEspera/Notificacion ni seeds.

## Verificacion historica del Bloque 1 - 2026-11-02

Punto de partida: rama `feature/triage-final`, HEAD `a090fbc`, arbol limpio.
Se utilizaron Django 5.2.18, DRF 3.16.1, psycopg 3.3.6 y python-dotenv 1.2.4,
instalados en `.venv` ignorado. No se creo `.env` ni se guardo una clave:
los checks recibieron una clave efimera generada en el entorno del proceso.

| Comprobacion | Resultado |
| --- | --- |
| manage.py check | Exit 0; System check identified no issues (0 silenced). |
| manage.py test dominio.tests.EstructuraTests | Exit 0; 8 tests, OK; sin preparar BD |
| Sintaxis AST e imports Python nuevos | Exit 0; 13 archivos; WSGI, ASGI y migracion incluidos |
| pip check | Exit 0; No broken requirements found. |
| Grafo inicial y comparacion offline modelos/migraciones | Exit 0; sin cambios detectados |
| manage.py makemigrations --check | Exit 1; ImproperlyConfigured: falta NAME u OPTIONS['service'] en DATABASES |
| manage.py migrate | No ejecutado: sin PostgreSQL configurado |
| 10 tests IntegridadPostgreSQLTests | Pendientes: requieren BD de desarrollo |
| git diff --check y revision --no-index de archivos nuevos | Exit 0; sin errores de whitespace |
| git diff --exit-code -- app/frontend y status de frontend | Exit 0; sin cambios |
| git check-ignore | .env, .env.production y .venv ignorados; .env.example visible |

La migracion `dominio/migrations/0001_initial.py` fue generada con las APIs
MigrationLoader(None), MigrationAutodetector y MigrationWriter de Django,
sin conexion ni SQLite. Se uso el mismo contexto sin traducciones que utiliza
makemigrations para evitar diferencias artificiales en los modelos de auth.
Depende de `auth.0012_alter_user_first_name_max_length`. Una segunda carga del
grafo y comparacion contra ProjectState.from_apps no detecto diferencias.
Esto valida archivos/estado de modelos, NO la aplicacion de SQL en PostgreSQL.

La revision de configuracion no encontro secretos reales agregados. Las
menciones a score/color en tests comprueban su ausencia; no son campos clinicos.
Se conservaron los archivos historicos. Estado final esperado:

```text
 M .gitignore
?? app/backend/
```

Unico archivo existente modificado: `.gitignore`. Archivos nuevos:
`.env.example`, `requirements.txt`, `README.md`, `manage.py`,
`config/{__init__,settings,urls,wsgi,asgi}.py`,
`dominio/{__init__,apps,managers,models,tests}.py`,
`dominio/migrations/{__init__,0001_initial}.py`.

Antes de cerrar la verificacion de BD: configurar una conexion PostgreSQL real,
repetir makemigrations --check, aplicar migrate y ejecutar los 18 tests.
No hubo commit ni push y el frontend permanece congelado.

## Bloque 2 implementado: identidad y autorización

### Decisiones y límites

- Sesiones de Django + SessionAuthentication de DRF. Sin JWT, tokens propios,
  paquetes nuevos ni tablas nuevas. La ampliación agrega el contador en 0002. Se reutiliza
  django_session, cuya migración debe estar aplicada.
- Email normalizado y búsqueda sin distinguir mayúsculas. La restricción
  usuario_email_ci_unique sigue siendo la garantía final en PostgreSQL.
- Todas las contraseñas se escriben con create_user/set_password. Altas y cambio
  propio ejecutan los validadores estándar de Django ya configurados.
- Una cuenta activa debe tener exactamente el perfil de su rol. Administrador
  no tiene perfil. Login rechaza perfiles faltantes/cruzados/múltiples; las
  operaciones autenticadas vuelven a comprobar esta condición.
- Rol de dominio y permisos técnicos son distintos: ADMINISTRADOR no necesita
  is_staff/is_superuser para administrar estas cuentas. Esos flags tampoco
  otorgan acceso a un rol diferente.
- Usuario/perfil se guardan en una transacción. El administrador solo gestiona
  MEDICO/SECRETARIA, no crea pacientes ni otros administradores. Al editar no
  puede cambiar rol/DNI, asignar privilegios ni cambiar contraseñas ajenas.
  Activar/desactivar usa PATCH is_active; no existe DELETE de cuentas.
- No se implementan consultas ni operaciones de turnos, agenda, triaje,
  disponibilidad, reprogramación, registro público
  o edición del perfil propio en este bloque.

### Endpoints

Todas las rutas tienen prefijo `/api/` y barra final. Respuestas JSON.

| Método/ruta | Acceso y contrato |
| --- | --- |
| GET auth/csrf/ | Público. Entrega csrfToken y cookie CSRF para iniciar el flujo. |
| POST auth/login/ | Público con CSRF. Body: email, password. Devuelve usuario y csrfToken renovado; establece sesión. |
| POST auth/logout/ | Sesión + CSRF. Invalida la sesión actual; 204. |
| GET auth/me/ | Cuenta activa/perfil válido. Solo identidad propia y perfil necesario. |
| POST auth/password/ | Cuenta activa + CSRF. password_actual, password_nueva, password_confirmacion. |
| POST auth/password-reset/ | Público + CSRF. email; respuesta genérica, envío solo a cuentas elegibles. |
| POST auth/password-reset/confirm/ | Público + CSRF. uid, token, password_nueva, password_confirmacion. |
| GET/POST admin/usuarios/ | Solo ADMINISTRADOR. Lista paginada / alta interna. |
| GET/PUT/PATCH admin/usuarios/{id}/ | Solo ADMINISTRADOR, únicamente Médico/Secretaría. |
| GET admin/especialidades/ | Solo ADMINISTRADOR. Catálogo existente para seleccionar especialidad al crear/editar médicos; no permite escribir. |

Ejemplo de alta de médico (usar una contraseña privada que cumpla validadores):

```json
{
  "email": "profesional@example.com",
  "password": "<contraseña privada>",
  "nombre": "Nombre",
  "apellido": "Apellido",
  "dni": "12345678",
  "telefono": "3515551234",
  "rol": "MEDICO",
  "matricula": "MP-12345",
  "especialidad": 1
}
```

El ID de especialidad debe existir en PostgreSQL; no se crea un seed implícito.
Para SECRETARIA enviar legajo en lugar de matricula/especialidad. is_active es
opcional al crear (true por defecto). PATCH admite campos parciales; PUT exige
los campos generales requeridos. El rol es inmutable en ambos casos.

La respuesta de identidad contiene exclusivamente id, email, nombre, apellido,
dni, telefono, rol, is_active y perfil. perfil es null para ADMINISTRADOR; para
Paciente contiene id/obra_social, para Médico id/matricula/especialidad
(id/nombre), para Secretaría id/legajo. Nunca devuelve password, hash, grupos
o flags técnicos. No usar las credenciales ni los IDs del frontend como seed.

### Sesión y CSRF

1. GET auth/csrf/ conservando cookies.
2. POST auth/login/ con email/password y encabezado X-CSRFToken.
3. Conservar la cookie sessionid HttpOnly. Login rota el token CSRF: usar el
   nuevo csrfToken de la respuesta (o la cookie csrftoken actualizada).
4. Enviar X-CSRFToken y cookies en cada POST/PUT/PATCH/DELETE posterior.

Login tiene csrf_protect explícito: SessionAuthentication por sí sola no
protege el login anónimo. Credenciales incorrectas, inactividad o perfil
inconsistente devuelven el mismo 401. En endpoints protegidos, una petición
anónima devuelve 403 con SessionAuthentication; un rol insuficiente también
devuelve 403. Datos inválidos devuelven 400; usuarios fuera del alcance
administrativo devuelven 404; métodos no habilitados devuelven 405.

CuentaBackend deriva de ModelBackend y rechaza is_active=False al autenticar y al recuperar una sesión
en peticiones posteriores. Los permisos de API también comprueban actividad.
El cambio de contraseña verifica la actual y la confirmación, aplica la
política y usa update_session_auth_hash: conserva/rota la sesión actual y las
otras sesiones dejan de ser válidas en su próxima petición.

Login tiene un throttle complementario de 10 solicitudes/minuto por IP con el
cache estándar de Django. Es independiente del contador persistente de cinco
contraseñas incorrectas por cuenta descrito abajo; no es protección distribuida definitiva.
NUM_PROXIES=0 evita confiar en X-Forwarded-For enviado directamente por un
cliente; revisar esa configuración junto con el proxy real al desplegar.

Cookies Secure por defecto con DEBUG=false; en HTTP local usar DEBUG=true.
Para producción se requiere HTTPS. SameSite=Lax y sesión HttpOnly. La
integración futura se plantea bajo el mismo origen; no se habilitó CORS ni
se debilitó CSRF para el servidor estático del frontend. Orígenes confiables
adicionales se configuran explícitamente en DJANGO_CSRF_TRUSTED_ORIGINS.

### Administración inicial y pruebas

Crear el administrador inicial mediante `manage.py createsuperuser` (email,
contraseña y datos requeridos). No hay credenciales por defecto ni tabla
Administrador. Los usuarios no administradores creados directamente por
scripts requieren su perfil correspondiente antes de poder iniciar sesión.
Las escrituras ORM externas siguen siendo responsables de validar el rol y
perfil: no se agregaron triggers ni constraints entre tablas.

```powershell
& ./.venv/Scripts/python.exe manage.py check
& ./.venv/Scripts/python.exe manage.py makemigrations --check --dry-run
$env:POSTGRES_TEST_DB = 'test_tesis_identity_' + [guid]::NewGuid().ToString('N').Substring(0,12)
& ./.venv/Scripts/python.exe manage.py test dominio --noinput
```

Ejecutar desde app/backend. Django crea y destruye una BD PostgreSQL aislada;
la cuenta de pruebas debe tener permiso CREATEDB. Nunca configurar
POSTGRES_TEST_DB con el nombre de desarrollo/producción. Los tests usan
APIClient con CSRF habilitado, sesiones reales y hashing PBKDF2 de Django.
No hacen peticiones de escritura a la base de desarrollo ni al frontend.

Pendientes de despliegue: HTTPS/proxy, cache compartido, entrega de email,
verificación de email inicial y auditoría según requisitos posteriores.
Los permisos por rol no sustituyen futuras restricciones por objeto/agenda:
esas reglas se implementarán al exponer operaciones de los siguientes bloques.

### Verificación inicial del Bloque 2 — 2026-11-02 (antes de recuperación)

- `manage.py check`: sin incidencias.
- `manage.py makemigrations --check --dry-run`: No changes detected.
- `manage.py test dominio --noinput`: 45 tests aprobados (18 del Bloque 1 y
  27 de API/identidad), sobre una BD PostgreSQL temporal con nombre único.
  Django creó y eliminó esa base; no se migró ni escribió en la de desarrollo.
- `pip check`, parseo AST e imports ejecutados por la suite: correctos.
- Sin cambios en frontend, models.py, migración 0001 ni requirements.txt.
- Sin migraciones nuevas, commit o push.

## Ampliación B2: cinco fallos y recuperación

`Usuario.intentos_fallidos` es persistente, comienza en cero y tiene constraint
PostgreSQL 0–5. `bloqueado_por_intentos` se calcula al llegar a cinco: no es una
columna ni modifica is_active. No hay fecha ni desbloqueo automático por tiempo.

AUTHENTICATION_BACKENDS contiene únicamente CuentaBackend. No dejar ModelBackend
como fallback: permitiría saltarse el bloqueo. Como cambia el nombre de backend
guardado en sesiones anteriores a esta ampliación, se requiere volver a iniciar
sesión una vez desplegada. El administrador inicial también está sujeto a la
política; necesita un email real/configurado para recuperación en producción.

Cada contraseña incorrecta evaluada de una cuenta existente/no bloqueada suma
uno. El quinto fallo bloquea; una contraseña correcta posterior no autentica ni
reinicia nada. Un login exitoso antes del quinto reinicia a cero. Contraseña
correcta de cuenta inactiva/perfil inválido no es login exitoso. Se preservan
respuestas 401 genéricas; no se publican contador ni estado de bloqueo.
Entrada incompleta, fallo CSRF o throttle 429 no cuentan como contraseña errónea.

authenticate usa transaction.atomic/select_for_update sobre la fila Usuario;
LoginView mantiene la transacción hasta login/last_login. Los fallos se guardan
retornando normalmente, sin una excepción que deshaga su incremento. La garantía
por cuenta funciona entre procesos/IPs usando PostgreSQL. No depende del cache.
La administración guarda únicamente campos editados; una copia anterior ya no
puede sobrescribir contador, password o last_login. La API no permite editar el
contador ni desbloquear cuentas manualmente.

El bloqueo afecta nuevas autenticaciones por contraseña. Las sesiones abiertas
con CuentaBackend pueden seguir operando hasta cierre, vencimiento o reset. Sin
embargo, el endpoint de cambio de contraseña propia rechaza cuentas bloqueadas:
el desbloqueo exige recuperación por email. Antes del bloqueo, ese cambio sigue
conservando su sesión y no reinicia el contador de fallos.

### Recuperación por API

1. Obtener CSRF y enviar POST `/api/auth/password-reset/` con email.
2. Siempre se responde 200 con el mismo mensaje para emails sintácticamente
   válidos: existentes, inexistentes, inactivos o bloqueados. No se expone token.
3. PasswordResetForm envía solo a cuentas activas con contraseña utilizable.
   No cambia intentos, contraseña ni activación. Un perfil inconsistente sigue
   requiriendo corrección administrativa: reset no lo repara.
4. El correo contiene uid/token y URL del endpoint de confirmación. El origen
   sale de PASSWORD_RESET_BASE_URL, no del Host de la petición.
5. POST `/api/auth/password-reset/confirm/` con uid, token, password_nueva y
   password_confirmacion. Mantener CSRF también para este endpoint público.

Este bloque entrega la API, no una pantalla nueva del frontend. El enlace del
email identifica el endpoint y sus parámetros: para completar el flujo se usa
POST desde el cliente/APIClient/Postman. Abrirlo como GET no cambia contraseña.
La pantalla de recuperación y su conexión con esta API quedan para integración
del frontend; no se añadió una interfaz de recuperación en este bloque.

Se usa default_token_generator de Django, sin almacenar ni implementar tokens
propios, y SetPasswordForm para política/confirmación/hashing. La confirmación
vuelve a cargar/bloquear la fila y verifica el token dentro de la transacción;
guarda password e intentos_fallidos=0 conjuntamente. Dos confirmaciones del mismo
token no pueden consumirlo simultáneamente. No se inicia sesión automáticamente
ni se conserva una sesión previa mediante update_session_auth_hash: todas las
sesiones anteriores dejan de autenticar al siguiente acceso por cambio del hash.

PASSWORD_RESET_TIMEOUT es 3600 segundos. Un token vencido no desbloquea y puede
reemplazarse solicitando otro correo; reenviar tampoco reinicia intentos. Puede
haber varios enlaces aún válidos; el primer reset exitoso invalida los demás al
cambiar la contraseña. Token inválido/vencido/usuario inactivo se rechaza con un
mismo error 400. Un reset nunca reactiva is_active=False.

Solicitud y confirmación comparten un throttle complementario de 10 peticiones
por minuto/IP, separado del scope de login. SMTP fallido se registra mediante
el comportamiento nativo de Django y conserva respuesta genérica. La entrega
SMTP síncrona puede producir diferencias de tiempo: las respuestas uniformes
no eliminan totalmente ese canal de enumeración. Para producción debe evaluarse
envío asíncrono y cache compartido; no se agregaron colas ni librerías externas.

### Email y despliegue

- DEBUG=true: backend de consola por defecto; no prueba entrega ni control real
  del buzón. Solo se utiliza para desarrollo.
- Tests: locmem, inspección del correo y tokens sin envío real.
- DEBUG=false: SMTP por defecto. Configurar EMAIL_BACKEND, EMAIL_HOST/PORT,
  EMAIL_HOST_USER/PASSWORD, EMAIL_USE_TLS o EMAIL_USE_SSL, DEFAULT_FROM_EMAIL y
  PASSWORD_RESET_BASE_URL (origen público HTTPS). No habilitar TLS y SSL a la vez.
- EMAIL_TIMEOUT=10 segundos limita esperas de transporte; no es un timeout de
  bloqueo. No dejar el backend de consola en producción. Las credenciales se
  configuran en entorno/.env privado, nunca en Git.
- Aplicar únicamente `manage.py migrate` para incorporar 0002. Agrega el contador
  inicial cero a usuarios existentes y su constraint; no modifica 0001 ni perfiles.

La suite incluye los 45 tests previos y pruebas adicionales de bloqueo, reset,
caducidad/reenvío, CSRF, correo, campos protegidos y carreras reales PostgreSQL
con TransactionTestCase y conexiones independientes. No utilizar SQLite para
afirmar la garantía de select_for_update.

### Verificación de la ampliación — 2026-11-02

- 70 tests PostgreSQL aprobados: 45 previos y 25 nuevos, incluidos cuatro de
  concurrencia real. Duración de ejecución: aproximadamente 386 segundos.
- El teardown inicial devolvió error porque Supavisor retenía seis conexiones
  ociosas. Se completó luego la eliminación de la base temporal mediante el
  helper de Django apuntado explícitamente a ella, sin terminar sesiones ni
  ejecutar SQL manual. El fallo fue posterior al OK de los 70 tests.
- En conexiones mediante pooler, la limpieza puede requerir reintento cuando
  libere sus conexiones; alternativamente usar --keepdb sobre una base de test
  dedicada o una conexión PostgreSQL directa para pruebas. Nunca usar la base
  de desarrollo como base de test.
- 0002 fue aplicada a la base configurada exclusivamente mediante
  `manage.py migrate dominio 0002 --noinput`, después de revisar --plan.
- manage.py check, makemigrations --check, migrate --check y pip check correctos.
- Frontend, 0001_initial y requirements.txt intactos. Sin commit ni push.

## Bloque 3: especialidades, médicos y disponibilidad

### Modelo y catálogo

Especialidad -> Medico -> Disponibilidad. El identificador de agenda es
Medico.pk, distinto de Usuario.pk. Disponibilidad no duplica especialidad ni
almacena duración/prioridad: duracion_minutos se calcula del intervalo. Los
bloques nuevos tienen precisión de minutos y pertenecen a una fecha, sin
intervalos que crucen medianoche. No hay mínimo clínico de veinte minutos.

0003_catalogo_especialidades es exclusivamente una data migration. Provisiona
Clínica Médica, Pediatría y Cardiología con get_or_create por nombre canónico,
sin IDs fijos. Es idempotente y no modifica especialidades preexistentes ni
interpreta aliases del frontend. Su reversa no borra datos que podrían estar
referenciados; reaplicarla tampoco duplica el catálogo. No cambia models.py,
0001, 0002 ni instala extensiones PostgreSQL.

El catálogo es de solo lectura para la API. La administración de cuentas sigue
en B2. Una especialidad solo puede cambiarse si el médico todavía no tiene
disponibilidades ni turnos, incluidos históricos/sin disponibilidad. B2 adquiere
el mismo bloqueo de Medico y revalida la condición antes de guardar. La edición
de otros datos del profesional y el envío de la misma especialidad siguen
permitidos. No se pueden trasladar bloques a otro médico.

### Contrato de endpoints (prefijo /api/)

| Método/ruta | Acceso |
| --- | --- |
| GET especialidades/ | Los cuatro roles autenticados/activos con perfil válido. |
| GET admin/especialidades/ | Conserva el contrato B2: solo Administrador. |
| GET medicos/ | Los cuatro roles; filtros especialidad={id}, incluir_inactivos=true. |
| GET medicos/{id}/ | Directorio seguro de profesionales. |
| GET medicos/{medico_pk}/disponibilidades/ | Paciente: solo futuras DISPONIBLE; Médico: propia agenda; Secretaría: agenda explícita. |
| GET medicos/{medico_pk}/disponibilidades/{id}/ | Mismos límites de consulta, también para el bloque individual. |
| POST medicos/{medico_pk}/disponibilidades/ | Médico propio o Secretaría. Crea un bloque DISPONIBLE. |
| POST medicos/{medico_pk}/disponibilidades/lote/ | Mismos roles, 1–100 bloques explícitos en una transacción. |
| PATCH medicos/{medico_pk}/disponibilidades/{id}/ | Mismos roles. Solo fecha/hora_inicio/hora_fin. |
| POST .../disponibilidades/{id}/bloquear/ | Mismos roles; sin body. DISPONIBLE -> BLOQUEADO. |
| POST .../disponibilidades/{id}/desbloquear/ | Mismos roles; sin body. BLOQUEADO -> DISPONIBLE. |
| DELETE .../disponibilidades/{id}/ | Mismos roles; bloque futuro no ocupado y sin ningún Turno relacionado. |

Escrituras con sesión y CSRF de B2. Administrador no tiene acceso operativo a
disponibilidad. Un médico accede al directorio de otros profesionales, pero no
a sus agendas. Los intentos de usar otra agenda/bloque anidado ajeno devuelven
404; roles sin permiso devuelven 403. PUT de disponibilidad no está habilitado.

Los listados son paginados (page, tamaño configurado en B2). Médicos expone solo
id, nombre, apellido, matricula y especialidad {id,nombre}. No expone DNI,
credenciales ni email. Por defecto excluye cuentas médicas inactivas; solo
Secretaría/Administrador pueden solicitar incluir_inactivos=true. Un paciente
no puede consultar disponibilidad de un médico inactivo. Secretaría conserva
acceso de lectura a esas agendas, puede retirar/bloquear bloques, pero no crear,
modificar intervalos ni desbloquear para habilitar horarios del médico inactivo.

Disponibilidad expone id, medico, fecha, hora_inicio, hora_fin, estado y
duracion_minutos. No publica paciente/turno. Filtros: fecha o desde/hasta, estado;
se validan formatos/rangos. Un paciente no puede ampliar su visibilidad con esos
filtros. Las vistas profesionales conservan consulta del historial, incluso pasado.
El orden es fecha/hora/ID: no se trata de priorización clínica ni antigüedad.

Creación individual:

```json
{"fecha":"2099-01-01","hora_inicio":"09:00","hora_fin":"09:20"}
```

Lote (los intervalos vienen de una selección/configuración explícita):

```json
{"bloques":[
  {"fecha":"2099-01-01","hora_inicio":"09:00","hora_fin":"09:20"},
  {"fecha":"2099-01-01","hora_inicio":"09:20","hora_fin":"09:40"}
]}
```

POST devuelve 201; PATCH/acciones 200; DELETE 204. No se aceptan médico,
especialidad, estado, duración ni ID enviados como campos de escritura.
Ningún endpoint permite establecer OCUPADO. Duplicado/solapamiento, ocupación o
historial incompatible devuelven 409; formatos, intervalos y fechas pasadas 400.

### Servicio transaccional y límites para B4

agenda.py concentra create_blocks/update_block/set_blocked/delete_block. Primero
autoriza al actor, bloquea Medico con select_for_update y después el bloque
concreto. Valida nuevamente dentro de atomic. La misma agenda no admite
solapamientos, duplicados ni contenciones, cualquiera sea el estado existente;
intervalos adyacentes sí se permiten. Médicos distintos son independientes.
El lote valida contra la BD y contra sí mismo antes de insertar: fallo implica
cero altas del lote. PATCH usa valores actuales, no una copia antigua, y escribe
únicamente campos editados. Bloquear/desbloquear es idempotente y no altera Turno.

OCUPADO es exclusivo de las futuras operaciones de Turno en B4. B3 nunca lo
asigna ni modifica/elimina un bloque con ese estado. No se cambia fecha/horario
ni se elimina un bloque con cualquier referencia de Turno, aunque esté cancelado.
El bloqueo de un recurso actualmente DISPONIBLE puede cambiar su configuración
sin borrar historial cancelado ni alterar el Turno. No se representa simultáneamente
OCUPADO+BLOQUEADO. Pasado se conserva para lectura, no se reescribe ni elimina
desde estas operaciones. Consultar no genera bloques ni modifica su estado.

No hay ExclusionConstraint: la exclusión parcial se garantiza para operaciones
que pasan por este servicio y usan el bloqueo del padre. SQL/scripts externos
pueden saltar esa regla; la BD sigue protegiendo intervalo y duplicado exacto.
B4 debe seguir el mismo orden de bloqueos, comprobar médico/actividad/estado,
revalidar el bloque y guardar Turno + ocupación/liberación conjuntamente. Una
lectura actual DISPONIBLE no constituye una reserva. Debe definir qué estados de
Turno consumen un bloque y cómo se tratará una indisponibilidad sobre uno ocupado.

No hay algoritmo de triaje, prioridad, sobreturnos ni duración clínica en B3.
Cardiología no recibe prioridad Baja artificial. Los IDs proceden de PostgreSQL;
no se copiaron JSON, localStorage, aliases o reconciliaciones del frontend.

### Validación B3

Los 70 tests de B1/B2 se conservan. El fixture de identidad usa get_or_create
para Clínica Médica y verifica su presencia en el catálogo (ya no supone un
catálogo de una única fila). Se agregan pruebas API, catálogo idempotente,
matriz de roles, historial, lotes y concurrencia PostgreSQL mediante conexiones
independientes. Para Supavisor se usa una base temporal única con --keepdb y
limpieza posterior mediante Django; esto evita hacer fallar el resultado de la
suite por conexiones ociosas retenidas durante el teardown automático.
