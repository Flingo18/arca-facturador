// Lo que hacen los botones de Notion: emitir una factura y completar un cliente con ARCA.
// Nombres de propiedades = los del template de Notion.

import { notion, texto, opcion, fecha, numero, rt, sel, dia, actualizarPagina, subirArchivo } from './notion.js';
import { mapearReceptor } from './mapeo.js';
import { emitirFacturaC } from './wsfe.js';
import { generarPDF, numeroFormateado } from './pdf.js';
import { consultarCuit } from './padron.js';

function hoyAR() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function ahoraAR() {
  const d = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
}

function errorUsuario(msg) {
  const e = new Error(msg);
  e.status = 400;
  e.usuario = true;
  return e;
}

// ---------- Emitir factura ----------

export async function emitirDesdeNotion(cfg, pageId) {
  const pagina = await notion(cfg, `/pages/${pageId}`);
  const p = pagina.properties || {};
  if (!p['Estado'] || !p['Importe']) {
    throw errorUsuario('Esta página no es de la base Facturas del template (faltan Estado o Importe).');
  }

  const yaEmitida = texto(p['Número']);
  if (yaEmitida) return { ok: true, yaEmitida: true, numero: yaEmitida, cae: texto(p['CAE']) };
  if (opcion(p['Estado']) === 'Emitiendo') {
    return { ok: false, enCurso: true, error: 'Esta factura ya se está emitiendo. Esperá unos segundos y refrescá.' };
  }

  // Marca la página antes de llamar a ARCA para que un doble clic no emita dos veces
  await actualizarPagina(cfg, pageId, { Estado: sel('Emitiendo'), Error: rt('') });

  try {
    const clienteId = p['Cliente']?.relation?.[0]?.id;
    if (!clienteId) throw errorUsuario('Elegí un cliente en la factura.');
    const cliente = (await notion(cfg, `/pages/${clienteId}`)).properties || {};

    const importe = numero(p['Importe']);
    if (!importe || importe <= 0) throw errorUsuario('El importe está vacío o en cero.');

    const hoy = hoyAR();
    const periodo = fecha(p['Período']) || {};
    const vence = fecha(p['Vence'])?.start;
    const receptorDatos = {
      nombre: texto(cliente['Razón social']) || texto(cliente['Nombre']),
      tipoDocumento: opcion(cliente['Tipo de documento']),
      nroDocumento: texto(cliente['Nro de documento']),
      condicionIva: opcion(cliente['Condición IVA']),
      domicilio: texto(cliente['Domicilio fiscal']),
    };
    let receptor;
    try {
      receptor = mapearReceptor(receptorDatos);
    } catch (e) {
      throw errorUsuario(`Datos del cliente: ${e.message}`);
    }
    const descripcion = texto(p['Concepto']) || 'Servicios';

    const factura = await emitirFacturaC(cfg, {
      importe: Math.round(importe * 100) / 100,
      moneda: 'PES',
      servDesde: periodo.start || hoy,
      servHasta: periodo.end || periodo.start || hoy,
      vtoPago: vence && vence >= hoy ? vence : hoy,
      receptor,
    });
    const nro = numeroFormateado(factura);

    // Guardar primero número y CAE: si falla el PDF, la factura igual queda registrada
    await actualizarPagina(cfg, pageId, {
      Estado: sel('Emitida'),
      'Número': rt(nro),
      CAE: rt(String(factura.cae)),
      'Vto CAE': dia(factura.vtoCae),
      Fecha: dia(factura.fecha),
      Error: rt(''),
    });

    let pdfOk = true;
    try {
      const pdf = await generarPDF(cfg, factura, {
        receptorNombre: receptorDatos.nombre,
        receptorDomicilio: receptorDatos.domicilio,
        receptorCondicionIva: receptorDatos.condicionIva,
        descripcion,
      });
      const nombre = `Factura-C-${nro}.pdf`;
      const id = await subirArchivo(cfg, nombre, pdf, 'application/pdf');
      await actualizarPagina(cfg, pageId, { PDF: { files: [{ type: 'file_upload', file_upload: { id }, name: nombre }] } });
    } catch (e) {
      pdfOk = false;
      console.error('PDF:', e);
      await actualizarPagina(cfg, pageId, { Error: rt(`Factura emitida, pero no se pudo adjuntar el PDF: ${e.message}`) }).catch(() => {});
    }

    return { ok: true, numero: nro, cae: String(factura.cae), vtoCae: factura.vtoCae, importe: factura.importe, cliente: receptorDatos.nombre, pdf: pdfOk };
  } catch (e) {
    await actualizarPagina(cfg, pageId, { Estado: sel('Error'), Error: rt(e.message) }).catch(() => {});
    throw e;
  }
}

// ---------- Completar cliente con ARCA ----------

export async function completarClienteDesdeNotion(cfg, pageId) {
  const pagina = await notion(cfg, `/pages/${pageId}`);
  const p = pagina.properties || {};
  if (!p['Nro de documento']) throw errorUsuario('Esta página no es de la base Clientes del template (falta Nro de documento).');

  const cuit = texto(p['Nro de documento']).replace(/\D/g, '');
  try {
    const d = await consultarCuit(cfg, cuit);
    const resumen = [
      `Consultado ${ahoraAR()}`,
      `CUIT ${d.estadoCuit || 's/d'}`,
      d.categoriaMonotributo ? `Categoría ${d.categoriaMonotributo}` : '',
      d.avisos?.length ? `Avisos: ${d.avisos.join(' | ')}` : '',
    ].filter(Boolean).join(' · ');
    await actualizarPagina(cfg, pageId, {
      'Razón social': rt(d.razonSocial),
      'Condición IVA': sel(d.condicionIva),
      'Tipo de documento': sel('CUIT'),
      'Nro de documento': rt(d.cuit),
      'Domicilio fiscal': rt(d.domicilioFiscal),
      'Datos ARCA': rt(resumen),
    });
    return { ok: true, ...d };
  } catch (e) {
    await actualizarPagina(cfg, pageId, { 'Datos ARCA': rt(`No se pudo consultar (${ahoraAR()}): ${e.message}`) }).catch(() => {});
    throw e;
  }
}
