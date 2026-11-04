// GET /api/estado                 → servidores de ARCA + último número emitido
// GET /api/estado?parametros=1    → además, condiciones IVA, tipos de comprobante y puntos de venta
// Header: x-api-key: <API_SECRET>

import { cargarConfig } from '../lib/config.js';
import { json, autorizado, errorRespuesta } from '../lib/http.js';
import { dummy, ultimoAutorizado, parametros } from '../lib/wsfe.js';

export default async function handler(req, res) {
  const cfg = await cargarConfig();
  if (!autorizado(req, cfg)) return json(res, 401, { ok: false, error: 'No autorizado' });
  try {
    const url = new URL(req.url, 'http://x');
    const out = {
      ok: true,
      entorno: cfg.env,
      cuit: cfg.cuit,
      ptoVta: cfg.ptoVta,
      servidores: await dummy(cfg),
      ultimaFacturaC: await ultimoAutorizado(cfg),
    };
    if (url.searchParams.get('parametros')) out.parametros = await parametros(cfg);
    return json(res, 200, out);
  } catch (e) {
    return errorRespuesta(res, e);
  }
}
