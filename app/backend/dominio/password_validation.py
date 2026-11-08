from django.core.exceptions import ValidationError


class PasswordComplexityValidator:
    """Shared policy for new passwords; whitespace is not a special character."""

    def validate(self, password, user=None):
        if (len(password) < 8 or not any(c.isupper() for c in password)
                or not any(c.islower() for c in password)
                or not any(c.isdecimal() for c in password)
                or not any(not c.isalnum() and not c.isspace() for c in password)):
            raise ValidationError(self.get_help_text(), code="password_complexity")

    def get_help_text(self):
        return "Use al menos 8 caracteres, mayúscula, minúscula, número y carácter especial (no un espacio)."
