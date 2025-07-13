/* eslint-disable max-len */
require("dotenv").config();
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});
// Construye la URL base de la función
const BASE_FUNCTION_URL = process.env.URL_FUNCTIONS;

// Programar la función para Contifico
exports.contificoDocs = onSchedule({
  timeZone: "America/Guayaquil",
  schedule: "0 19 * * *",
}, async () => {
  try {
    // Agrega la subruta específica a la URL base de tu función 'api'
    const targetUrl = `${BASE_FUNCTION_URL}/contifico/documentos`; // Nota la ausencia de la comilla final extra aquí.
    const response = await axios.get(targetUrl);
    console.log("Respuesta de la función Contifico documentos:", response.data);
  } catch (error) {
    console.error("Error al llamar a la función Contifico documentos:", error);
  }
});

// Programar la función para WhatsApp Pre-notificación
exports.whatsAppNotifPre = onSchedule({
  timeZone: "America/Guayaquil",
  schedule: "30 08 * * *",
}, async () => {
  try {
    // Agrega la subruta específica a la URL base de tu función 'api'
    const targetUrl = `${BASE_FUNCTION_URL}/whatsapp/notify-two-days-before`; // Nota la ausencia de la comilla final extra aquí.
    const response = await axios.get(targetUrl);
    console.log("Respuesta de la función WhatsApp pre-notificación:", response.data);
  } catch (error) {
    console.error("Error al llamar a la función WhatsApp pre-notificación:", error);
  }
});

// Programar la función para WhatsApp Notificación actual
exports.whatsAppNotifNow = onSchedule({
  timeZone: "America/Guayaquil",
  schedule: "30 08 * * *",
}, async () => {
  try {
    // Agrega la subruta específica a la URL base de tu función 'api'
    const targetUrl = `${BASE_FUNCTION_URL}/whatsapp/notify-same-day`;
    const response = await axios.get(targetUrl);
    console.log("Respuesta de la función WhatsApp notificación actual:", response.data);
  } catch (error) {
    console.error("Error al llamar a la función WhatsApp notificación actual:", error);
  }
});
