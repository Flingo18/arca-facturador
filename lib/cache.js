// Caché del ticket de acceso (TA) de WSAA.
// ARCA da un TA válido por ~12 h y rechaza pedir otro mientras el anterior siga vigente,
// así que hay que guardarlo. En memoria sirve mientras la función esté "caliente";
// con Upstash Redis (REST) sobrevive entre invocaciones de Vercel.

const memoria = new Map();

async function upstash(cfg, cmd) {
  const res = await fetch(cfg.upstash.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.upstash.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
  const data = await res.json();
  return data.result;
}

function usaUpstash(cfg) {
  return Boolean(cfg.upstash.url && cfg.upstash.token);
}

export async function cacheGet(cfg, key) {
  const m = memoria.get(key);
  if (m && m.expira > Date.now()) return m.valor;
  if (usaUpstash(cfg)) {
    try {
      const raw = await upstash(cfg, ['GET', key]);
      if (raw) {
        const valor = JSON.parse(raw);
        memoria.set(key, { valor, expira: new Date(valor.expiration).getTime() });
        return valor;
      }
    } catch (e) {
      console.warn('cacheGet Upstash falló:', e.message);
    }
  }
  return null;
}

export async function cacheSet(cfg, key, valor, ttlSeg) {
  memoria.set(key, { valor, expira: Date.now() + ttlSeg * 1000 });
  if (usaUpstash(cfg)) {
    try {
      await upstash(cfg, ['SET', key, JSON.stringify(valor), 'EX', String(Math.max(60, Math.floor(ttlSeg)))]);
    } catch (e) {
      console.warn('cacheSet Upstash falló:', e.message);
    }
  }
}

// Lectura/escritura directa (sin vencimiento) para los ajustes guardados desde /setup.
export function hayKv(cfg) {
  return usaUpstash(cfg);
}

export async function kvGet(cfg, key) {
  if (!usaUpstash(cfg)) return null;
  return upstash(cfg, ['GET', key]);
}

export async function kvSet(cfg, key, valor) {
  if (!usaUpstash(cfg)) throw new Error('No hay base Upstash conectada al proyecto de Vercel');
  return upstash(cfg, ['SET', key, valor]);
}
