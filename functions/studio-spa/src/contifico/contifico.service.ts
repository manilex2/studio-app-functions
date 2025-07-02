import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Filter, getFirestore, Timestamp } from 'firebase-admin/firestore';

@Injectable()
export class ContificoService {
  constructor(private readonly configService: ConfigService) {}

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
          Authorization: this.configService.get<string>('CONTIFICO_AUTH_TOKEN'),
        },
      })
        .then((response) => {
          docs = response.data;
        })
        .catch((err) => {
          console.error(err);
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

        const asesorDocs = (
          await db
            .collection('users')
            .where('cedula', '==', doc.vendedor.cedula)
            .limit(1)
            .get()
        ).docs;

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

        const clientDocs = (
          await db
            .collection('users')
            .where('cedula', '==', doc.cliente.cedula)
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
            .where('cedula', '==', doc.cliente.cedula)
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
          Authorization: `Bearer ${this.configService.get<string>('CONTIFICO_AUTH_TOKEN')}`,
        },
        data: {
          nombre: categoryName,
          tipo_producto: tipoCategoria,
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
   * Crear producto o servicio en Contifico.
   * @param proServData Datos del producto o servicio a crear
   */
  async createProductOrService(proServData: any): Promise<string> {
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
      if (proServData.tipo !== 'PROD' && proServData.tipo !== 'SERV') {
        throw new HttpException(
          'El tipo de producto/servicio debe ser "PROD" o "SERV"',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (proServData.tipo === 'PROD' && !proServData.sku) {
        throw new HttpException(
          'El SKU del producto es obligatorio para registrar el producto',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        proServData.tipo === 'PROD' &&
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
          Authorization: `Bearer ${this.configService.get<string>('CONTIFICO_AUTH_TOKEN')}`,
        },
        data: {
          tipo: proServData.tipo,
          nombre: proServData.nombre,
          descripcion: proServData.descripcion || '',
          categoria_id: proServData.categoria,
          minimo: 1,
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
        return response.data.id; // Si no hay stock, no se registra movimiento de inventario
      }

      await this.createInventoryMovement(
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
      return response.data.id;
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
  ): Promise<void> {
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
          Authorization: `Bearer ${this.configService.get<string>('CONTIFICO_AUTH_TOKEN')}`,
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
          Authorization: `Bearer ${this.configService.get<string>('CONTIFICO_AUTH_TOKEN')}`,
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
      return;
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
      const response = await axios({
        method: 'POST',
        url: `${this.configService.get<string>('CONTIFICO_URI')}/persona/?pos=${this.configService.get<string>('CONTIFICO_AUTH_TOKEN')}`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.configService.get<string>('CONTIFICO_AUTH_TOKEN')}`,
        },
        data: {
          tipo: 'N',
          cedula: clientData.cedula,
          telefonos: clientData.telefono || null,
          email: clientData.email,
          direccion: clientData.direccion || null,
          razon_social: clientData.razonSocial,
          es_cliente: clientData.esCliente,
          es_empleado: clientData.esEmpleado,
          es_vendedor: clientData.esVendedor,
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
}
