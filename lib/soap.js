import https from 'node:https';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false, // dejamos todo como string: CAE, CUIT y números largos no se rompen
  trimValues: true,
});

export function parseXml(xml) {
  return parser.parse(xml);
}

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Arma XML a partir de un objeto plano/anidado, respetando el orden de las claves.
// Las claves con valor undefined/null se omiten. Los arrays repiten el tag.
export function toXml(obj, prefix = 'ar') {
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) out += toXml({ [k]: item }, prefix);
    } else if (typeof v === 'object') {
      out += `<${prefix}:${k}>${toXml(v, prefix)}</${prefix}:${k}>`;
    } else {
      out += `<${prefix}:${k}>${escapeXml(v)}</${prefix}:${k}>`;
    }
  }
  return out;
}

// Los servidores de producción de ARCA usan una configuración TLS antigua (clave DH chica)
// que OpenSSL 3 rechaza con el nivel de seguridad por defecto. Bajamos el nivel solo para
// estas conexiones; el certificado del servidor se sigue validando.
const agenteArca = new https.Agent({ keepAlive: true, ciphers: 'DEFAULT@SECLEVEL=1' });

function postXml(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, agent: agenteArca, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error(`timeout de ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

export async function soapCall(url, action, envelope, { timeoutMs = 25000 } = {}) {
  let res;
  try {
    res = await postXml(url, { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action }, envelope, timeoutMs);
  } catch (e) {
    throw new Error(`No se pudo conectar con ${new URL(url).host}: ${e.code || ''} ${e.message}`.trim());
  }
  const text = res.text;
  const parsed = parseXml(text);
  const body = parsed?.Envelope?.Body;
  if (body?.Fault) {
    const f = body.Fault;
    const err = new Error(`SOAP Fault: ${f.faultstring || f.faultcode || 'desconocido'}`);
    err.faultcode = f.faultcode;
    err.faultstring = f.faultstring;
    throw err;
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} desde ${url}: ${text.slice(0, 300)}`);
  return body;
}

export function asArray(x) {
  if (x === undefined || x === null || x === '') return [];
  return Array.isArray(x) ? x : [x];
}
