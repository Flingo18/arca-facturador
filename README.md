# Facturador ARCA

Emití **Factura C** (monotributo) directo contra los web services de ARCA, sin intermediarios y sin pagar un servicio de facturación. Está pensado para dispararse desde **Notion** con **n8n**, pero es una API común: la podés llamar desde Make, Zapier o tu propio código.

- **WSAA**: firma el pedido de acceso con tu certificado y guarda el ticket (12 h).
- **WSFEv1**: pide el CAE, consulta comprobantes y el último número emitido.
- **Padrón A5**: trae razón social, condición IVA y domicilio de un CUIT.
- **PDF**: genera la factura con el QR obligatorio.

## Instalación (sin terminal)

1. Tocá el botón y seguí los pasos de Vercel. Te va a pedir una **clave de instalación** (`API_SECRET`): inventá una larga y guardala.

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FFlingo18%2Farca-facturador&project-name=facturador-arca&repository-name=facturador-arca&env=API_SECRET&envDescription=Invent%C3%A1%20una%20clave%20larga%20(20%20caracteres%20o%20m%C3%A1s).%20La%20vas%20a%20usar%20en%20la%20p%C3%A1gina%20de%20configuraci%C3%B3n%20y%20en%20n8n.)

2. En el proyecto de Vercel: **Storage → Create Database → Upstash for Redis** (plan gratis) → **Connect** al proyecto. Después **Deployments → ⋯ → Redeploy**.
3. Abrí la dirección de tu app (por ejemplo `https://facturador-arca-xxxx.vercel.app`). Ahí está el asistente de configuración: tus datos, el certificado de ARCA y una prueba de conexión.

Cada instalación es de una sola persona: tu certificado y tu clave privada quedan en tu propio proyecto de Vercel (la clave, cifrada con tu clave de instalación).

## Endpoints

Todos piden el header `x-api-key: <API_SECRET>`.

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
