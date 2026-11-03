from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from .managers import UsuarioManager


class Usuario(AbstractBaseUser, PermissionsMixin):
    class Rol(models.TextChoices):
        PACIENTE = "PACIENTE", "Paciente"
        SECRETARIA = "SECRETARIA", "Secretaria"
        MEDICO = "MEDICO", "Medico"
        ADMINISTRADOR = "ADMINISTRADOR", "Administrador"

    email = models.EmailField(unique=True)
    nombre = models.CharField(max_length=100)
    apellido = models.CharField(max_length=100)
    dni = models.CharField(max_length=20)
    telefono = models.CharField(max_length=30)
    rol = models.CharField(max_length=20, choices=Rol.choices)
    is_active = models.BooleanField(default=True)
    intentos_fallidos = models.PositiveSmallIntegerField(default=0, editable=False)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now, editable=False)

    objects = UsuarioManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["nombre", "apellido", "dni", "telefono"]

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower("email"), name="usuario_email_ci_unique"),
            models.CheckConstraint(condition=models.Q(rol__in=["PACIENTE", "SECRETARIA", "MEDICO", "ADMINISTRADOR"]), name="usuario_rol_valido"),
            models.CheckConstraint(condition=models.Q(intentos_fallidos__gte=0, intentos_fallidos__lte=5), name="usuario_intentos_fallidos_rango"),
        ]

    @property
    def bloqueado_por_intentos(self):
        return self.intentos_fallidos >= 5

    def clean(self):
        super().clean()
        self.email = self.email.strip().lower()

    def get_full_name(self):
        return f"{self.nombre} {self.apellido}"

    def get_short_name(self):
        return self.nombre

    def __str__(self):
        return self.email


class PerfilRol(models.Model):
    class Meta:
        abstract = True

    def clean(self):
        super().clean()
        if self.usuario_id and self.usuario.rol != self.ROL:
            raise ValidationError({"usuario": "El rol del usuario no corresponde al perfil."})


class Paciente(PerfilRol):
    ROL = Usuario.Rol.PACIENTE
    usuario = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="paciente", limit_choices_to={"rol": ROL})
    obra_social = models.CharField(max_length=150, blank=True)


class Especialidad(models.Model):
    nombre = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.nombre


class Medico(PerfilRol):
    ROL = Usuario.Rol.MEDICO
    usuario = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="medico", limit_choices_to={"rol": ROL})
    matricula = models.CharField(max_length=50, unique=True)
    especialidad = models.ForeignKey(Especialidad, on_delete=models.PROTECT, related_name="medicos")


class Secretaria(PerfilRol):
    ROL = Usuario.Rol.SECRETARIA
    usuario = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="secretaria", limit_choices_to={"rol": ROL})
    legajo = models.CharField(max_length=50, unique=True)


class Disponibilidad(models.Model):
    class Estado(models.TextChoices):
        DISPONIBLE = "DISPONIBLE", "Disponible"
        OCUPADO = "OCUPADO", "Ocupado"
        BLOQUEADO = "BLOQUEADO", "Bloqueado"

    medico = models.ForeignKey(Medico, on_delete=models.PROTECT, related_name="disponibilidades")
    fecha = models.DateField()
    hora_inicio = models.TimeField()
    hora_fin = models.TimeField()
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.DISPONIBLE)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(hora_fin__gt=models.F("hora_inicio")), name="disponibilidad_intervalo_valido"),
            models.CheckConstraint(condition=models.Q(estado__in=["DISPONIBLE", "OCUPADO", "BLOQUEADO"]), name="disponibilidad_estado_valido"),
            models.UniqueConstraint(fields=["medico", "fecha", "hora_inicio", "hora_fin"], name="disponibilidad_bloque_unico"),
        ]


class Turno(models.Model):
    class Estado(models.TextChoices):
        RESERVADO = "RESERVADO", "Reservado"
        PENDIENTE = "PENDIENTE", "Pendiente"
        PRESENTE = "PRESENTE", "Presente"
        EN_ATENCION = "EN_ATENCION", "En atencion"
        COMPLETADO = "COMPLETADO", "Completado"
        CANCELADO = "CANCELADO", "Cancelado"
        AUSENTE = "AUSENTE", "Ausente (historico)"

    id_turno = models.BigAutoField(primary_key=True)
    fecha = models.DateField()
    hora = models.TimeField()
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.RESERVADO)
    duracion_turno = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)], help_text="Minutos del turno/agenda; independiente de la prioridad.")
    fecha_hora_creacion = models.DateTimeField(default=timezone.now, editable=False)
    fecha_hora_arribo = models.DateTimeField(null=True, blank=True)
    fecha_hora_inicio = models.DateTimeField(null=True, blank=True)
    fecha_hora_cierre = models.DateTimeField(null=True, blank=True)
    paciente = models.ForeignKey(Paciente, on_delete=models.PROTECT, related_name="turnos")
    medico = models.ForeignKey(Medico, on_delete=models.PROTECT, related_name="turnos")
    disponibilidad = models.ForeignKey(Disponibilidad, on_delete=models.PROTECT, related_name="turnos", null=True, blank=True)
    secretaria = models.ForeignKey(Secretaria, on_delete=models.PROTECT, related_name="turnos", null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(duracion_turno__gt=0), name="turno_duracion_positiva"),
            models.CheckConstraint(condition=models.Q(estado__in=["RESERVADO", "PENDIENTE", "PRESENTE", "EN_ATENCION", "COMPLETADO", "CANCELADO", "AUSENTE"]), name="turno_estado_valido"),
        ]
        indexes = [models.Index(fields=["medico", "fecha", "estado", "fecha_hora_creacion"], name="turno_agenda_idx")]


class Triaje(models.Model):
    class Prioridad(models.TextChoices):
        ALTA = "ALTA", "Alta"
        MEDIA = "MEDIA", "Media"
        BAJA = "BAJA", "Baja"

    id_triaje = models.BigAutoField(primary_key=True)
    turno = models.OneToOneField(Turno, on_delete=models.PROTECT, related_name="triaje")
    respuesta_sintomas = models.JSONField(default=dict)
    nivel_prioridad = models.CharField(max_length=5, choices=Prioridad.choices)
    fecha_hora_evaluacion = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(nivel_prioridad__in=["ALTA", "MEDIA", "BAJA"]), name="triaje_prioridad_valida")]

    def clean(self):
        super().clean()
        if not isinstance(self.respuesta_sintomas, dict):
            raise ValidationError({"respuesta_sintomas": "Las respuestas deben ser un objeto estructurado."})


class PropuestaReprogramacion(models.Model):
    class Estado(models.TextChoices):
        EN_ESPERA = 'EN_ESPERA', 'En espera'
        ACEPTADA = 'ACEPTADA', 'Aceptada'
        RECHAZADA = 'RECHAZADA', 'Rechazada'
        ANULADA = 'ANULADA', 'Anulada'
        INVALIDADA = 'INVALIDADA', 'Invalidada'

    turno = models.ForeignKey(Turno, on_delete=models.PROTECT, related_name='propuestas')
    disponibilidad_origen = models.ForeignKey(Disponibilidad, on_delete=models.PROTECT, related_name='propuestas_origen', null=True)
    fecha_origen = models.DateField()
    hora_origen = models.TimeField()
    duracion_origen = models.PositiveSmallIntegerField()
    disponibilidad_destino = models.ForeignKey(Disponibilidad, on_delete=models.PROTECT, related_name='propuestas_destino')
    fecha_destino = models.DateField()
    hora_inicio_destino = models.TimeField()
    hora_fin_destino = models.TimeField()
    creada_por = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='propuestas_creadas')
    motivo = models.CharField(max_length=500)
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.EN_ESPERA)
    fecha_hora_creacion = models.DateTimeField(default=timezone.now, editable=False)
    fecha_hora_resolucion = models.DateTimeField(null=True, editable=False)
    motivo_cierre = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['turno'], condition=models.Q(estado='EN_ESPERA'), name='propuesta_abierta_turno'),
            models.UniqueConstraint(fields=['disponibilidad_destino'], condition=models.Q(estado='EN_ESPERA'), name='propuesta_abierta_destino'),
            models.CheckConstraint(condition=~models.Q(disponibilidad_origen=models.F('disponibilidad_destino')), name='propuesta_bloques_distintos'),
            models.CheckConstraint(condition=models.Q(hora_fin_destino__gt=models.F('hora_inicio_destino')), name='propuesta_intervalo_valido'),
            models.CheckConstraint(condition=models.Q(duracion_origen__gt=0), name='propuesta_duracion_positiva'),
            models.CheckConstraint(condition=models.Q(estado__in=['EN_ESPERA','ACEPTADA','RECHAZADA','ANULADA','INVALIDADA']), name='propuesta_estado_valido'),
            models.CheckConstraint(condition=(models.Q(estado='EN_ESPERA', fecha_hora_resolucion__isnull=True) | (~models.Q(estado='EN_ESPERA') & models.Q(fecha_hora_resolucion__isnull=False))), name='propuesta_resolucion_estado'),
            models.CheckConstraint(condition=models.Q(fecha_hora_resolucion__isnull=True) | models.Q(fecha_hora_resolucion__gte=models.F('fecha_hora_creacion')), name='propuesta_orden_temporal'),
        ]
