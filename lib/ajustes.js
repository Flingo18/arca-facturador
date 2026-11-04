// Ajustes guardados desde la página /setup en la base Upstash del propio proyecto.
// La clave privada se guarda cifrada (AES-256-GCM) con una llave derivada de API_SECRET:
// sin esa clave, lo que hay en la base no sirve para firmar.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { kvGet, kvSet, hayKv } from './cache.js';

const CLAVE_KV = 'arca:ajustes';

function llave(secret) {
  return createHash('sha256').update(`arca-ajustes:${secret}`).digest();
}

export function cifrar(texto, secret) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', llave(secret), iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function descifrar(valor, secret) {
  const [iv, tag, enc] = valor.split('.').map((p) => Buffer.from(p, 'base64'));
  const d = createDecipheriv('aes-256-gcm', llave(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

async function leerCrudo(cfg) {
  if (!hayKv(cfg)) return {};
  try {
    const raw = await kvGet(cfg, CLAVE_KV);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('No se pudieron leer los ajustes:', e.message);
    return {};
  }
}

// Devuelve los ajustes con la clave privada ya descifrada (en `key`).
export async function leerAjustes(cfg) {
  const a = await leerCrudo(cfg);
  if (a.keyCifrada && cfg.apiSecret) {
    try {
      a.key = descifrar(a.keyCifrada, cfg.apiSecret);
    } catch {
      a.keyIlegible = true; // cambió API_SECRET: hay que generar un certificado nuevo
    }
  }
  delete a.keyCifrada;
  return a;
}

// Mezcla `cambios` con lo guardado. `key` se cifra; un valor null borra el campo.
export async function guardarAjustes(cfg, cambios) {
  if (!cfg.apiSecret) throw new Error('Falta la variable API_SECRET en Vercel');
  const a = await leerCrudo(cfg);
  for (const [k, v] of Object.entries(cambios)) {
    if (k === 'key') {
      if (v === null) delete a.keyCifrada;
      else a.keyCifrada = cifrar(v, cfg.apiSecret);
    } else if (k === 'emisor') {
      a.emisor = { ...(a.emisor || {}), ...v };
    } else if (v === null) {
      delete a[k];
    } else {
      a[k] = v;
    }
  }
  a.actualizado = new Date().toISOString();
  await kvSet(cfg, CLAVE_KV, JSON.stringify(a));
}
