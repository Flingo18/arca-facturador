// Asistente de instalación (lo usa la página /setup).
// Header: x-api-key: <API_SECRET>
//
// GET  /api/setup                                  → qué está configurado (sin mostrar secretos)
// POST /api/setup { accion: "datos", ... }         → guarda CUIT, punto de venta, entorno y datos del PDF
// POST /api/setup { accion: "generar-csr" }        → crea clave privada + pedido de certificado (CSR)
// POST /api/setup { accion: "certificado", pem }   → guarda el certificado descargado de ARCA

import forge from 'node-forge';
import { generateKeyPairSync } from 'node:crypto';
import { getConfig, cargarConfig } from '../lib/config.js';
import { json, autorizado, leerBody, errorRespuesta } from '../lib/http.js';
import { leerAjustes, guardarAjustes } from '../lib/ajustes.js';
import { hayKv } from '../lib/cache.js';
import { envolverPem, leerClave } from '../lib/wsaa.js';

const ALIAS = 'facturadornotion';

function infoCertificado(certPem, keyPem) {
  if (!certPem) return null;
  try {
    const cert = forge.pki.certificateFromPem(envolverPem(certPem, 'CERTIFICATE'));
    let coincide = null;
    if (keyPem) {
      const key = leerClave(keyPem);
      coincide = cert.publicKey.n.equals(key.n);
    }
    const cn = cert.subject.getField('CN')?.value || '';
    const serial = cert.subject.getField({ type: '2.5.4.5' })?.value || '';
    return { alias: cn, cuit: serial.replace(/\D/g, ''), vence: cert.validity.notAfter.toISOString().slice(0, 10), coincideConClave: coincide };
  } catch (e) {
    return { error: `No se pudo leer el certificado: ${e.message}` };
  }
}

function estado(cfg, a) {
  const fuente = (envVar, valor) => (process.env[envVar] ? 'vercel' : valor ? 'setup' : null);
  return {
    ok: true,
    baseConectada: hayKv(cfg),
    entorno: cfg.env,
    cuit: cfg.cuit,
    ptoVta: cfg.ptoVta,
    emisor: cfg.emisor,
    tieneClave: Boolean(cfg.key),
    claveIlegible: Boolean(a.keyIlegible),
    csr: a.csr || null,
    certificado: infoCertificado(cfg.cert, cfg.key),
    origen: {
      cuit: fuente('ARCA_CUIT', a.cuit),
      certificado: fuente('ARCA_CERT', a.cert),
      clave: fuente('ARCA_KEY', a.key),
    },
  };
}

function texto(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

export default async function handler(req, res) {
  const base = getConfig();
  if (!autorizado(req, base)) return json(res, 401, { ok: false, error: 'Clave de instalación incorrecta' });

  try {
    if (req.method === 'GET') {
      const a = await leerAjustes(base);
      return json(res, 200, estado(getConfig(a), a));
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Usar GET o POST' });
    if (!hayKv(base)) {
      return json(res, 400, {
        ok: false,
        error: 'Falta conectar la base Upstash al proyecto en Vercel (Storage → Upstash → Connect) y volver a desplegar.',
      });
    }

    const body = await leerBody(req);

    if (body.accion === 'datos') {
      const cuit = texto(body.cuit, 20).replace(/\D/g, '');
      if (cuit.length !== 11) return json(res, 400, { ok: false, error: 'El CUIT tiene que tener 11 números' });
      const ptoVta = Number(body.ptoVta);
      if (!Number.isInteger(ptoVta) || ptoVta < 1 || ptoVta > 99998) {
        return json(res, 400, { ok: false, error: 'El punto de venta tiene que ser un número (ej. 2)' });
      }
      const entorno = body.entorno === 'homologacion' ? 'homologacion' : 'produccion';
      await guardarAjustes(base, {
        cuit,
        ptoVta,
        entorno,
        emisor: {
          razonSocial: texto(body.razonSocial),
          domicilio: texto(body.domicilio),
          inicioActividades: texto(body.inicioActividades, 20),
          iibb: texto(body.iibb, 80),
          condicionIva: texto(body.condicionIva, 60) || 'Responsable Monotributo',
        },
      });
    } else if (body.accion === 'generar-csr') {
      const actual = await cargarConfig();
      if (!actual.cuit || !actual.emisor.razonSocial) {
        return json(res, 400, { ok: false, error: 'Primero guardá tu CUIT y tu nombre (paso 1)' });
      }
      if (actual.cert && !body.reemplazar) {
        return json(res, 409, { ok: false, error: 'Ya hay un certificado cargado. Si generás uno nuevo, el actual deja de servir.' });
      }
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
      const key = forge.pki.privateKeyFromPem(keyPem);
      const csr = forge.pki.createCertificationRequest();
      csr.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
      csr.setSubject([
        { name: 'countryName', value: 'AR' },
        { name: 'organizationName', value: actual.emisor.razonSocial.slice(0, 64) },
        { name: 'commonName', value: ALIAS },
        { type: '2.5.4.5', value: `CUIT ${actual.cuit}` },
      ]);
      csr.sign(key, forge.md.sha256.create());
      await guardarAjustes(base, { key: keyPem, csr: forge.pki.certificationRequestToPem(csr), cert: null });
    } else if (body.accion === 'certificado') {
      const pem = envolverPem(texto(body.pem, 20000).replace(/\r/g, ''), 'CERTIFICATE');
      const a = await leerAjustes(base);
      const info = infoCertificado(pem, a.key);
      if (!info || info.error) return json(res, 400, { ok: false, error: info?.error || 'Certificado vacío' });
      if (info.coincideConClave === false) {
        return json(res, 400, {
          ok: false,
          error: 'Ese certificado no corresponde al pedido generado acá. Subí a ARCA el último archivo .csr que descargaste.',
        });
      }
      await guardarAjustes(base, { cert: pem, csr: null });
    } else {
      return json(res, 400, { ok: false, error: 'Acción desconocida' });
    }

    const a = await leerAjustes(base);
    return json(res, 200, estado(getConfig(a), a));
  } catch (e) {
    return errorRespuesta(res, e);
  }
}
