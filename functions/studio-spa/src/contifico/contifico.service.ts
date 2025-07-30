import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Filter, getFirestore, Timestamp } from 'firebase-admin/firestore';

// --- Interfaces para la estructura de Contifico ---
interface ContificoPersona {
  ruc?: string;
  cedula: string;
  razon_social: string;
  telefonos?: string;
  direccion?: string;
  tipo: 'N' | 'J' | 'I' | 'P'; // N:Natural, J:Juridica, I:SinId, P:Placa
  email?: string;
  es_extranjero?: boolean;
}

interface ContificoDocumentDetail {
  producto_id: string;
  cantidad: number;
  precio: number; // Precio unitario del producto en el detalle
  porcentaje_iva?: number; // 0, 12, null
  porcentaje_descuento: number;
  base_cero: number;
  base_gravable: number;
  base_no_gravable: number;
  porcentaje_ice?: number;
  valor_ice?: number;
}

interface ContificoCobro {
  forma_cobro: 'EF' | 'CQ' | 'TC' | 'TRA'; // Tipos de cobro
  monto: number;
  numero_cheque?: string; // Solo para CQ
  tipo_ping?: 'D' | 'M' | 'E' | 'P' | 'A'; // Solo para TC
}

// --- Interfaces para la entrada de tu NestJS ---
interface DocumentDetailDto {
  producto_id: string;
  cantidad: number;
  precio: number;
  porcentaje_iva?: number;
  porcentaje_descuento?: number; // Ahora opcional en la entrada DTO, por defecto 0
  base_cero?: number; // Calculados o proporcionados
  base_gravable?: number;
  base_no_gravable?: number;
  porcentaje_ice?: number;
  valor_ice?: number;
}

export interface CreateElectronicDocumentDto {
  pos: string; //Codigo POS del movimiento de inventario
  cliente_id_contifico: string; // El ID del cliente en Contifico
  tipo_documento: 'FAC' | 'NVT' | 'NCR' | 'NDA' | 'RET' | 'LQC'; // Tipos de documento
  documento_numero: string; // Número del documento (ej. 001-001-000000001)
  descripcion?: string;
  // Totales, ahora obligatorios en la entrada para el payload
  subtotal_0: number;
  subtotal_12: number;
  iva: number;
  ice: number;
  servicio?: number;
  total: number;
  adicional1?: string;
  adicional2?: string;
  detalles: DocumentDetailDto[];
  cobros: ContificoCobro[]; // Debe ser un array con al menos un cobro
  // El vendedor se manejará internamente si es necesario, o se puede agregar al DTO si lo pasas
  vendedor_id?: string; // Opcional, si tienes un ID de vendedor de Contifico
}

@Injectable()
export class ContificoService {
  constructor(private readonly configService: ConfigService) {}

  private readonly logger = new Logger(ContificoService.name);

  /**
   * Obtiene los datos de una persona (cliente/proveedor) de Contifico por su ID.
   * @param personaId El ID de la persona en Contifico.
   * @returns Los datos de la persona o null si no se encuentra.
   */
  async getPersonaById(personaId: string): Promise<ContificoPersona | null> {
    try {
      const response = await axios({
        method: 'GET',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/persona/${personaId}/`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
      });
      if (response.status === 200) {
        return response.data;
      }
      return null;
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        error.response &&
        error.response.status === 404
      ) {
        // La persona no fue encontrada
        return null;
      }
      this.logger.error(
        `Error al obtener persona con ID ${personaId}:`,
        error.message,
      );
      throw new HttpException(
        error.message || 'Error interno del servidor al obtener persona',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Convertir fecha de string DD/MM/YYYY a Date.
   * @param dateString Fecha a formatear
   */
  private convertToDate(dateString: string): Date {
    const [day, month, year] = dateString.split('/');
    return new Date(`${year}-${month}-${day}`);
  }

  /**
   * Obtener documentos de Contifico y guardarlos/actualizarlos en Firestore.
   */
  async contificoDocuments(): Promise<string> {
    const db = getFirestore();
    const batch = db.batch();

    try {
      const date = new Date();

      // Obtener la fecha en formato DD/MM/YYYY en zona horaria de Ecuador
      const ecuadorDateString = date.toLocaleDateString('en-GB', {
        timeZone: 'America/Guayaquil',
      });
      let docs = [];

      // Realizar la solicitud a la API de Contifico
      await axios({
        method: 'GET',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/registro/documento/?tipo_registro=CLI&fecha_emision=${ecuadorDateString}`,
        headers: {
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
      })
        .then((response) => {
          docs = response.data;
        })
        .catch((err) => {
          this.logger.error(err);
          throw new HttpException(
            'Error al obtener documentos de Contifico',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        });

      // Guardar o actualizar documentos en Firestore
      for (const doc of docs) {
        const productsList = [];
        const serviceList = [];
        let ventasGeneralesRef = null;
        let ventasGeneralesData = null;
        let ventasPorStoreRef = null;
        let ventasPorStoreData = null;
        let ventasPorAsesorRef = null;
        let ventasPorAsesorData = null;
        let ventasPorClienteRef = null;
        let ventasPorClienteData = null;
        let currentDocProductTotalValue = 0;
        let currentDocProductCount = 0;
        let currentDocServiceTotalValue = 0;
        let currentDocServiceCount = 0;
        let currentDocTotalValue = 0;
        let currentDocTotalTransactions = 0;
        const orderData = {
          idContifico: doc.id,
          orderDate:
            Timestamp.fromDate(this.convertToDate(doc.fecha_emision)) ?? null,
          urlRide: doc.url_ride || null,
          orderStatus:
            doc.estado == 'P'
              ? 'Pago_Pendiente'
              : doc.estado == 'C'
                ? 'Pago_Por_Validar'
                : doc.estado == 'G'
                  ? 'En_proceso'
                  : doc.estado == 'A'
                    ? 'Cancelado'
                    : doc.estado == 'E'
                      ? 'Enviado'
                      : 'Completado',
          subtotal: Number(doc.subtotal_12) ?? 0,
          tax: (Number(doc.subtotal_12 ?? 0) * Number(doc.iva ?? 1)) / 100 || 0,
          totalValue: Number(doc.total) ?? 0,
          paymentTransactionId:
            doc.cobros.length > 0
              ? String(doc.cobros[0].numero_comprobante)
              : null,
          paymentDate:
            doc.cobros.length > 0
              ? Timestamp.fromDate(this.convertToDate(doc.cobros[0].fecha))
              : null,
          paymentMethods:
            doc.cobros.length > 0
              ? doc.cobros[0].forma_cobro == 'TC'
                ? 'creditCard'
                : doc.cobros[0].forma_cobro == 'TRA'
                  ? 'bankTransfer'
                  : 'payInStore'
              : null,
          clientUserId: null,
        };

        const ventasGeneralesDocs = (
          await db
            .collection('monthlyStatistics')
            .where(
              Filter.and(
                Filter.where('year', '==', date.getFullYear()),
                Filter.where('month', '==', date.getMonth() + 1),
                Filter.where('storeRef', '==', null),
                Filter.where('asesorRef', '==', null),
                Filter.where('productRef', '==', null),
                Filter.where('serviceRef', '==', null),
                Filter.where('clientRef', '==', null),
              ),
            )
            .get()
        ).docs;

        if (ventasGeneralesDocs.length < 1) {
          ventasGeneralesRef = db.collection('monthlyStatistics').doc();
          ventasGeneralesData = {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            asesorRef: null,
            clientRef: null,
            storeRef: null,
            productRef: null,
            serviceRef: null,
            productTotalValue: 0,
            serviceTotalValue: 0,
            productCount: 0,
            serviceCount: 0,
            totalValue: 0,
            totalTransactions: 0,
            lastUpdate: Timestamp.fromDate(date),
          };
          batch.create(ventasGeneralesRef, ventasGeneralesData);
        } else {
          ventasGeneralesRef = ventasGeneralesDocs[0].ref;
          ventasGeneralesData = ventasGeneralesDocs[0].data();
        }

        this.logger.debug(`Pase ventasGeneralesDocs`);

        const separateStrings = doc.documento.split('-');
        const numeroEstablecimiento = separateStrings[0];

        const storeDocs = (
          await db
            .collection('locales')
            .where('numeroEstablecimiento', '==', numeroEstablecimiento)
            .limit(1)
            .get()
        ).docs;
        const storeRef = storeDocs.length > 0 ? storeDocs[0].ref : null;

        if (storeRef) {
          const ventasPorStoreDocs = (
            await db
              .collection('monthlyStatistics')
              .where(
                Filter.and(
                  Filter.where('year', '==', date.getFullYear()),
                  Filter.where('month', '==', date.getMonth() + 1),
                  Filter.where('storeRef', '==', storeRef),
                ),
              )
              .limit(1)
              .get()
          ).docs;

          if (ventasPorStoreDocs.length < 1) {
            ventasPorStoreRef = db.collection('monthlyStatistics').doc();
            ventasPorStoreData = {
              year: date.getFullYear(),
              month: date.getMonth() + 1,
              asesorRef: null,
              clientRef: null,
              storeRef: storeRef,
              productRef: null,
              serviceRef: null,
              productTotalValue: 0,
              serviceTotalValue: 0,
              productCount: 0,
              serviceCount: 0,
              totalValue: 0,
              totalTransactions: 0,
              lastUpdate: Timestamp.fromDate(date),
            };
            batch.create(ventasPorStoreRef, ventasPorStoreData);
          } else {
            ventasPorStoreRef = ventasPorStoreDocs[0].ref;
            ventasPorStoreData = ventasPorStoreDocs[0].data();
          }
        }

        this.logger.debug(`Pase ventasPorStoreDocs`);

        const asesorDocs = doc.vendedor
          ? (
              await db
                .collection('users')
                .where('cedula', '==', doc.vendedor.cedula)
                .limit(1)
                .get()
            ).docs
          : [];

        const asesorRef = asesorDocs.length > 0 ? asesorDocs[0].ref : null;

        if (asesorRef) {
          const ventasPorAsesorDocs = (
            await db
              .collection('monthlyStatistics')
              .where(
                Filter.and(
                  Filter.where('year', '==', date.getFullYear()),
                  Filter.where('month', '==', date.getMonth() + 1),
                  Filter.where('asesorRef', '==', asesorRef),
                ),
              )
              .limit(1)
              .get()
          ).docs;

          if (ventasPorAsesorDocs.length < 1) {
            ventasPorAsesorRef = db.collection('monthlyStatistics').doc();
            ventasPorAsesorData = {
              year: date.getFullYear(),
              month: date.getMonth() + 1,
              asesorRef: asesorRef,
              clientRef: null,
              storeRef: null,
              productRef: null,
              serviceRef: null,
              productTotalValue: 0,
              serviceTotalValue: 0,
              productCount: 0,
              serviceCount: 0,
              totalValue: 0,
              totalTransactions: 0,
              lastUpdate: Timestamp.fromDate(date),
            };
            batch.create(ventasPorAsesorRef, ventasPorAsesorData);
          } else {
            ventasPorAsesorRef = ventasPorAsesorDocs[0].ref;
            ventasPorAsesorData = ventasPorAsesorDocs[0].data();
          }
        }

        this.logger.debug(`Pase ventasPorAsesorDocs`);

        const clientDocs = (
          await db
            .collection('users')
            .where('cedula', '==', doc.persona.cedula)
            .limit(1)
            .get()
        ).docs;

        const clientRef = clientDocs.length > 0 ? clientDocs[0].ref : null;

        if (clientRef) {
          const ventasPorClienteDocs = (
            await db
              .collection('monthlyStatistics')
              .where(
                Filter.and(
                  Filter.where('year', '==', date.getFullYear()),
                  Filter.where('month', '==', date.getMonth() + 1),
                  Filter.where('clientRef', '==', clientRef),
                ),
              )
              .limit(1)
              .get()
          ).docs;

          if (ventasPorClienteDocs.length < 1) {
            ventasPorClienteRef = db.collection('monthlyStatistics').doc();
            ventasPorClienteData = {
              year: date.getFullYear(),
              month: date.getMonth() + 1,
              asesorRef: null,
              clientRef: clientRef,
              storeRef: null,
              productRef: null,
              serviceRef: null,
              productTotalValue: 0,
              serviceTotalValue: 0,
              productCount: 0,
              serviceCount: 0,
              totalValue: 0,
              totalTransactions: 0,
              lastUpdate: Timestamp.fromDate(date),
            };
            batch.create(ventasPorClienteRef, ventasPorClienteData);
          } else {
            ventasPorClienteRef = ventasPorClienteDocs[0].ref;
            ventasPorClienteData = ventasPorClienteDocs[0].data();
          }
        }

        this.logger.debug(`Pase ventasPorClienteDocs`);

        for (const detalle of doc.detalles) {
          const productDocs = (
            await db
              .collection('productos')
              .where('idContifico', '==', detalle.producto_id)
              .limit(1)
              .get()
          ).docs;
          const productRef = productDocs.length > 0 ? productDocs[0].ref : null;

          if (productRef) {
            const detailTotalPrice = detalle.precio * detalle.cantidad;
            productsList.push({
              productId: productRef,
              quantity: detalle.cantidad,
              totalPrice: detailTotalPrice,
            });

            currentDocProductTotalValue += detailTotalPrice;
            currentDocProductCount += detalle.cantidad;
            currentDocTotalValue += detailTotalPrice;
            currentDocTotalTransactions++;

            const ventasPorProductoDocs = await db
              .collection('monthlyStatistics')
              .where(
                Filter.and(
                  Filter.where('year', '==', date.getFullYear()),
                  Filter.where('month', '==', date.getMonth() + 1),
                  Filter.where('productRef', '==', productRef),
                ),
              )
              .limit(1)
              .get();

            if (ventasPorProductoDocs.empty) {
              const newDocRef = db.collection('monthlyStatistics').doc();
              batch.create(newDocRef, {
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                storeRef: null,
                asesorRef: null,
                productRef: productRef,
                serviceRef: null,
                clientRef: null,
                productTotalValue: detailTotalPrice,
                serviceTotalValue: 0,
                productCount: detalle.cantidad,
                serviceCount: 0,
                totalValue: detailTotalPrice,
                totalTransactions: 1,
                lastUpdate: Timestamp.fromDate(date),
              });
            } else {
              const ventasPorProductoDoc = ventasPorProductoDocs.docs[0];
              const ventasPorProductoData = ventasPorProductoDoc.data();

              batch.update(ventasPorProductoDoc.ref, {
                totalValue: ventasPorProductoData.totalValue + detailTotalPrice,
                productTotalValue:
                  ventasPorProductoData.productTotalValue + detailTotalPrice,
                productCount:
                  ventasPorProductoData.productCount + detalle.cantidad,
                totalTransactions: ventasPorProductoData.totalTransactions + 1,
                lastUpdate: Timestamp.fromDate(date),
              });
            }

            this.logger.debug(`Pase ventasPorProductoDocs`);

            continue;
          }

          const serviceDocs = (
            await db
              .collection('servicios')
              .where('idContifico', '==', detalle.producto_id)
              .limit(1)
              .get()
          ).docs;
          const serviceRef = serviceDocs.length > 0 ? serviceDocs[0].ref : null;

          if (serviceRef) {
            const detailTotalPrice = detalle.precio * detalle.cantidad;
            serviceList.push({
              serviceId: serviceRef,
              quantity: detalle.cantidad,
              totalPrice: detailTotalPrice,
            });

            // Acumular para las estadísticas generales del documento
            currentDocServiceTotalValue += detailTotalPrice;
            currentDocServiceCount += detalle.cantidad;
            currentDocTotalValue += detailTotalPrice;
            currentDocTotalTransactions++;

            const ventasPorServicioDocs = await db
              .collection('monthlyStatistics')
              .where(
                Filter.and(
                  Filter.where('year', '==', date.getFullYear()),
                  Filter.where('month', '==', date.getMonth() + 1),
                  Filter.where('serviceRef', '==', serviceRef),
                ),
              )
              .limit(1)
              .get();

            if (ventasPorServicioDocs.empty) {
              const newDocRef = db.collection('monthlyStatistics').doc();
              batch.create(newDocRef, {
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                storeRef: null,
                asesorRef: null,
                productRef: null,
                serviceRef: serviceRef,
                clientRef: null,
                productTotalValue: 0,
                serviceTotalValue: detailTotalPrice,
                productCount: 0,
                serviceCount: detalle.cantidad,
                totalValue: detailTotalPrice,
                totalTransactions: 1,
                lastUpdate: Timestamp.fromDate(date),
              });
            } else {
              const ventasPorServicioDoc = ventasPorServicioDocs.docs[0];
              const ventasPorServicioData = ventasPorServicioDoc.data();

              batch.update(ventasPorServicioDoc.ref, {
                totalValue: ventasPorServicioData.totalValue + detailTotalPrice,
                serviceTotalValue:
                  ventasPorServicioData.serviceTotalValue + detailTotalPrice,
                serviceCount:
                  ventasPorServicioData.serviceCount + detalle.cantidad,
                totalTransactions: ventasPorServicioData.totalTransactions + 1,
                lastUpdate: Timestamp.fromDate(date),
              });
            }

            this.logger.debug(`Pase ventasPorServicioDoc`);
          }
        }

        batch.update(ventasGeneralesRef, {
          totalValue: ventasGeneralesData.totalValue + currentDocTotalValue,
          productTotalValue:
            ventasGeneralesData.productTotalValue + currentDocProductTotalValue,
          productCount:
            ventasGeneralesData.productCount + currentDocProductCount,
          serviceTotalValue:
            ventasGeneralesData.serviceTotalValue + currentDocServiceTotalValue,
          serviceCount:
            ventasGeneralesData.serviceCount + currentDocServiceCount,
          totalTransactions:
            ventasGeneralesData.totalTransactions + currentDocTotalTransactions,
          lastUpdate: Timestamp.fromDate(date),
        });

        if (ventasPorStoreRef) {
          batch.update(ventasPorStoreRef, {
            totalValue: ventasPorStoreData.totalValue + currentDocTotalValue,
            productTotalValue:
              ventasPorStoreData.productTotalValue +
              currentDocProductTotalValue,
            productCount:
              ventasPorStoreData.productCount + currentDocProductCount,
            serviceTotalValue:
              ventasPorStoreData.serviceTotalValue +
              currentDocServiceTotalValue,
            serviceCount:
              ventasPorStoreData.serviceCount + currentDocServiceCount,
            totalTransactions:
              ventasPorStoreData.totalTransactions +
              currentDocTotalTransactions,
            lastUpdate: Timestamp.fromDate(date),
          });
        }

        if (ventasPorAsesorRef) {
          batch.update(ventasPorAsesorRef, {
            totalValue: ventasPorAsesorData.totalValue + currentDocTotalValue,
            productTotalValue:
              ventasPorAsesorData.productTotalValue +
              currentDocProductTotalValue,
            productCount:
              ventasPorAsesorData.productCount + currentDocProductCount,
            serviceTotalValue:
              ventasPorAsesorData.serviceTotalValue +
              currentDocServiceTotalValue,
            serviceCount:
              ventasPorAsesorData.serviceCount + currentDocServiceCount,
            totalTransactions:
              ventasPorAsesorData.totalTransactions +
              currentDocTotalTransactions,
            lastUpdate: Timestamp.fromDate(date),
          });
        }

        if (ventasPorClienteRef) {
          batch.update(ventasPorClienteRef, {
            totalValue: ventasPorClienteData.totalValue + currentDocTotalValue,
            productTotalValue:
              ventasPorClienteData.productTotalValue +
              currentDocProductTotalValue,
            productCount:
              ventasPorClienteData.productCount + currentDocProductCount,
            serviceTotalValue:
              ventasPorClienteData.serviceTotalValue +
              currentDocServiceTotalValue,
            serviceCount:
              ventasPorClienteData.serviceCount + currentDocServiceCount,
            totalTransactions:
              ventasPorClienteData.totalTransactions +
              currentDocTotalTransactions,
            lastUpdate: Timestamp.fromDate(date),
          });
        }

        const clienteDocs = (
          await db
            .collection('users')
            .where('cedula', '==', doc.persona.cedula)
            .limit(1)
            .get()
        ).docs;

        const clienteRef = clienteDocs.length > 0 ? clienteDocs[0].ref : null;

        const existOrder = (
          await db
            .collection('orders')
            .where('idContifico', '==', doc.id)
            .limit(1)
            .get()
        ).docs.map((document) => ({
          ref: document.ref,
        }));

        const existService = (
          await db
            .collection('serviciosFacturados')
            .where('idContifico', '==', doc.id)
            .limit(1)
            .get()
        ).docs.map((document) => ({
          ref: document.ref,
        }));

        if (existOrder.length > 0) {
          let newData = {
            ...orderData,
          };
          if (clienteRef) {
            newData = {
              ...newData,
              clientUserId: clienteRef,
            };
          }
          batch.update(existOrder[0].ref, newData);
        } else if (productsList.length > 0) {
          const lastOrder = (
            await db
              .collection('orders')
              .orderBy('orderDate', 'desc')
              .limit(1)
              .get()
          ).docs;
          let newData = {
            ...orderData,
            transferProofImage: null,
            transferValidationBy: null,
            transferValidationComments: null,
            shippingMethod: 'pickup',
            shippingAddress: null,
            shippingCost: 0,
            promoCode: null,
            internalNote: [],
            processedDate: null,
            readyForPickupDate: null,
            shippedDate: null,
            deliveryDate: null,
            completedDate: null,
            pickUpDate: null,
            productsList,
            orderNumber:
              lastOrder.length > 0 ? lastOrder[0].data().orderNumber + 1 : 1,
          };
          if (clienteRef) {
            newData = {
              ...newData,
              clientUserId: clienteRef,
            };
          }
          const newDocRef = db.collection('orders').doc();
          batch.create(newDocRef, newData);
        }

        if (existService.length > 0) {
          let newData = {
            ...orderData,
          };
          if (clienteRef) {
            newData = {
              ...newData,
              clientUserId: clienteRef,
            };
          }
          batch.update(existService[0].ref, newData);
        } else if (serviceList.length > 0) {
          let newData = {
            ...orderData,
            serviceList,
          };
          if (clienteRef) {
            newData = {
              ...newData,
              clientUserId: clienteRef,
            };
          }
          const newDocRef = db.collection('serviciosFacturados').doc();
          batch.create(newDocRef, newData);
        }
      }

      await batch.commit();

      return `${docs.length} documentos guardados o actualizados correctamente`;
    } catch (error) {
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Crear categoría en Contifico.
   * @param categoryName Nombre de la categoría a crear
   * @param tipoCategoría Tipo de categoría (PROD, SERV)
   */
  async createCategory(
    categoryName: string,
    tipoCategoria: 'PROD' | 'SERV',
  ): Promise<string> {
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/categoria/`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
        data: {
          nombre: categoryName,
          tipo_producto: tipoCategoria,
        },
      });
      return response.data.id;
    } catch (error) {
      console.log(error);
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Crear producto o servicio en Contifico.
   * @param proServData Datos del producto o servicio a crear
   */
  async createProductOrService(proServData: any): Promise<object> {
    try {
      if (!proServData.precio || proServData.precio <= 0) {
        throw new HttpException(
          'El precio debe ser mayor a 0 para registrar el producto/servicio',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!proServData.tipo) {
        throw new HttpException(
          'El tipo de producto/servicio es obligatorio para registrar el producto/servicio',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!proServData.categoria) {
        throw new HttpException(
          'La categoría del producto/servicio es obligatoria para registrar el producto/servicio',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (proServData.tipo !== 'PRO' && proServData.tipo !== 'SER') {
        throw new HttpException(
          'El tipo de producto/servicio debe ser "PRO" o "SER"',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (proServData.tipo === 'PRO' && !proServData.sku) {
        throw new HttpException(
          'El SKU del producto es obligatorio para registrar el producto',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        proServData.tipo === 'PRO' &&
        (!proServData.compra || proServData.compra <= 0)
      ) {
        throw new HttpException(
          'El precio de compra debe ser mayor a 0 para registrar el movimiento de inventario',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!proServData.nombre) {
        throw new HttpException(
          'El nombre del producto/servicio es obligatorio para registrar el producto/servicio',
          HttpStatus.BAD_REQUEST,
        );
      }

      const response = await axios({
        method: 'POST',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/producto/`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
        data: {
          tipo: proServData.tipo,
          nombre: proServData.nombre,
          descripcion: proServData.descripcion || '',
          categoria_id: proServData.categoria,
          minimo: 0,
          pvp1: proServData.precio,
          estado: proServData.estado ? 'A' : 'I',
          codigo: proServData.sku,
        },
      });

      if (response.status !== 201) {
        throw new HttpException(
          'Error al crear el producto/servicio',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      if (!proServData.stock || proServData.stock <= 0) {
        return { producto: response.data.id }; // Si no hay stock, no se registra movimiento de inventario
      }

      const response2 = await this.createInventoryMovement(
        'ING',
        [
          {
            id: response.data.id,
            cantidad: proServData.stock,
            precio: proServData.compra,
          },
        ],
        'Ingreso de Inventario',
      );
      // Si se crea el movimiento de inventario, retornamos el ID del producto/servicio
      return { producto: response.data.id, pos: response2 };
    } catch (error) {
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Crear movimiento de inventario en Contifico.
   *
   * @param tipo Tipo de movimiento (ING, EGR)
   * @param productDetails Array de objetos con el ID del producto/servicio, cantidad y precio.
   * @param descripcion Descripción del movimiento de inventario.
   */
  async createInventoryMovement(
    tipo: string,
    productDetails: Array<{
      id: string;
      cantidad: number;
      precio?: number;
    }>,
    descripcion: string,
  ): Promise<string> {
    try {
      if (tipo === 'ING') {
        for (const detail of productDetails) {
          // Verificamos si 'precio' es undefined o null
          if (detail.precio === undefined || detail.precio === null) {
            throw new HttpException(
              `El producto/servicio con ID ${detail.id} debe tener un precio para un movimiento de ingreso (ING).`,
              HttpStatus.BAD_REQUEST,
            );
          }
          // También puedes añadir una validación para asegurar que el precio sea mayor o igual a 0, si es necesario
          if (detail.precio <= 0) {
            throw new HttpException(
              `El precio del producto/servicio con ID ${detail.id} no puede ser negativo o 0.`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }
      const responseBodega = await axios({
        method: 'GET',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/bodega/`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
      });
      const bodegaId = responseBodega.data[0]?.id; // Usamos optional chaining por si no hay bodegas
      if (!bodegaId) {
        throw new HttpException(
          'No se encontró una bodega para registrar el movimiento de inventario',
          HttpStatus.BAD_REQUEST,
        );
      }

      const date = new Date();

      // Obtener la fecha en formato DD/MM/YYYY en zona horaria de Ecuador
      const ecuadorDateString = date.toLocaleDateString('en-GB', {
        timeZone: 'America/Guayaquil',
      });

      const detallesContifico = productDetails.map((detail) => {
        const detalle: {
          producto_id: string;
          cantidad: number;
          precio?: number;
        } = {
          producto_id: detail.id,
          cantidad: detail.cantidad,
        };
        if (detail.precio !== undefined) {
          // Puedes omitir '&& detail.precio !== null' si estás seguro de que null no vendrá o no importa
          detalle.precio = detail.precio;
        }
        return detalle;
      });
      const response = await axios({
        method: 'POST',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/movimiento-inventario/`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
        data: {
          tipo,
          bodega_id: bodegaId,
          detalles: detallesContifico,
          fecha: ecuadorDateString,
          descripcion: descripcion || `Movimiento de inventario`,
        },
      });
      if (response.status !== 201) {
        throw new HttpException(
          'Error al registrar el movimiento de inventario',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      return response.data.pos;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new HttpException(
          error.response.data.mensaje || 'Error al comunicarse con Contifico',
          error.response.status,
        );
      }
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Crear cliente en Contifico.
   * @param clientData Datos del cliente a crear
   */
  async createClient(clientData: any): Promise<string> {
    try {
      if (!clientData.cedula) {
        throw new HttpException(
          'La cédula del cliente es obligatoria para crear el cliente',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!clientData.razonSocial) {
        throw new HttpException(
          'La razón social del cliente es obligatoria para crear el cliente',
          HttpStatus.BAD_REQUEST,
        );
      }
      const response = await axios({
        method: 'POST',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/persona/?pos=${this.configService.get<string>('CONTIFICO_AUTH_TOKEN')}`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
        data: {
          tipo: 'N',
          razon_social: clientData.razonSocial,
          cedula: clientData.cedula,
          telefonos: clientData.telefono || null,
          email: clientData.email || null,
          direccion: clientData.direccion || null,
          es_cliente: clientData.esCliente || false,
          es_empleado: clientData.esEmpleado || false,
          es_vendedor: clientData.esVendedor || false,
          es_proveedor: false,
        },
      });
      return response.data.id;
    } catch (error) {
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Crea un documento electrónico en Contifico con la estructura completa requerida.
   * Asume que los cálculos de subtotal_0, subtotal_12, iva, ice y total vienen pre-calculados
   * en el DTO de entrada.
   * @param documentData Datos completos del documento electrónico a crear.
   * @returns El ID del documento creado en Contifico.
   */
  async createElectronicDocument(
    documentData: CreateElectronicDocumentDto,
  ): Promise<string> {
    try {
      // 1. Validaciones iniciales
      if (!documentData.pos) {
        throw new HttpException(
          'El pos del movimiento de inventario de Contifico es obligatorio.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!documentData.cliente_id_contifico) {
        throw new HttpException(
          'El ID del cliente de Contifico es obligatorio.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!documentData.tipo_documento) {
        throw new HttpException(
          'El tipo de documento es obligatorio (ej. FAC para factura).',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!documentData.documento_numero) {
        throw new HttpException(
          'El número de documento es obligatorio (ej. 001-001-000000001).',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Validar formato del número de documento
      const docNumberRegex = /^[0-9]{3}-[0-9]{3}-[0-9]{1,9}$/;
      if (!docNumberRegex.test(documentData.documento_numero)) {
        throw new HttpException(
          'El número de documento no cumple el formato requerido (ej. 001-001-000000001).',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!documentData.detalles || documentData.detalles.length === 0) {
        throw new HttpException(
          'El documento debe contener al menos un detalle de producto/servicio.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!documentData.cobros || documentData.cobros.length === 0) {
        throw new HttpException(
          'El documento debe contener al menos un cobro.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validar que los totales obligatorios estén presentes
      const requiredTotals = [
        'subtotal_0',
        'subtotal_12',
        'iva',
        'ice',
        'total',
      ];
      for (const field of requiredTotals) {
        if (documentData[field] === undefined || documentData[field] === null) {
          throw new HttpException(
            `El campo de total '${field}' es obligatorio.`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // 2. Obtener datos del cliente de Contifico
      const clienteContifico = await this.getPersonaById(
        documentData.cliente_id_contifico,
      );
      if (!clienteContifico) {
        throw new HttpException(
          `Cliente con ID ${documentData.cliente_id_contifico} no encontrado en Contifico.`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Opcional: Obtener datos del vendedor si se proporciona un ID
      let vendedorContifico: ContificoPersona | null = null;
      if (documentData.vendedor_id) {
        vendedorContifico = await this.getPersonaById(documentData.vendedor_id);
        if (!vendedorContifico) {
          this.logger.warn(
            `Vendedor con ID ${documentData.vendedor_id} no encontrado. El documento se creará sin información de vendedor.`,
          );
        }
      }

      // 3. Preparar los detalles para Contifico
      const detallesParaContifico: ContificoDocumentDetail[] =
        documentData.detalles.map((d) => ({
          producto_id: d.producto_id,
          cantidad: d.cantidad,
          precio: d.precio,
          porcentaje_iva: d.porcentaje_iva ?? null, // Usar null si es undefined
          porcentaje_descuento: d.porcentaje_descuento ?? 0, // Por defecto 0
          base_cero: d.base_cero ?? 0, // Asumimos 0 si no se proporciona
          base_gravable: d.base_gravable ?? d.precio * d.cantidad,
          base_no_gravable: d.base_no_gravable ?? 0, // Asumimos 0 si no se proporciona
          porcentaje_ice: d.porcentaje_ice ?? 0,
          valor_ice: d.valor_ice ?? 0,
        }));

      // 4. Preparar la fecha de emisión
      const fechaEmision = new Date().toLocaleDateString('en-GB', {
        timeZone: 'America/Guayaquil',
      }); // Formato DD/MM/YYYY

      // 5. Construir el payload completo para Contifico
      const payload = {
        pos: documentData.pos, // Token del POS del Movimiento de Inventario de Contifico
        fecha_emision: fechaEmision,
        tipo_documento: documentData.tipo_documento || 'FAC',
        documento: documentData.documento_numero,
        estado: 'C', // Siempre 'C' = Cobrado
        electronico: true,
        autorizacion: '', // Siempre en blanco para documentos electrónicos
        caja_id: null, // Ignorado según tu indicación
        cliente: {
          ruc: clienteContifico.ruc || clienteContifico.cedula, // Usar RUC si existe, sino cédula
          cedula: clienteContifico.cedula,
          razon_social: clienteContifico.razon_social,
          telefonos: clienteContifico.telefonos || null,
          direccion: clienteContifico.direccion || null,
          tipo: clienteContifico.tipo,
          email: clienteContifico.email || null,
          es_extranjero: clienteContifico.es_extranjero ?? false, // Por defecto false
        },
        vendedor: vendedorContifico
          ? {
              ruc: vendedorContifico.ruc || vendedorContifico.cedula,
              cedula: vendedorContifico.cedula,
              razon_social: vendedorContifico.razon_social,
              telefonos: vendedorContifico.telefonos || null,
              direccion: vendedorContifico.direccion || null,
              tipo: vendedorContifico.tipo,
              email: vendedorContifico.email || null,
              es_extranjero: vendedorContifico.es_extranjero ?? false,
            }
          : null, // Enviar null si no hay vendedor
        descripcion:
          documentData.descripcion ||
          `Documento ${documentData.tipo_documento} #${documentData.documento_numero}`,
        subtotal_0: documentData.subtotal_0,
        subtotal_12: documentData.subtotal_12,
        iva: documentData.iva,
        ice: documentData.ice || 0.0,
        servicio: documentData.servicio ?? 0.0, // Por defecto 0
        total: documentData.total,
        adicional1: documentData.adicional1 || '',
        adicional2: documentData.adicional2 || '',
        detalles: detallesParaContifico,
        cobros: documentData.cobros, // Array de cobros
      };

      // 6. Realizar la solicitud HTTP a la API de Contifico
      const response = await axios({
        method: 'POST',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/documento/`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
        data: payload,
      });

      // 7. Manejo de la respuesta
      if (response.status === 201) {
        return response.data.id; // Retorna el ID del documento creado
      } else {
        throw new HttpException(
          response.data.mensaje ||
            'Error al crear el documento electrónico en Contifico.',
          response.status,
        );
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        this.logger.error(
          'Error al crear documento electrónico en Contifico:',
          error.response.data,
        );
        throw new HttpException(
          error.response.data.mensaje ||
            error.response.data.error ||
            'Error al comunicarse con Contifico',
          error.response.status,
        );
      }
      this.logger.error(
        'Error inesperado al crear documento electrónico:',
        error.message,
      );
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
