from django.contrib.auth.backends import ModelBackend
from django.db import transaction

from .models import Usuario
from .permissions import has_valid_role_profile


class CuentaBackend(ModelBackend):
    """Persistent lockout; preload profiles without changing session eligibility."""

    def get_user(self, user_id):
        try:
            user = Usuario.objects.select_related(
                "paciente", "medico__especialidad", "secretaria"
            ).get(pk=user_id)
        except Usuario.DoesNotExist:
            return None
        return user if self.user_can_authenticate(user) else None

    def authenticate(self, request, username=None, password=None, **kwargs):
        email = username if username is not None else kwargs.get(Usuario.USERNAME_FIELD)
        if email is None or password is None:
            return None
        with transaction.atomic():
            try:
                user = Usuario.objects.select_for_update().get(email__iexact=email.strip())
            except Usuario.DoesNotExist:
                Usuario().set_password(password)  # Comparable hashing work; no synthetic account.
                return None
            if user.bloqueado_por_intentos:
                Usuario().set_password(password)
                return None
            if not user.check_password(password):
                user.intentos_fallidos += 1
                user.save(update_fields=["intentos_fallidos"])
                # Return normally so the failed attempt is committed, not rolled back.
                return None
            if not self.user_can_authenticate(user) or not has_valid_role_profile(user):
                return None
            if user.intentos_fallidos:
                user.intentos_fallidos = 0
                user.save(update_fields=["intentos_fallidos"])
            return user
