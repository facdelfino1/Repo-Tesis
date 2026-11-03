from django.db import migrations


def provisionar_especialidades(apps, schema_editor):
    Especialidad = apps.get_model("dominio", "Especialidad")
    for nombre in ("Clínica Médica", "Pediatría", "Cardiología"):
        Especialidad.objects.using(schema_editor.connection.alias).get_or_create(nombre=nombre)


class Migration(migrations.Migration):
    dependencies = [("dominio", "0002_intentos_fallidos")]
    operations = [migrations.RunPython(provisionar_especialidades, migrations.RunPython.noop)]
