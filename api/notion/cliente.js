// Botón "Completar con ARCA" de la base Clientes de Notion.
// POST (webhook de botón/automatización) o GET (link en fórmula): ?key=<clave de botones>&page=<id>
import { crearHandler } from '../../lib/botones.js';
import { completarClienteDesdeNotion } from '../../lib/flujos.js';

export default crearHandler(completarClienteDesdeNotion, (r) => ({
  ok: true,
  titulo: `${r.razonSocial} actualizado`,
  lineas: [`${r.condicionIva} · CUIT ${r.estadoCuit || 's/d'}`, r.domicilioFiscal || ''],
}));
