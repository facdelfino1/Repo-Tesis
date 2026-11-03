from django.urls import include, path
from rest_framework.routers import SimpleRouter

from .views import (CsrfView, EspecialidadViewSet, LoginView, LogoutView, MeView,
                    PasswordChangeView, PasswordResetConfirmView, PasswordResetRequestView, UsuarioInternoViewSet,
                    CatalogoEspecialidadViewSet, DisponibilidadViewSet, MedicoViewSet, TurnoPropioViewSet, TurnoAgendaViewSet, PacienteBusquedaViewSet, ReprogramacionView, PropuestaViewSet, PropuestaAgendaViewSet, PendienteAgendaViewSet)

router = SimpleRouter()
router.register("admin/usuarios", UsuarioInternoViewSet, basename="usuario-interno")
router.register("admin/especialidades", EspecialidadViewSet, basename="especialidad")
router.register("especialidades", CatalogoEspecialidadViewSet, basename="catalogo-especialidad")
router.register("medicos", MedicoViewSet, basename="medico")
router.register(r"medicos/(?P<medico_pk>[0-9]+)/disponibilidades", DisponibilidadViewSet, basename="disponibilidad")

router.register("turnos", TurnoPropioViewSet, basename="turno")
router.register(r"medicos/(?P<medico_pk>[0-9]+)/turnos", TurnoAgendaViewSet, basename="turno-agenda")

router.register("pacientes", PacienteBusquedaViewSet, basename="paciente-busqueda")

router.register('propuestas', PropuestaViewSet, basename='propuesta')
router.register(r'medicos/(?P<medico_pk>[0-9]+)/propuestas', PropuestaAgendaViewSet, basename='propuesta-agenda')
router.register(r'medicos/(?P<medico_pk>[0-9]+)/pendientes', PendienteAgendaViewSet, basename='pendiente-agenda')

urlpatterns = [
    path('medicos/<int:medico_pk>/reprogramacion/afectados/', ReprogramacionView.as_view(http_method_names=['get', 'head', 'options']), name='reprogramacion-afectados'),
    path('medicos/<int:medico_pk>/reprogramacion/', ReprogramacionView.as_view(http_method_names=['post', 'options']), name='reprogramacion'),
    path("auth/csrf/", CsrfView.as_view(), name="auth-csrf"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", MeView.as_view(), name="auth-me"),
    path("auth/password/", PasswordChangeView.as_view(), name="auth-password"),
    path("auth/password-reset/", PasswordResetRequestView.as_view(), name="auth-password-reset"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("", include(router.urls)),
]
