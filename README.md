# Facturador ARCA

Emití **Factura C** (monotributo) directo contra los web services de ARCA, sin intermediarios y sin pagar un servicio de facturación. Se usa desde **Notion**: un botón en tu base de facturas emite la factura en ARCA y te deja número, CAE y PDF en la misma página. También es una API común: la podés llamar desde n8n, Make, Zapier o tu propio código.

- **WSAA**: firma el pedido de acceso con tu certificado y guarda el ticket (12 h).
- **WSFEv1**: pide el CAE, consulta comprobantes y el último número emitido.
- **Padrón A5**: trae razón social, condición IVA y domicilio de un CUIT.
- **PDF**: genera la factura con el QR obligatorio.

## Instalación (sin terminal)

1. Tocá el botón y seguí los pasos de Vercel. Te va a pedir una **clave de instalación** (`API_SECRET`): inventá una larga y guardala.

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FFlingo18%2Farca-facturador&project-name=facturador-arca&repository-name=facturador-arca&env=API_SECRET&envDescription=Invent%C3%A1%20una%20clave%20larga%20(20%20caracteres%20o%20m%C3%A1s)%20y%20guardala%3A%20la%20vas%20a%20usar%20para%20entrar%20a%20la%20p%C3%A1gina%20de%20configuraci%C3%B3n.)

2. En el proyecto de Vercel: **Storage → Create Database → Upstash for Redis** (plan gratis) → **Connect** al proyecto. Después **Deployments → ⋯ → Redeploy**.
3. Abrí la dirección de tu app (por ejemplo `https://facturador-arca-xxxx.vercel.app`). Ahí está el asistente de configuración: tus datos, el certificado de ARCA, la prueba de conexión, la conexión con Notion y las direcciones para los botones.

Cada instalación es de una sola persona: tu certificado, tu clave privada y el token de Notion quedan en tu propio proyecto de Vercel (cifrados con tu clave de instalación).

## Botones de Notion

| Endpoint | Botón | Qué hace |
|---|---|---|
| `POST/GET /api/notion/emitir?key=…` | 🧾 Emitir factura (base Facturas) | Lee la factura y el cliente, emite la Factura C, guarda Número, CAE, fechas y adjunta el PDF |
| `POST/GET /api/notion/cliente?key=…` | 🔎 Completar con ARCA (base Clientes) | Busca el CUIT en el padrón y completa razón social, condición IVA y domicilio fiscal |

- `POST`: acción **Enviar webhook** de un botón o automatización de Notion (planes pagos). La app toma el ID de la página del cuerpo que manda Notion.
- `GET` con `&page=<id>`: link desde una propiedad fórmula, para el plan gratis.
- `key` es una clave derivada de `API_SECRET` que solo sirve para estos dos endpoints; el asistente te da las direcciones completas.

## Endpoints de la API

Piden el header `x-api-key: <API_SECRET>`.


| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/api/emitir` | Emite la factura y devuelve número, CAE, vencimiento del CAE y el PDF en base64 |
| `GET` | `/api/consultar?numero=00001-00000012` | Trae una factura de ARCA (`existe: true/false`). Sin número, trae la última |
| `POST` | `/api/consultar` | Igual, con `"pdf": true` + datos del receptor para regenerar el PDF |
| `GET` | `/api/padron?cuit=30712345678` | Razón social, condición IVA y domicilio fiscal del CUIT (constancia de inscripción) |
| `GET` | `/api/estado` | Chequea que ARCA responda y devuelve el último número. `?parametros=1` suma condiciones IVA y puntos de venta |

### Ejemplo de `/api/emitir`

```json
{
  "importe": 150000,
  "moneda": "ARS",
  "descripcion": "Mantenimiento mensual - noviembre",
  "periodoDesde": "2026-11-01",
  "periodoHasta": "2026-11-30",
  "vencimiento": "2026-11-10",
  "receptor": {
    "nombre": "Clínica Ejemplo SRL",
    "tipoDocumento": "CUIT",
    "nroDocumento": "30712345678",
    "condicionIva": "Responsable Inscripto",
    "domicilio": "Av. Siempreviva 742"
  }
}
```

Los valores de `tipoDocumento` y `condicionIva` son los mismos que las opciones de la base Clientes del template de Notion.

Si la conexión con ARCA se corta después de pedir el CAE, el servicio consulta si el comprobante quedó autorizado antes de dar error, para no duplicar números.

## Variables de entorno

La única obligatoria es `API_SECRET`. Lo demás se carga desde el asistente; si preferís variables de entorno, tienen prioridad sobre lo guardado ahí (ver `.env.example`):

- `ARCA_ENV`: `homologacion` o `produccion`
- `ARCA_CUIT`, `ARCA_PTO_VTA`
- `ARCA_CERT`, `ARCA_KEY`: certificado y clave en PEM (o `_B64`)
- `EMISOR_*`: datos que salen en el PDF
- `NOTION_TOKEN`: secreto de la integración interna de Notion
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (los crea la integración de Upstash): guardan el ticket de ARCA y los ajustes del asistente. ARCA no deja pedir un ticket nuevo mientras el anterior está vigente, así que sin esta base podés quedar bloqueado hasta 12 h.

## Generar el certificado por terminal (opcional)

Si preferís no usar el asistente:

```bash
bash scripts/generar-csr.sh 20XXXXXXXXX "Tu Nombre" produccion
```

## Pendiente

- Factura E (clientes del exterior) vía WSFEX.
- Notas de crédito C.

## Tests

```bash
npm install
npm test
```
