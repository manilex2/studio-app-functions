import { Injectable, BadRequestException } from '@nestjs/common';
import { DocumentReference, getFirestore } from 'firebase-admin/firestore';
import { read, utils } from 'xlsx';

@Injectable()
export class ExcelService {
  private db = getFirestore();

  // Definición de las reglas de validación basada en AtencionesRecord
  private validationRules = {
    fechaRegistro: { type: 'date', required: true },
    nombreServicio: { type: 'string', required: true, maxLength: 255 },
    notas: { type: 'string', required: false, maxLength: 1000 },
    notas2: { type: 'string', required: false, maxLength: 1000 },
    notas3: { type: 'string', required: false, maxLength: 1000 },
    notas4: { type: 'string', required: false, maxLength: 1000 },
    alergias: { type: 'string', required: false, maxLength: 500 },
    medicamentos: { type: 'string', required: false, maxLength: 500 },
    antecedentesPersonales: {
      type: 'string',
      required: false,
      maxLength: 1000,
    },
    antecedentesFamiliares: {
      type: 'string',
      required: false,
      maxLength: 1000,
    },
  };

  async processExcel(fileBuffer: Buffer): Promise<void> {
    const workbook = read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[2];

    if (!sheetName) {
      throw new BadRequestException(
        'La tercera hoja de cálculo no existe en el archivo proporcionado.',
      );
    }

    const worksheet = workbook.Sheets[sheetName];
    const jsonData: any[] = utils.sheet_to_json(worksheet, { header: 1 });

    if (jsonData.length === 0) {
      throw new BadRequestException('La hoja de cálculo está vacía.');
    }

    const headers = jsonData[0];
    const dataRows = jsonData.slice(1);
    const processingResults: {
      rowIndex: number;
      status: string;
      message?: string;
    }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const rowIndex = i + 2;
      const row = dataRows[i];
      const attentionData: any = {};
      let cedula: string | undefined;
      const rowErrors: string[] = [];

      if (
        row.every(
          (cell) =>
            cell === undefined || cell === null || String(cell).trim() === '',
        )
      ) {
        processingResults.push({
          rowIndex,
          status: 'skipped',
          message: 'Fila completamente vacía.',
        });
        continue;
      }

      headers.forEach((header: string, colIndex: number) => {
        const normalizedHeader = String(header).toLowerCase().trim();
        let value = row[colIndex];

        if (
          value === undefined ||
          value === null ||
          (typeof value === 'string' && value.trim() === '')
        ) {
          value = null;
        }

        if (normalizedHeader === 'cedula') {
          if (value !== null) {
            cedula = String(value).trim();
          } else {
            rowErrors.push('El campo "cédula" es obligatorio y está vacío.');
          }
        } else if (
          normalizedHeader !== 'nombres' &&
          normalizedHeader !== 'apellidos'
        ) {
          const validationRule = this.validationRules[header];
          if (validationRule) {
            // Pasamos el valor por referencia para que validateField lo pueda actualizar
            const validatedValue = value;
            const validationError = this.validateField(
              header,
              validatedValue,
              validationRule,
            );

            if (validationError) {
              rowErrors.push(validationError);
            } else {
              attentionData[header] = validatedValue;
            }
          } else {
            attentionData[header] = value;
          }
        }
      });

      if (rowErrors.length > 0) {
        processingResults.push({
          rowIndex,
          status: 'failed',
          message: `Errores de validación: ${rowErrors.join(', ')}`,
        });
        continue;
      }

      if (!cedula) {
        processingResults.push({
          rowIndex,
          status: 'failed',
          message: 'Cédula no proporcionada o inválida en la fila.',
        });
        continue;
      }

      let clientRef: DocumentReference | undefined;
      try {
        const usersRef = this.db.collection('users');
        const userQuery = await usersRef
          .where('cedula', '==', cedula)
          .limit(1)
          .get();

        if (userQuery.empty) {
          processingResults.push({
            rowIndex,
            status: 'failed',
            message: `Usuario con cédula ${cedula} no encontrado.`,
          });
          continue;
        }
        clientRef = userQuery.docs[0].ref;
      } catch (error: any) {
        processingResults.push({
          rowIndex,
          status: 'error',
          message: `Error al buscar usuario con cédula ${cedula}: ${error.message}`,
        });
        continue;
      }

      const finalAttentionData = {
        ...attentionData,
        clientRef: clientRef,
        createdAt: new Date(),
      };

      try {
        await this.db.collection('atenciones').add(finalAttentionData);
        processingResults.push({ rowIndex, status: 'success' });
      } catch (error: any) {
        processingResults.push({
          rowIndex,
          status: 'error',
          message: `Error al guardar atención: ${error.message}`,
        });
      }
    }

    const successCount = processingResults.filter(
      (r) => r.status === 'success',
    ).length;
    const failedCount = processingResults.filter(
      (r) => r.status === 'failed' || r.status === 'error',
    ).length;
    const skippedCount = processingResults.filter(
      (r) => r.status === 'skipped',
    ).length;
    const totalRows = dataRows.length;

    const reportMessage = `Procesamiento de hoja de cálculo completado: ${successCount} éxitos, ${failedCount} fallos, ${skippedCount} saltados de ${totalRows} filas.`;

    if (failedCount > 0) {
      console.error(
        reportMessage,
        processingResults.filter(
          (r) => r.status === 'failed' || r.status === 'error',
        ),
      );
      throw new BadRequestException({
        message: reportMessage,
        details: processingResults,
      });
    } else {
      console.log(reportMessage);
    }
  }

  private validateField(
    fieldName: string,
    value: any,
    rule: any,
  ): string | null {
    if (
      rule.required &&
      (value === null || value === undefined || String(value).trim() === '')
    ) {
      return `El campo "${fieldName}" es requerido.`;
    }
    if (
      !rule.required &&
      (value === null || value === undefined || String(value).trim() === '')
    ) {
      return null;
    }

    switch (rule.type) {
      case 'string':
        if (typeof value !== 'string') {
          value = String(value);
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          return `El campo "${fieldName}" excede la longitud máxima de ${rule.maxLength} caracteres.`;
        }
        break;
      case 'number':
        const numValue = Number(value);
        if (isNaN(numValue)) {
          return `El campo "${fieldName}" debe ser un número válido.`;
        }
        if (rule.min !== undefined && numValue < rule.min) {
          return `El campo "${fieldName}" debe ser mayor o igual a ${rule.min}.`;
        }
        if (rule.max !== undefined && numValue > rule.max) {
          return `El campo "${fieldName}" debe ser menor o igual a ${rule.max}.`;
        }
        if (rule.integer && !Number.isInteger(numValue)) {
          return `El campo "${fieldName}" debe ser un número entero.`;
        }
        value = numValue;
        break;
      case 'date':
        let dateValue: Date | null = null;
        if (typeof value === 'number') {
          dateValue = new Date(Math.round((value - 25569) * 86400 * 1000));
        } else if (typeof value === 'string') {
          dateValue = new Date(value);
        }

        if (!dateValue || isNaN(dateValue.getTime())) {
          return `El campo "${fieldName}" debe ser una fecha válida.`;
        }
        value = dateValue;
        break;
      case 'boolean':
        const lowerValue = String(value).toLowerCase().trim();
        if (!['true', 'false', '1', '0'].includes(lowerValue)) {
          return `El campo "${fieldName}" debe ser un valor booleano (verdadero/falso).`;
        }
        value = lowerValue === 'true' || lowerValue === '1';
        break;
    }
    return null;
  }
}
