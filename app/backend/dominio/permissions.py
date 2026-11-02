from rest_framework.permissions import BasePermission

from .models import Usuario


def has_valid_role_profile(user):
    """Reject missing, mismatched or multiple profiles; an admin has none."""
    expected = {
        Usuario.Rol.PACIENTE: "paciente",
        Usuario.Rol.MEDICO: "medico",
        Usuario.Rol.SECRETARIA: "secretaria",
        Usuario.Rol.ADMINISTRADOR: None,
    }
    if user.rol not in expected:
        return False
    profiles = {name for name in ("paciente", "medico", "secretaria") if getattr(user, name, None) is not None}
    return profiles == ({expected[user.rol]} if expected[user.rol] else set())


class IsActiveUser(BasePermission):
    message = "Debe iniciar sesión con una cuenta activa y un perfil válido."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and has_valid_role_profile(user))


class HasRole(IsActiveUser):
    allowed_roles = ()
    message = "Su rol no está autorizado para esta operación."

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.rol in self.allowed_roles


class IsAdministrador(HasRole):
    allowed_roles = (Usuario.Rol.ADMINISTRADOR,)


class IsPaciente(HasRole):
    allowed_roles = (Usuario.Rol.PACIENTE,)


class IsMedico(HasRole):
    allowed_roles = (Usuario.Rol.MEDICO,)


class IsSecretaria(HasRole):
    allowed_roles = (Usuario.Rol.SECRETARIA,)
