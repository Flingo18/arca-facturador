// Prueba los botones de Notion con la API de Notion simulada (sin tocar ARCA).
import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const k of Object.keys(process.env)) if (/^(ARCA_|EMISOR_|UPSTASH_|KV_|NOTION_)/.test(k)) delete process.env[k];
process.env.API_SECRET = 'secreto-de-prueba';
process.env.NOTION_TOKEN = 'ntn_prueba';

const paginas = {
  f1: { object: 'page', id: 'f1', properties: { Estado: { select: { name: 'Borrador' } }, Importe: { number: 5000 }, 'Número': { rich_text: [] }, Cliente: { relation: [] }, Concepto: { title: [{ plain_text: 'Algo' }] } } },
  f2: { object: 'page', id: 'f2', properties: { Estado: { select: { name: 'Emitida' } }, Importe: { number: 5000 }, 'Número': { rich_text: [{ plain_text: '00002-00000009' }] }, CAE: { rich_text: [{ plain_text: '123' }] } } },
};
const patches = [];
globalThis.fetch = async (url, opts = {}) => {
  const ruta = String(url).replace('https://api.notion.com/v1', '');
  assert.equal(opts.headers.Authorization, 'Bearer ntn_prueba');
  const id = ruta.split('/')[2];
  if (opts.method === 'PATCH') { patches.push({ id, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({}) }; }
  const p = paginas[id];
  return p ? { ok: true, json: async () => p } : { ok: false, status: 404, json: async () => ({ code: 'object_not_found' }) };
};

const { default: emitir } = await import('../api/notion/emitir.js');
const { claveBotones, getConfig } = await import('../lib/config.js');
const KEY = claveBotones(getConfig());

function llamar(method, url, body) {
  return new Promise((resolve) => {
    const req = { method, url, headers: {}, body };
    const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, end(s) { resolve({ status: this.statusCode, tipo: this.h['Content-Type'], body: s }); } };
    emitir(req, res);
  });
}

test('rechaza sin clave', async () => {
  const r = await llamar('POST', '/api/notion/emitir', { data: { id: 'f1' } });
  assert.equal(r.status, 401);
});

test('la clave de botones no es la de instalación', () => {
  assert.notEqual(KEY, 'secreto-de-prueba');
  assert.equal(KEY.length, 32);
});

test('webhook de Notion: factura sin cliente queda en Error', async () => {
  paginas['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'] = { ...paginas.f1, id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1' };
  patches.length = 0;
  const r = await llamar('POST', `/api/notion/emitir?key=${KEY}`, { source: { type: 'automation' }, data: { object: 'page', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' } });
  assert.equal(r.status, 400);
  assert.match(JSON.parse(r.body).error, /Elegí un cliente/);
  assert.equal(patches[0].body.properties.Estado.select.name, 'Emitiendo');
  assert.equal(patches.at(-1).body.properties.Estado.select.name, 'Error');
});

test('link de fórmula: ya emitida devuelve página HTML sin tocar Notion', async () => {
  paginas['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2'] = { ...paginas.f2, id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2' };
  patches.length = 0;
  const r = await llamar('GET', `/api/notion/emitir?key=${KEY}&page=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2`);
  assert.equal(r.status, 200);
  assert.match(r.tipo, /text\/html/);
  assert.match(r.body, /ya estaba emitida \(00002-00000009\)/);
  assert.equal(patches.length, 0);
});
