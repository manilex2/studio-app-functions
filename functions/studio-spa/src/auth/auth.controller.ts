import {
  Body,
  Controller,
  Delete,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService, Register } from './auth.service';
import { Request, Response } from 'express';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name); // Instanciar el logger

  constructor(private readonly authService: AuthService) {}

  @Put('change-password')
  @Header('Content-Type', 'application/json')
  async changePassword(@Req() req: Request, @Res() res: Response) {
    const { uid, clave, email } = req.body;

    try {
      this.logger.log(
        'Recibida solicitud para cambiar la contraseña del usuario.',
      );
      const message = await this.authService.changePassword(uid, clave, email);
      return res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error al cambiar la contraseña: ${error.message}`,
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
  @Post('signup')
  @Header('Content-Type', 'application/json')
  async singUp(@Body() body: Register, @Res() res: Response) {
    try {
      this.logger.log(
        'Recibida solicitud para registrar al usuario en la plataforma.',
      );
      await this.authService.singUp(body);
      return res.status(HttpStatus.CREATED).send({
        message:
          'Usuario creado exitosamente. Se le envió una contraseña provisional a su email.',
      });
    } catch (error) {
      this.logger.error(
        `Error al crear al usuario: ${error.message}`,
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

  @Post('reset-password')
  @Header('Content-Type', 'application/json')
  async resetPassword(@Res() res: Response, @Body('email') email: string) {
    try {
      this.logger.log(
        'Recibida solicitud para resetear la contraseña del usuario.',
      );
      await this.authService.resetPassword(email);
      return res.status(HttpStatus.OK).send({
        message: 'Se ha enviado un correo para restablecer la contraseña',
      });
    } catch (error) {
      this.logger.error(
        `Error al reestrablecer la contraseña: ${error.message}`,
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

  @Post('confirm-reset')
  @Header('Content-Type', 'application/json')
  async confirmReset(
    @Res() res: Response,
    @Body('email') email: string,
    @Body('token') token: string,
  ) {
    try {
      this.logger.log(
        'Recibida solicitud para confirmar el reseteo de la contraseña del usuario.',
      );
      await this.authService.confirmReset(email, token);
      return res.status(HttpStatus.OK).send({
        message:
          'La contraseña ha sido restablecida y enviada al correo electrónico',
      });
    } catch (error) {
      this.logger.error(
        `Error al confirmar el reestrablecimiento de la contraseña: ${error.message}`,
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

  @Delete('delete-account')
  @Header('Content-Type', 'application/json')
  async deleteAccount(@Res() res: Response, @Body('email') email: string) {
    try {
      this.logger.log(
        'Recibida solicitud para eliminar al usuario de la plataforma.',
      );
      await this.authService.deleteAccount(email);
      return res.status(HttpStatus.OK).json({
        message: 'La cuenta ha sido eliminada exitosamente.', // Mensaje corregido
      });
    } catch (error) {
      this.logger.error(
        `Error al eliminar al usuario: ${error.message}`,
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
}
