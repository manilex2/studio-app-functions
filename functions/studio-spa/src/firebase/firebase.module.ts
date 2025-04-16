import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { cert, initializeApp } from 'firebase-admin/app';
import serviceAccount from '../serviceAccountKey.json';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'FIREBASE_ADMIN',
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get('NODE_ENV');
        console.log('NODE_ENV:', nodeEnv);
        if (configService.get('NODE_ENV') === 'production') {
          return initializeApp();
        } else {
          return initializeApp({
            credential: cert(serviceAccount.toString()),
          });
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ['FIREBASE_ADMIN'],
})
export class FirebaseModule {}
