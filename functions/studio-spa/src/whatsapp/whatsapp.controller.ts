// whatsapp.controller.ts
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name); // Agregamos un logger para el controlador

  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('notify-two-days-before')
  @HttpCode(HttpStatus.OK) // Se devuelve 200 OK si la operación de inicio fue exitosa
  async notifyTwoDaysBefore() {
    try {
      this.logger.log(
        'Recibida solicitud para notificar bookings con 2 días o menos.',
      );
      await this.whatsappService.checkAndNotifyTwoDaysBefore();
      return {
        statusCode: HttpStatus.OK,
        message:
          'Proceso de notificación para 2 días o menos iniciado con éxito. Consulta los logs para detalles.',
      };
    } catch (error) {
      this.logger.error(
        `Error en notifyTwoDaysBefore: ${error.message}`,
        error.stack,
      );
      // Lanza una excepción HTTP para que NestJS la maneje y devuelva la respuesta adecuada
      // Usamos InternalServerErrorException como un fallback general.
      // Podrías usar BadGatewayException si es un problema con la API de WhatsApp, etc.
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message:
          'Ocurrió un error al intentar iniciar el proceso de notificación para 2 días o menos.',
        error: error.message, // Incluye el mensaje de error para depuración
      });
    }
  }

  @Get('notify-same-day')
  @HttpCode(HttpStatus.OK)
  async notifySameDay() {
    try {
      this.logger.log(
        'Recibida solicitud para notificar bookings del mismo día.',
      );
      await this.whatsappService.checkAndNotifySameDay();
      return {
        statusCode: HttpStatus.OK,
        message:
          'Proceso de notificación para el mismo día iniciado con éxito. Consulta los logs para detalles.',
      };
    } catch (error) {
      this.logger.error(
        `Error en notifySameDay: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message:
          'Ocurrió un error al intentar iniciar el proceso de notificación para el mismo día.',
        error: error.message,
      });
    }
  }

  // Si decides mantener un endpoint de "status", asegúrate de que sea informativo
  @Get('status') // Cambiado a POST si solo quieres que se dispare, no que se "obtenga" el estado.
  @HttpCode(HttpStatus.OK)
  getStatus(): { status: string; message: string } {
    return {
      status: 'OK',
      message: 'WhatsApp notification service endpoint is accessible.',
    };
  }
}
