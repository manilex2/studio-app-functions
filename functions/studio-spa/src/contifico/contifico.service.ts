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
        url: `${this.configService.get<string>('CONTIFICO_URI_DOCUMENT')}?tipo_registro=CLI&fecha_emision=${ecuadorDateString}`,
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
        const totalClienteValue = 0;
        const totalAsesorValue = 0;
        const totalStoreValue = 0;
        const totalGeneralValue = 0;
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
            String(doc.cobros[0].numero_comprobante) || null,
          paymentDate:
            Timestamp.fromDate(this.convertToDate(doc.cobros[0].fecha)) ?? null,
          paymentMethods:
            doc.cobros[0].forma_cobro == 'TC'
              ? 'creditCard'
              : doc.cobros[0].forma_cobro == 'TRA'
                ? 'bankTransfer'
                : 'payInStore',
          clientUserId: null,
        };

        const ventasGenerales = await db
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
          .get();

        const separateStrings = doc.documento.split('-');
        const numeroEstablecimiento = separateStrings[0];

        const storeRef = (
          await db
            .collection('locales')
            .where('numeroEstablecimiento', '==', numeroEstablecimiento)
            .get()
        ).docs.map((store) => {
          return store.ref;
        });

        const ventasPorStore = await db
          .collection('monthlyStatistics')
          .where(
            Filter.and(
              Filter.where('year', '==', date.getFullYear()),
              Filter.where('month', '==', date.getMonth() + 1),
              Filter.where('storeRef', '==', storeRef[0]),
            ),
          )
          .get();

        const asesorRef = (
          await db
            .collection('users')
            .where('cedula', '==', doc.vendedor.cedula)
            .get()
        ).docs.map((asesor) => {
          return asesor.ref;
        });

        const ventasPorAsesor = await db
          .collection('monthlyStatistics')
          .where(
            Filter.and(
              Filter.where('year', '==', date.getFullYear()),
              Filter.where('month', '==', date.getMonth() + 1),
              Filter.where('asesorRef', '==', asesorRef[0]),
            ),
          )
          .get();

        const clientRef = (
          await db
            .collection('users')
            .where('cedula', '==', doc.cliente.cedula)
            .get()
        ).docs.map((cliente) => {
          return cliente.ref;
        });

        const ventasPorCliente = await db
          .collection('monthlyStatistics')
          .where(
            Filter.and(
              Filter.where('year', '==', date.getFullYear()),
              Filter.where('month', '==', date.getMonth() + 1),
              Filter.where('clientRef', '==', clientRef[0]),
            ),
          )
          .get();

        for (const detalle of doc.detalles) {
          const productRef = (
            await db
              .collection('productos')
              .where('idContifico', '==', detalle.producto_id)
              .get()
          ).docs.map((product) => {
            return product.ref;
          });

          if (productRef.length > 0) {
            productsList.push({
              productId: productRef[0],
              quantity: detalle.cantidad,
              totalPrice: detalle.precio * detalle.cantidad,
            });

            const ventasPorProducto = await db
              .collection('monthlyStatistics')
              .where(
                Filter.and(
                  Filter.where('year', '==', date.getFullYear()),
                  Filter.where('month', '==', date.getMonth() + 1),
                  Filter.where('productRef', '==', productRef[0]),
                ),
              )
              .get();

            if (ventasPorProducto.empty) {
              const newDocRef = db.collection('monthlyStatistics').doc();
              batch.create(newDocRef, {
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                storeRef: storeRef[0] || null,
                asesorRef: asesorRef[0] || null,
                productRef: productRef[0],
                serviceRef: null,
                clientRef: clientRef[0] || null,
                productTotalValue: detalle.precio * detalle.cantidad,
                serviceTotalValue: 0,
                productCount: detalle.cantidad,
                serviceCount: 0,
                totalValue: detalle.precio * detalle.cantidad,
                totalTransactions: 1,
                lastUpdate: Timestamp.fromDate(date),
              });
            } else {
              const ventasPorProductoDoc = ventasPorProducto.docs[0];
              const ventasPorProductoData = ventasPorProductoDoc.data();

              batch.update(ventasPorProductoDoc.ref, {
                totalValue:
                  ventasPorProductoData.totalValue +
                  detalle.precio * detalle.cantidad,
                productTotalValue:
                  ventasPorProductoData.totalProducts +
                  detalle.precio * detalle.cantidad,
                productCount:
                  ventasPorProductoData.productCount + detalle.cantidad,
                totalTransactions: ventasPorProductoData.totalTransactions + 1,
                lastUpdate: Timestamp.fromDate(date),
              });
            }

            continue;
          }

          const service = await db
            .collection('servicios')
            .where('idContifico', '==', detalle.producto_id)
            .get();

          if (!service.empty) {
            serviceList.push({
              serviceId: service.docs[0].ref,
              quantity: detalle.cantidad,
              totalPrice: detalle.precio * detalle.cantidad,
            });

            const ventasPorServicio = await db
              .collection('monthlyStatistics')
              .where(
                Filter.and(
                  Filter.where('year', '==', date.getFullYear()),
                  Filter.where('month', '==', date.getMonth() + 1),
                  Filter.where('serviceRef', '==', service.docs[0].ref),
                ),
              )
              .get();
          }
        }

        const cliente = (
          await db
            .collection('users')
            .where('cedula', '==', doc.cliente.cedula)
            .get()
        ).docs.map((contact) => {
          return contact;
        });

        const existOrder = (
          await db.collection('orders').where('idContifico', '==', doc.id).get()
        ).docs.map((document) => ({
          ref: document.ref,
        }));

        const existService = (
          await db
            .collection('serviciosFacturados')
            .where('idContifico', '==', doc.id)
            .get()
        ).docs.map((document) => ({
          ref: document.ref,
        }));

        if (existOrder.length > 0) {
          let newData = {
            ...orderData,
          };
          if (cliente && cliente.length > 0) {
            newData = {
              ...newData,
              clientUserId: cliente[0].ref,
            };
          }
          batch.update(existOrder[0].ref, newData);
        } else if (productsList.length > 0) {
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
            orderNumber: 0,
          };
          if (cliente && cliente.length > 0) {
            newData = {
              ...newData,
              clientUserId: cliente[0].ref,
            };
          }
          const newDocRef = db.collection('orders').doc();
          batch.create(newDocRef, newData);
        }

        if (existService.length > 0) {
          let newData = {
            ...orderData,
          };
          if (cliente && cliente.length > 0) {
            newData = {
              ...newData,
              clientUserId: cliente[0].ref,
            };
          }
          batch.update(existOrder[0].ref, newData);
        } else if (serviceList.length > 0) {
          let newData = {
            ...orderData,
            serviceList,
          };
          if (cliente && cliente.length > 0) {
            newData = {
              ...newData,
              clientUserId: cliente[0].ref,
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
}
