from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.conf import settings
from django.contrib.auth.forms import PasswordResetForm, SetPasswordForm
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from urllib.parse import urlsplit
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .agenda import create_blocks, delete_block, set_blocked, update_block
from .models import Disponibilidad, Especialidad, Medico, Usuario
from .permissions import IsActiveUser, IsAdministrador, IsGestorAgenda, IsLectorAgenda, has_valid_role_profile
from .serializers import (EspecialidadSerializer, LoginSerializer, PasswordChangeSerializer,
                          PasswordResetConfirmSerializer, PasswordResetRequestSerializer,
                          UsuarioInternoSerializer, UsuarioSerializer)
from .serializers import (DisponibilidadConsultaSerializer, DisponibilidadEscrituraSerializer,
                          DisponibilidadFiltroSerializer, DisponibilidadLoteSerializer,
                          MedicoConsultaSerializer, MedicoFiltroSerializer)


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
                  extra_email_context={"reset_path": reverse("auth-password-reset-confirm"),
                                       "reset_page_path": "/frontend/pages/auth/recuperar-password.html"})
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


class CatalogoEspecialidadViewSet(EspecialidadViewSet):
    permission_classes = [IsActiveUser]


class MedicoViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_value_regex = "[0-9]+"
    permission_classes = [IsActiveUser]
    serializer_class = MedicoConsultaSerializer

    def get_queryset(self):
        filters = MedicoFiltroSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        rows = Medico.objects.filter(usuario__rol=Usuario.Rol.MEDICO).select_related("usuario", "especialidad")
        if data["incluir_inactivos"]:
            if self.request.user.rol not in (Usuario.Rol.SECRETARIA, Usuario.Rol.ADMINISTRADOR):
                raise PermissionDenied()
        else:
            rows = rows.filter(usuario__is_active=True)
        if "especialidad" in data:
            rows = rows.filter(especialidad_id=data["especialidad"])
        return rows.order_by("usuario__apellido", "usuario__nombre", "pk")


class DisponibilidadViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    lookup_value_regex = "[0-9]+"
    serializer_class = DisponibilidadConsultaSerializer

    def get_permissions(self):
        return [IsLectorAgenda() if self.request.method in SAFE_METHODS else IsGestorAgenda()]

    def get_queryset(self):
        medico = get_object_or_404(Medico.objects.select_related("usuario"),
                                   pk=self.kwargs["medico_pk"], usuario__rol=Usuario.Rol.MEDICO)
        user = self.request.user
        if user.rol == Usuario.Rol.MEDICO and medico.usuario_id != user.pk:
            raise NotFound()
        if not has_valid_role_profile(medico.usuario) or (user.rol == Usuario.Rol.PACIENTE and not medico.usuario.is_active):
            raise NotFound()
        rows = Disponibilidad.objects.filter(medico=medico)
        if user.rol == Usuario.Rol.PACIENTE:
            now = timezone.localtime()
            rows = rows.filter(estado=Disponibilidad.Estado.DISPONIBLE).filter(
                Q(fecha__gt=now.date()) | Q(fecha=now.date(), hora_inicio__gt=now.time()))
        filters = DisponibilidadFiltroSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        for name, lookup in (("fecha", "fecha"), ("desde", "fecha__gte"), ("hasta", "fecha__lte"), ("estado", "estado")):
            if name in filters.validated_data:
                rows = rows.filter(**{lookup: filters.validated_data[name]})
        return rows.order_by("fecha", "hora_inicio", "pk")

    def create(self, request, **kwargs):
        serializer = DisponibilidadEscrituraSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        block = create_blocks(request.user, kwargs["medico_pk"], [serializer.validated_data])[0]
        return Response(self.get_serializer(block).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def lote(self, request, **kwargs):
        serializer = DisponibilidadLoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        blocks = create_blocks(request.user, kwargs["medico_pk"], serializer.validated_data["bloques"])
        return Response(self.get_serializer(blocks, many=True).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, **kwargs):
        serializer = DisponibilidadEscrituraSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        block = update_block(request.user, kwargs["medico_pk"], kwargs["pk"], serializer.validated_data)
        return Response(self.get_serializer(block).data)

    def _set_blocked(self, request, kwargs, blocked):
        if request.data:
            raise ValidationError("Esta acción no recibe campos; utiliza el bloque identificado en la URL.")
        block = set_blocked(request.user, kwargs["medico_pk"], kwargs["pk"], blocked=blocked)
        return Response(self.get_serializer(block).data)

    @action(detail=True, methods=["post"])
    def bloquear(self, request, **kwargs):
        return self._set_blocked(request, kwargs, True)

    @action(detail=True, methods=["post"])
    def desbloquear(self, request, **kwargs):
        return self._set_blocked(request, kwargs, False)

    def destroy(self, request, **kwargs):
        delete_block(request.user, kwargs["medico_pk"], kwargs["pk"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class TurnoPropioViewSet(viewsets.ReadOnlyModelViewSet):
    from .permissions import IsPaciente
    permission_classes = [IsPaciente]
    lookup_value_regex = '[0-9]+'

    def get_serializer_class(self):
        from .serializers import TurnoConsultaSerializer
        return TurnoConsultaSerializer

    def get_queryset(self):
        from .models import Turno
        return Turno.objects.filter(paciente__usuario=self.request.user).select_related(
            'medico__usuario', 'medico__especialidad', 'triaje', 'paciente__usuario').order_by('fecha', 'hora', 'pk')


    def _operar(self, request, accion):
        from . import turnos
        from .serializers import AccionTurnoSerializer, ModificarTurnoSerializer
        schema = ModificarTurnoSerializer if accion in ('modificar', 'reasignar') else AccionTurnoSerializer
        serializer = schema(data=request.data)
        serializer.is_valid(raise_exception=True)
        functions = {'cancelar': turnos.cancelar_turno, 'modificar': turnos.modificar_turno,
                     'presencia': turnos.registrar_presencia, 'iniciar': turnos.iniciar_consulta,
                     'finalizar': turnos.finalizar_consulta}
        from .reprogramacion import reasignar_pendiente
        functions['reasignar'] = reasignar_pendiente
        args = {'medico_id': self.kwargs.get('medico_pk')}
        if accion in ('modificar', 'reasignar'):
            args['disponibilidad_id'] = serializer.validated_data['disponibilidad']
        turno = functions[accion](request.user, self.kwargs['pk'], **args)
        return Response(self.get_serializer(turno).data)

    @action(detail=True, methods=['post'])
    def cancelar(self, request, **kwargs):
        return self._operar(request, 'cancelar')

    @action(detail=True, methods=['post'])
    def modificar(self, request, **kwargs):
        return self._operar(request, 'modificar')


    @action(detail=True, methods=['post'])
    def reasignar(self, request, **kwargs):
        return self._operar(request, 'reasignar')


class TurnoAgendaViewSet(TurnoPropioViewSet):
    def get_permissions(self):
        from .permissions import IsPaciente
        from .permissions import IsSecretaria
        if self.action == 'create':
            return [IsLectorAgenda()]
        if self.action in ('presencia', 'cancelar', 'modificar', 'reasignar'):
            return [IsSecretaria()]
        if self.action in ('iniciar', 'finalizar'):
            from .permissions import IsMedico
            return [IsMedico()]
        return [IsGestorAgenda()]

    def get_queryset(self):
        from .models import Turno
        medico = get_object_or_404(Medico, pk=self.kwargs['medico_pk'])
        if self.request.user.rol == Usuario.Rol.MEDICO and medico.usuario_id != self.request.user.pk:
            raise NotFound()
        rows = Turno.objects.filter(medico=medico).select_related('medico__usuario', 'medico__especialidad', 'triaje', 'paciente__usuario')
        # Only date filters apply here; availability states are a different domain.
        from rest_framework import serializers
        class Filtros(serializers.Serializer):
            fecha = serializers.DateField(required=False)
            estado = serializers.ChoiceField(choices=Turno.Estado.choices, required=False)
        filters = Filtros(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        return rows.filter(**filters.validated_data).order_by('fecha', 'hora', 'pk')

    def create(self, request, **kwargs):
        from .serializers import ReservaTurnoSerializer, ReservaSecretariaSerializer
        from .turnos import reservar_turno
        if request.user.rol not in (Usuario.Rol.PACIENTE, Usuario.Rol.SECRETARIA):
            raise PermissionDenied()
        schema = ReservaSecretariaSerializer if request.user.rol == Usuario.Rol.SECRETARIA else ReservaTurnoSerializer
        serializer = schema(data=request.data)
        serializer.is_valid(raise_exception=True)
        turno = reservar_turno(request.user, kwargs['medico_pk'], serializer.validated_data['disponibilidad'],
                               serializer.validated_data.get('respuestas'), paciente_id=serializer.validated_data.get('paciente'))
        return Response(self.get_serializer(turno).data, status=status.HTTP_201_CREATED)


    @action(detail=True, methods=['post'])
    def presencia(self, request, **kwargs):
        return self._operar(request, 'presencia')

    @action(detail=True, methods=['post'])
    def iniciar(self, request, **kwargs):
        return self._operar(request, 'iniciar')

    @action(detail=True, methods=['post'])
    def finalizar(self, request, **kwargs):
        return self._operar(request, 'finalizar')


    @action(detail=True, methods=['post'])
    def propuestas(self, request, **kwargs):
        from .serializers import ProponerPendienteSerializer
        from .reprogramacion import proponer_pendiente
        serializer = ProponerPendienteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = proponer_pendiente(request.user, kwargs['medico_pk'], kwargs['pk'], **serializer.validated_data)
        return Response(_resultado_reprogramacion(result), status=201 if result['propuestas'] else 200)


class PacienteBusquedaViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    from .permissions import IsSecretaria
    from .serializers import PacienteConsultaSerializer
    permission_classes = [IsSecretaria]
    serializer_class = PacienteConsultaSerializer

    def get_queryset(self):
        from .models import Paciente
        from .serializers import PacienteBusquedaSerializer
        serializer = PacienteBusquedaSerializer(data=self.request.query_params)
        serializer.is_valid(raise_exception=True)
        return Paciente.objects.filter(usuario__dni=serializer.validated_data['dni'],
            usuario__is_active=True, usuario__rol=Usuario.Rol.PACIENTE,
            usuario__medico__isnull=True, usuario__secretaria__isnull=True).select_related('usuario').order_by('pk')



def _resultado_reprogramacion(result):
    from .serializers import PropuestaConsultaSerializer
    return {**result, 'propuestas': PropuestaConsultaSerializer(result['propuestas'], many=True).data}


class ReprogramacionView(APIView):
    permission_classes = [IsGestorAgenda]

    def _medico(self, request, medico_pk):
        medico = get_object_or_404(Medico, pk=medico_pk)
        if request.user.rol == Usuario.Rol.MEDICO and medico.usuario_id != request.user.pk:
            raise NotFound()
        return medico

    def get(self, request, medico_pk):
        from .models import Turno
        from .serializers import ReprogramacionAlcanceSerializer, TurnoConsultaSerializer
        medico = self._medico(request, medico_pk)
        serializer = ReprogramacionAlcanceSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        rows = Turno.objects.filter(medico=medico, fecha=data['fecha_original'], estado='RESERVADO',
            fecha_hora_arribo__isnull=True, fecha_hora_inicio__isnull=True, fecha_hora_cierre__isnull=True,
            disponibilidad__hora_inicio__lt=data['hora_fin'], disponibilidad__hora_fin__gt=data['hora_inicio'])
        return Response(TurnoConsultaSerializer(rows.order_by('hora','pk'), many=True).data)

    def post(self, request, medico_pk):
        from .serializers import ReprogramacionSerializer
        from .reprogramacion import reprogramar
        self._medico(request, medico_pk)
        serializer = ReprogramacionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = reprogramar(request.user, medico_pk, **serializer.validated_data)
        return Response(_resultado_reprogramacion(result), status=201 if result['propuestas'] else 200)


class PropuestaViewSet(viewsets.ReadOnlyModelViewSet):
    from .permissions import IsPaciente
    from .serializers import PropuestaConsultaSerializer
    permission_classes = [IsPaciente]
    serializer_class = PropuestaConsultaSerializer
    lookup_value_regex = '[0-9]+'

    def get_queryset(self):
        from .models import PropuestaReprogramacion
        return PropuestaReprogramacion.objects.filter(turno__paciente__usuario=self.request.user).select_related(
            'turno__medico__usuario', 'turno__paciente__usuario', 'disponibilidad_destino').order_by('-fecha_hora_creacion','pk')

    def _responder(self, request, aceptar):
        from .serializers import AccionTurnoSerializer
        from .reprogramacion import responder
        serializer = AccionTurnoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal, conflict = responder(request.user, self.kwargs['pk'], aceptar=aceptar)
        data = self.get_serializer(proposal).data
        if conflict:
            return Response({'detail': 'La propuesta ya no es aplicable. Su turno sigue pendiente.', 'propuesta': data}, status=409)
        return Response(data)

    @action(detail=True, methods=['post'])
    def aceptar(self, request, **kwargs):
        return self._responder(request, True)

    @action(detail=True, methods=['post'])
    def rechazar(self, request, **kwargs):
        return self._responder(request, False)


class PropuestaAgendaViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsGestorAgenda]
    from .serializers import PropuestaConsultaSerializer
    serializer_class = PropuestaConsultaSerializer

    def get_queryset(self):
        from .models import PropuestaReprogramacion
        medico = get_object_or_404(Medico, pk=self.kwargs['medico_pk'])
        if self.request.user.rol == Usuario.Rol.MEDICO and medico.usuario_id != self.request.user.pk:
            raise NotFound()
        return PropuestaReprogramacion.objects.filter(turno__medico=medico).select_related(
            'turno__medico__usuario', 'turno__paciente__usuario', 'disponibilidad_destino').order_by('-fecha_hora_creacion','pk')


class PendienteAgendaViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsGestorAgenda]

    def get_serializer_class(self):
        from .serializers import TurnoConsultaSerializer
        return TurnoConsultaSerializer
    def get_queryset(self):
        from .reprogramacion import ordenar_turnos, proyeccion
        rows = TurnoAgendaViewSet.get_queryset(self).filter(estado='PENDIENTE')
        turns = list(rows)
        try:
            ordered = ordenar_turnos([proyeccion(t) for t in turns])
        except ValueError as error:
            from .agenda import AgendaConflict
            raise AgendaConflict(str(error)) from error
        by_id = {t.pk:t for t in turns}
        return [by_id[item['id']] for item in ordered]
