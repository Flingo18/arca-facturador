// Consulta si una factura existe en ARCA.
// GET  /api/consultar?numero=00001-00000012   (o ?nro=12, usa el punto de venta configurado)
// POST /api/consultar con { "numero": "...", "pdf": true, "receptor": {...}, "descripcion": "..." }
//      para regenerar el PDF de una factura ya emitida.
// Header: x-api-key: <API_SECRET>

import { cargarConfig } from '../lib/config.js';
import { json, autorizado, leerBody, errorRespuesta } from '../lib/http.js';
import { consultar, ultimoAutorizado, CBTE_TIPO } from '../lib/wsfe.js';
import { generarPDF, numeroFormateado } from '../lib/pdf.js';

function parsearNumero(q) {
  if (q.numero) {
    const m = String(q.numero).match(/^(\d+)-(\d+)$/);
    if (m) return { ptoVta: Number(m[1]), nro: Number(m[2]) };
  }
  if (q.nro) return { ptoVta: null, nro: Number(q.nro) };
  return null;
}

export default async function handler(req, res) {
  const cfg = await cargarConfig();
  if (!autorizado(req, cfg)) return json(res, 401, { ok: false, error: 'No autorizado' });

  try {
    const url = new URL(req.url, 'http://x');
    const q = req.method === 'POST' ? await leerBody(req) : Object.fromEntries(url.searchParams);
    const tipo = Number(q.cbteTipo || CBTE_TIPO.FACTURA_C);
    const parsed = parsearNumero(q);
    const ptoVta = parsed?.ptoVta || cfg.ptoVta;

    // Sin número: devuelve el último autorizado
    const nro = parsed?.nro ?? (await ultimoAutorizado(cfg, tipo, ptoVta));
    if (!nro) return json(res, 200, { ok: true, existe: false, ultimo: 0 });

    const f = await consultar(cfg, nro, tipo, ptoVta);
    if (!f) return json(res, 200, { ok: true, existe: false, ptoVta, nro });

    const out = { ok: true, existe: true, entorno: cfg.env, numero: numeroFormateado(f), ...f };
    if (q.pdf === true || q.pdf === '1' || q.pdf === 'true') {
      const pdf = await generarPDF(cfg, f, {
        receptorNombre: q.receptor?.nombre,
        receptorDomicilio: q.receptor?.domicilio,
        receptorCondicionIva: q.receptor?.condicionIva,
        descripcion: q.descripcion,
      });
      out.pdfNombre = `Factura-C-${out.numero}.pdf`;
      out.pdfBase64 = pdf.toString('base64');
    }
    return json(res, 200, out);
  } catch (e) {
    return errorRespuesta(res, e);
  }
}
