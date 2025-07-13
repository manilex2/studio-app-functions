import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import * as admin from 'firebase-admin';

async function bootstrap() {
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      console.log('Firebase Admin SDK initialized successfully.'); // Mensaje de éxito
    } catch (error) {
      console.error('Error al inicializar Firebase Admin SDK:', error); // Captura el error aquí
      // Aquí puedes decidir si quieres que la aplicación se detenga o intente continuar
      process.exit(1); // Detener la aplicación si la inicialización falla críticamente
    }
  }

  const app = await NestFactory.create(AppModule);

  const corsOptions: CorsOptions = {
    origin: [
      'https://app.flutterflow.io/debug',
      'https://spastudio.flutterflow.app',
      'https://drhairecu.flutterflow.app',
      'https://drhairsalons.flutterflow.app',
      'https://studio-manager-vefzvj.web.app',
      'https://dr-hair-12585.web.app',
      'https://dr-hair-salon.web.app',
      'https://drhairecu.com',
      'https://drhairsalons.com',
    ],
    methods: 'GET, POST, PUT, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  };
  app.enableCors(corsOptions);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`NestJS application is running on: http://localhost:${port}`);
}
bootstrap();
