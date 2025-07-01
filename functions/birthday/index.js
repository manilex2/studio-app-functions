// index.js (o un nuevo archivo, por ejemplo, 'birthdayUpdater.js')

// Asegúrate de que admin.initializeApp() ya ha sido llamado antes de ejecutar esta función.
// Si esta función va en un archivo separado, necesitarás importar 'admin' y asegurarte
// de que el SDK de Firebase ya esté inicializado.
const admin = require('firebase-admin'); // Si no está ya importado en este archivo.
const serviceAccount = require('./serviceAccountKey-DrHairSalon.json'); //

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount), //
  // Si tu proyecto usa Realtime Database o Storage, también necesitarás la URL de la base de datos
  // databaseURL: "https://<DATABASE_NAME>.firebaseio.com"
});

// --- Función para actualizar el campo birthday ---
async function updateBirthdayToMidnight() {
  const db = admin.firestore();
  const usersRef = db.collection('users');
  let batch = db.batch();
  let updatesCount = 0;
  let batchOperations = 0;

  console.log('Iniciando el proceso de actualización de cumpleaños a 12 AM...');

  try {
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
      console.log('No se encontraron usuarios en la colección "users".');
      return;
    }

    for (const doc of snapshot.docs) {
      const userData = doc.data();
      // Verifica si el campo 'birthday' existe y es un tipo de dato que se pueda convertir a fecha
      if (userData.birthday && (userData.birthday instanceof admin.firestore.Timestamp || userData.birthday instanceof Date)) {
        let currentBirthday;

        // Convierte el Timestamp de Firestore a un objeto Date de JS
        if (userData.birthday instanceof admin.firestore.Timestamp) {
          currentBirthday = userData.birthday.toDate();
        } else { // Si ya es un objeto Date
          currentBirthday = userData.birthday;
        }
        
        // Crear una nueva fecha con la misma fecha pero hora 00:00:00
        const newBirthday = new Date(
          currentBirthday.getFullYear(),
          currentBirthday.getMonth(),
          currentBirthday.getDate(),
          0, // Horas
          0, // Minutos
          0, // Segundos
          0  // Milisegundos
        );
        
        // Compara si la fecha y hora ya son 12 AM para evitar escrituras innecesarias
        // La comparación se hace en milisegundos para ser precisa.
        if (currentBirthday.getTime() !== newBirthday.getTime()) {
          batch.update(doc.ref, { birthday: newBirthday });
          updatesCount++;
          batchOperations++;

          // Límite de 500 operaciones por lote
          if (batchOperations === 500) {
            console.log(`Ejecutando lote de ${batchOperations} actualizaciones...`);
            await batch.commit();
            batchOperations = 0; // Reiniciar contador de operaciones del lote
            // Crear un nuevo lote para las siguientes operaciones
            batch = db.batch(); // Reasignar un nuevo lote
          }
        }
      }
    }

    // Ejecutar cualquier operación restante en el lote final
    if (batchOperations > 0) {
      console.log(`Ejecutando lote final de ${batchOperations} actualizaciones...`);
      await batch.commit();
    }

    console.log(`Proceso completado. Se actualizaron ${updatesCount} documentos.`);
  } catch (error) {
    console.error('Error al actualizar los cumpleaños:', error);
    throw new Error(`Fallo en la actualización de cumpleaños: ${error.message}`);
  }
}

async function run() {
  // Llama a la nueva función de actualización
  try {
    await updateBirthdayToMidnight();
    console.log('Actualización de cumpleaños completada.');
  } catch (error) {
    console.error('Error durante la actualización de cumpleaños:', error.message);
  }
}

run();