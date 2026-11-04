// WSFEv1: autorización de comprobantes (CAE) y consultas.
// Por ahora soporta Factura C (código 11) de servicios para monotributistas.

import { soapCall, toXml, asArray } from './soap.js';
import { getAuth } from './wsaa.js';

const NS = 'http://ar.gov.afip.dif.FEV1/';

export const CBTE_TIPO = { FACTURA_C: 11, NOTA_DEBITO_C: 12, NOTA_CREDITO_C: 13 };
export const CONCEPTO = { PRODUCTOS: 1, SERVICIOS: 2, PRODUCTOS_Y_SERVICIOS: 3 };
export const DOC_TIPO = { CUIT: 80, DNI: 96, SIN_IDENTIFICAR: 99 };

// Valores de FEParamGetCondicionIvaReceptor (verificables con /api/estado?parametros=1)
export const CONDICION_IVA = {
  'Responsable Inscripto': 1,
  Exento: 4,
  'Consumidor Final': 5,
  Monotributo: 6,
  'Sujeto No Categorizado': 7,
  'Cliente del Exterior': 9,
  'IVA Liberado': 10,
  'Monotributista Social': 13,
  'IVA No Alcanzado': 15,
};

function envelope(metodo, inner) {
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">` +
    `<soapenv:Header/><soapenv:Body><ar:${metodo}>${inner}</ar:${metodo}></soapenv:Body></soapenv:Envelope>`
  );
}

async function llamar(cfg, metodo, contenido = {}, { conAuth = true } = {}) {
  let inner = '';
  if (conAuth) {
    const { token, sign } = await getAuth(cfg, 'wsfe');
    inner += toXml({ Auth: { Token: token, Sign: sign, Cuit: cfg.cuit } });
  }
  inner += toXml(contenido);
  const body = await soapCall(cfg.wsfeUrl, NS + metodo, envelope(metodo, inner));
  const result = body?.[`${metodo}Response`]?.[`${metodo}Result`];
  if (!result) throw new Error(`WSFE ${metodo}: respuesta vacía`);
  return result;
}

function errores(result) {
  return asArray(result?.Errors?.Err).map((e) => ({ code: e.Code, msg: e.Msg }));
}

function lanzarSiErrores(metodo, result) {
  const errs = errores(result);
  if (errs.length) {
    const err = new Error(`${metodo}: ${errs.map((e) => `[${e.code}] ${e.msg}`).join(' | ')}`);
    err.arca = errs;
    throw err;
  }
}

// ---------- Utilidades de formato ----------

export function fechaAAAAMMDD(d) {
  if (typeof d === 'string' && /^\d{8}$/.test(d)) return d;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10).replace(/-/g, '');
  const date = d instanceof Date ? d : new Date(d);
  // fecha calendario en Argentina
  const ar = new Date(date.getTime() - 3 * 3600 * 1000);
  return ar.toISOString().slice(0, 10).replace(/-/g, '');
}

export function aISO(aaaammdd) {
  if (!aaaammdd) return null;
  const s = String(aaaammdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function monto(n) {
  return (Math.round(Number(n) * 100) / 100).toFixed(2);
}

// ---------- Métodos ----------

export async function dummy(cfg) {
  const r = await llamar(cfg, 'FEDummy', {}, { conAuth: false });
  return { appServer: r.AppServer, dbServer: r.DbServer, authServer: r.AuthServer };
}

export async function ultimoAutorizado(cfg, cbteTipo = CBTE_TIPO.FACTURA_C, ptoVta = cfg.ptoVta) {
  const r = await llamar(cfg, 'FECompUltimoAutorizado', { PtoVta: ptoVta, CbteTipo: cbteTipo });
  lanzarSiErrores('FECompUltimoAutorizado', r);
  return Number(r.CbteNro || 0);
}

export async function consultar(cfg, cbteNro, cbteTipo = CBTE_TIPO.FACTURA_C, ptoVta = cfg.ptoVta) {
  const r = await llamar(cfg, 'FECompConsultar', {
    FeCompConsReq: { CbteTipo: cbteTipo, CbteNro: cbteNro, PtoVta: ptoVta },
  });
  const errs = errores(r);
  // 602 = no existe el comprobante
  if (errs.some((e) => String(e.code) === '602')) return null;
  lanzarSiErrores('FECompConsultar', r);
  const g = r.ResultGet;
  return {
    ptoVta: Number(g.PtoVta),
    cbteTipo: Number(g.CbteTipo),
    cbteNro: Number(g.CbteDesde),
    fecha: aISO(g.CbteFch),
    docTipo: Number(g.DocTipo),
    docNro: g.DocNro,
    importe: Number(g.ImpTotal),
    moneda: g.MonId,
    cotizacion: Number(g.MonCotiz),
    cae: g.CodAutorizacion,
    vtoCae: aISO(g.FchVto),
    resultado: g.Resultado,
    servDesde: aISO(g.FchServDesde),
    servHasta: aISO(g.FchServHasta),
    vtoPago: aISO(g.FchVtoPago),
  };
}

export async function cotizacion(cfg, monId = 'DOL') {
  const r = await llamar(cfg, 'FEParamGetCotizacion', { MonId: monId });
  lanzarSiErrores('FEParamGetCotizacion', r);
  return { monId: r.ResultGet.MonId, cotiz: Number(r.ResultGet.MonCotiz), fecha: aISO(r.ResultGet.FchCotiz) };
}

export async function parametros(cfg) {
  const condIva = await llamar(cfg, 'FEParamGetCondicionIvaReceptor', { ClaseCmp: 'C' });
  const tipos = await llamar(cfg, 'FEParamGetTiposCbte');
  const ptos = await llamar(cfg, 'FEParamGetPtosVenta');
  return {
    condicionesIvaReceptor: asArray(condIva?.ResultGet?.CondicionIvaReceptor).map((c) => ({ id: Number(c.Id), desc: c.Desc })),
    tiposComprobante: asArray(tipos?.ResultGet?.CbteTipo).map((c) => ({ id: Number(c.Id), desc: c.Desc })),
    puntosDeVenta: asArray(ptos?.ResultGet?.PtoVenta).map((p) => ({ nro: Number(p.Nro), tipo: p.EmisionTipo, bloqueado: p.Bloqueado })),
    erroresPtosVenta: errores(ptos),
  };
}

/**
 * Emite una Factura C.
 * datos = {
 *   importe: number,                 // total (en Factura C = neto, sin IVA discriminado)
 *   concepto?: 1|2|3,                // default 2 (servicios)
 *   receptor: { docTipo: 80|96|99, docNro: string, condicionIva: number },
 *   servDesde?, servHasta?, vtoPago?: 'YYYY-MM-DD'  // obligatorios si concepto 2/3
 *   fecha?: 'YYYY-MM-DD'             // default hoy
 *   moneda?: 'PES'|'DOL', cotizacion?: number, pagoMismaMoneda?: boolean
 * }
 */
export async function emitirFacturaC(cfg, datos) {
  const cbteTipo = CBTE_TIPO.FACTURA_C;
  const concepto = Number(datos.concepto || CONCEPTO.SERVICIOS);
  const fecha = fechaAAAAMMDD(datos.fecha || new Date());
  const moneda = datos.moneda || 'PES';

  let monCotiz = 1;
  if (moneda !== 'PES') {
    monCotiz = datos.cotizacion ? Number(datos.cotizacion) : (await cotizacion(cfg, moneda)).cotiz;
  }

  const ultimo = await ultimoAutorizado(cfg, cbteTipo);
  const nro = ultimo + 1;

  const det = {
    Concepto: concepto,
    DocTipo: datos.receptor.docTipo,
    DocNro: datos.receptor.docTipo === DOC_TIPO.SIN_IDENTIFICAR ? 0 : String(datos.receptor.docNro).replace(/\D/g, ''),
    CbteDesde: nro,
    CbteHasta: nro,
    CbteFch: fecha,
    ImpTotal: monto(datos.importe),
    ImpTotConc: '0.00',
    ImpNeto: monto(datos.importe),
    ImpOpEx: '0.00',
    ImpTrib: '0.00',
    ImpIVA: '0.00',
    FchServDesde: concepto !== CONCEPTO.PRODUCTOS ? fechaAAAAMMDD(datos.servDesde || datos.fecha || new Date()) : undefined,
    FchServHasta: concepto !== CONCEPTO.PRODUCTOS ? fechaAAAAMMDD(datos.servHasta || datos.fecha || new Date()) : undefined,
    FchVtoPago: concepto !== CONCEPTO.PRODUCTOS ? fechaAAAAMMDD(datos.vtoPago || datos.fecha || new Date()) : undefined,
    MonId: moneda,
    MonCotiz: moneda === 'PES' ? 1 : monCotiz,
    CanMisMonExt: moneda === 'PES' ? undefined : datos.pagoMismaMoneda ? 'S' : 'N',
    CondicionIVAReceptorId: datos.receptor.condicionIva,
  };

  const req = {
    FeCAEReq: {
      FeCabReq: { CantReg: 1, PtoVta: cfg.ptoVta, CbteTipo: cbteTipo },
      FeDetReq: { FECAEDetRequest: det },
    },
  };

  let r;
  try {
    r = await llamar(cfg, 'FECAESolicitar', req);
  } catch (e) {
    // Si se cortó la conexión, puede que ARCA lo haya autorizado igual: lo verificamos.
    const existente = await consultar(cfg, nro, cbteTipo).catch(() => null);
    if (existente && existente.cae) return { ...existente, recuperada: true, observaciones: [] };
    throw e;
  }

  const detResp = asArray(r?.FeDetResp?.FECAEDetResponse)[0] || {};
  const obs = asArray(detResp?.Observaciones?.Obs).map((o) => ({ code: o.Code, msg: o.Msg }));
  const errs = errores(r);

  if (detResp.Resultado !== 'A' || !detResp.CAE) {
    const detalle = [...errs, ...obs].map((e) => `[${e.code}] ${e.msg}`).join(' | ') || 'rechazada sin detalle';
    const err = new Error(`ARCA rechazó la factura: ${detalle}`);
    err.arca = [...errs, ...obs];
    throw err;
  }

  return {
    ptoVta: cfg.ptoVta,
    cbteTipo,
    cbteNro: nro,
    fecha: aISO(fecha),
    docTipo: det.DocTipo,
    docNro: String(det.DocNro),
    importe: Number(det.ImpTotal),
    moneda,
    cotizacion: Number(det.MonCotiz),
    cae: detResp.CAE,
    vtoCae: aISO(detResp.CAEFchVto),
    resultado: 'A',
    servDesde: aISO(det.FchServDesde),
    servHasta: aISO(det.FchServHasta),
    vtoPago: aISO(det.FchVtoPago),
    observaciones: obs,
  };
}
