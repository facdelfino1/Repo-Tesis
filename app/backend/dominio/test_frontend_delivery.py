from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from django.template.loader import render_to_string


class FrontendDeliveryTests(SimpleTestCase):
    @override_settings(DEBUG=True)
    def test_login_page_delivered_in_development(self):
        response=self.client.get('/frontend/pages/auth/login.html')
        self.assertEqual(response.status_code,200)
        self.assertIn(b'type="module"',b''.join(response.streaming_content))

    @override_settings(DEBUG=True)
    def test_es_modules_delivered_in_development(self):
        for path in ('assets/js/core/api.js','assets/js/core/session.js','assets/js/features/catalog/catalog-service.js'):
            response=self.client.get('/frontend/'+path)
            self.assertEqual(response.status_code,200)
            self.assertIn('javascript',response['Content-Type'])
            response.close()

    @override_settings(DEBUG=False)
    def test_development_frontend_not_exposed_in_production(self):
        self.assertEqual(self.client.get('/frontend/pages/auth/login.html').status_code,404)

    @override_settings(DEBUG=True)
    def test_no_traversal_or_private_backend_file(self):
        for path in ('../backend/.env','%2e%2e/backend/.env','missing.html'):
            self.assertEqual(self.client.get('/frontend/'+path).status_code,404)

    def test_reset_email_links_to_form_and_keeps_api_instructions(self):
        body=render_to_string('dominio/password_reset_email.txt',dict(protocol='https',domain='example.test',
            reset_path=reverse('auth-password-reset-confirm'),reset_page_path='/frontend/pages/auth/recuperar-password.html',uid='uid',token='token'))
        self.assertIn('https://example.test/frontend/pages/auth/recuperar-password.html?uid=uid&token=token',body)
        self.assertIn('https://example.test/api/auth/password-reset/confirm/',body)
