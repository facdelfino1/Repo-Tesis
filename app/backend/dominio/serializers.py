from collections.abc import Mapping

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers

from .models import Especialidad, Medico, Secretaria, Usuario
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
                    for key, value in data.items():
                        setattr(instance, key, value)
                    # Never write a stale password, last_login or lockout counter.
                    instance.save(update_fields=list(data))
                    profile = instance.medico if instance.rol == Usuario.Rol.MEDICO else instance.secretaria
                    for key, value in profile_data.items():
                        setattr(profile, key, value)
                profile.full_clean()
                profile.save()
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
