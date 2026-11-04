// Configuración leída de variables de entorno.

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

function pem(name) {
  const raw = process.env[name];
  if (raw && raw.trim()) return raw.replace(/\\n/g, '\n').trim();
  const b64 = process.env[`${name}_B64`];
  if (b64 && b64.trim()) return Buffer.from(b64.trim(), 'base64').toString('utf8').trim();
  return null;
}

export function getConfig() {
  const env = (process.env.ARCA_ENV || 'homologacion').toLowerCase();
  if (!ENDPOINTS[env]) throw new Error(`ARCA_ENV inválido: ${env} (usar homologacion o produccion)`);

  const cuit = (process.env.ARCA_CUIT || '').replace(/\D/g, '');
  const ptoVta = Number(process.env.ARCA_PTO_VTA || 1);

  return {
    env,
    cuit,
    ptoVta,
    cert: pem('ARCA_CERT'),
    key: pem('ARCA_KEY'),
    wsaaUrl: process.env.ARCA_WSAA_URL || ENDPOINTS[env].wsaa,
    wsfeUrl: process.env.ARCA_WSFE_URL || ENDPOINTS[env].wsfe,
    apiSecret: process.env.API_SECRET || '',
    emisor: {
      razonSocial: process.env.EMISOR_RAZON_SOCIAL || '',
      domicilio: process.env.EMISOR_DOMICILIO || '',
      inicioActividades: process.env.EMISOR_INICIO_ACTIVIDADES || '',
      iibb: process.env.EMISOR_IIBB || '',
      condicionIva: process.env.EMISOR_CONDICION_IVA || 'Responsable Monotributo',
    },
    upstash: {
      // La integración de Upstash en Vercel crea KV_REST_API_URL / KV_REST_API_TOKEN
      url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
    },
  };
}

export function assertCredenciales(cfg) {
  const faltan = [];
  if (!cfg.cuit) faltan.push('ARCA_CUIT');
  if (!cfg.cert) faltan.push('ARCA_CERT');
  if (!cfg.key) faltan.push('ARCA_KEY');
  if (faltan.length) throw new Error(`Faltan variables de entorno: ${faltan.join(', ')}`);
}
