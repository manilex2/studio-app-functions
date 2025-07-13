import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as admin from 'firebase-admin';
import { https, setGlobalOptions } from 'firebase-functions/v2';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import express from 'express';
import { Express } from 'express-serve-static-core';
import { INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';

admin.initializeApp();

setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: '1GiB',
});

const expressServer = express();
let nestApp: INestApplication;

const createFunction = async (expressInstance: Express) => {
  if (!nestApp) {
    nestApp = await NestFactory.create(
      AppModule,
      new ExpressAdapter(expressInstance),
    );

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

    nestApp.enableCors(corsOptions);
    await nestApp.init();
  }
  return nestApp;
};

export const api = https.onRequest(async (request, response) => {
  await createFunction(expressServer);
  expressServer(request, response);
});
