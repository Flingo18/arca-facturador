// Manejo común de los endpoints que llaman los botones de Notion.
// - POST: webhook de un botón o automatización de Notion (planes pagos). Responde JSON.
// - GET:  link desde una propiedad fórmula (sirve en el plan gratis). Responde una página.
// Autenticación: ?key=<clave de botones> en la dirección (o header x-api-key).

import { timingSafeEqual } from 'node:crypto';
import { cargarConfig, claveBotones } from './config.js';
import { json, leerBody } from './http.js';
import { normalizarId } from './notion.js';

function igual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function paginaHtml(res, status, { ok, titulo, lineas = [] }) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title><style>
:root{--bg:#f6f5f1;--card:#fff;--ink:#1d1c1a;--muted:#6b6860;--ok:#2f7a4a;--err:#a33a2c}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--card:#1e1e1c;--ink:#eceae4;--muted:#a29f96;--ok:#7cc597;--err:#f08a7a}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:520px;margin:12vh auto;padding:28px 24px;background:var(--card);border-radius:14px}
h1{font-size:22px;margin:0 0 12px;color:${ok ? 'var(--ok)' : 'var(--err)'}}p{margin:6px 0}small{color:var(--muted)}
</style></head><body><main><h1>${ok ? '✅' : '⚠️'} ${escapar(titulo)}</h1>
${lineas.map((l) => `<p>${escapar(l)}</p>`).join('')}
<p><small>Podés cerrar esta pestaña y volver a Notion.</small></p></main></body></html>`);
}

export function crearHandler(accion, describir) {
  return async function handler(req, res) {
    const esLink = req.method === 'GET';
    let cfg;
    try {
      cfg = await cargarConfig();
    } catch (e) {
      return esLink ? paginaHtml(res, 500, { ok: false, titulo: 'La app no está configurada', lineas: [e.message] }) : json(res, 500, { ok: false, error: e.message });
    }

    const url = new URL(req.url, 'http://x');
    const key = url.searchParams.get('key') || req.headers['x-api-key'];
    if (!igual(key, claveBotones(cfg)) && !igual(key, cfg.apiSecret)) {
      return esLink
        ? paginaHtml(res, 401, { ok: false, titulo: 'Link inválido', lineas: ['La clave del link no coincide. Copiá de nuevo la dirección desde la página de configuración de la app.'] })
        : json(res, 401, { ok: false, error: 'No autorizado' });
    }

    let pageId = normalizarId(url.searchParams.get('page'));
    if (!pageId && req.method === 'POST') {
      const body = await leerBody(req).catch(() => ({}));
      pageId = normalizarId(body?.data?.id || body?.pageId || body?.id);
    }
    if (!pageId) {
      const msg = 'No llegó el ID de la página de Notion.';
      return esLink ? paginaHtml(res, 400, { ok: false, titulo: msg }) : json(res, 400, { ok: false, error: msg });
    }

    try {
      const r = await accion(cfg, pageId);
      if (esLink) return paginaHtml(res, r.ok ? 200 : 409, describir(r));
      return json(res, r.ok ? 200 : 409, r);
    } catch (e) {
      console.error(e);
      if (esLink) return paginaHtml(res, e.status || 502, { ok: false, titulo: 'No se pudo completar', lineas: [e.message] });
      return json(res, e.status || 502, { ok: false, error: e.message });
    }
  };
}
