import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { cert, initializeApp, App } from 'firebase-admin/app';
import * as fs from 'fs/promises';
import * as path from 'path';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'FIREBASE_ADMIN',
      useFactory: async (configService: ConfigService): Promise<App> => {
        const nodeEnv = configService.get('NODE_ENV');
        const serviceAccountPath = configService.get<string>(
          'FIREBASE_SERVICE_ACCOUNT_PATH',
        );

        console.log('NODE_ENV:', nodeEnv);
        if (nodeEnv != 'development') {
          console.log(
            'Inicializando Firebase Admin para producción (autodetectando credenciales).',
          );
          return initializeApp();
        } else if (serviceAccountPath) {
          console.log(`Cargando credenciales desde: ${serviceAccountPath}`);
          const absolutePath = path.resolve(process.cwd(), serviceAccountPath);
          try {
            const serviceAccountContent = await fs.readFile(
              absolutePath,
              'utf8',
            );
            const serviceAccount = JSON.parse(serviceAccountContent);

            return initializeApp({
              credential: cert(serviceAccount), // Pasamos el objeto JSON directamente
            });
          } catch (error) {
            console.error(
              `Error al cargar o parsear el archivo de cuenta de servicio desde ${absolutePath}:`,
              error,
            );
            throw new Error(
              'No se pudo inicializar Firebase Admin debido a un error en la carga de la cuenta de servicio.',
            );
          }
        } else {
          console.warn(
            'Advertencia: No se encontró FIREBASE_SERVICE_ACCOUNT_PATH. Inicializando Firebase Admin sin credenciales explícitas.',
          );
          return initializeApp();
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ['FIREBASE_ADMIN'],
})
export class FirebaseModule {}
