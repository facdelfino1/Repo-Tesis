# Backend - Bloque 1

Proyecto Django 5.2 LTS y DRF con PostgreSQL como unico motor. Una app
`dominio` contiene el modelo relacional; `config` contiene infraestructura.
Las URLs estan vacias: autenticacion API y endpoints pertenecen al Bloque 2.

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
  transaccional del Bloque 2, junto con concurrencia y revalidacion del bloque.
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

## Bloque 2

Autenticacion API, validacion de password en endpoints, permisos por rol,
administracion de cuentas sobre Usuario unico, manejo de sesion/token,
intentos fallidos/bloqueo/caducidad y recuperacion. Definir contratos y
servicios de operaciones que se habiliten: no implementar de golpe todos los
flujos ni migrar JSON sin una estrategia de seed acordada.

La politica completa de complejidad del prototipo debe acordarse y aplicarse
con validadores de password cuando se expongan altas/cambios. La base configura
los validadores estandar de Django; create_user no ejecuta validate_password.
No hay integracion frontend, endpoints Admin, metricas definitivas, reglas
clinicas, modelos Reprogramacion/ListaEspera/Notificacion ni seeds.

## Verificacion de entrega - 2026-11-02

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
