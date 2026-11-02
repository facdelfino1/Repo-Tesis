from django.contrib.auth.base_user import BaseUserManager
from django.core.validators import validate_email


class UsuarioManager(BaseUserManager):
    use_in_migrations = True

    def get_by_natural_key(self, email):
        return self.get(email__iexact=email.strip())

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("El email es obligatorio.")
        email = self.normalize_email(email).strip().lower()
        validate_email(email)
        user = self.model(email=email, **extra_fields)
        if user.rol not in self.model.Rol.values:
            raise ValueError("El rol no es valido.")
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("rol", self.model.Rol.ADMINISTRADOR)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        if not password:
            raise ValueError("El superusuario requiere una contrasena.")
        if not all(extra_fields.get(flag) for flag in ("is_staff", "is_superuser", "is_active")):
            raise ValueError("El superusuario debe estar activo y tener permisos de superusuario.")
        if extra_fields["rol"] != self.model.Rol.ADMINISTRADOR:
            raise ValueError("El superusuario debe tener rol ADMINISTRADOR.")
        return self.create_user(email, password, **extra_fields)
