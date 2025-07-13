import { Body, Controller, Logger, Post } from '@nestjs/common';
import { Get, Header, HttpException, HttpStatus, Res } from '@nestjs/common';
import { ContificoService } from './contifico.service';
import { Response } from 'express';

@Controller('contifico')
export class ContificoController {
  constructor(private readonly contificoService: ContificoService) {}

  private readonly logger = new Logger(ContificoController.name); // Agregamos un logger para el controlador

  @Get('documentos')
  @Header('Content-Type', 'application/json')
  async obtenerDocsContifico(@Res() res: Response): Promise<void> {
    try {
      this.logger.log(
        'Recibida solicitud para obtener los documentos de Contifico.',
      );
      const message = await this.contificoService.contificoDocuments();
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error al obtener los documentos de Contifico: ${error.message}`,
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

  @Post('createCategory')
  @Header('Content-Type', 'application/json')
  async crearCategoriaContifico(
    @Body() body: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(
        'Recibida solicitud para crear la categoría en Contifico.',
      );
      const message = await this.contificoService.createCategory(
        body.category,
        body.tipo,
      );
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error al crear categoría en Contifico: ${error.message}`,
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

  @Post('createProdServ')
  @Header('Content-Type', 'application/json')
  async crearProdServContifico(
    @Body() body: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(
        'Recibida solicitud para crear el producto/servicio en Contifico.',
      );
      const message = await this.contificoService.createProductOrService(body);
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error al crear producto/servicio en Contifico: ${error.message}`,
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

  @Post('createMovInv')
  @Header('Content-Type', 'application/json')
  async crearMovInventario(
    @Body() body: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(
        'Recibida solicitud para crear el movimiento de inventario en Contifico.',
      );
      const message = await this.contificoService.createInventoryMovement(
        body.tipo,
        body.productDetails,
        body.descripcion,
      );
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error al crear movimiento en el inventario en Contifico: ${error.message}`,
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

  @Post('createUser')
  @Header('Content-Type', 'application/json')
  async crearUsuarioContifico(
    @Body() body: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(
        'Recibida solicitud para crear el usuario dentro de Contifico.',
      );
      const message = await this.contificoService.createClient(body);
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error al crear usuario en Contifico: ${error.message}`,
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

  @Post('createDoc')
  @Header('Content-Type', 'application/json')
  async crearDocContifico(
    @Body() body: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(
        'Recibida solicitud para crear el documento en Contifico.',
      );
      const message =
        await this.contificoService.createElectronicDocument(body);
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      this.logger.error(
        `Error al crear el documento en Contifico: ${error.message}`,
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
