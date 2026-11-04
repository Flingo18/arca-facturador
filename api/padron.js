// GET /api/padron?cuit=30712345678
// Header: x-api-key: <API_SECRET>
// Devuelve los datos de la constancia de inscripción del CUIT:
// { ok, cuit, razonSocial, condicionIva, domicilioFiscal, estadoCuit, tipoPersona, actividades, categoriaMonotributo, avisos }
// condicionIva usa los mismos valores que la base Clientes de Notion.

import { cargarConfig } from '../lib/config.js';
import { json, autorizado, errorRespuesta } from '../lib/http.js';
import { consultarCuit } from '../lib/padron.js';

export default async function handler(req, res) {
  const cfg = await cargarConfig();
  if (!autorizado(req, cfg)) return json(res, 401, { ok: false, error: 'No autorizado' });
  try {
    const url = new URL(req.url, 'http://x');
    const datos = await consultarCuit(cfg, url.searchParams.get('cuit'));
    return json(res, 200, { ok: true, ...datos });
  } catch (e) {
    return errorRespuesta(res, e);
  }
}
