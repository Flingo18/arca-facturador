import { timingSafeEqual } from 'node:crypto';

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function autorizado(req, cfg) {
  if (!cfg.apiSecret) return false; // sin secreto configurado no se expone nada
  const enviado = String(req.headers['x-api-key'] || '');
  const a = Buffer.from(enviado);
  const b = Buffer.from(cfg.apiSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function leerBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function errorRespuesta(res, e) {
  console.error(e);
  return json(res, e.status || 502, {
    ok: false,
    error: e.message,
    arca: e.arca || undefined,
  });
}
