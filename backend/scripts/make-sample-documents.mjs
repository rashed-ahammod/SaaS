/**
 * node scripts/make-sample-documents.mjs   -> samples/documents/
 *
 * Sample bills and receipts for the AI document reader (WP22). Each is a small image or PDF
 * that also carries what is printed on it as text (a PNG tEXt chunk "erp:document", or
 * "ERP-DOCUMENT:" in the PDF), so the fake provider (AI_PROVIDER=fake) can "read" it.
 * A real model reads the picture; for that, use real scans.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const out = new URL('../samples/documents/', import.meta.url);
mkdirSync(out, { recursive: true });

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A 32 x 20 off-white PNG with the printed text in a tEXt chunk (or none). */
function png(document) {
  const [w, h] = [32, 20];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rows = Buffer.alloc((w * 3 + 1) * h, 0xf4);
  for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0; // filter byte
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(document ? [chunk('tEXt', Buffer.concat([Buffer.from('erp:document\0', 'latin1'), Buffer.from(JSON.stringify(document), 'utf8')]))] : []),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF whose text is the document. */
function pdf(document, title) {
  const text = `ERP-DOCUMENT:${JSON.stringify(document)}`;
  const stream = `BT /F1 10 Tf 40 780 Td (${title}) Tj ET\n% ${text}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const files = {
  'bill-karim-traders-kt5590.png': png({
    vendorName: 'Karim Traders, Nawabpur Road', vendorBin: '000345678-0103', documentNo: 'KT-5590', date: '2026-10-24',
    lines: [{ description: 'A4 paper 80 gsm (Double A), 100 reams', amount: '65000', vatPercent: '15' }, { description: 'Box files, 50 pcs', amount: '7500', vatPercent: '15' }],
    subtotal: '72500', vat: '10875', total: '83375',
  }),
  'bill-link3-internet-oct-2026.pdf': pdf({
    vendorName: 'Link3 Technologies Ltd', vendorBin: '000567891-0101', documentNo: 'L3/2026/10/4471', date: '2026-10-05',
    lines: [{ description: 'Internet 100 Mbps, October 2026', amount: '23000', vatPercent: '5' }],
    subtotal: '23000', vat: '1150', total: '24150',
  }, 'Link3 Technologies Ltd - Tax invoice (Mushak 6.3) L3/2026/10/4471'),
  'receipt-shohag-bus-ctg.png': png({
    vendorName: 'Shohag Paribahan', vendorBin: null, documentNo: 'SP-118842', date: '2026-10-18',
    lines: [{ description: 'Bus ticket Dhaka to Chattogram (AC)', amount: '1400', vatPercent: null }],
    subtotal: '1400', vat: null, total: '1400',
  }),
  'receipt-hotel-agrabad.png': png({
    vendorName: 'Hotel Agrabad, Chattogram', vendorBin: '000222333-0201', documentNo: 'HA/10/7731', date: '2026-10-19',
    lines: [{ description: 'Room, 1 night (dealer visit)', amount: '6000', vatPercent: '15' }],
    subtotal: '6000', vat: '900', total: '6950',
  }),
  'blurred-photo.png': png(null),
};
for (const [name, data] of Object.entries(files)) writeFileSync(new URL(name, out), data);
console.log(`wrote ${Object.keys(files).length} files to samples/documents`);
