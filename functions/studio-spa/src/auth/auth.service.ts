import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Filter } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createTransport } from 'nodemailer';
import { genSalt } from 'bcrypt';
import { JsonWebTokenError, sign, verify } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

export interface Register {
  display_name: string;
  email: string;
  enable: boolean;
  rol: string;
  phone_number?: string;
  cargo: string;
  cedula: string;
  ngrams: string[];
  genero: string;
  completedRegister: boolean;
  photo_url?: string;
  unidad?: string;
  nombreUnidad?: string;
  category?: string;
  birthday?: Date;
  direccion?: string;
  medicamentos?: string;
  antecedentesPersonales?: string;
  alergias?: string;
  antecedentesFamiliares?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly configService: ConfigService) {}

  private auth = getAuth();
  private db = getFirestore();
  private storage = getStorage().bucket(
    this.configService.get<string>('STORAGE_BUCKET_FIREBASE'),
  );
  private transporter = createTransport({
    host: this.configService.get<string>('SENDGRID_HOST'),
    port: +this.configService.get<string>('SENDGRID_PORT'),
    auth: {
      user: this.configService.get<string>('SENDGRID_USER'),
      pass: this.configService.get<string>('SENDGRID_API_KEY'),
    },
  });

  capitalize = (str: string): string =>
    str
      .split(' ')
      .map(([first, ...rest]) => [first.toUpperCase(), ...rest].join(''))
      .join(' ');

  /**
   * Crear una clave provisional (hash)
   */
  async claveProv(): Promise<string> {
    const saltRounds = 10;
    try {
      const salt = await genSalt(saltRounds);
      return salt;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      throw new HttpException(
        'Error al generar la clave provisional',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async singUp(body: Register): Promise<void> {
    const clave = await this.claveProv();

    const {
      email,
      display_name,
      photo_url,
      rol,
      enable,
      phone_number,
      cargo,
      cedula,
      ngrams,
      genero,
      unidad,
      birthday,
      category,
      completedRegister,
      nombreUnidad,
      alergias,
      antecedentesFamiliares,
      antecedentesPersonales,
      direccion,
      medicamentos,
    } = body;

    try {
      const userSnapshot = await this.db
        .collection('users')
        .where(
          Filter.or(
            Filter.where('email', '==', email),
            Filter.where('cedula', '==', cedula),
          ),
        )
        .get();

      const userExists = !userSnapshot.empty;
      if (userExists) {
        throw new HttpException(
          'El usuario con ese email y/o cedula ya se encuentra creado.',
          HttpStatus.CONFLICT,
        );
      }

      const newUserRef = this.db.collection('users').doc();
      const user = {
        email: email,
        displayName: display_name,
        password: clave,
      };

      const userFirebase = await this.auth.createUser({
        ...user,
        uid: newUserRef.id,
      });

      const rolRef = (await this.db.collection('roles').doc(rol).get()).ref;
      const unidadRef = unidad
        ? (await this.db.collection('locales').doc(unidad).get()).ref
        : null;

      let photo = '';

      if (photo_url) {
        // 1) Extraer MIME y payload base64
        const match = photo_url.match(/^data:(.+);base64,(.+)$/);
        if (!match) {
          throw new Error('El photo_url no tiene formato Data URI válido');
        }
        const mimeType = match[1]; // ej. "image/png" o "application/pdf"
        const base64Data = match[2]; // la parte pura Base64

        // 2) Derivar extensión a partir del MIME
        let extension = mimeType.split('/')[1]; // ej. "png", "jpeg", "pdf"
        // Opcional: si quieres mapear algunos casos especiales:
        const extMap: Record<string, string> = {
          jpeg: 'jpg',
          'svg+xml': 'svg',
        };
        extension = extMap[extension] ?? extension;

        // 3) Construir el path dinámico
        const filePath = `users/${newUserRef.id}/profile/profile.${extension}`;

        // 4) Convertir Base64 a Buffer
        const buffer = Buffer.from(base64Data, 'base64');

        // 5) Subir a Firebase Storage con el contentType correcto
        const file = this.storage.file(filePath);
        const downloadToken = uuidv4();
        await file.save(buffer, {
          metadata: {
            contentType: mimeType,
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
            },
          },
        });

        // 6) Construir la URL pública (o firmada)
        const encodedPath = encodeURIComponent(filePath);
        photo = `https://firebasestorage.googleapis.com/v0/b/${this.configService.get<string>('STORAGE_BUCKET_FIREBASE')}/o/${encodedPath}?alt=media&token=${downloadToken}`;
      }

      const usuario = {
        email,
        display_name,
        photo_url: photo ?? '',
        phone_number: phone_number ?? null,
        rol: rolRef,
        uid: userFirebase.uid,
        created_time: new Date(userFirebase.metadata.creationTime),
        enable,
        firstLogin: true,
        cargo,
        cedula,
        rolName: this.capitalize(rol),
        ngrams,
        genero,
        unidad: unidadRef,
        nombreUnidad: nombreUnidad ?? '',
        category: category ?? '',
        birthday: birthday ? new Date(birthday) : null,
        completedRegister: completedRegister ?? true,
        alergias: alergias ?? '',
        antecedentesFamiliares: antecedentesFamiliares ?? '',
        antecedentesPersonales: antecedentesPersonales ?? '',
        direccion: direccion ?? '',
        medicamentos: medicamentos ?? '',
      };

      await newUserRef.set(usuario);

      await this.transporter.sendMail({
        from: `${this.configService.get<string>('SENDGRID_SENDER_NAME')} <${this.configService.get<string>('SENDGRID_SENDER_EMAIL')}>`,
        to: email,
        subject: `Registro de usuario exitoso en ${this.configService.get<string>('STUDIO_NAME')}`,
        html: `<p>Hola ${display_name}</p>
               <p>Has sido registrado en la plataforma de ${this.configService.get<string>('STUDIO_NAME')}.</p>
               <p>Su usuario es el correo electrónico ${email} y su contraseña provisional: <b>${clave}</b></p>
               <p>Al iniciar sesión por primera vez se le solicitará cambiar la contraseña.</p>
               <p>Para ingresar a la plataforma de ${this.configService.get<string>('STUDIO_NAME')} puede ingresar a través del siguiente link: 
               <a href="${this.configService.get<string>('STUDIO_URL')}">${this.configService.get<string>('STUDIO_NAME')}</a></p>
               <p>Atentamente,</p><p><b>El equipo de ${this.configService.get<string>('STUDIO_NAME')}</b></p>`,
      });

      if (body.cargo == 'cliente') {
        const cartRef = this.db.collection('shoppingCart').doc();
        const cartData = {
          userRef: newUserRef,
          shoppingCartItems: [],
          wishListItems: [],
        };
        await cartRef.set(cartData);

        const pointsRef = this.db.collection('puntosTotales').doc();
        const pointsData = {
          userRef: newUserRef,
          puntosTotales: 0,
          puntosVigentes: 0,
          puntosPorCaducar: 0,
        };
        await pointsRef.set(pointsData);
      }
    } catch (error) {
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async changePassword(
    uid: string,
    newPassword: string,
    email: string,
  ): Promise<string> {
    const auth = getAuth();

    try {
      await auth.updateUser(uid, { password: newPassword });
      return `Contraseña cambiada exitosamente para el usuario: ${email}`;
    } catch (error) {
      console.error('Error al cambiar la contraseña: ', error);

      const errorMessage = error.message || 'Ocurrió un error desconocido';

      if (errorMessage.startsWith('BAD REQUEST')) {
        throw new HttpException(
          `Solicitud incorrecta: ${errorMessage}`,
          HttpStatus.BAD_REQUEST,
        );
      } else if (errorMessage.startsWith('UNAUTHORIZED')) {
        throw new HttpException(
          `Error de autorización: ${errorMessage}`,
          HttpStatus.UNAUTHORIZED,
        );
      } else if (errorMessage.startsWith('FORBIDDEN')) {
        throw new HttpException(
          `Prohibido: ${errorMessage}`,
          HttpStatus.FORBIDDEN,
        );
      } else if (errorMessage.startsWith('NOT FOUND')) {
        throw new HttpException(
          `Recurso no encontrado: ${errorMessage}`,
          HttpStatus.NOT_FOUND,
        );
      } else if (errorMessage.startsWith('CONFLICT')) {
        throw new HttpException(
          `Conflicto: ${errorMessage}`,
          HttpStatus.CONFLICT,
        );
      } else {
        throw new HttpException(
          `Error interno del servidor: ${errorMessage}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }

  async resetPassword(email: string): Promise<void> {
    try {
      const userRecord = await this.auth.getUserByEmail(email);

      const token = sign(
        { email },
        this.configService.get<string>('JWT_SECRET'),
        {
          expiresIn: '1h',
        },
      );

      await this.db
        .collection('users')
        .doc(userRecord.uid)
        .set({ resetToken: token }, { merge: true });

      const resetLink = `${this.configService.get<string>('STUDIO_URL')}/login?email=${encodeURIComponent(
        email,
      )}&token=${encodeURIComponent(token)}`;

      await this.transporter.sendMail({
        to: email,
        from: `${this.configService.get<string>('SENDGRID_SENDER_NAME')} <${this.configService.get<string>('SENDGRID_SENDER_EMAIL')}>`, // Configura el remitente en tus variables de entorno
        subject: `Restablecimiento de contraseña para ${this.configService.get<string>('STUDIO_NAME')}`,
        html: `
          <p>Hola, ${userRecord.displayName}</p>
          <p>Hemos recibido una solicitud para restablecer su contraseña.</p>
          <p>Haz clic en el siguiente enlace para restablecerla:</p>
          <a href="${resetLink}">Restablecer contraseña</a>
          <p>Este enlace expirará en 1 hora.</p>
          <p>En caso de no haberla solicitado puede hacer caso omiso a este email.</p>
          <p>Atentamente,</p>
          <p><b>El equipo de ${this.configService.get<string>('STUDIO_NAME')}</b></p>
        `,
      });
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Error al procesar la solicitud',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async confirmReset(email: string, token: string): Promise<void> {
    try {
      verify(token, this.configService.get<string>('JWT_SECRET'));

      const userRecord = await this.auth.getUserByEmail(email);

      const userDoc = await this.db
        .collection('users')
        .doc(userRecord.uid)
        .get();
      const userData = userDoc.data();

      if (!userData || userData.resetToken !== token) {
        throw new HttpException(
          'Token inválido o expirado',
          HttpStatus.BAD_REQUEST,
        );
      }

      const newPassword = await this.claveProv();

      await this.auth.updateUser(userRecord.uid, { password: newPassword });

      await this.db
        .collection('users')
        .doc(userRecord.uid)
        .update({ resetToken: null });

      await this.transporter.sendMail({
        to: email,
        from: `${this.configService.get<string>('SENDGRID_SENDER_NAME')} <${this.configService.get<string>('SENDGRID_SENDER_EMAIL')}>`,
        subject: `Confirmación de Restablecimiento de contraseña para ${this.configService.get<string>('STUDIO_NAME')}`,
        html: `
          <p>Hola, ${userRecord.displayName}</p>
          <p>Su contraseña ha sido restablecida exitosamente.</p>
          <p>Su nueva contraseña es: <strong>${newPassword}</strong></p>
          <p>Al iniciar sesión, se le solicitará cambiar esta contraseña.</p>
          <p>Puede acceder a través del siguiente enlace:</p>
          <a href="${this.configService.get<string>('STUDIO_URL')}">Restablecer contraseña</a>
          <p>Atentamente,</p>
          <p><b>El equipo de ${this.configService.get<string>('STUDIO_NAME')}</b></p>
        `,
      });
    } catch (error) {
      if (error instanceof JsonWebTokenError) {
        throw new HttpException(
          'Token inválido o expirado',
          HttpStatus.BAD_REQUEST,
        );
      } else if (error.code === 'auth/user-not-found') {
        throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Error al procesar la solicitud',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
