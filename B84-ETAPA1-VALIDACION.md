# B8.4 — Fase B, primera etapa

Fecha: 2026-11-06. Base: `feature/triage-final`, `3ba376a`.
Git estaba limpio antes de comenzar. Alcance exclusivo: OBS-07 y OBS-03.

**Estado actual: validación funcional y automatizada aprobada sobre PostgreSQL
temporal local.** El cierre al final de este documento reemplaza los bloqueos y
pendientes históricos registrados en las secciones anteriores.

## Cambios

- `app/frontend/pages/secretaria/gestion-turnos.html`: los formularios de
  asignación y modificación son directamente `.modal-content` dentro de
  `.modal-dialog-scrollable`. Bootstrap puede limitar la altura y desplazar
  `.modal-body`, conservando cabecera y pie accesibles. No se agregó CSS global.
- `app/backend/dominio/password_validation.py`: validador compartido de longitud
  mínima 8, mayúscula, minúscula, número decimal y carácter especial distinto de
  espacio. Conserva la semántica Unicode que ya utilizaba el registro público.
- `app/backend/config/settings.py`: incorpora el validador y conserva los cuatro
  validadores nativos: similitud, longitud, contraseñas comunes y solo numéricas.
- `app/backend/dominio/serializers.py`: retira la comprobación duplicada del
  registro público; utiliza `validate_password`, como las altas internas y el
  cambio propio. La recuperación continúa utilizando `SetPasswordForm`, que
  ejecuta los mismos validadores configurados.
- `app/backend/dominio/test_password_policy.py`: cinco tests sin BD y cinco tests
  API. Cubren cada condición ausente, espacio como único supuesto especial,
  valores válidos, Unicode, validadores nativos, ambos roles internos, conservación
  del hash ante rechazo, reutilización del token después de rechazo y login de
  una cuenta preexistente cuya clave no satisface la nueva complejidad.
- `app/backend/dominio/test_api.py` y `test_password_reset.py`: las claves
  sintéticas de operaciones exitosas incluyen un prefijo que garantiza las cinco
  condiciones. Se evita que muestras aleatorias hagan fallar los tests.

No se modificaron JavaScript, modelos, migraciones, otras observaciones,
credenciales existentes ni datos de Supabase. No se realizó commit ni push.

## Validación ejecutada

| Comprobación | Resultado |
| --- | --- |
| Python del entorno `app/backend/.venv` | Python 3.12.7; Django 5.2.18; psycopg 3.3.6 |
| `PasswordPolicyTests` y `FrontendDeliveryTests` | 10/10 tests aprobados; sin preparar BD |
| `manage.py check` | Sin incidencias |
| Análisis AST Python | 36 archivos de `config/` y `dominio/`, sin errores |
| Sintaxis JavaScript con Node `--input-type=module --check` | 33/33 archivos aprobados |
| Comparación HTML con HEAD | IDs, controles, atributos funcionales y opciones preservados |
| Chrome headless, Bootstrap 5.3.3 y CSS del proyecto | 10/10 combinaciones de modal y viewport aprobadas |
| Tests focalizados con PostgreSQL aislado | 77 descubiertos; bloqueados antes de ejecutarse por timeout de conexión |
| Suite completa con PostgreSQL aislado | 269 descubiertos; bloqueados antes de ejecutarse por timeout de conexión |

### Modal: alcance de la prueba de navegador

Se utilizó el HTML real anterior y posterior, con Bootstrap y estilos del proyecto.
Se retiraron los scripts de aplicación solamente de las copias temporales de
prueba para impedir conexiones con la API. Se mostró el cuestionario pediátrico
completo. La prueba desplazó exclusivamente `.modal-body`, comprobó la geometría
de cada control, la visibilidad del pie y el envío mediante clic de navegador,
interceptando el evento submit sin reservar ni modificar turnos.

Viewports, todos con escala 1: 1366×768, 1920×1080, 768×1024, 390×844 y 320×568.
En la versión anterior, a 1366×768, el cuerpo de asignación medía 1088 px sin
scroll interno: siete controles y el pie quedaban fuera del área accesible.
En la versión corregida, el cuerpo dispone de 576 px y desplaza sus 1088 px de
contenido; todos los controles y el botón de confirmación resultan accesibles.
El formulario de modificación cabe completo en los tamaños probados y sus
botones también respondieron.

Esta prueba valida estructura, desplazamiento y accesibilidad geométrica.
No sustituye un recorrido funcional con sesión, búsqueda y reserva contra una
API de pruebas ni una comprobación de teclado virtual en un dispositivo móvil.

### Aislamiento y bloqueo de PostgreSQL

El `.env` existente apunta a un host remoto y no especifica una base de test.
No se utilizó ese destino. Los procesos de validación sobrescribieron, solamente
en su entorno, todos los parámetros PostgreSQL relevantes:

```text
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=55484
POSTGRES_DB=b84_unused
POSTGRES_TEST_DB=test_b84_isolated
POSTGRES_USER=b84_isolated
POSTGRES_PASSWORD=<valor sintético local de prueba>
POSTGRES_SSLMODE=disable
```

La clave Django también fue efímera. No se editó `.env`.
Ambos grupos se intentaron en procesos separados, también fuera del sandbox,
y fallaron al preparar la base con `OperationalError: connection timeout expired`.
No hay un servidor PostgreSQL de pruebas accesible en el destino local elegido.
Python funciona; el bloqueo actual es la disponibilidad de PostgreSQL aislado.
No se utilizó SQLite para sustituir las garantías PostgreSQL del sistema.

## Pendientes para cerrar la validación

1. Proveer una instancia PostgreSQL de desarrollo aislada y revisar sus parámetros
   antes de ejecutar los 77 tests focalizados y los 269 de la suite completa.
2. Repetir búsqueda, selección de paciente, cuestionario, reserva y modificación
   desde Secretaría con esa API aislada al 100 % de zoom.
3. Comprobar los cuatro flujos de contraseñas por API, incluidos los tests nuevos
   de persistencia, sesiones y token. Hasta entonces no se declaran aprobados.

La implementación queda preparada para revisión; la validación de integración
permanece incompleta. No se implementaron otras observaciones.

## Revisión del bloqueo de infraestructura — 2026-11-06

Se preservaron los ocho archivos existentes de la Etapa 1. En esta revisión
solo se amplió este informe; no se modificaron código, `.env` ni configuración.

- El intérprete correcto es `app/backend/.venv/Scripts/python.exe`, no el alias
  `python` de Windows ni un supuesto entorno `.venv` en la raíz. Se verificaron
  Python 3.12.7, Django 5.2.18 y psycopg 3.3.6 mediante imports exitosos.
- `config/settings.py` carga `app/backend/.env`. Las variables del proceso
  prevalecen porque `load_dotenv` no utiliza `override=True`.
- `DJANGO_SECRET_KEY` y los parámetros PostgreSQL están presentes en `.env`.
  No había valores PostgreSQL alternativos en el entorno del proceso antes de
  cargarlo. No se imprimieron secretos ni cadenas de conexión.
- El destino efectivo es remoto y corresponde a Supabase. No hay
  `POSTGRES_TEST_DB`, `DATABASE_URL` ni `TEST_DATABASE_URL` configurados.
  Estas dos últimas variables tampoco son interpretadas por la configuración
  actual. No se conectó a Supabase ni se intentó crear allí una base.
- `POSTGRES_TEST_DB` controla el nombre que Django crea y destruye en el mismo
  servidor configurado; no proporciona por sí solo otro servidor ni aislamiento
  de infraestructura respecto de la instancia principal.
- Se consultaron comandos, procesos, servicios y ubicaciones habituales de
  PostgreSQL y contenedores. No se encontraron `postgres`, `initdb`, `pg_ctl`,
  `psql`, Docker o Podman disponibles para preparar el entorno.
- La enumeración TCP requirió salir del sandbox por un error de acceso denegado.
  Fuera de él se completó correctamente: cero listeners en 5432, 5433, 5434,
  55432 y 55484. No se encontraron procesos ni servicios PostgreSQL activos.
- Los directorios temporales B8.4 encontrados contienen pruebas de interfaz,
  no una instancia PostgreSQL identificada.

**Causa del bloqueo:** se asignaron parámetros sintéticos a
`127.0.0.1:55484`, pero no se había provisionado un servidor en ese destino.
Cambiar variables no inicia PostgreSQL. El timeout anterior no demuestra un
defecto de autenticación o de las correcciones OBS-03/OBS-07: ocurrió antes de
preparar la base y ejecutar los tests.

**Decisión:** detener la validación con BD, como se solicitó. No se reiteraron
los tests contra el mismo destino inexistente ni contra Supabase. Los resultados
aprobados de la tabla anterior pertenecen a la ejecución previa; los 77 tests
focalizados y 269 completos siguen pendientes, al igual que los recorridos
funcionales de autenticación y gestión de turnos contra una API aislada.

**Alternativa recomendada, pendiente de autorización:** descargar y extraer
binarios de PostgreSQL para Windows en un directorio temporal dedicado, iniciar
un proceso local sin instalar un servicio Windows, y crear un clúster vacío con
datos exclusivamente sintéticos. Usar loopback y un puerto libre verificado,
con directorios, credenciales y bases exclusivos de B8.4; parametrizar Django
solo en los procesos de pruebas. Esto permitiría ejecutar los dos grupos de
tests y luego verificar la API/frontend con reservas sintéticas, sin acceder a
Supabase, modificar PATH, instalar servicios ni tocar configuración global.
No se descargó, inició ni creó ninguno de esos componentes en esta revisión.

## Ejecución autorizada con PostgreSQL temporal — cierre

Se utilizó PostgreSQL 16.15 para Windows x64, distribución ZIP de EDB enlazada
desde la [página oficial de PostgreSQL](https://www.postgresql.org/download/windows/).
Archivo: [postgresql-16.15-5-windows-x64-binaries.zip](https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64-binaries.zip),
373254386 bytes. Antes de extraer y ejecutar se comparó el SHA-256 calculado con
el [checksum publicado por EDB](https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64-binaries.zip.sha256):

```text
43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281
```

La descarga, extracción, clúster, credenciales sintéticas y perfiles de navegador
se alojaron fuera del repositorio, bajo un directorio temporal exclusivo de esta
ejecución. No se instaló un servicio ni se modificaron PATH, registro de Windows
o configuración global.

El clúster se inicializó vacío, con UTF-8 y autenticación SCRAM. Se comprobó por
SQL que escuchaba únicamente en `127.0.0.1:55484` y que `data_directory`
correspondía al directorio temporal esperado. Django recibió sus parámetros por
el entorno del proceso, sin editar `.env`.

Un guard temporal verificó `settings.DATABASES` y rechazó conexiones psycopg que
no fueran a ese host/puerto o que usaran bases distintas de `postgres`,
`b84_validation` y `test_b84_validation`. También se fijó `hostaddr` a loopback y
se eliminaron variables PG/servicios heredadas del entorno de los lanzadores.
No se establecieron conexiones a Supabase.

| Comprobación de esta ejecución | Resultado |
| --- | --- |
| Tests focalizados de contraseñas, registro, identidad y recuperación | **77/77 aprobados**, 55.810 s |
| Suite completa `dominio` | **269/269 aprobados**, 148.068 s |
| Base utilizada por ambos grupos | `test_b84_validation`, creada y destruida por Django en el clúster local |
| `manage.py check` | Sin incidencias |
| Navegador contra API real aislada | Login de Secretaría, búsqueda/selección de paciente, reserva pediátrica y modificación aprobados |
| Persistencia posterior al recorrido | Un turno, mismo paciente/médico/triaje/Secretaría; origen DISPONIBLE y destino OCUPADO |
| Integridad del trabajo preexistente | Siete archivos de implementación/tests y `.env` coinciden con sus hashes anteriores |

### OBS-03

Pasaron los tests de cada condición ausente en registro público, altas de Médico
y Secretaría, cambio y recuperación, incluidos valores válidos posteriores.
También pasaron las comprobaciones de validadores nativos, mensajes sin revelar
la clave, hashes intactos ante rechazo, tokens reutilizables tras rechazo,
invalidación posterior al éxito, sesiones, CSRF, límites de solicitudes y
concurrencia. El login con una contraseña preexistente sin la nueva complejidad
continuó funcionando. No se modificaron credenciales reales.

### OBS-07

El recorrido se ejecutó en Chrome headless con el HTML y JavaScript reales,
sesión Django, CSRF y API local, sin mocks de datos. Se sirvieron temporalmente al
navegador los mismos assets Bootstrap 5.3.3 que referencia la aplicación.
Viewport 1366×768, escala 1: todos los controles visibles fueron accesibles,
el modal de asignación tuvo scroll interno y ambos pies/botones de envío
permanecieron accesibles. La reserva devolvió 201 y la modificación 200.
Las comprobaciones responsive previas en cinco tamaños siguen documentadas
arriba; este recorrido añadió operaciones y persistencia reales aisladas.

El clasificador devolvió MEDIA para el cuestionario sintético utilizado. Después
de modificar el horario se conservaron ID, fecha de creación, triaje y atribución
a Secretaría. No se cambiaron reglas de triaje ni otras observaciones.

### Incidencias de la preparación y del controlador de pruebas

El sandbox impidió a `pg_ctl` crear el token restringido de Windows (error 87).
El arranque fuera del sandbox requirió conceder acceso al usuario local PC
exclusivamente sobre la carpeta temporal. No requirió cambios en el proyecto.

Se corrigieron únicamente los lanzadores temporales para normalizar la dirección
devuelta por PostgreSQL, evitar una conversión de caracteres del pipeline de
PowerShell al preparar datos sintéticos y esperar el final de las transiciones
Bootstrap. El primer recorrido de navegador ya obtuvo 201/200 de la API, pero
su espera de cierre de modal venció por intentar enviarlo durante la animación
de apertura. El recorrido corregido pasó completo. No fallaron tests de la
aplicación ni se modificó su código durante esta ejecución.

La prueba no incorpora una comprobación física del teclado virtual móvil ni
una matriz de navegadores; esas limitaciones no se presentan como verificadas.

### Apagado, limpieza y estado final

PostgreSQL se detuvo mediante `pg_ctl -m fast -w stop`, con confirmación
`server stopped`. Se detuvieron los procesos de la API de pruebas y se comprobó
que no quedaran listeners en los puertos 55484 y 58084 ni procesos PostgreSQL.
La consulta de procesos del primer script de limpieza no respondió de forma
útil; el cierre se completó con los PID y fechas de inicio identificados para
esta ejecución, sin detener procesos ajenos.

Antes de la eliminación recursiva se verificó la ruta absoluta exacta bajo TEMP
y que la raíz no fuera un reparse point. Se eliminaron el directorio completo
de esta ejecución y su script de preparación: binarios, ZIP, checksum,
clúster sintético, credenciales, lanzadores, logs y perfiles del navegador.
Se confirmó que ambos destinos ya no existían. Los artefactos de ejecuciones
anteriores no se eliminaron. La evidencia necesaria permanece resumida aquí.

La base principal de Supabase no fue utilizada ni modificada. No hubo cambios
de implementación, modelos, migraciones o `.env` durante esta validación.
Se preservan los siete archivos de implementación/tests autorizados y este
informe, en `feature/triage-final`, HEAD `3ba376a`, sin commit ni push.
`git diff --check` termina con código 0; Git solo advierte sobre la conversión
LF/CRLF de dos archivos de tests, sin errores de whitespace.

**Resultado final de la Etapa 1: APROBADA dentro del alcance ejecutado.**
El bloqueo PostgreSQL queda resuelto para esta ejecución; no queda un servidor
permanente instalado o activo. Las demás observaciones B8.4 no se abordaron.
