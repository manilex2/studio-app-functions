import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

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
          paymentTransactionId: doc.cobros[0].numero_comprobante || null,
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

        const existOrder = (
          await db.collection('orders').where('idContifico', '==', doc.id).get()
        ).docs.map((document) => ({
          ref: document.ref,
        }));

        const existService = (
          await db
            .collection('servicios')
            .where('idContifico', '==', doc.id)
            .get()
        ).docs.map((document) => ({
          ref: document.ref,
        }));

        const cliente = (
          await db
            .collection('users')
            .where('cedula', '==', doc.cliente.cedula)
            .get()
        ).docs.map((contact) => {
          return contact;
        });

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
        } else if (existService.length > 0) {
        } else {
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
            productList: [],
            orderNumber: 0,
          };
          const newDocRef = db.collection('orders').doc();
          if (cliente.length > 0) {
            newData = {
              ...newData,
              clientUserId: cliente[0].ref,
            };
          }
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
