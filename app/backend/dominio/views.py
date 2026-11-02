from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.conf import settings
from django.contrib.auth.forms import PasswordResetForm, SetPasswordForm
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.middleware.csrf import get_token
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import csrf_protect
from urllib.parse import urlsplit
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import Especialidad, Usuario
from .permissions import IsAdministrador, has_valid_role_profile
from .serializers import (EspecialidadSerializer, LoginSerializer, PasswordChangeSerializer,
                          PasswordResetConfirmSerializer, PasswordResetRequestSerializer,
                          UsuarioInternoSerializer, UsuarioSerializer)


class CsrfView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Keep the account lock through login/last_login to serialize with resets.
        with transaction.atomic():
            user = authenticate(request=request._request, **serializer.validated_data)
            if user is None or not user.is_active or not has_valid_role_profile(user):
                return Response({"detail": "No fue posible iniciar sesión. Verifique sus datos o utilice la recuperación de contraseña."},
                                status=status.HTTP_401_UNAUTHORIZED)
            login(request._request, user)
            return Response({"usuario": UsuarioSerializer(user).data, "csrfToken": get_token(request)})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request._request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(UsuarioSerializer(request.user).data)


class PasswordChangeView(APIView):
    def post(self, request):
        with transaction.atomic():
            user = Usuario.objects.select_for_update().get(pk=request.user.pk)
            if not user.is_active or not has_valid_role_profile(user):
                raise PermissionDenied()
            if user.bloqueado_por_intentos:
                raise ValidationError({"detail": "Debe recuperar la contraseña mediante el enlace enviado a su email."})
            request.user = user
            serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
            serializer.is_valid(raise_exception=True)
            user.set_password(serializer.validated_data["password_nueva"])
            user.save(update_fields=["password"])
            update_session_auth_hash(request._request, user)
        return Response({"detail": "Contraseña actualizada correctamente."})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        form = PasswordResetForm({"email": serializer.validated_data["email"]})
        if not form.is_valid():
            raise ValidationError(form.errors)
        origin = urlsplit(settings.PASSWORD_RESET_BASE_URL)
        form.save(domain_override=origin.netloc, use_https=origin.scheme == "https",
                  subject_template_name="dominio/password_reset_subject.txt",
                  email_template_name="dominio/password_reset_email.txt",
                  extra_email_context={"reset_path": reverse("auth-password-reset-confirm")})
        return Response({"detail": "Si la cuenta permite recuperación, recibirá un correo con las instrucciones."})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invalid = {"detail": "El enlace de recuperación no es válido o ha vencido. Solicite uno nuevo."}
        with transaction.atomic():
            try:
                uid = Usuario._meta.pk.to_python(force_str(urlsafe_base64_decode(data["uid"])))
                user = Usuario.objects.select_for_update().get(pk=uid)
            except (ValueError, TypeError, OverflowError, DjangoValidationError, Usuario.DoesNotExist):
                raise ValidationError(invalid)
            if not user.is_active or not user.has_usable_password() or not default_token_generator.check_token(user, data["token"]):
                raise ValidationError(invalid)
            form = SetPasswordForm(user, {"new_password1": data["password_nueva"],
                                          "new_password2": data["password_confirmacion"]})
            if not form.is_valid():
                names = {"new_password1": "password_nueva", "new_password2": "password_confirmacion"}
                raise ValidationError({names.get(key, "detail"): list(errors) for key, errors in form.errors.items()})
            user = form.save(commit=False)
            user.intentos_fallidos = 0
            user.save(update_fields=["password", "intentos_fallidos"])
        # Do not preserve or create sessions: the password hash invalidates old sessions.
        return Response({"detail": "Contraseña restablecida. Ya puede iniciar sesión."})


class UsuarioInternoViewSet(mixins.CreateModelMixin, mixins.ListModelMixin,
                           mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                           viewsets.GenericViewSet):
    permission_classes = [IsAdministrador]
    serializer_class = UsuarioInternoSerializer
    queryset = Usuario.objects.filter(rol__in=[Usuario.Rol.MEDICO, Usuario.Rol.SECRETARIA]).select_related(
        "paciente", "medico__especialidad", "secretaria"
    ).order_by("id")


class EspecialidadViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAdministrador]
    serializer_class = EspecialidadSerializer
    queryset = Especialidad.objects.order_by("nombre")
