import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Filter, FieldValue } from 'firebase-admin/firestore';
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
  cargo: string | null;
  cedula: string;
  ngrams: string[];
  admin: boolean;
  genero?: string;
  completedRegister?: boolean;
  phone_number?: string;
  photo_url?: string;
  unidad?: string;
  nombreUnidad?: string;
  category?: string;
  birthday?: string | null;
  direccion?: string;
  medicamentos?: string;
  antecedentesPersonales?: string;
  alergias?: string;
  antecedentesFamiliares?: string;
  idContifico?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name); // Instanciar el logger
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
    const batch = this.db.batch();

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
      idContifico,
      admin,
    } = body;

    try {
      const userSnapshot = await this.db
        .collection('users')
        .where(
          Filter.or(
            Filter.where('email', '==', email.trim()),
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

      this.logger.debug(`Pase el filtro de verificar usuario`);

      const newUserRef = this.db.collection('users').doc();
      const user = {
        email: email.trim(),
        displayName: display_name,
        password: clave,
      };

      const userFirebase = await this.auth.createUser({
        ...user,
        uid: newUserRef.id,
      });

      this.logger.debug(
        `Pude crear el usuario ${JSON.stringify(userFirebase)}`,
      );

      const rolRef = (await this.db.collection('roles').doc(rol).get()).ref;

      this.logger.debug(`Obtuve el rol ${JSON.stringify(rolRef)}`);
      const unidadDoc = unidad
        ? await this.db.collection('locales').doc(unidad).get()
        : null;

      this.logger.debug(`Pase unidadDoc ${JSON.stringify(unidadDoc)}`);

      let photo = '';

      if (photo_url) {
        this.logger.debug(`Hay una foto ${photo_url}`);
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
        email: email.trim(),
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
        rolName:
          rolRef.id == 'admin'
            ? 'admin'
            : rolRef.id == 'asesor'
              ? 'Asesor'
              : 'Cliente',
        ngrams,
        genero: genero ?? null,
        unidad: unidadDoc ? unidadDoc.ref : null,
        nombreUnidad:
          nombreUnidad && unidadDoc ? unidadDoc.data().nombre_unidad : null,
        category: category ?? '',
        birthday: birthday != '' || birthday != null ? birthday : null,
        completedRegister: completedRegister ?? true,
        alergias: alergias ?? '',
        antecedentesFamiliares: antecedentesFamiliares ?? '',
        antecedentesPersonales: antecedentesPersonales ?? '',
        direccion: direccion ?? '',
        medicamentos: medicamentos ?? '',
        idContifico: idContifico ?? '',
        regCompRRSS: true, // Registro completo en RRSS
      };

      batch.set(newUserRef, usuario);

      this.logger.debug(`Creado el usuario ${JSON.stringify(usuario)}`);

      if (body.cargo == 'cliente') {
        const cartRef = this.db.collection('shoppingCart').doc();
        const cartData = {
          userRef: newUserRef,
          shoppingCartItems: [],
          wishListItems: [],
        };
        batch.set(cartRef, cartData);

        const pointsRef = this.db.collection('puntosTotales').doc();
        const pointsData = {
          userRef: newUserRef,
          puntosTotales: 0,
          puntosVigentes: 0,
          puntosPorCaducar: 0,
        };
        batch.set(pointsRef, pointsData);

        this.logger.debug(
          `Creado el carrito ${JSON.stringify(cartRef)} y los puntos ${JSON.stringify(pointsRef)}`,
        );
      }

      await batch.commit();

      if (admin != true) {
        await this.transporter.sendMail({
          from: `${this.configService.get<string>('SENDGRID_SENDER_NAME')} <${this.configService.get<string>('SENDGRID_SENDER_EMAIL')}>`,
          to: email,
          subject: `Registro de usuario exitoso en ${this.configService.get<string>('STUDIO_NAME')}`,
          html: `<p>Hola ${display_name}</p>
               <p>Has sido registrado en la plataforma de ${this.configService.get<string>('STUDIO_NAME')}.</p>
               <p>Su usuario es el correo electrónico ${email.trim()} y su contraseña provisional: <b>${clave}</b></p>
               <p>Al iniciar sesión por primera vez se le solicitará cambiar la contraseña.</p>
               <p>Para ingresar a la plataforma de ${this.configService.get<string>('STUDIO_NAME')} puede ingresar a través del siguiente link: 
               <a href="${this.configService.get<string>('STUDIO_URL')}">${this.configService.get<string>('STUDIO_NAME')}</a></p>
               <p>Atentamente,</p><p><b>El equipo de ${this.configService.get<string>('STUDIO_NAME')}</b></p>`,
        });

        this.logger.debug(`Enviado el correo`);
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
      this.logger.error('Error al cambiar la contraseña: ', error);

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

      this.logger.debug(`Pase userRecord: ${userRecord}`);

      const token = sign(
        { email },
        this.configService.get<string>('JWT_SECRET'),
        {
          expiresIn: '1h',
        },
      );

      this.logger.debug(`Pase sign de JWT: ${token}`);

      await this.db
        .collection('users')
        .doc(userRecord.uid)
        .set({ resetToken: token }, { merge: true });

      this.logger.debug('Pase guardado del token en base de datos');

      const resetLink = `${this.configService.get<string>('STUDIO_URL')}/login?email=${encodeURIComponent(
        email,
      )}&token=${encodeURIComponent(token)}`;

      this.logger.debug(resetLink);

      await this.transporter.sendMail({
        to: email,
        from: `${this.configService.get<string>('SENDGRID_SENDER_NAME')} <${this.configService.get<string>('SENDGRID_SENDER_EMAIL')}>`, // Configura el remitente en tus variables de entorno
        subject: `Restablecimiento de contraseña para ${this.configService.get<string>('STUDIO_NAME')}`,
        html: `
          <p>Hola, ${userRecord.displayName}</p>
          <p>Hemos recibido una solicitud para restablecer su contraseña.</p>
          <p>Haz clic en el siguiente enlace para confirmar el reestablecimiento:</p>
          <a href="${resetLink}">Restablecer contraseña</a>
          <p>Este enlace expirará en 1 hora.</p>
          <p>En caso de no haberla solicitado puede hacer caso omiso a este email.</p>
          <p>Luego de confirmar le llegará una clave provisional a este email.</p>
          <p>Atentamente,</p>
          <p><b>El equipo de ${this.configService.get<string>('STUDIO_NAME')}</b></p>
        `,
      });
      this.logger.debug('Pase envio de correo');
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Error al procesar la solicitud ${error}`,
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
        .set({ resetToken: null, firstLogin: true }, { merge: true });

      this.logger.debug('Reseteado el token');

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
          <a href="${this.configService.get<string>('STUDIO_URL')}/login">Iniciar sesión</a>
          <p>Atentamente,</p>
          <p><b>El equipo de ${this.configService.get<string>('STUDIO_NAME')}</b></p>
        `,
      });

      this.logger.debug('Pase envio de correo');
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
        `Error al procesar la solicitud ${error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteAccount(email: string): Promise<void> {
    try {
      const userRecord = await this.auth.getUserByEmail(email);

      const userDoc = await this.db
        .collection('users')
        .doc(userRecord.uid)
        .get();
      const userData = userDoc.data();

      // Verificar si los datos del usuario existen antes de intentar copiarlos
      if (userData) {
        await this.db
          .collection('usersDeleted')
          .doc(userRecord.uid)
          .set({
            ...userData,
            deletedAt: FieldValue.serverTimestamp(),
          }); // Usar .set() con merge:true o sin merge para crear/sobrescribir y añadir timestamp
      } else {
        // Esto es un caso raro si getUserByEmail encontró un usuario pero no en la colección 'users'
        this.logger.warn(
          `Usuario ${userRecord.uid} encontrado en Auth pero no en la colección 'users'.`,
        );
      }

      await this.auth.deleteUser(userRecord.uid);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        throw new HttpException('Usuario no encontrado.', HttpStatus.NOT_FOUND);
      }
      // Registrar el error original para depuración
      this.logger.error(
        `Error en el servicio deleteAccount: ${error.message}`,
        error.stack,
      );

      // Lanzar una excepción genérica para el cliente, pero con el error registrado internamente
      throw new HttpException(
        `Error al procesar la solicitud de eliminación de cuenta. ${error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
