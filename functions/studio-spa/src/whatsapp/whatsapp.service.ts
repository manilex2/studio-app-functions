import { Injectable, Logger } from '@nestjs/common';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import axios from 'axios';
import { isBefore, addDays, startOfDay, endOfDay, isSameDay } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { es } from 'date-fns/locale';
import { ConfigService } from '@nestjs/config';

// Definimos la interfaz para el documento de Booking en TypeScript
interface Booking {
  date?: Timestamp;
  clientUserId?: any;
  startDateTime?: Timestamp;
  endDateTime?: Timestamp;
  serviceId?: any;
  asesorId?: any;
  comments?: string;
  imageUrl?: string;
  isPaid?: boolean;
  unidad?: any;
  serviceName?: string;
  bookingStatus?: string;
  asesorName?: string;
  year?: number;
  month?: number;
  nombreCliente?: string;
  numeroCliente?: string;
  completedService?: boolean;
  treatmentRef?: any;
  atencionNumber?: number;
  isCancelled?: boolean;
  close?: boolean;
  timeSlot?: string;
  isStart?: boolean;
  notifWS1?: boolean;
  notifWS2?: boolean;
}

@Injectable()
export class WhatsappService {
  constructor(private readonly configService: ConfigService) {}

  private db = getFirestore();
  private readonly bookingsCollection = this.db.collection('bookings');
  private readonly logger = new Logger(WhatsappService.name);
  private readonly TIME_ZONE = 'America/Guayaquil'; // Define tu zona horaria aquí

  // --- Función simulada/Placeholder para enviar mensajes de WhatsApp ---
  private async sendWhatsAppMessage(
    to: string,
    message: string,
  ): Promise<void> {
    try {
      this.logger.log(`Intentando enviar WhatsApp a ${to}: "${message}"`);
      // Simulación de una operación asíncrona
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Aquí iría tu integración real con la API de WhatsApp Business.
      // Ejemplo (¡asegúrate de usar variables de entorno!):
      /*
      const accessToken = this.configService.get<string>('WHATSAPP_API_TOKEN');
      const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
      const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;

      const response = await axios.post(url, {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
          body: message,
        },
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(`Mensaje de WhatsApp enviado a ${to} exitosamente. Respuesta: ${JSON.stringify(response.data)}`);
      */
      this.logger.log(`Simulación: Mensaje enviado a ${to}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar mensaje de WhatsApp a ${to}: ${error.message}`,
      );
      if (axios.isAxiosError(error) && error.response) {
        this.logger.error(
          `Respuesta de error de WhatsApp API: ${JSON.stringify(error.response.data)}`,
        );
      }
      // Re-lanza el error o maneja según tu política (ej. encolar para reintento)
      throw new Error(`Fallo al enviar mensaje a ${to}`);
    }
  }

  /**
   * Verifica los bookings con 2 días o menos de antelación y envía notificación.
   * Utiliza la zona horaria definida para cálculos precisos.
   */
  // @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'America/Caracas' }) // Ejemplo de cron con zona horaria
  async checkAndNotifyTwoDaysBefore(): Promise<void> {
    this.logger.log(
      'Iniciando verificación de bookings para notificación de 2 días o menos (UTC).',
    );
    let successfulNotifications = 0;
    let failedNotifications = 0;

    try {
      const now = new Date();
      const nowZoned = toZonedTime(now, this.TIME_ZONE);

      // Calculamos las fechas límite en la zona horaria definida
      const endOfTodayZoned = endOfDay(nowZoned);
      const endOfTwoDaysFromNowZoned = endOfDay(addDays(nowZoned, 2));

      // Convertimos las fechas límite de la zona horaria definida a UTC para la consulta de Firestore
      // Usamos toZonedTime con 'UTC' como destino para obtener la fecha UTC correcta.
      const twoDaysFromNowUtcDate = toZonedTime(
        endOfTwoDaysFromNowZoned,
        'UTC',
      );
      const twoDaysFromNowUtcTimestamp = Timestamp.fromDate(
        twoDaysFromNowUtcDate,
      );

      // Ahora sí usamos now en el log para evitar el aviso
      this.logger.debug(`Fecha actual (UTC): ${now.toISOString()}`);
      this.logger.debug(
        `Fecha actual en ${this.TIME_ZONE}: ${format(nowZoned, 'yyyy-MM-dd HH:mm:ssXXX', { timeZone: this.TIME_ZONE })}`,
      );
      this.logger.debug(
        `Fecha límite (2 días desde ahora) en ${this.TIME_ZONE}: ${format(endOfTwoDaysFromNowZoned, 'yyyy-MM-dd HH:mm:ssXXX', { timeZone: this.TIME_ZONE })}`,
      );
      this.logger.debug(
        `Consultando Firestore para bookings con 'date' <= ${twoDaysFromNowUtcTimestamp.toDate().toISOString()} (UTC)`,
      );

      const snapshot = await this.bookingsCollection
        .where('date', '<=', twoDaysFromNowUtcTimestamp)
        .where('notifWS1', '!=', true)
        .get();

      if (snapshot.empty) {
        this.logger.log(
          'No se encontraron bookings para notificar (2 días o menos) después del filtro de Firestore.',
        );
        return;
      }

      const updates: Promise<FirebaseFirestore.WriteResult>[] = [];

      for (const doc of snapshot.docs) {
        const booking = doc.data() as Booking;
        const bookingDateZoned = booking.date
          ? toZonedTime(booking.date.toDate(), this.TIME_ZONE)
          : null;

        if (!bookingDateZoned || !booking.numeroCliente) {
          this.logger.warn(
            `Booking ${doc.id} omitido por datos incompletos (fecha o número de cliente).`,
          );
          continue;
        }

        const isFutureOrToday = !isBefore(
          bookingDateZoned,
          startOfDay(nowZoned),
        );
        const isWithinTwoDays = !isBefore(
          addDays(endOfTodayZoned, 2),
          bookingDateZoned,
        );

        if (isFutureOrToday && isWithinTwoDays && !booking.notifWS1) {
          try {
            const formattedDate = format(bookingDateZoned, "eeee d 'de' MMMM", {
              timeZone: this.TIME_ZONE,
              locale: es,
            });
            const message = `¡Hola ${booking.nombreCliente || 'cliente'}! Te recordamos tu cita de ${booking.serviceName || 'servicio'} en 2 días o menos, el ${formattedDate}. ¡Te esperamos!`;
            await this.sendWhatsAppMessage(booking.numeroCliente, message);

            updates.push(doc.ref.update({ notifWS1: true }));
            this.logger.log(
              `Notificación enviada y 'notifWS1' actualizado para booking ${doc.id}`,
            );
            successfulNotifications++;
          } catch (sendError) {
            this.logger.error(
              `Error procesando booking ${doc.id} para notificación de 2 días: ${sendError.message}`,
            );
            failedNotifications++;
          }
        } else {
          this.logger.debug(
            `Booking ${doc.id} no cumple las condiciones de 2 días (o ya notificado).`,
          );
        }
      }

      await Promise.allSettled(updates); // Usa Promise.allSettled para que las fallas de actualización no detengan las demás
      this.logger.log(
        `Proceso de notificación de 2 días o menos completado. Éxitos: ${successfulNotifications}, Fallos: ${failedNotifications}.`,
      );
    } catch (error) {
      this.logger.error(
        `Error fatal en checkAndNotifyTwoDaysBefore: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Verifica los bookings para el mismo día y envía notificación.
   * Utiliza la zona horaria definida para cálculos precisos.
   */
  // @Cron(CronExpression.EVERY_DAY_AT_7AM, { timeZone: 'America/Caracas' }) // Ejemplo de cron con zona horaria
  async checkAndNotifySameDay(): Promise<void> {
    this.logger.log(
      'Iniciando verificación de bookings para notificación del mismo día (UTC).',
    );
    let successfulNotifications = 0;
    let failedNotifications = 0;

    try {
      const now = new Date(); // Fecha y hora actual en UTC
      const nowZoned = toZonedTime(now, this.TIME_ZONE); // Hora actual en la zona horaria definida

      // Calculamos el inicio y fin del día en la zona horaria definida
      const startOfTodayZoned = startOfDay(nowZoned);
      const endOfTodayZoned = endOfDay(nowZoned);

      // Convertimos a UTC Timestamps para la consulta de Firestore
      const startOfTodayUtcDate = toZonedTime(startOfTodayZoned, 'UTC');
      const endOfTodayUtcDate = toZonedTime(endOfTodayZoned, 'UTC');

      const startOfTodayUtcTimestamp = Timestamp.fromDate(startOfTodayUtcDate);
      const endOfTodayUtcTimestamp = Timestamp.fromDate(endOfTodayUtcDate);

      this.logger.debug(`Fecha actual (UTC): ${now.toISOString()}`);
      this.logger.debug(
        `Fecha actual en ${this.TIME_ZONE}: ${format(nowZoned, 'yyyy-MM-dd HH:mm:ssXXX', { timeZone: this.TIME_ZONE })}`,
      );
      this.logger.debug(
        `Rango para hoy en ${this.TIME_ZONE}: ${format(startOfTodayZoned, 'yyyy-MM-dd HH:mm:ssXXX')} a ${format(endOfTodayZoned, 'yyyy-MM-dd HH:mm:ssXXX')}`,
      );
      this.logger.debug(
        `Consultando Firestore para bookings con 'date' entre ${startOfTodayUtcTimestamp.toDate().toISOString()} y ${endOfTodayUtcTimestamp.toDate().toISOString()} (UTC)`,
      );

      const snapshot = await this.bookingsCollection
        .where('date', '>=', startOfTodayUtcTimestamp)
        .where('date', '<=', endOfTodayUtcTimestamp)
        .where('notifWS2', '!=', true)
        .get();

      if (snapshot.empty) {
        this.logger.log(
          'No se encontraron bookings para notificar (mismo día) después del filtro de Firestore.',
        );
        return;
      }

      const updates: Promise<FirebaseFirestore.WriteResult>[] = [];

      for (const doc of snapshot.docs) {
        const booking = doc.data() as Booking;
        const bookingDateZoned = booking.date
          ? toZonedTime(booking.date.toDate(), this.TIME_ZONE)
          : null;

        if (!bookingDateZoned || !booking.numeroCliente) {
          this.logger.warn(
            `Booking ${doc.id} omitido por datos incompletos (fecha o número de cliente).`,
          );
          continue;
        }

        if (isSameDay(bookingDateZoned, nowZoned) && !booking.notifWS2) {
          try {
            const formattedTime = booking.startDateTime
              ? format(
                  toZonedTime(booking.startDateTime.toDate(), this.TIME_ZONE),
                  'h:mm a',
                  { timeZone: this.TIME_ZONE, locale: es },
                )
              : 'la hora programada';

            const message = `¡Hola ${booking.nombreCliente || 'cliente'}! Solo un recordatorio rápido: tienes tu cita de ${booking.serviceName || 'servicio'} hoy a las ${formattedTime}. ¡Te esperamos!`;
            await this.sendWhatsAppMessage(booking.numeroCliente, message);

            updates.push(doc.ref.update({ notifWS2: true }));
            this.logger.log(
              `Notificación enviada y 'notifWS2' actualizado para booking ${doc.id}`,
            );
            successfulNotifications++;
          } catch (sendError) {
            this.logger.error(
              `Error procesando booking ${doc.id} para notificación del mismo día: ${sendError.message}`,
            );
            failedNotifications++;
          }
        } else {
          this.logger.debug(
            `Booking ${doc.id} no cumple las condiciones del mismo día (o ya notificado).`,
          );
        }
      }

      await Promise.allSettled(updates);
      this.logger.log(
        `Proceso de notificación del mismo día completado. Éxitos: ${successfulNotifications}, Fallos: ${failedNotifications}.`,
      );
    } catch (error) {
      this.logger.error(
        `Error fatal en checkAndNotifySameDay: ${error.message}`,
        error.stack,
      );
    }
  }
}
