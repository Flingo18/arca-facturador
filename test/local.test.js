// Pruebas que no tocan ARCA: firma CMS, XML, mapeo de datos y PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { crearTRA, firmarCMS } from '../lib/wsaa.js';
import { toXml, parseXml } from '../lib/soap.js';
import { mapearReceptor, mapearMoneda } from '../lib/mapeo.js';
import { fechaAAAAMMDD } from '../lib/wsfe.js';
import { generarPDF, urlQR } from '../lib/pdf.js';

function certDePrueba() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const attrs = [{ name: 'commonName', value: 'test' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey) };
}

test('TRA tiene servicio y fechas con -03:00', () => {
  const tra = crearTRA('wsfe', new Date('2026-11-04T20:00:00Z'));
  assert.match(tra, /<service>wsfe<\/service>/);
  assert.match(tra, /<generationTime>2026-11-04T16:50:00-03:00<\/generationTime>/);
  assert.match(tra, /<expirationTime>2026-11-04T17:10:00-03:00<\/expirationTime>/);
});

test('firma CMS válida que contiene el TRA', () => {
  const { cert, key } = certDePrueba();
  const tra = crearTRA('wsfe');
  const b64 = firmarCMS(tra, cert, key);
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(b64)));
  assert.equal(p7.rawCapture.content.value[0].value, tra);
  assert.equal(p7.certificates.length, 1);
});

test('firma CMS aunque cert y clave lleguen sin líneas BEGIN/END', () => {
  const { cert, key } = certDePrueba();
  const sinHeaders = (p) => p.replace(/-----[^-]+-----/g, '').trim();
  const b64 = firmarCMS(crearTRA('wsfe'), sinHeaders(cert), sinHeaders(forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(forge.pki.privateKeyFromPem(key))))));
  assert.ok(b64.length > 100);
});

test('padrón: interpreta monotributista y responsable inscripto', async () => {
  const { interpretarPersona } = await import('../lib/padron.js');
  const mono = interpretarPersona({
    datosGenerales: { idPersona: '20123456789', apellido: 'PEREZ', nombre: 'JUAN', estadoClave: 'ACTIVO', domicilioFiscal: { direccion: 'CALLE 1', descripcionProvincia: 'CIUDAD AUTONOMA BUENOS AIRES', codPostal: '1425' } },
    datosMonotributo: { categoriaMonotributo: { descripcionCategoria: 'C' } },
  });
  assert.equal(mono.razonSocial, 'PEREZ JUAN');
  assert.equal(mono.condicionIva, 'Monotributo');
  assert.equal(mono.domicilioFiscal, 'CALLE 1, CABA (1425)');
  const ri = interpretarPersona({
    datosGenerales: { idPersona: '30712345678', razonSocial: 'EMPRESA SRL', domicilioFiscal: { direccion: 'AV X 100', localidad: 'ROSARIO', descripcionProvincia: 'SANTA FE', codPostal: '2000' } },
    datosRegimenGeneral: { impuesto: [{ idImpuesto: '30' }, { idImpuesto: '10' }] },
    errorConstancia: { error: 'domicilio no confirmado' },
  });
  assert.equal(ri.condicionIva, 'Responsable Inscripto');
  assert.equal(ri.domicilioFiscal, 'AV X 100, ROSARIO, SANTA FE (2000)');
  assert.deepEqual(ri.avisos, ['domicilio no confirmado']);
});

test('toXml respeta orden y omite undefined', () => {
  const xml = toXml({ A: 1, B: undefined, C: { D: 'x&y' } });
  assert.equal(xml, '<ar:A>1</ar:A><ar:C><ar:D>x&amp;y</ar:D></ar:C>');
});

test('parseXml no convierte CAE a número', () => {
  const r = parseXml('<a><CAE>76451234567890</CAE><DocNro>20123456789</DocNro></a>');
  assert.equal(r.a.CAE, '76451234567890');
});

test('mapeo de receptor', () => {
  assert.deepEqual(mapearReceptor({ tipoDocumento: 'CUIT', nroDocumento: '30-71234567-8', condicionIva: 'Responsable Inscripto' }), {
    docTipo: 80,
    docNro: '30712345678',
    condicionIva: 1,
  });
  assert.equal(mapearReceptor({ tipoDocumento: 'Sin identificar', condicionIva: 'Consumidor Final' }).docTipo, 99);
  assert.throws(() => mapearReceptor({ tipoDocumento: 'CUIT', nroDocumento: '123', condicionIva: 'Monotributo' }));
  assert.throws(() => mapearReceptor({ tipoDocumento: 'CUIT', nroDocumento: '30712345678', condicionIva: 'Cliente del Exterior' }));
  assert.throws(() => mapearReceptor({ tipoDocumento: 'CUIT', nroDocumento: '30712345678' }));
  assert.equal(mapearMoneda('USD'), 'DOL');
});

test('fechas en formato ARCA', () => {
  assert.equal(fechaAAAAMMDD('2026-11-04'), '20261104');
  assert.equal(fechaAAAAMMDD(new Date('2026-11-05T01:00:00Z')), '20261104'); // 22 h en Argentina
});

test('genera PDF con QR', async () => {
  const cfg = {
    env: 'homologacion',
    cuit: '20123456789',
    emisor: { razonSocial: 'Prueba', domicilio: 'Calle 1', inicioActividades: '01/01/2020', iibb: 'Exento', condicionIva: 'Responsable Monotributo' },
  };
  const f = {
    ptoVta: 1, cbteTipo: 11, cbteNro: 12, fecha: '2026-11-04', docTipo: 80, docNro: '30712345678',
    importe: 150000, moneda: 'PES', cotizacion: 1, cae: '76451234567890', vtoCae: '2026-11-14',
    servDesde: '2026-11-01', servHasta: '2026-11-30', vtoPago: '2026-11-10',
  };
  const qr = urlQR(cfg, f);
  const data = JSON.parse(Buffer.from(qr.split('p=')[1], 'base64').toString());
  assert.equal(data.codAut, 76451234567890);
  assert.equal(data.tipoCodAut, 'E');
  const pdf = await generarPDF(cfg, f, { receptorNombre: 'Cliente SRL', descripcion: 'Mantenimiento noviembre' });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
