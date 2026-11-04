// Cliente mínimo de la API de Notion (con el token de una integración interna).

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

export async function notion(cfg, ruta, { method = 'GET', body, form } = {}) {
  if (!cfg.notionToken) {
    const e = new Error('Falta conectar Notion: pegá el token de tu integración en la página de configuración de la app.');
    e.status = 400;
    throw e;
  }
  const headers = { Authorization: `Bearer ${cfg.notionToken}`, 'Notion-Version': VERSION };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + ruta, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.message || `HTTP ${res.status}`;
    if (res.status === 404 || data.code === 'object_not_found') {
      msg = 'Notion no encuentra la página. ¿Conectaste la integración a las bases Facturas y Clientes? (⋯ → Conexiones)';
    } else if (res.status === 401) {
      msg = 'El token de Notion no es válido. Revisalo en la página de configuración de la app.';
    }
    const e = new Error(msg);
    e.status = res.status === 401 || res.status === 404 ? 400 : 502;
    throw e;
  }
  return data;
}

// ---------- Lectura de propiedades ----------

export const texto = (prop) => ((prop && (prop.rich_text || prop.title)) || []).map((t) => t.plain_text).join('').trim();
export const opcion = (prop) => (prop && (prop.select?.name || prop.status?.name)) || '';
export const fecha = (prop) => prop?.date || null;
export const numero = (prop) => (prop && typeof prop.number === 'number' ? prop.number : null);

// ---------- Escritura de propiedades ----------

export const rt = (s) => ({ rich_text: s ? [{ text: { content: String(s).slice(0, 1900) } }] : [] });
export const sel = (name) => ({ select: name ? { name } : null });
export const dia = (d) => ({ date: d ? { start: d } : null });

export function actualizarPagina(cfg, pageId, properties) {
  return notion(cfg, `/pages/${pageId}`, { method: 'PATCH', body: { properties } });
}

// Sube un archivo a Notion y devuelve el id para adjuntarlo en una propiedad Files.
export async function subirArchivo(cfg, nombre, buffer, tipo) {
  const up = await notion(cfg, '/file_uploads', { method: 'POST', body: { mode: 'single_part', filename: nombre, content_type: tipo } });
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: tipo }), nombre);
  await notion(cfg, `/file_uploads/${up.id}/send`, { method: 'POST', form });
  return up.id;
}

// Acepta el id con o sin guiones, o una URL de Notion.
export function normalizarId(v) {
  const m = String(v || '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : '';
}
