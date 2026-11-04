# arca-facturador

Servicio chico para emitir **Factura C** (monotributo) directo contra los web services de ARCA, sin intermediarios. Se despliega en Vercel y lo dispara n8n desde la base **Cobrables** de Notion (Clave).

- **WSAA**: firma el pedido de acceso con tu certificado y guarda el ticket (12 h).
- **WSFEv1**: pide el CAE, consulta comprobantes y el último número emitido.
- **PDF**: genera la factura con el QR obligatorio.

## Endpoints

Todos piden el header `x-api-key: <API_SECRET>`.

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/api/emitir` | Emite la factura y devuelve número, CAE, vencimiento del CAE y el PDF en base64 |
| `GET` | `/api/consultar?numero=00001-00000012` | Trae una factura de ARCA (`existe: true/false`). Sin número, trae la última |
| `POST` | `/api/consultar` | Igual, con `"pdf": true` + datos del receptor para regenerar el PDF |
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

Los valores de `tipoDocumento` y `condicionIva` son los mismos que las opciones de la base Clientes en Notion.

Si la conexión con ARCA se corta después de pedir el CAE, el servicio consulta si el comprobante quedó autorizado antes de dar error, para no duplicar números.

## Variables de entorno

Ver `.env.example`. Las importantes:

- `ARCA_ENV`: `homologacion` o `produccion`
- `ARCA_CUIT`, `ARCA_PTO_VTA`
- `ARCA_CERT`, `ARCA_KEY`: certificado y clave en PEM (o `_B64`)
- `API_SECRET`: clave compartida con n8n
- `EMISOR_*`: datos que salen en el PDF
- `UPSTASH_REDIS_REST_URL` / `TOKEN`: **recomendado**. ARCA no deja pedir un ticket nuevo mientras el anterior está vigente; sin caché persistente, después de un "arranque en frío" de Vercel podés quedar bloqueado hasta 12 h.

## Certificado de homologación (Mac)

```bash
bash scripts/generar-csr.sh 20XXXXXXXXX "Tu Nombre" homologacion
```

Deja `arca.key` y `arca.csr` en `~/arca-certs/homologacion/`. Después, en ARCA con clave fiscal:

1. Adherir el servicio **WSASS – Autogestión Certificados Homologación**.
2. En WSASS → *Nuevo certificado*: pegar el CSR y descargar el certificado.
3. En WSASS → *Crear autorización a servicio*: elegir el certificado y el servicio **wsfe**.

La clave privada y el certificado van **solo** a las variables de entorno de Vercel.

## Pendiente

- Factura E (clientes del exterior) vía WSFEX.
- Notas de crédito C.

## Tests

```bash
npm install
npm test
```

Prueban firma, XML, mapeo de datos y PDF sin conectarse a ARCA.
