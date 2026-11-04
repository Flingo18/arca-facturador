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

export async function soapCall(url, action, envelope, { timeoutMs = 25000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: action,
      },
      body: envelope,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  const parsed = parseXml(text);
  const body = parsed?.Envelope?.Body;
  if (body?.Fault) {
    const f = body.Fault;
    const err = new Error(`SOAP Fault: ${f.faultstring || f.faultcode || 'desconocido'}`);
    err.faultcode = f.faultcode;
    err.faultstring = f.faultstring;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} desde ${url}: ${text.slice(0, 300)}`);
  return body;
}

export function asArray(x) {
  if (x === undefined || x === null || x === '') return [];
  return Array.isArray(x) ? x : [x];
}
