from collections.abc import Mapping
from datetime import datetime

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework import serializers

from .models import Disponibilidad, Especialidad, Medico, Paciente, Secretaria, Usuario
from .permissions import has_valid_role_profile


class UsuarioSerializer(serializers.ModelSerializer):
    perfil = serializers.SerializerMethodField()

    class Meta:
        model = Usuario
        fields = ("id", "email", "nombre", "apellido", "dni", "telefono", "rol", "is_active", "perfil")
        read_only_fields = fields

    def get_perfil(self, user):
        if user.rol == Usuario.Rol.PACIENTE:
            profile = getattr(user, "paciente", None)
            return {"id": profile.pk, "obra_social": profile.obra_social} if profile else None
        if user.rol == Usuario.Rol.MEDICO:
            profile = getattr(user, "medico", None)
            return {"id": profile.pk, "matricula": profile.matricula,
                    "especialidad": {"id": profile.especialidad_id, "nombre": profile.especialidad.nombre}} if profile else None
        if user.rol == Usuario.Rol.SECRETARIA:
            profile = getattr(user, "secretaria", None)
            return {"id": profile.pk, "legajo": profile.legajo} if profile else None
        return None


def check_password_policy(password, user):
    try:
        validate_password(password, user=user)
    except DjangoValidationError as error:
        raise serializers.ValidationError(error.messages) from error


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_email(self, value):
        return value.strip().lower()


class RegistroPacienteSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    password_confirmacion = serializers.CharField(write_only=True, trim_whitespace=False)
    obra_social = serializers.CharField(max_length=150, required=False, allow_blank=True)

    class Meta:
        model = Usuario
        fields = ("nombre", "apellido", "dni", "telefono", "email", "obra_social",
                  "password", "password_confirmacion")
        extra_kwargs = {"email": {"validators": []}}

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({"detail": "Envíe el formulario como un objeto."})
        forbidden = set(data) - set(self.fields)
        if forbidden:
            raise serializers.ValidationError({key: "Campo no permitido." for key in sorted(forbidden)})
        return super().to_internal_value(data)

    def validate_email(self, value):
        value = value.strip().lower()
        if Usuario.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Ya existe una cuenta con este email.")
        return value

    def validate_dni(self, value):
        if not value.isascii() or not value.isdecimal():
            raise serializers.ValidationError("Ingrese un DNI numérico.")
        if Usuario.objects.filter(dni=value).exists():
            raise serializers.ValidationError("Ya existe una cuenta con este DNI.")
        return value

    def validate_telefono(self, value):
        if not value.isascii() or not value.isdecimal():
            raise serializers.ValidationError("Ingrese un teléfono numérico.")
        return value

    def validate(self, attrs):
        password = attrs["password"]
        if password != attrs["password_confirmacion"]:
            raise serializers.ValidationError({"password_confirmacion": "Las contraseñas no coinciden."})
        if (len(password) < 8 or not any(c.isupper() for c in password)
                or not any(c.islower() for c in password) or not any(c.isdecimal() for c in password)
                or not any(not c.isalnum() and not c.isspace() for c in password)):
            raise serializers.ValidationError({"password": "Use al menos 8 caracteres, mayúscula, minúscula, número y carácter especial."})
        candidate = Usuario(rol=Usuario.Rol.PACIENTE, **{key: attrs[key] for key in
                            ("nombre", "apellido", "dni", "telefono", "email")})
        try:
            check_password_policy(password, candidate)
        except serializers.ValidationError as error:
            raise serializers.ValidationError({"password": error.detail}) from error
        return attrs

    def create(self, validated_data):
        data = dict(validated_data)
        password = data.pop("password")
        data.pop("password_confirmacion")
        obra_social = data.pop("obra_social", "")
        try:
            with transaction.atomic():
                # DNI is historically non-unique. Serialize public registrations of
                # the same DNI without changing existing internal-account contracts.
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                                   ["registro-paciente:dni:" + data["dni"]])
                if Usuario.objects.filter(dni=data["dni"]).exists():
                    raise serializers.ValidationError({"dni": "Ya existe una cuenta con este DNI."})
                user = Usuario.objects.create_user(password=password, rol=Usuario.Rol.PACIENTE, **data)
                profile = Paciente(usuario=user, obra_social=obra_social)
                profile.full_clean()
                profile.save()
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error
        except IntegrityError as error:
            raise serializers.ValidationError({"detail": "No se pudo crear la cuenta: existen datos duplicados o inválidos."}) from error
        return user


class PasswordChangeSerializer(serializers.Serializer):
    password_actual = serializers.CharField(write_only=True, trim_whitespace=False)
    password_nueva = serializers.CharField(write_only=True, trim_whitespace=False)
    password_confirmacion = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["password_actual"]):
            raise serializers.ValidationError({"password_actual": "La contraseña actual es incorrecta."})
        if attrs["password_nueva"] != attrs["password_confirmacion"]:
            raise serializers.ValidationError({"password_confirmacion": "Las contraseñas no coinciden."})
        try:
            check_password_policy(attrs["password_nueva"], user)
        except serializers.ValidationError as error:
            raise serializers.ValidationError({"password_nueva": error.detail}) from error
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=128, write_only=True)
    token = serializers.CharField(max_length=256, write_only=True)
    password_nueva = serializers.CharField(write_only=True, trim_whitespace=False)
    password_confirmacion = serializers.CharField(write_only=True, trim_whitespace=False)


class UsuarioInternoSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)
    rol = serializers.ChoiceField(choices=(Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA))
    matricula = serializers.CharField(max_length=50, required=False, write_only=True)
    especialidad = serializers.PrimaryKeyRelatedField(queryset=Especialidad.objects.all(), required=False, write_only=True)
    legajo = serializers.CharField(max_length=50, required=False, write_only=True)

    class Meta:
        model = Usuario
        fields = ("id", "email", "nombre", "apellido", "dni", "telefono", "rol", "is_active",
                  "password", "matricula", "especialidad", "legajo")
        read_only_fields = ("id",)
        extra_kwargs = {"email": {"validators": []}}

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({"detail": "Envíe los datos de una cuenta como un objeto."})
        unknown = set(data) - set(self.fields)
        forbidden = unknown | (set(data) & {"id"})
        if forbidden:
            raise serializers.ValidationError({key: "Campo no permitido." for key in sorted(forbidden)})
        return super().to_internal_value(data)

    def validate_email(self, value):
        value = value.strip().lower()
        existing = Usuario.objects.filter(email__iexact=value)
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError("Ya existe una cuenta con este email.")
        return value

    def validate(self, attrs):
        user = self.instance
        if user:
            if not has_valid_role_profile(user):
                raise serializers.ValidationError("La cuenta tiene un perfil inconsistente; requiere revisión administrativa.")
            if attrs.get("rol", user.rol) != user.rol:
                raise serializers.ValidationError({"rol": "No se permite cambiar el rol de una cuenta existente."})
            if attrs.get("dni", user.dni) != user.dni:
                raise serializers.ValidationError({"dni": "El DNI de una cuenta existente no se modifica aquí."})
            if "password" in attrs:
                raise serializers.ValidationError({"password": "Utilice el cambio de contraseña propia."})
        role = user.rol if user else attrs["rol"]
        required = ("matricula", "especialidad") if role == Usuario.Rol.MEDICO else ("legajo",)
        incompatible = ("legajo",) if role == Usuario.Rol.MEDICO else ("matricula", "especialidad")
        errors = {key: "Este dato no corresponde al rol seleccionado." for key in incompatible if key in attrs}
        if not user:
            errors.update({key: "Este campo es obligatorio." for key in (*required, "password") if key not in attrs})
        model, field, relation = (Medico, "matricula", "medico") if role == Usuario.Rol.MEDICO else (Secretaria, "legajo", "secretaria")
        if field in attrs:
            existing = model.objects.filter(**{field: attrs[field]})
            if user:
                existing = existing.exclude(pk=getattr(user, relation).pk)
            if existing.exists():
                errors[field] = "Este valor ya está registrado."
        if errors:
            raise serializers.ValidationError(errors)
        if not user:
            candidate = Usuario(**{key: value for key, value in attrs.items()
                                  if key not in ("password", "matricula", "especialidad", "legajo")})
            try:
                check_password_policy(attrs["password"], candidate)
            except serializers.ValidationError as error:
                raise serializers.ValidationError({"password": error.detail}) from error
        return attrs

    def _save_account(self, validated_data, instance=None):
        data = dict(validated_data)
        profile_data = {key: data.pop(key) for key in ("matricula", "especialidad", "legajo") if key in data}
        password = data.pop("password", None)
        try:
            with transaction.atomic():
                if instance is None:
                    instance = Usuario.objects.create_user(password=password, **data)
                    profile = Medico(usuario=instance, **profile_data) if instance.rol == Usuario.Rol.MEDICO else Secretaria(usuario=instance, **profile_data)
                else:
                    # Coordinate specialty changes with all writers of this doctor's agenda.
                    profile = Medico.objects.select_for_update().get(usuario=instance) if instance.rol == Usuario.Rol.MEDICO else instance.secretaria
                    if (instance.rol == Usuario.Rol.MEDICO and "especialidad" in profile_data
                            and profile_data["especialidad"].pk != profile.especialidad_id
                            and (profile.disponibilidades.exists() or profile.turnos.exists())):
                        raise serializers.ValidationError({"especialidad": "No puede cambiarse mientras el médico tenga agenda o historial de turnos."})
                    for key, value in data.items():
                        setattr(instance, key, value)
                    # Never write a stale password, last_login or lockout counter.
                    instance.save(update_fields=list(data))
                    for key, value in profile_data.items():
                        setattr(profile, key, value)
                profile.full_clean()
                profile.save()
                # Response serialization must not reuse a stale reverse-relation cache.
                instance._state.fields_cache["medico" if instance.rol == Usuario.Rol.MEDICO else "secretaria"] = profile
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages) from error
        except IntegrityError as error:
            # A uniqueness race must not expose SQL, constraint names or credentials.
            raise serializers.ValidationError("No se pudo guardar la cuenta: existen datos duplicados o relacionados inválidos.") from error
        return instance

    def create(self, validated_data):
        return self._save_account(validated_data)

    def update(self, instance, validated_data):
        return self._save_account(validated_data, instance)

    def to_representation(self, instance):
        return UsuarioSerializer(instance).data


class EspecialidadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Especialidad
        fields = ("id", "nombre")
        read_only_fields = fields


class MedicoConsultaSerializer(serializers.ModelSerializer):
    nombre = serializers.CharField(source="usuario.nombre", read_only=True)
    apellido = serializers.CharField(source="usuario.apellido", read_only=True)
    especialidad = EspecialidadSerializer(read_only=True)

    class Meta:
        model = Medico
        fields = ("id", "nombre", "apellido", "matricula", "especialidad")
        read_only_fields = fields


class DisponibilidadConsultaSerializer(serializers.ModelSerializer):
    duracion_minutos = serializers.SerializerMethodField()

    class Meta:
        model = Disponibilidad
        fields = ("id", "medico", "fecha", "hora_inicio", "hora_fin", "estado", "duracion_minutos")
        read_only_fields = fields

    def get_duracion_minutos(self, block):
        minutes = (datetime.combine(block.fecha, block.hora_fin)
                   - datetime.combine(block.fecha, block.hora_inicio)).total_seconds() / 60
        return int(minutes) if minutes.is_integer() else minutes


class DisponibilidadEscrituraSerializer(serializers.Serializer):
    fecha = serializers.DateField()
    hora_inicio = serializers.TimeField()
    hora_fin = serializers.TimeField()

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError("Envíe un objeto con fecha y horario.")
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({field: "Campo no permitido." for field in sorted(unknown)})
        return super().to_internal_value(data)


class DisponibilidadLoteSerializer(DisponibilidadEscrituraSerializer):
    fecha = None
    hora_inicio = None
    hora_fin = None
    bloques = DisponibilidadEscrituraSerializer(many=True, allow_empty=False, max_length=100)


class MedicoFiltroSerializer(serializers.Serializer):
    especialidad = serializers.IntegerField(required=False, min_value=1)
    incluir_inactivos = serializers.BooleanField(required=False, default=False)


class DisponibilidadFiltroSerializer(serializers.Serializer):
    fecha = serializers.DateField(required=False)
    desde = serializers.DateField(required=False)
    hasta = serializers.DateField(required=False)
    estado = serializers.ChoiceField(choices=Disponibilidad.Estado.choices, required=False)
    futuros = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if "fecha" in attrs and ("desde" in attrs or "hasta" in attrs):
            raise serializers.ValidationError("Utilice fecha o rango desde/hasta, no ambos.")
        if "desde" in attrs and "hasta" in attrs and attrs["desde"] > attrs["hasta"]:
            raise serializers.ValidationError("Desde debe ser anterior o igual a hasta.")
        return attrs


class ReservaTurnoSerializer(serializers.Serializer):
    disponibilidad = serializers.IntegerField(min_value=1)
    respuestas = serializers.JSONField(required=False)

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError('Envíe un objeto de reserva.')
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({key: 'Campo no permitido.' for key in sorted(unknown)})
        if type(data.get('disponibilidad')) is not int:
            raise serializers.ValidationError({'disponibilidad': 'Seleccione un identificador entero de disponibilidad.'})
        if 'respuestas' in data and type(data['respuestas']) is not dict:
            raise serializers.ValidationError({'respuestas': 'Envíe un cuestionario completo como objeto.'})
        return super().to_internal_value(data)


class TurnoConsultaSerializer(serializers.ModelSerializer):
    medico = MedicoConsultaSerializer(read_only=True)
    paciente = serializers.IntegerField(source='paciente_id', read_only=True)
    paciente_detalle = serializers.SerializerMethodField()
    asignacion_vigente = serializers.SerializerMethodField()
    horario_futuro = serializers.SerializerMethodField()
    prioridad = serializers.SerializerMethodField()
    triaje = serializers.SerializerMethodField()

    class Meta:
        from .models import Turno
        model = Turno
        fields = ('id_turno', 'paciente', 'medico', 'disponibilidad', 'fecha', 'hora', 'estado',
                  'duracion_turno', 'fecha_hora_creacion', 'fecha_hora_arribo', 'fecha_hora_inicio',
                  'fecha_hora_cierre', 'prioridad', 'triaje', 'asignacion_vigente', 'horario_futuro', 'paciente_detalle')
        read_only_fields = fields

    def get_asignacion_vigente(self, turno):
        return turno.estado in ('RESERVADO', 'PRESENTE', 'EN_ATENCION')

    def get_horario_futuro(self, turno):
        now = timezone.localtime()
        return turno.fecha > now.date() or (turno.fecha == now.date() and turno.hora > now.time())

    def get_paciente_detalle(self, turno):
        usuario = turno.paciente.usuario
        return {'id': turno.paciente_id, 'nombre': usuario.nombre,
                'apellido': usuario.apellido, 'dni': usuario.dni}

    def get_prioridad(self, turno):
        triaje = getattr(turno, 'triaje', None)
        return triaje.nivel_prioridad if triaje else None

    def get_triaje(self, turno):
        triaje = getattr(turno, 'triaje', None)
        if not triaje:
            return None
        return {'id_triaje': triaje.pk, 'respuesta_sintomas': triaje.respuesta_sintomas,
                'nivel_prioridad': triaje.nivel_prioridad, 'fecha_hora_evaluacion': triaje.fecha_hora_evaluacion.isoformat()}


class ReservaSecretariaSerializer(ReservaTurnoSerializer):
    paciente = serializers.IntegerField(min_value=1)

    def to_internal_value(self, data):
        if isinstance(data, Mapping) and type(data.get('paciente')) is not int:
            raise serializers.ValidationError({'paciente': 'Seleccione un identificador entero de paciente.'})
        return super().to_internal_value(data)


class ModificarTurnoSerializer(ReservaTurnoSerializer):
    respuestas = None


class AccionTurnoSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, Mapping) or data:
            raise serializers.ValidationError({'detail': 'Esta acción no recibe campos.'})
        return {}


class PacienteBusquedaSerializer(serializers.Serializer):
    dni = serializers.CharField(max_length=20, allow_blank=False)

    def to_internal_value(self, data):
        if 'dni' not in data or set(data) - {'dni', 'page'}:
            raise serializers.ValidationError({'dni': 'Indique únicamente el DNI exacto a buscar.'})
        return super().to_internal_value(data)


class PacienteConsultaSerializer(serializers.ModelSerializer):
    nombre = serializers.CharField(source='usuario.nombre', read_only=True)
    apellido = serializers.CharField(source='usuario.apellido', read_only=True)
    dni = serializers.CharField(source='usuario.dni', read_only=True)

    class Meta:
        from .models import Paciente
        model = Paciente
        fields = ('id', 'nombre', 'apellido', 'dni')
        read_only_fields = fields


class ReprogramacionAlcanceSerializer(serializers.Serializer):
    fecha_original = serializers.DateField()
    hora_inicio = serializers.TimeField()
    hora_fin = serializers.TimeField()

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({'detail': 'Envíe un objeto de reprogramación.'})
        if set(data) - set(self.fields):
            raise serializers.ValidationError({'detail': 'Se recibieron campos no permitidos.'})
        return super().to_internal_value(data)

    def validate(self, attrs):
        if attrs['hora_fin'] <= attrs['hora_inicio']:
            raise serializers.ValidationError({'hora_fin': 'Debe ser posterior al inicio.'})
        for field in ('hora_inicio','hora_fin'):
            value = attrs[field]
            if value.tzinfo or value.second or value.microsecond:
                raise serializers.ValidationError({field: 'Indique una hora con precisión de minutos.'})
        return attrs


class ReprogramacionSerializer(ReprogramacionAlcanceSerializer):
    nueva_fecha = serializers.DateField()
    turnos = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False)
    motivo = serializers.CharField(max_length=500, allow_blank=False)

    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            ids = data.get('turnos')
            if type(ids) is not list or not ids or any(type(pk) is not int or pk <= 0 for pk in ids) or len(set(ids)) != len(ids):
                raise serializers.ValidationError({'turnos': 'Seleccione IDs enteros positivos, sin duplicados.'})
        return super().to_internal_value(data)


class ProponerPendienteSerializer(serializers.Serializer):
    nueva_fecha = serializers.DateField()
    motivo = serializers.CharField(max_length=500, allow_blank=False)

    def to_internal_value(self, data):
        if not isinstance(data, Mapping) or set(data) - set(self.fields):
            raise serializers.ValidationError({'detail': 'Indique únicamente nueva fecha y motivo.'})
        return super().to_internal_value(data)


class PropuestaConsultaSerializer(serializers.ModelSerializer):
    vigente = serializers.SerializerMethodField()
    reserva_garantizada = serializers.SerializerMethodField()

    class Meta:
        from .models import PropuestaReprogramacion
        model = PropuestaReprogramacion
        fields = ('id', 'turno', 'disponibilidad_origen', 'fecha_origen', 'hora_origen', 'duracion_origen',
                  'disponibilidad_destino', 'fecha_destino', 'hora_inicio_destino', 'hora_fin_destino',
                  'creada_por', 'motivo', 'estado', 'fecha_hora_creacion', 'fecha_hora_resolucion',
                  'motivo_cierre', 'vigente', 'reserva_garantizada')
        read_only_fields = fields

    def get_vigente(self, proposal):
        from .reprogramacion import destino_vigente
        from .turnos import _valid_user
        return (proposal.estado == 'EN_ESPERA' and proposal.turno.estado == 'PENDIENTE'
                and _valid_user(proposal.turno.medico.usuario, Usuario.Rol.MEDICO)
                and _valid_user(proposal.turno.paciente.usuario, Usuario.Rol.PACIENTE)
                and destino_vigente(proposal))

    def get_reserva_garantizada(self, proposal):
        return False
