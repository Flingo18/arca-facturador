// Genera el PDF de la Factura C con el QR obligatorio de ARCA.

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const DOC_LABEL = { 80: 'CUIT', 96: 'DNI', 99: 'Sin identificar' };
const TIPO_LABEL = { 11: 'FACTURA', 12: 'NOTA DE DÉBITO', 13: 'NOTA DE CRÉDITO' };

export function urlQR(cfg, f) {
  const data = {
    ver: 1,
    fecha: f.fecha,
    cuit: Number(cfg.cuit),
    ptoVta: f.ptoVta,
    tipoCmp: f.cbteTipo,
    nroCmp: f.cbteNro,
    importe: f.importe,
    moneda: f.moneda,
    ctz: f.cotizacion,
    tipoCodAut: 'E',
    codAut: Number(f.cae),
  };
  if (f.docTipo !== 99) {
    data.tipoDocRec = f.docTipo;
    data.nroDocRec = Number(f.docNro);
  }
  const p = Buffer.from(JSON.stringify(data)).toString('base64');
  return `https://www.afip.gob.ar/fe/qr/?p=${p}`;
}

const pad = (n, l) => String(n).padStart(l, '0');
const fechaAR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const plata = (n, moneda) =>
  `${moneda === 'PES' ? '$' : moneda === 'DOL' ? 'US$' : moneda + ' '} ${Number(n).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function numeroFormateado(f) {
  return `${pad(f.ptoVta, 5)}-${pad(f.cbteNro, 8)}`;
}

/**
 * @param cfg  configuración (emisor)
 * @param f    resultado de emitirFacturaC / consultar
 * @param extra { receptorNombre, receptorDomicilio, receptorCondicionIva, descripcion }
 * @returns Buffer
 */
export async function generarPDF(cfg, f, extra = {}) {
  const qrPng = await QRCode.toBuffer(urlQR(cfg, f), { margin: 0, width: 260 });
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - 72;
  const x0 = 36;
  let y = 36;

  // Encabezado: dos columnas con la letra en el medio
  doc.rect(x0, y, W, 120).stroke();
  doc.moveTo(x0 + W / 2, y + 40).lineTo(x0 + W / 2, y + 120).stroke();
  doc.rect(x0 + W / 2 - 24, y, 48, 40).stroke();
  doc.font('Helvetica-Bold').fontSize(26).text('C', x0 + W / 2 - 24, y + 4, { width: 48, align: 'center' });
  doc.fontSize(7).text(`COD. ${pad(f.cbteTipo, 3)}`, x0 + W / 2 - 24, y + 31, { width: 48, align: 'center' });

  // Emisor (izquierda)
  doc.font('Helvetica-Bold').fontSize(14).text(cfg.emisor.razonSocial || '—', x0 + 10, y + 14, { width: W / 2 - 50 });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Domicilio: ${cfg.emisor.domicilio}`, x0 + 10, y + 60, { width: W / 2 - 20 });
  doc.text(`Condición frente al IVA: ${cfg.emisor.condicionIva}`, x0 + 10, y + 88, { width: W / 2 - 20 });

  // Comprobante (derecha)
  const xr = x0 + W / 2 + 34;
  doc.font('Helvetica-Bold').fontSize(16).text(TIPO_LABEL[f.cbteTipo] || 'COMPROBANTE', xr, y + 10);
  doc.font('Helvetica').fontSize(9);
  doc.text(`Punto de Venta: ${pad(f.ptoVta, 5)}    Comp. Nro: ${pad(f.cbteNro, 8)}`, x0 + W / 2 + 10, y + 46);
  doc.text(`Fecha de Emisión: ${fechaAR(f.fecha)}`, x0 + W / 2 + 10, y + 60);
  doc.text(`CUIT: ${cfg.cuit}`, x0 + W / 2 + 10, y + 74);
  doc.text(`Ingresos Brutos: ${cfg.emisor.iibb}`, x0 + W / 2 + 10, y + 88);
  doc.text(`Inicio de Actividades: ${cfg.emisor.inicioActividades}`, x0 + W / 2 + 10, y + 102);
  y += 128;

  // Período
  if (f.servDesde) {
    doc.rect(x0, y, W, 22).stroke();
    doc.text(
      `Período Facturado Desde: ${fechaAR(f.servDesde)}    Hasta: ${fechaAR(f.servHasta)}    Fecha de Vto. para el pago: ${fechaAR(f.vtoPago)}`,
      x0 + 10,
      y + 7,
      { width: W - 20 }
    );
    y += 30;
  }

  // Receptor
  doc.rect(x0, y, W, 56).stroke();
  doc.text(`${DOC_LABEL[f.docTipo] || 'Doc'}: ${f.docTipo === 99 ? '—' : f.docNro}`, x0 + 10, y + 8, { width: W / 2 - 20 });
  doc.text(`Apellido y Nombre / Razón Social: ${extra.receptorNombre || '—'}`, x0 + W / 2, y + 8, { width: W / 2 - 10 });
  doc.text(`Condición frente al IVA: ${extra.receptorCondicionIva || '—'}`, x0 + 10, y + 24, { width: W / 2 - 20 });
  doc.text(`Domicilio: ${extra.receptorDomicilio || '—'}`, x0 + W / 2, y + 24, { width: W / 2 - 10 });
  doc.text('Condición de venta: Otra', x0 + 10, y + 40);
  y += 64;

  // Detalle
  doc.rect(x0, y, W, 18).fillAndStroke('#eeeeee', '#000000');
  doc.fillColor('#000000').font('Helvetica-Bold');
  doc.text('Descripción', x0 + 10, y + 5);
  doc.text('Cant.', x0 + W - 200, y + 5, { width: 40, align: 'right' });
  doc.text('Subtotal', x0 + W - 110, y + 5, { width: 100, align: 'right' });
  y += 24;
  doc.font('Helvetica');
  const desc = extra.descripcion || 'Servicios';
  doc.text(desc, x0 + 10, y, { width: W - 230 });
  doc.text('1,00', x0 + W - 200, y, { width: 40, align: 'right' });
  doc.text(plata(f.importe, f.moneda), x0 + W - 110, y, { width: 100, align: 'right' });
  y = Math.max(y + 20, doc.y + 10);

  // Totales
  const yTot = Math.max(y + 20, 560);
  doc.rect(x0, yTot, W, 60).stroke();
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`Subtotal: ${plata(f.importe, f.moneda)}`, x0 + W - 260, yTot + 10, { width: 250, align: 'right' });
  doc.text(`Importe Otros Tributos: ${plata(0, f.moneda)}`, x0 + W - 260, yTot + 24, { width: 250, align: 'right' });
  doc.fontSize(12).text(`Importe Total: ${plata(f.importe, f.moneda)}`, x0 + W - 260, yTot + 40, { width: 250, align: 'right' });
  if (f.moneda !== 'PES') {
    doc.font('Helvetica').fontSize(8).text(`Tipo de cambio: ${f.cotizacion}`, x0 + 10, yTot + 44);
  }

  // Pie: QR + CAE
  const yPie = yTot + 76;
  doc.image(qrPng, x0, yPie, { width: 90 });
  doc.font('Helvetica-Bold').fontSize(10).text('Comprobante Autorizado', x0 + 104, yPie + 10);
  doc.font('Helvetica').fontSize(8).text('Esta Administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación', x0 + 104, yPie + 26, { width: 230 });
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`CAE N°: ${f.cae}`, x0 + W - 220, yPie + 10, { width: 220, align: 'right' });
  doc.text(`Fecha de Vto. de CAE: ${fechaAR(f.vtoCae)}`, x0 + W - 220, yPie + 26, { width: 220, align: 'right' });

  if (cfg.env !== 'produccion') {
    doc.fillColor('#cc0000').fontSize(9).text('HOMOLOGACIÓN — comprobante de prueba sin validez fiscal', x0, yPie + 100, { width: W, align: 'center' });
  }

  doc.end();
  return done;
}
