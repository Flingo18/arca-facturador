// WSAA: autenticación. Firma un TRA (ticket de requerimiento de acceso) con el
// certificado del emisor (CMS/PKCS#7, SHA-256) y lo canjea por token + sign.

import forge from 'node-forge';
import { soapCall, parseXml } from './soap.js';
import { cacheGet, cacheSet } from './cache.js';
import { assertCredenciales, describirPem } from './config.js';

// Fecha ISO en hora argentina (-03:00), formato que WSAA acepta.
function isoAR(date) {
  const ar = new Date(date.getTime() - 3 * 3600 * 1000);
  return ar.toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

export function crearTRA(servicio, ahora = new Date()) {
  const desde = new Date(ahora.getTime() - 10 * 60 * 1000);
  const hasta = new Date(ahora.getTime() + 10 * 60 * 1000);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${isoAR(desde)}</generationTime>` +
    `<expirationTime>${isoAR(hasta)}</expirationTime>` +
    `</header><service>${servicio}</service></loginTicketRequest>`
  );
}

// Si el valor se pegó sin las líneas BEGIN/END (solo el bloque base64), lo rearmamos.
function envolverPem(valor, etiqueta) {
  if (/-----BEGIN /.test(valor)) return valor;
  const cuerpo = valor.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(cuerpo)) return valor;
  const lineas = cuerpo.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${etiqueta}-----\n${lineas}\n-----END ${etiqueta}-----`;
}

function leerClave(keyPem) {
  const intentos = /-----BEGIN /.test(keyPem)
    ? [keyPem]
    : [envolverPem(keyPem, 'PRIVATE KEY'), envolverPem(keyPem, 'RSA PRIVATE KEY')];
  let ultimo;
  for (const k of intentos) {
    try {
      return forge.pki.privateKeyFromPem(k);
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
}

export function firmarCMS(tra, certPem, keyPem) {
  let cert, key;
  try {
    cert = forge.pki.certificateFromPem(envolverPem(certPem, 'CERTIFICATE'));
  } catch (e) {
    throw new Error(`ARCA_CERT no es un certificado PEM válido (${describirPem(certPem)}): ${e.message}`);
  }
  try {
    key = leerClave(keyPem);
  } catch (e) {
    throw new Error(`ARCA_KEY no es una clave privada PEM válida (${describirPem(keyPem)}): ${e.message}`);
  }
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

async function pedirTA(cfg, servicio) {
  const cms = firmarCMS(crearTRA(servicio), cfg.cert, cfg.key);
  const envelope =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>` +
    '</soapenv:Body></soapenv:Envelope>';

  const body = await soapCall(cfg.wsaaUrl, '', envelope);
  const ret = body?.loginCmsResponse?.loginCmsReturn;
  if (!ret) throw new Error('WSAA no devolvió loginCmsReturn');
  const ticket = parseXml(ret)?.loginTicketResponse;
  const token = ticket?.credentials?.token;
  const sign = ticket?.credentials?.sign;
  const expiration = ticket?.header?.expirationTime;
  if (!token || !sign) throw new Error('WSAA devolvió un ticket sin token/sign');
  return { token, sign, expiration };
}

// Devuelve { token, sign } usando caché mientras el TA siga vigente.
export async function getAuth(cfg, servicio = 'wsfe') {
  assertCredenciales(cfg);
  const key = `arca:ta:${cfg.env}:${cfg.cuit}:${servicio}`;
  const cached = await cacheGet(cfg, key);
  // margen de 5 minutos antes del vencimiento
  if (cached && new Date(cached.expiration).getTime() - Date.now() > 5 * 60 * 1000) {
    return cached;
  }
  try {
    const ta = await pedirTA(cfg, servicio);
    const ttl = (new Date(ta.expiration).getTime() - Date.now()) / 1000;
    await cacheSet(cfg, key, ta, ttl);
    return ta;
  } catch (e) {
    if (/alreadyAuthenticated|ya posee un TA/i.test(`${e.faultcode} ${e.message}`)) {
      throw new Error(
        'ARCA dice que ya hay un ticket de acceso vigente y no está en caché. ' +
          'Configurá UPSTASH_REDIS_REST_URL/TOKEN para conservarlo, o esperá a que venza (máx. 12 h).'
      );
    }
    throw e;
  }
}
