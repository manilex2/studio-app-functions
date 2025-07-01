// index.js

// Importaciones de librerías
const { read, utils } = require('xlsx');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Para cargar variables de entorno desde .env

// --- Configuración de Firebase Admin SDK ---
// Para ejecutar esto localmente, necesitas las credenciales de tu proyecto Firebase.
// Opción 1: Archivo JSON de credenciales de servicio (RECOMENDADO para local)
// Descarga tu archivo de credenciales de servicio de Firebase (Project settings > Service accounts)
// Guarda el archivo JSON en la misma carpeta que este script (ej. serviceAccountKey.json)
// y descomenta la siguiente línea:
const serviceAccount = require('./serviceAccountKey-DrHairSalon.json'); //

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount), //
  // Si tu proyecto usa Realtime Database o Storage, también necesitarás la URL de la base de datos
  // databaseURL: "https://<DATABASE_NAME>.firebaseio.com"
});

// Opción 2: Usar variables de entorno (menos común para credenciales JSON completas)
// Si prefieres usar variables de entorno, tendrías que pasar cada parte del JSON
// como una variable de entorno y construir el objeto aquí.
// Pero la opción 1 es mucho más sencilla y segura para desarrollo local.

// --- Adaptación de tu ExcelService ---
class ExcelProcessor {
  constructor() {
    this.db = admin.firestore(); //
    this.validationRules = {
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
      // ... (añade otras reglas si las tenías en tu proyecto original)
    };
  }

  async processExcel(fileBuffer) {
    console.log('Iniciando procesamiento de Excel...');
    const workbook = read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[2]; // Tercera hoja (índice 2)

    if (!sheetName) {
      throw new Error('La tercera hoja de cálculo no existe en el archivo proporcionado.');
    }

    const worksheet = workbook.Sheets[sheetName];
    // { header: 1 } indica que la primera fila es el encabezado y devuelve un array de arrays
    const jsonData = utils.sheet_to_json(worksheet, { header: 1 });

    if (jsonData.length === 0) {
      throw new Error('La hoja de cálculo está vacía.');
    }

    const headers = jsonData[0]; // La primera fila son los encabezados
    const dataRows = jsonData.slice(1); // Las filas de datos comienzan desde la segunda fila
    const processingResults = [];

    for (let i = 0; i < dataRows.length; i++) {
      const rowIndex = i + 2; // +2 para coincidir con el número de fila real en Excel (1-based)
      const row = dataRows[i];
      const attentionData = {};
      let cedula;
      const rowErrors = [];

      // Saltar filas completamente vacías
      if (row.every(cell => cell === undefined || cell === null || String(cell).trim() === '')) {
        processingResults.push({
          rowIndex,
          status: 'skipped',
          message: 'Fila completamente vacía.',
        });
        continue;
      }

      headers.forEach((header, colIndex) => {
        const normalizedHeader = String(header).toLowerCase().trim();
        let value = row[colIndex];

        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
          value = null;
        }

        if (normalizedHeader === 'cedula') { // Asegúrate de que el encabezado en tu Excel sea 'cedula'
          if (value !== null) {
            cedula = String(value).trim();
          } else {
            rowErrors.push('El campo "cédula" es obligatorio y está vacío.');
          }
        } else if (normalizedHeader !== 'nombres' && normalizedHeader !== 'apellidos') {
          const validationRule = this.validationRules[header];
          if (validationRule) {
            // El validateField de tu código original pasaba por referencia, aquí lo manejamos devolviendo el valor
            const validationError = this.validateField(header, value, validationRule);

            if (validationError) {
              rowErrors.push(validationError);
            } else {
              // Si la validación modifica el valor (ej. fecha de número a objeto Date), lo asignamos
              attentionData[header] = this.formatValidatedValue(value, validationRule.type);
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

      let clientRef;
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
      } catch (error) {
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
        // Descomenta la siguiente línea para guardar en Firestore
        await this.db.collection('atenciones').add(finalAttentionData);
        console.log(`Fila ${rowIndex}: Procesado para cédula ${cedula}.`);
        processingResults.push({ rowIndex, status: 'success' });
      } catch (error) {
        processingResults.push({
          rowIndex,
          status: 'error',
          message: `Error al guardar atención: ${error.message}`,
        });
      }
    }

    const successCount = processingResults.filter((r) => r.status === 'success').length;
    const failedCount = processingResults.filter((r) => r.status === 'failed' || r.status === 'error').length;
    const skippedCount = processingResults.filter((r) => r.status === 'skipped').length;
    const totalRows = dataRows.length;

    const reportMessage = `Procesamiento de hoja de cálculo completado: ${successCount} éxitos, ${failedCount} fallos, ${skippedCount} saltados de ${totalRows} filas.`;

    if (failedCount > 0) {
      console.error(
        reportMessage,
        processingResults.filter((r) => r.status === 'failed' || r.status === 'error'),
      );
      throw new Error(JSON.stringify({ message: reportMessage, details: processingResults }));
    } else {
      console.log(reportMessage);
    }
  }

  // Helper para manejar la validación de campos, adaptado de tu código
  validateField(fieldName, value, rule) {
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
        break;
      case 'date':
        // xlsx puede devolver números para fechas (días desde 1900-01-01)
        let dateValue;
        if (typeof value === 'number') {
          dateValue = new Date(Math.round((value - 25569) * 86400 * 1000));
        } else if (typeof value === 'string') {
          dateValue = new Date(value);
        } else if (value instanceof Date) {
          dateValue = value;
        }

        if (!dateValue || isNaN(dateValue.getTime())) {
          return `El campo "${fieldName}" debe ser una fecha válida.`;
        }
        // No se asigna 'value = dateValue' aquí porque solo devuelve el error, no muta 'value'
        break;
      case 'boolean':
        const lowerValue = String(value).toLowerCase().trim();
        if (!['true', 'false', '1', '0'].includes(lowerValue)) {
          return `El campo "${fieldName}" debe ser un valor booleano (verdadero/falso).`;
        }
        break;
    }
    return null;
  }

  // Función para formatear el valor validado (especialmente para fechas)
  formatValidatedValue(value, type) {
    if (type === 'date') {
      if (typeof value === 'number') {
        return new Date(Math.round((value - 25569) * 86400 * 1000));
      } else if (typeof value === 'string') {
        return new Date(value);
      }
    }
    return value;
  }
}

// --- Lógica principal para ejecutar el script ---
async function run() {
  const excelProcessor = new ExcelProcessor();
  const filePath = path.join(__dirname, 'pacientes_15may2025.xlsx'); // Cambia al nombre de tu archivo

  try {
    console.log(`Intentando leer el archivo: ${filePath}`);
    const fileBuffer = fs.readFileSync(filePath);
    console.log(`Archivo ${filePath} leído exitosamente. Tamaño: ${fileBuffer.length} bytes.`);
    await excelProcessor.processExcel(fileBuffer);
    console.log('Procesamiento de Excel finalizado con éxito.');
  } catch (error) {
    console.error('Error durante la ejecución del script:', error.message);
    if (error.details) {
      console.error('Detalles del error:', error.details);
    }
  }
}

run();