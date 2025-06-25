import { Body, Controller, Post } from '@nestjs/common';
import { Get, Header, HttpException, HttpStatus, Res } from '@nestjs/common';
import { ContificoService } from './contifico.service';
import { Response } from 'express';

@Controller('contifico')
export class ContificoController {
  constructor(private readonly contificoService: ContificoService) {}
  @Get('documentos')
  @Header('Content-Type', 'application/json')
  async obtenerDocsContifico(@Res() res: Response): Promise<void> {
    try {
      const message = await this.contificoService.contificoDocuments();
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.getStatus()).send({ message: error.message });
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ message: 'Error interno del servidor' });
      }
    }
  }

  @Post('contifico/createCategory')
  @Header('Content-Type', 'application/json')
  async crearCategoriaContifico(
    @Body() body: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const message = await this.contificoService.createCategory(
        body.category,
        body.tipo,
      );
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      console.error('Error al crear categoría en Contifico:', error);
      if (error instanceof HttpException) {
        res.status(error.getStatus()).send({ message: error.message });
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ message: 'Error interno del servidor' });
      }
    }
  }

  @Post('contifico/createProdServ')
  @Header('Content-Type', 'application/json')
  async crearProdServContifico(
    @Body() body: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const message = await this.contificoService.createProductOrService(body);
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      console.error('Error al crear producto/servicio en Contifico:', error);
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
