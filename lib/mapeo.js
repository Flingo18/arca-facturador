// Traduce los valores tal como están en Notion a los códigos de ARCA.

import { CONDICION_IVA, DOC_TIPO } from './wsfe.js';

function errorDatos(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

export function mapearReceptor(r = {}) {
  const tipo = (r.tipoDocumento || '').trim();
  const condicion = (r.condicionIva || '').trim();

  if (condicion === 'Cliente del Exterior') {
    throw errorDatos('Clientes del exterior requieren Factura E (exportación de servicios), que todavía no está implementada.');
  }
  const condicionIva = CONDICION_IVA[condicion];
  if (!condicionIva) throw errorDatos(`Condición IVA del cliente vacía o desconocida: "${condicion}"`);

  let docTipo;
  if (tipo === 'CUIT') docTipo = DOC_TIPO.CUIT;
  else if (tipo === 'DNI') docTipo = DOC_TIPO.DNI;
  else if (tipo === 'Sin identificar' || !tipo) docTipo = DOC_TIPO.SIN_IDENTIFICAR;
  else throw errorDatos(`Tipo de documento desconocido: "${tipo}"`);

  const docNro = String(r.nroDocumento || '').replace(/\D/g, '');
  if (docTipo === DOC_TIPO.CUIT && docNro.length !== 11) throw errorDatos(`El CUIT del cliente tiene que tener 11 dígitos (llegó "${r.nroDocumento || ''}")`);
  if (docTipo === DOC_TIPO.DNI && (docNro.length < 7 || docNro.length > 8)) throw errorDatos(`DNI inválido: "${r.nroDocumento || ''}"`);
  if (docTipo === DOC_TIPO.SIN_IDENTIFICAR && condicionIva !== CONDICION_IVA['Consumidor Final']) {
    throw errorDatos('Sin documento solo se puede facturar a Consumidor Final.');
  }

  return { docTipo, docNro, condicionIva };
}

export function mapearMoneda(m) {
  const v = (m || 'ARS').toUpperCase();
  if (v === 'ARS' || v === 'PES') return 'PES';
  if (v === 'USD' || v === 'DOL') return 'DOL';
  throw errorDatos(`Moneda no soportada: ${m}`);
}

export function validarImporte(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) throw errorDatos(`Importe inválido: ${n}`);
  return v;
}
