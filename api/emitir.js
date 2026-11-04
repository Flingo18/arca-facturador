// POST /api/emitir
// Header: x-api-key: <API_SECRET>
// Body (JSON):
// {
//   "importe": 150000,
//   "moneda": "ARS",                     // ARS | USD
//   "descripcion": "Mantenimiento mensual - noviembre",
//   "periodoDesde": "2026-11-01",        // opcional, default hoy
//   "periodoHasta": "2026-11-30",        // opcional, default hoy
//   "vencimiento": "2026-11-10",         // opcional, default hoy
//   "fecha": "2026-11-04",               // opcional, default hoy
//   "receptor": {
//     "nombre": "Clínica X SRL",
//     "tipoDocumento": "CUIT",           // CUIT | DNI | Sin identificar
//     "nroDocumento": "30712345678",
//     "condicionIva": "Responsable Inscripto",
//     "domicilio": "Av. Siempreviva 742"
//   },
//   "incluirPdf": true                   // default true
// }

import { getConfig } from '../lib/config.js';
import { json, autorizado, leerBody, errorRespuesta } from '../lib/http.js';
import { mapearReceptor, mapearMoneda, validarImporte } from '../lib/mapeo.js';
import { emitirFacturaC } from '../lib/wsfe.js';
import { generarPDF, numeroFormateado } from '../lib/pdf.js';

export default async function handler(req, res) {
  const cfg = getConfig();
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Usar POST' });
  if (!autorizado(req, cfg)) return json(res, 401, { ok: false, error: 'No autorizado' });

  try {
    const body = await leerBody(req);
    const receptor = mapearReceptor(body.receptor);
    const factura = await emitirFacturaC(cfg, {
      importe: validarImporte(body.importe),
      moneda: mapearMoneda(body.moneda),
      cotizacion: body.cotizacion,
      pagoMismaMoneda: body.pagoMismaMoneda,
      fecha: body.fecha,
      servDesde: body.periodoDesde,
      servHasta: body.periodoHasta,
      vtoPago: body.vencimiento,
      receptor,
    });

    const numero = numeroFormateado(factura);
    const out = { ok: true, entorno: cfg.env, numero, ...factura };

    if (body.incluirPdf !== false) {
      const pdf = await generarPDF(cfg, factura, {
        receptorNombre: body.receptor?.nombre,
        receptorDomicilio: body.receptor?.domicilio,
        receptorCondicionIva: body.receptor?.condicionIva,
        descripcion: body.descripcion,
      });
      out.pdfNombre = `Factura-C-${numero}.pdf`;
      out.pdfBase64 = pdf.toString('base64');
    }
    return json(res, 200, out);
  } catch (e) {
    return errorRespuesta(res, e);
  }
}
