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
        let totalProductValue = 0;
        let totalServiceValue = 0;
        let totalClienteValue = 0;
        let totalAsesorValue = 0;
        let totalStoreValue = 0;
        let totalGeneralValue = 0;
        let totalProducts = 0;
        let totalServices = 0;
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

        for (const detalle of doc.detalles) {
          const product = await db
            .collection('productos')
            .where('idContifico', '==', detalle.producto_id)
            .get();

          if (!product.empty) {
            productsList.push({
              productId: product.docs[0].ref,
              quantity: detalle.cantidad,
              totalPrice: detalle.precio * detalle.cantidad,
            });
            totalProductValue += detalle.precio * detalle.cantidad;
            totalProducts += detalle.cantidad;
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

            totalServiceValue += detalle.precio * detalle.cantidad;
            totalServices += detalle.cantidad;
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

      const ventasGenerales = await db
        .collection('monthlyStatistics')
        .where(
          Filter.and(
            Filter.where('year', '==', date.getFullYear()),
            Filter.where('month', '==', date.getMonth() + 1),
          ),
        )
        .get();

      const ventasPorStore = await db
        .collection('monthlyStatistics')
        .where(
          Filter.and(
            Filter.where('year', '==', date.getFullYear()),
            Filter.where('month', '==', date.getMonth() + 1),
            Filter.where('storeRef', '==', null),
          ),
        )
        .get();

      const ventasPorAsesor = await db
        .collection('monthlyStatistics')
        .where(
          Filter.and(
            Filter.where('year', '==', date.getFullYear()),
            Filter.where('month', '==', date.getMonth() + 1),
            Filter.where('asesorRef', '==', null),
          ),
        )
        .get();

      const ventasPorProducto = await db
        .collection('monthlyStatistics')
        .where(
          Filter.and(
            Filter.where('year', '==', date.getFullYear()),
            Filter.where('month', '==', date.getMonth() + 1),
            Filter.where('productRef', '==', null),
          ),
        )
        .get();

      const ventasPorServicio = await db
        .collection('monthlyStatistics')
        .where(
          Filter.and(
            Filter.where('year', '==', date.getFullYear()),
            Filter.where('month', '==', date.getMonth() + 1),
            Filter.where('productRef', '==', null),
          ),
        )
        .get();

      const ventasPorCliente = await db
        .collection('monthlyStatistics')
        .where(
          Filter.and(
            Filter.where('year', '==', date.getFullYear()),
            Filter.where('month', '==', date.getMonth() + 1),
            Filter.where('asesorRef', '==', null),
          ),
        )
        .get();

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
