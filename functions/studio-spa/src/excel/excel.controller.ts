import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ExcelService } from './excel.service';
import { File as MulterFile } from 'multer';

@Controller('excel')
export class ExcelController {
  constructor(private readonly excelService: ExcelService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException('No se ha subido ningún archivo.');
    }
    // Asegúrate de que solo permites archivos CSV o Excel si es necesario
    // if (file.mimetype !== 'text/csv' && file.mimetype !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    //   throw new BadRequestException('Solo se permiten archivos CSV o Excel.');
    // }

    try {
      await this.excelService.processExcel(file.buffer); // Pasamos el buffer del archivo
      return { message: 'Hoja de cálculo procesada exitosamente.' };
    } catch (error) {
      console.error('Error al procesar la hoja de cálculo:', error);
      throw new BadRequestException(
        'Error al procesar la hoja de cálculo: ' + error.message,
      );
    }
  }
}
