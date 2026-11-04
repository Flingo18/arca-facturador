// Configuración: variables de entorno y, si faltan, los ajustes cargados desde /setup.

const ENDPOINTS = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};

export function limpiarPem(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function pem(name) {
  const raw = process.env[name];
  if (raw && raw.trim()) return limpiarPem(raw);
  const b64 = process.env[`${name}_B64`];
  if (b64 && b64.trim()) return limpiarPem(Buffer.from(b64.trim(), 'base64').toString('utf8'));
  return null;
}

// Describe un PEM sin revelar su contenido: solo la línea BEGIN y el largo.
export function describirPem(valor) {
  if (!valor) return 'vacía';
  const begin = (valor.match(/-----BEGIN [A-Z0-9 ]+-----/) || [])[0];
  return `${begin ? `empieza con "${begin}"` : 'no tiene línea -----BEGIN ...-----'}, ${valor.length} caracteres`;
}

// Lee la configuración. Las variables de entorno mandan; lo que falte se toma de los
// ajustes guardados desde la página /setup (ver lib/ajustes.js y cargarConfig()).
export function getConfig(ajustes = {}) {
  const a = ajustes || {};
  const ae = a.emisor || {};
  const env = (process.env.ARCA_ENV || a.entorno || 'homologacion').toLowerCase();
  if (!ENDPOINTS[env]) throw new Error(`ARCA_ENV inválido: ${env} (usar homologacion o produccion)`);

  const cuit = (process.env.ARCA_CUIT || a.cuit || '').replace(/\D/g, '');
  const ptoVta = Number(process.env.ARCA_PTO_VTA || a.ptoVta || 1);

  return {
    env,
    cuit,
    ptoVta,
    cert: pem('ARCA_CERT') || (a.cert ? limpiarPem(a.cert) : null),
    key: pem('ARCA_KEY') || (a.key ? limpiarPem(a.key) : null),
    wsaaUrl: process.env.ARCA_WSAA_URL || ENDPOINTS[env].wsaa,
    wsfeUrl: process.env.ARCA_WSFE_URL || ENDPOINTS[env].wsfe,
    apiSecret: process.env.API_SECRET || '',
    emisor: {
      razonSocial: process.env.EMISOR_RAZON_SOCIAL || ae.razonSocial || '',
      domicilio: process.env.EMISOR_DOMICILIO || ae.domicilio || '',
      inicioActividades: process.env.EMISOR_INICIO_ACTIVIDADES || ae.inicioActividades || '',
      iibb: process.env.EMISOR_IIBB || ae.iibb || '',
      condicionIva: process.env.EMISOR_CONDICION_IVA || ae.condicionIva || 'Responsable Monotributo',
    },
    upstash: {
      // La integración de Upstash en Vercel crea KV_REST_API_URL / KV_REST_API_TOKEN
      url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
    },
  };
}

// Igual que getConfig(), pero completando con lo guardado desde /setup.
export async function cargarConfig() {
  const base = getConfig();
  if (base.cuit && base.cert && base.key) return base; // todo viene de variables de entorno
  const { leerAjustes } = await import('./ajustes.js');
  const ajustes = await leerAjustes(base);
  return getConfig(ajustes);
}

export function assertCredenciales(cfg) {
  const faltan = [];
  if (!cfg.cuit) faltan.push('ARCA_CUIT');
  if (!cfg.cert) faltan.push('ARCA_CERT');
  if (!cfg.key) faltan.push('ARCA_KEY');
  if (faltan.length) {
    const e = new Error(`Falta configurar: ${faltan.join(', ')}. Completalo en la página /setup de la app.`);
    e.status = 400;
    throw e;
  }
}
