import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('dominio', '0004_propuesta_reprogramacion')]

    operations = [
        migrations.AddField(
            model_name='turno',
            name='cerrado_por',
            field=models.ForeignKey(blank=True, editable=False, null=True,
                                    on_delete=django.db.models.deletion.PROTECT,
                                    related_name='consultas_cerradas', to=settings.AUTH_USER_MODEL),
        ),
    ]
