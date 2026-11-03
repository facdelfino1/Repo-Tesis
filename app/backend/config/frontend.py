"""Local same-origin delivery only; production serves the frontend as static files."""
from django.conf import settings
from django.http import Http404
from django.core.exceptions import SuspiciousFileOperation
from django.views.static import serve


def frontend(request, path):
    if not settings.DEBUG:
        raise Http404()
    try:
        return serve(request, path, document_root=settings.BASE_DIR.parent / 'frontend')
    except SuspiciousFileOperation as error:
        raise Http404() from error
