// Asegúrate de que admin.initializeApp() ya ha sido llamado antes de ejecutar esta función.
// Si esta función va en un archivo separado, necesitarás importar 'admin' y asegurarte
// de que el SDK de Firebase ya esté inicializado.
require('dotenv').config(); // Asegúrate de que dotenv esté instalado y configurado correctamente.
const admin = require('firebase-admin'); // Si no está ya importado en este archivo.
const serviceAccount = require('./serviceAccountKey-DrHairSalon.json'); //
const axios = require('axios'); // Asegúrate de que axios esté instalado y configurado correctamente.
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// --- Función para actualizar todos los datos de categorías, productos, servicios y usuarios en Contifico ---
async function updateContificoSync() {
  const db = admin.firestore();
  const usersRef = db.collection('users');
  const categoriesServicesRef = db.collection('categories');
  const categoriesProductsRef = db.collection('categoriesProducts');
  const serviciosRef = db.collection('servicios');
  const productosRef = db.collection('productos');
  let batch = db.batch();
  let updatesCount = 0;
  let batchOperations = 0;

  console.log('Iniciando el proceso de actualización de Contifico3...');

  try {
    const usuarios = await usersRef.get();

    if (usuarios.empty) {
      console.log('No se encontraron usuarios en la colección "users".');
    }

    for (const usuario of usuarios.docs) {
      const userData = usuario.data();
      if (userData && !userData.cedula && !userData.rolName == "Cliente") {
        batch.set(usuario.ref, {
          regCompRRSS: false
        }, { merge: true });
        batchOperations++;
        updatesCount++;
      } else {
        batch.set(usuario.ref, {
          regCompRRSS: true
        }, { merge: true });
        batchOperations++;
        updatesCount++;
      }
      // Límite de 500 operaciones por lote
      if (batchOperations === 500) {
        console.log(`Ejecutando lote de ${batchOperations} actualizaciones...`);
        await batch.commit();
        batchOperations = 0; // Reiniciar contador de operaciones del lote
        // Crear un nuevo lote para las siguientes operaciones
        batch = db.batch(); // Reasignar un nuevo lote
      }
      if (!userData.idContifico) {
        try {
          const data = {
            tipo: 'N',
            razon_social: userData.display_name,
            cedula: userData.cedula,
            telefonos: userData.telefono || null,
            email: userData.email || null,
            direccion: userData.direccion || null,
            es_cliente: true,
            es_empleado: userData.rolName != "Cliente" && userData.rolName != "Asesor" ? true : false,
            es_vendedor: userData.rolName == "Asesor" ? true : false,
            es_proveedor: false,
          }

          console.log(`Data de persona: ${JSON.stringify(data)}`);
          const response = await axios({
            method: 'POST',
            url: `${process.env.CONTIFICO_URI}/persona/?pos=${process.env.CONTIFICO_AUTH_TOKEN}`,
            headers: {
              'Content-Type': 'application/json',
              Authorization: process.env.CONTIFICO_API_KEY,
            },
            data: data,
          });
          batch.set(usuario.ref, {idContifico: response.data.id}, { merge: true });
          batchOperations++;
          updatesCount++;
        } catch (error) {
          console.error(`Error al crear el usuario en Contifico para ${userData.display_name}:`, error);
          if (error.response && error.response.data && error.response.data.id) {
            batch.set(usuario.ref, {idContifico: error.response.data.id}, { merge: true });
            batchOperations++;
            updatesCount++;
          }
        }
      }
      // Límite de 500 operaciones por lote
      if (batchOperations === 500) {
        console.log(`Ejecutando lote de ${batchOperations} actualizaciones...`);
        await batch.commit();
        batchOperations = 0; // Reiniciar contador de operaciones del lote
        // Crear un nuevo lote para las siguientes operaciones
        batch = db.batch(); // Reasignar un nuevo lote
      }
    }

    const categoriasServ = await categoriesServicesRef.get();

    if (categoriasServ.empty) {
      console.log('No se encontraron categorías de servicios en la colección "categories".');
    }

    for (const categoria of categoriasServ.docs) {
      const categoryData = categoria.data();
      if (!categoryData.idContifico) {
        const data = {
          nombre: categoryData.Categoria,
          tipo_producto: "SERV",
        }

        console.log(`Data de categoria de servicio: ${JSON.stringify(data)}`);
        try {
          const response = await axios({
            method: 'POST',
            url: `${process.env.CONTIFICO_URI}/categoria/`,
            headers: {
              'Content-Type': 'application/json',
              Authorization: process.env.CONTIFICO_API_KEY,
            },
            data: data,
          });
          batch.set(categoria.ref, {idContifico: response.data.id}, { merge: true });
          batchOperations++;
          updatesCount++;
        } catch (error) {
          console.error(`Error al crear la categoría de servicio en Contifico para ${categoryData.Categoria}:`, error);
          if (error.response && error.response.data && error.response.data.id) {
            batch.set(categoria.ref, {idContifico: error.response.data.id}, { merge: true });
            batchOperations++;
            updatesCount++;
          }
        }
      }
      // Límite de 500 operaciones por lote
      if (batchOperations === 500) {
        console.log(`Ejecutando lote de ${batchOperations} actualizaciones...`);
        await batch.commit();
        batchOperations = 0; // Reiniciar contador de operaciones del lote
        // Crear un nuevo lote para las siguientes operaciones
        batch = db.batch(); // Reasignar un nuevo lote
      }
    }

    const categoriasProd = await categoriesProductsRef.get();

    if (categoriasProd.empty) {
      console.log('No se encontraron categorías de productos en la colección "categoriesProducts".');
    }

    for (const categoria of categoriasProd.docs) {
      const categoryData = categoria.data();
      if (!categoryData.idContifico) {
        const data = {
          nombre: categoryData.categoryName,
          tipo_producto: "PROD",
        }

        console.log(`Data de categoria de producto: ${JSON.stringify(data)}`);
        try {
          const response = await axios({
            method: 'POST',
            url: `${process.env.CONTIFICO_URI}/categoria/`,
            headers: {
              'Content-Type': 'application/json',
              Authorization: process.env.CONTIFICO_API_KEY,
            },
            data: {
              nombre: categoryData.categoryName,
              tipo_producto: "PROD",
            },
          });
          batch.set(categoria.ref, {idContifico: response.data.id}, { merge: true });
          batchOperations++;
          updatesCount++;
        } catch (error) {
          console.error(`Error al crear la categoría de producto en Contifico para ${categoryData.categoryName}:`, error);
          if (error.response && error.response.data && error.response.data.id) {
            batch.set(categoria.ref, {idContifico: error.response.data.id}, { merge: true });
            batchOperations++;
            updatesCount++;
          }
        }
      }
      // Límite de 500 operaciones por lote
      if (batchOperations === 500) {
        console.log(`Ejecutando lote de ${batchOperations} actualizaciones...`);
        await batch.commit();
        batchOperations = 0; // Reiniciar contador de operaciones del lote
        // Crear un nuevo lote para las siguientes operaciones
        batch = db.batch(); // Reasignar un nuevo lote
      }
    }

    const services = await serviciosRef.get();

    if (services.empty) {
      console.log('No se encontraron servicios en la colección "servicios".');
    }

    for (const servicio of services.docs) {
      const serviceData = servicio.data();
      let categoria;
      if (serviceData.RefCategoria && serviceData.RefCategoria.id) {
        categoria = await categoriesServicesRef.doc(serviceData.RefCategoria.id).get();
      }
      if (!serviceData.idContifico) {
        const data = {
          tipo: 'SER',
          nombre: serviceData.nombre,
          descripcion: serviceData.descripcion || '',
          categoria_id: categoria.data()? categoria.data().idContifico : null,
          minimo: 0,
          pvp1: serviceData.precio,
          estado: 'A',
          codigo: serviceData.sku,
        }

        console.log(`Data de servicio: ${JSON.stringify(data)}`);
        try {
          const response = await axios({
            method: 'POST',
            url: `${process.env.CONTIFICO_URI}/producto/`,
            headers: {
              'Content-Type': 'application/json',
              Authorization: process.env.CONTIFICO_API_KEY,
            },
            data: data,
          });
          batch.set(servicio.ref, {idContifico: response.data.id}, { merge: true });
          batchOperations++;
          updatesCount++;
        } catch (error) {
          console.error(`Error al crear el servicio en Contifico para ${serviceData.nombre}:`, error);
          if (error.response && error.response.data && error.response.data.id) {
            batch.set(servicio.ref, {idContifico: error.response.data.id}, { merge: true });
            batchOperations++;
            updatesCount++;
          }
        }
      }
      // Límite de 500 operaciones por lote
      if (batchOperations === 500) {
        console.log(`Ejecutando lote de ${batchOperations} actualizaciones...`);
        await batch.commit();
        batchOperations = 0; // Reiniciar contador de operaciones del lote
        // Crear un nuevo lote para las siguientes operaciones
        batch = db.batch(); // Reasignar un nuevo lote
      }
    }

    const products = await productosRef.get();

    if (products.empty) {
      console.log('No se encontraron productos en la colección "productos".');
    }

    for (const producto of products.docs) {
      const productoData = producto.data();
      let categoria;
      if (productoData.refCategory && productoData.refCategory.id) {
        categoria = await categoriesProductsRef.doc(productoData.refCategory.id).get();
      }
      if (!productoData.idContifico) {
        const data = {
          tipo: 'PRO',
          nombre: productoData.nombre,
          descripcion: productoData.descripcion || '',
          categoria_id: categoria && categoria.data()? categoria.data().idContifico : null,
          minimo: 0,
          pvp1: productoData.precio,
          estado: 'A',
          codigo: productoData.sku,
        }

        console.log(`Data de producto: ${JSON.stringify(data)}`);
        try {
          const response = await axios({
            method: 'POST',
            url: `${process.env.CONTIFICO_URI}/producto/`,
            headers: {
              'Content-Type': 'application/json',
              Authorization: process.env.CONTIFICO_API_KEY,
            },
            data: data,
          });
          batch.set(producto.ref, {idContifico: response.data.id}, { merge: true });
          batchOperations++;
          updatesCount++;
        } catch (error) {
          console.error(`Error al crear el producto en Contifico para ${productoData.nombre}:`, error);
          if (error.response && error.response.data && error.response.data.id) {
            batch.set(producto.ref, {idContifico: error.response.data.id}, { merge: true });
            batchOperations++;
            updatesCount++;
          }
        }
      }
      // Límite de 500 operaciones por lote
      if (batchOperations === 500) {
        console.log(`Ejecutando lote de ${batchOperations} actualizaciones...`);
        await batch.commit();
        batchOperations = 0; // Reiniciar contador de operaciones del lote
        // Crear un nuevo lote para las siguientes operaciones
        batch = db.batch(); // Reasignar un nuevo lote
      }
    }

    // Ejecutar cualquier operación restante en el lote final
    if (batchOperations > 0) {
      console.log(`Ejecutando lote final de ${batchOperations} actualizaciones...`);
      await batch.commit();
    }

    console.log(`Proceso completado. Se actualizaron ${updatesCount} documentos.`);
  } catch (error) {
    console.error('Error al actualizar los documentos:', error);
    throw new Error(`Fallo en la actualización de documentos: ${error.message}`);
  }
}

async function run() {
  // Llama a la nueva función de actualización
  try {
    await updateContificoSync();
    console.log('Actualización de Contifico Completa.');
  } catch (error) {
    console.error('Error durante la actualización de Contifico:', error.message);
  }
}

run();