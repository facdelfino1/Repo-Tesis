from django.urls import include, path
from .frontend import frontend

urlpatterns = [path("api/", include("dominio.urls")), path("frontend/<path:path>", frontend, name="frontend-file")]
