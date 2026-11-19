import re
from datetime import datetime, timedelta
from html.parser import HTMLParser
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from django.utils.http import urlsafe_base64_decode
from rest_framework.test import APIRequestFactory

from .models import Usuario
from .views import PasswordResetRequestView


class EmailHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.visible = []
        self.anchor = None

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.anchor = {'href': dict(attrs)['href'], 'label': ''}

    def handle_data(self, data):
        self.visible.append(data)
        if self.anchor is not None:
            self.anchor['label'] += data

    def handle_endtag(self, tag):
        if tag == 'a' and self.anchor is not None:
            self.links.append(self.anchor)
            self.anchor = None


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    PASSWORD_RESET_BASE_URL='http://localhost:8000', DEBUG=True,
    CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'reset-email-presentation'}},
)
class PasswordResetEmailPresentationTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        mail.outbox = []
        # Unsaved synthetic account: no query, real SMTP or real account changes.
        self.user = Usuario(pk=123, email='recuperacion@example.test', rol='PACIENTE',
                            password=make_password('Synthetic!4827Password'), is_active=True)

    def generate_email(self):
        request = APIRequestFactory().post(reverse('auth-password-reset'), {'email': self.user.email}, format='json')
        with patch('django.contrib.auth.forms.PasswordResetForm.get_users', return_value=[self.user]):
            response = PasswordResetRequestView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(len(message.alternatives), 1)
        html, mimetype = message.alternatives[0]
        self.assertEqual(mimetype, 'text/html')
        parser = EmailHTMLParser()
        parser.feed(html)
        return message, html, parser

    def test_multipart_email_keeps_required_copy_and_removes_technical_instructions(self):
        message, html, parser = self.generate_email()
        self.assertEqual(message.subject, 'Recuperación de contraseña')
        self.assertEqual(message.message().get_content_type(), 'multipart/alternative')
        self.assertEqual([part.get_content_type() for part in message.message().get_payload()], ['text/plain', 'text/html'])
        for content in [message.body, ''.join(parser.visible)]:
            self.assertIn('Se solicitó restablecer la contraseña de su cuenta', content)
            self.assertIn('válido durante una hora', content)
            self.assertIn('Si no solicitó este correo, puede ignorarlo.', content)
            for forbidden in ['Para completar la recuperación', 'Identificador:', 'Token:', 'solicitud POST',
                              'password_nueva', 'password_confirmacion', '/api/auth/password-reset/confirm/']:
                self.assertNotIn(forbidden, content)
        self.assertEqual(len(parser.links), 1)
        self.assertEqual(parser.links[0]['label'], 'Restablecer contraseña')
        self.assertNotIn('http://', ''.join(parser.visible))
        self.assertNotIn('Identificador:', html)

    def test_html_and_plaintext_keep_the_same_functional_link_and_valid_token(self):
        message, _, parser = self.generate_email()
        plaintext_url = re.search(r'https?://\S+', message.body).group(0)
        self.assertEqual(parser.links[0]['href'], plaintext_url)
        url = urlsplit(plaintext_url)
        self.assertEqual((url.scheme, url.netloc), ('http', 'localhost:8000'))
        self.assertEqual(url.path, '/frontend/pages/auth/recuperar-password.html')
        query = parse_qs(url.query)
        self.assertEqual(set(query), {'uid', 'token'})
        self.assertEqual(urlsafe_base64_decode(query['uid'][0]).decode(), str(self.user.pk))
        self.assertTrue(default_token_generator.check_token(self.user, query['token'][0]))
        response = self.client.get(url.path, query)
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-form="password-recovery"', b''.join(response.streaming_content))

    def test_email_token_still_expires_after_the_configured_hour(self):
        self.assertEqual(settings.PASSWORD_RESET_TIMEOUT, 3600)
        issued = datetime(2026, 11, 19, 12)
        with patch.object(default_token_generator, '_now', return_value=issued):
            message, _, _ = self.generate_email()
        token = parse_qs(urlsplit(re.search(r'https?://\S+', message.body).group(0)).query)['token'][0]
        with patch.object(default_token_generator, '_now', return_value=issued + timedelta(seconds=3599)):
            self.assertTrue(default_token_generator.check_token(self.user, token))
        with patch.object(default_token_generator, '_now', return_value=issued + timedelta(seconds=3601)):
            self.assertFalse(default_token_generator.check_token(self.user, token))
