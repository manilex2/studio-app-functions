// whatsapp.controller.ts
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  HttpException,
  Res,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { Response } from 'express';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name); // Agregamos un logger para el controlador

  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('notify-two-days-before')
  @HttpCode(HttpStatus.OK) // Se devuelve 200 OK si la operación de inicio fue exitosa
  async notifyTwoDaysBefore(@Res() res: Response) {
    try {
      this.logger.log(
        'Recibida solicitud para notificar bookings con 2 días o menos.',
      );
      const message = await this.whatsappService.checkAndNotifyTwoDaysBefore();
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error en notifyTwoDaysBefore: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        res.status(error.getStatus()).send({ message: error.message });
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ message: 'Error interno del servidor' });
      }
    }
  }

  @Get('notify-same-day')
  @HttpCode(HttpStatus.OK)
  async notifySameDay(@Res() res: Response) {
    try {
      this.logger.log(
        'Recibida solicitud para notificar bookings del mismo día.',
      );
      const message = await this.whatsappService.checkAndNotifySameDay();
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error en notifySameDay: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        res.status(error.getStatus()).send({ message: error.message });
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ message: 'Error interno del servidor' });
      }
    }
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  getStatus(@Res() res: Response) {
    res.status(HttpStatus.OK).send({
      message:
        'Endpoint de Servicio de Notificaciones de WhatsApp es accesible.',
    });
  }
}
