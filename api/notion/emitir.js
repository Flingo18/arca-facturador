// Botón "Emitir factura" de la base Facturas de Notion.
// POST (webhook de botón/automatización) o GET (link en fórmula): ?key=<clave de botones>&page=<id>
import { crearHandler } from '../../lib/botones.js';
import { emitirDesdeNotion } from '../../lib/flujos.js';

const pesos = (n) => Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

export default crearHandler(emitirDesdeNotion, (r) => {
  if (r.yaEmitida) return { ok: true, titulo: `Esta factura ya estaba emitida (${r.numero})`, lineas: [r.cae ? `CAE ${r.cae}` : ''] };
  if (!r.ok) return { ok: false, titulo: r.error };
  return {
    ok: true,
    titulo: `Factura C ${r.numero} emitida`,
    lineas: [`${r.cliente} · ${pesos(r.importe)}`, `CAE ${r.cae} (vence ${r.vtoCae})`, r.pdf ? 'El PDF quedó adjunto en Notion.' : 'No se pudo adjuntar el PDF; el detalle está en la columna Error.'],
  };
});
