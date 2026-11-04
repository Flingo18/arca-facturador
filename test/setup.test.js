// Prueba el asistente /api/setup con una base Upstash simulada (sin tocar ARCA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';

const db = new Map();
globalThis.fetch = async (url, opts) => {
  const [cmd, key, val] = JSON.parse(opts.body);
  let result = null;
  if (cmd === 'GET') result = db.get(key) ?? null;
  if (cmd === 'SET') { db.set(key, val); result = 'OK'; }
  return { ok: true, json: async () => ({ result }) };
};

for (const k of Object.keys(process.env)) if (/^(ARCA_|EMISOR_|UPSTASH_|KV_)/.test(k)) delete process.env[k];
process.env.API_SECRET = 'clave-de-prueba-123';
process.env.KV_REST_API_URL = 'https://fake.upstash.io';
process.env.KV_REST_API_TOKEN = 'x';

const { default: setup } = await import('../api/setup.js');
const { cargarConfig } = await import('../lib/config.js');

function llamar(method, body, secret = 'clave-de-prueba-123') {
  return new Promise((resolve) => {
    const req = { method, headers: { 'x-api-key': secret }, body, url: '/api/setup' };
    const res = { statusCode: 200, setHeader() {}, end(s) { resolve({ status: this.statusCode, data: JSON.parse(s) }); } };
    setup(req, res);
  });
}

test('rechaza clave incorrecta', async () => {
  const r = await llamar('GET', undefined, 'otra');
  assert.equal(r.status, 401);
});

test('flujo completo: datos → CSR → certificado', async () => {
  let r = await llamar('POST', { accion: 'datos', cuit: '20-12345678-9', razonSocial: 'Ana Pérez', domicilio: 'Calle 1', ptoVta: '3', entorno: 'produccion' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.cuit, '20123456789');
  assert.equal(r.data.ptoVta, 3);
  assert.equal(r.data.entorno, 'produccion');

  r = await llamar('POST', { accion: 'generar-csr' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.csr, /BEGIN CERTIFICATE REQUEST/);
  const csr = forge.pki.certificationRequestFromPem(r.data.csr);
  assert.ok(csr.verify());
  assert.equal(csr.subject.getField('CN').value, 'facturadornotion');
  assert.equal(csr.subject.getField({ type: '2.5.4.5' }).value, 'CUIT 20123456789');

  // La clave no queda en texto plano en la base
  const crudo = db.get('arca:ajustes');
  assert.doesNotMatch(crudo, /PRIVATE KEY/);

  // Simula el certificado que devuelve ARCA, firmado sobre la clave pública del CSR
  const caKeys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey;
  cert.serialNumber = '05';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 2 * 365 * 86400000);
  cert.setSubject(csr.subject.attributes);
  cert.setIssuer([{ name: 'commonName', value: 'Computadores' }]);
  cert.sign(caKeys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);

  r = await llamar('POST', { accion: 'certificado', pem: certPem });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.certificado.coincideConClave, true);
  assert.equal(r.data.csr, null);

  const cfg = await cargarConfig();
  assert.equal(cfg.cuit, '20123456789');
  assert.match(cfg.key, /PRIVATE KEY/);
  assert.match(cfg.cert, /BEGIN CERTIFICATE/);
  assert.equal(cfg.emisor.razonSocial, 'Ana Pérez');

  // Generar otro con certificado cargado pide confirmación
  r = await llamar('POST', { accion: 'generar-csr' });
  assert.equal(r.status, 409);
});

test('rechaza un certificado que no corresponde a la clave', async () => {
  const otra = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = otra.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  cert.setSubject([{ name: 'commonName', value: 'x' }]);
  cert.setIssuer([{ name: 'commonName', value: 'x' }]);
  cert.sign(otra.privateKey, forge.md.sha256.create());
  const r = await llamar('POST', { accion: 'certificado', pem: forge.pki.certificateToPem(cert) });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /no corresponde/);
});
