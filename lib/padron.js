// Padrón de ARCA: Constancia de Inscripción (servicio WSAA "ws_sr_constancia_inscripcion", método getPersona_v2).
// Devuelve razón social, domicilio fiscal y condición frente al IVA de un CUIT.

import { soapCall, toXml, asArray } from './soap.js';
import { getAuth } from './wsaa.js';

const SERVICIO = 'ws_sr_constancia_inscripcion';
const NS = 'http://a5.soap.ws.server.puc.sr/';
const ENDPOINTS = {
  homologacion: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
  produccion: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
};

// Impuestos del régimen general que definen la condición frente al IVA
const IVA = 30;
const IVA_EXENTO = 32;

function texto(...partes) {
  return partes.filter((p) => p !== undefined && p !== null && String(p).trim() !== '').join(' ').trim();
}

function domicilioLegible(d) {
  if (!d) return '';
  const calle = texto(d.direccion);
  const localidad = d.localidad && d.localidad !== d.descripcionProvincia ? d.localidad : '';
  const provincia = d.descripcionProvincia === 'CIUDAD AUTONOMA BUENOS AIRES' ? 'CABA' : d.descripcionProvincia;
  const cp = d.codPostal ? `(${d.codPostal})` : '';
  return [calle, texto(localidad), texto(provincia, cp)].filter(Boolean).join(', ');
}

export function interpretarPersona(p) {
  const g = p.datosGenerales || {};
  const errores = [
    ...asArray(p.errorConstancia?.error),
    ...asArray(p.errorMonotributo?.error),
    ...asArray(p.errorRegimenGeneral?.error),
  ].map(String);

  const impuestos = asArray(p.datosRegimenGeneral?.impuesto).map((i) => Number(i.idImpuesto));
  let condicionIva;
  if (p.datosMonotributo) condicionIva = 'Monotributo';
  else if (impuestos.includes(IVA)) condicionIva = 'Responsable Inscripto';
  else if (impuestos.includes(IVA_EXENTO)) condicionIva = 'Exento';
  else condicionIva = 'Consumidor Final';

  const razonSocial = g.razonSocial || texto(g.apellido, g.nombre);
  const domicilio = asArray(g.domicilioFiscal)[0];

  return {
    cuit: String(g.idPersona || ''),
    razonSocial,
    tipoPersona: g.tipoPersona || '',
    estadoCuit: g.estadoClave || '',
    condicionIva,
    domicilioFiscal: domicilioLegible(domicilio),
    actividades: asArray(p.datosRegimenGeneral?.actividad || p.datosMonotributo?.actividadMonotributista)
      .map((a) => a.descripcionActividad)
      .filter(Boolean),
    categoriaMonotributo: p.datosMonotributo?.categoriaMonotributo?.descripcionCategoria || '',
    avisos: errores,
  };
}

export async function consultarCuit(cfg, cuit) {
  const id = String(cuit || '').replace(/\D/g, '');
  if (id.length !== 11) {
    const e = new Error(`El CUIT tiene que tener 11 dígitos (llegó "${cuit || ''}")`);
    e.status = 400;
    throw e;
  }
  const { token, sign } = await getAuth(cfg, SERVICIO);
  const inner = toXml({ token, sign, cuitRepresentada: cfg.cuit, idPersona: id }, '');
  const envelope =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="${NS}">` +
    `<soapenv:Header/><soapenv:Body><a5:getPersona_v2>${inner}</a5:getPersona_v2></soapenv:Body></soapenv:Envelope>`;

  let body;
  try {
    body = await soapCall(process.env.ARCA_PADRON_URL || ENDPOINTS[cfg.env], '', envelope);
  } catch (e) {
    if (/No existe persona/i.test(e.message)) {
      const err = new Error(`ARCA no tiene registrado el CUIT ${id}`);
      err.status = 404;
      throw err;
    }
    throw e;
  }
  const persona = body?.getPersona_v2Response?.personaReturn;
  if (!persona || !persona.datosGenerales) {
    const avisos = persona ? interpretarPersona(persona).avisos : [];
    const err = new Error(avisos[0] || `ARCA no devolvió datos para el CUIT ${id}`);
    err.status = 404;
    throw err;
  }
  return interpretarPersona(persona);
}
