from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('dominio', '0006_turno_origen')]

    operations = [
        migrations.AddField(
            model_name='usuario',
            name='fecha_nacimiento',
            field=models.DateField(blank=True, null=True),
        ),
    ]
