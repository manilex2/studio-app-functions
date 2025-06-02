# STUDIO SPA STUDIO APP

## Actualizar Configuración de CORS

> Si es primera vez debe instalar la consola:
>
> [Instalar consola de Google Cloud](https://cloud.google.com/sdk/docs/install?hl=es-419)
>
> Ejecutar el comando `gcloud init` y seguir las instrucciones de la configuración inicial.

Ejecutar el comando `gcloud config configurations list` para ver que archivos de configuración están creados.

Si no existe la configuración correspondiente ejecutar el comando `gcloud config configurations create [NOMBRE-DE-LA-CONFIGURACION]`, colocar el nombre la configuracion que se desee y siga los pasos a continuación (en caso de existir la configuración pasar directamente al paso 5):

1. Ejecutar `gcloud auth login` y elegir la cuenta de Google a usar.
2. Ejecutar `gcloud config set account [TU-CUENTA-EMAIL]` y colocar el email que desea asignar.
3. Ejecutar `gcloud projects list` para obtener la lista de proyectos.
4. Ejecutar `gcloud config set project [ID-DE-TU-PROYECTO]` y colocar el nombre del proyecto que se desea asignar a la configuración.
5. Ejecutar `gcloud config configurations activate [NOMBRE-DE-LA-CONFIGURACION]` introduzca el nombre de la configuración para activarla.

### Crear archivo CORS

Para completar la configuración debe crear un archivo cors para cada proyecto que se vea apróximadamente de la siguiente manera:

#### cors-example.json

```json
[
    {
      "origin": [
        "https://dominio1-permitido.com",
        "https://dominio2-permitido.com",
        "...",
      ],
      "method": ["GET", "OPTIONS", "HEAD"],
      "responseHeader": ["Content-Type", "x-goog-meta-custom"],
      "maxAgeSeconds": 3600
    }
  ]
```

Ejecutar comando `gsutil cors set [NOMBRE-ARCHIVO-CORS].json gs://<nombre-de-tu-bucket>` colocar el nombre del archivo CORS y la dirección del bucket para dar los permisos.

Puede ejecutar `gsutil cors get gs://<nombre-de-tu-bucket>` para verificar que la configuración de CORS se haya desplegado correctamente.