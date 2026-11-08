/**
 * The quotation and the VAT invoice (Mushak 6.3) as PDF, in Bangla or English (WP25-WP26).
 * One layout: the company, the document's number and dates, the customer, the lines
 * (quantity, unit price, discount, value, VAT) and the totals. The layout of Mushak 6.3 is
 * ILLUSTRATIVE: the NBR form's exact boxes are to be checked with the company's VAT consultant.
 */
import { formatAmount, toBanglaDigits } from '../../platform/money/format.js';
import { Money } from '../../platform/money/money.js';
import { createCanvas } from '../../platform/pdf/pdf-canvas.js';

export interface SalesDocument {
  kind: 'quotation' | 'invoice';
  lang: 'bn' | 'en';
  company: { name: string; bin: string | null; address: string | null };
  number: string;
  date: string;
  /** quotation: valid until; invoice: due date */
  secondDate: string;
  customer: {
    code: string;
    name: string;
    bin: string | null;
    address: string | null;
  };
  lines: Array<{
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountPercent: string;
    value: string;
    vatPercent: string;
    vatAmount: string;
    sdAmount: string;
  }>;
  totals: { value: string; sd: string; vat: string; total: string };
  terms?: string | null;
  reference?: string | null;
}

const T = {
  en: {
    quotation: 'Quotation',
    invoice: 'Tax invoice (Mushak 6.3)',
    no: 'No.',
    date: 'Date',
    validUntil: 'Valid until',
    due: 'Payment due',
    to: 'To',
    bin: 'BIN',
    item: 'Description',
    qty: 'Qty',
    price: 'Unit price',
    disc: 'Disc. %',
    value: 'Value',
    vat: 'VAT',
    sd: 'SD',
    total: 'Total',
    terms: 'Terms',
    ref: 'Order',
    sign: 'Authorised signature',
  },
  bn: {
    quotation: 'মূল্য প্রস্তাব (কোটেশন)',
    invoice: 'কর চালানপত্র (মূসক ৬.৩)',
    no: 'নং',
    date: 'তারিখ',
    validUntil: 'বৈধ',
    due: 'পরিশোধের শেষ তারিখ',
    to: 'প্রাপক',
    bin: 'বিআইএন',
    item: 'বিবরণ',
    qty: 'পরিমাণ',
    price: 'একক মূল্য',
    disc: 'ছাড় %',
    value: 'মূল্য',
    vat: 'ভ্যাট',
    sd: 'সম্পূরক শুল্ক',
    total: 'মোট',
    terms: 'শর্তাবলি',
    ref: 'অর্ডার',
    sign: 'অনুমোদিত স্বাক্ষর',
  },
};

export async function renderSalesDocumentPdf(
  d: SalesDocument,
): Promise<Buffer> {
  const t = T[d.lang];
  const n = (text: string) => (d.lang === 'bn' ? toBanglaDigits(text) : text);
  const tk = (amount: string) => formatAmount(Money.of(amount), d.lang);
  const { left, width, draw, paragraph, rule, end } = createCanvas({
    title: `${d.kind === 'quotation' ? 'Quotation' : 'Invoice'} ${d.number}`,
    author: d.company.name,
  });

  let y = 50;
  draw(d.company.name, left, y, {
    size: 15,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 20;
  const companyLine = [
    d.company.address,
    d.company.bin ? `${t.bin}: ${n(d.company.bin)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (companyLine)
    draw(companyLine, left, y, { size: 9, align: 'center', boxWidth: width });
  y += 22;
  draw(d.kind === 'quotation' ? t.quotation : t.invoice, left, y, {
    size: 13,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 24;
  draw(`${t.no}: ${d.number}`, left, y, { size: 10, bold: true });
  draw(`${t.date}: ${n(d.date)}`, left, y, {
    size: 10,
    align: 'right',
    boxWidth: width,
  });
  y += 15;
  if (d.reference) draw(`${t.ref}: ${d.reference}`, left, y, { size: 9 });
  draw(
    `${d.kind === 'quotation' ? t.validUntil : t.due}: ${n(d.secondDate)}`,
    left,
    y,
    { size: 10, align: 'right', boxWidth: width },
  );
  y += 20;
  draw(`${t.to}: ${d.customer.name} (${d.customer.code})`, left, y, {
    size: 10,
    bold: true,
  });
  y += 14;
  const customerLine = [
    d.customer.address,
    d.customer.bin ? `${t.bin}: ${n(d.customer.bin)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (customerLine) y = paragraph(customerLine, left, y, width, { size: 9 });
  y += 10;

  // the lines
  const cols = [
    { x: 0, w: 0.34, label: t.item, align: 'left' as const },
    { x: 0.34, w: 0.1, label: t.qty, align: 'right' as const },
    { x: 0.44, w: 0.13, label: t.price, align: 'right' as const },
    { x: 0.57, w: 0.08, label: t.disc, align: 'right' as const },
    { x: 0.65, w: 0.18, label: t.value, align: 'right' as const },
    { x: 0.83, w: 0.17, label: t.vat, align: 'right' as const },
  ];
  rule(y);
  y += 5;
  for (const c of cols)
    draw(c.label, left + c.x * width, y, {
      size: 9,
      bold: true,
      align: c.align,
      boxWidth: c.w * width - 4,
    });
  y += 14;
  rule(y);
  y += 5;
  for (const l of d.lines) {
    const cells = [
      l.description,
      `${n(l.quantity)} ${l.unit}`,
      tk(l.unitPrice),
      n(Money.of(l.discountPercent).toDb()),
      tk(l.value),
      `${tk(Money.of(l.vatAmount).plus(l.sdAmount).toDb())} (${n(l.vatPercent)}%)`,
    ];
    const top = y;
    y = paragraph(cells[0], left, top, cols[0].w * width - 6, { size: 9 });
    cells.slice(1).forEach((text, i) =>
      draw(text, left + cols[i + 1].x * width, top, {
        size: 9,
        align: 'right',
        boxWidth: cols[i + 1].w * width - 4,
      }),
    );
    y = Math.max(y, top + 13) + 3;
  }
  rule(y);
  y += 8;
  const totals: Array<[string, string]> = [
    [t.value, d.totals.value],
    ...(Money.of(d.totals.sd).isZero()
      ? []
      : [[t.sd, d.totals.sd] as [string, string]]),
    [t.vat, d.totals.vat],
    [t.total, d.totals.total],
  ];
  for (const [label, amount] of totals) {
    const bold = label === t.total;
    draw(label, left + 0.55 * width, y, { size: 10, bold });
    draw(`৳ ${tk(amount)}`, left + 0.65 * width, y, {
      size: 10,
      bold,
      align: 'right',
      boxWidth: 0.35 * width - 4,
    });
    y += 15;
  }
  if (d.terms) {
    y += 10;
    draw(t.terms, left, y, { size: 10, bold: true });
    y = paragraph(d.terms, left, y + 14, width, { size: 9 });
  }
  y += 50;
  draw(t.sign, left + 0.6 * width, y, {
    size: 9,
    align: 'center',
    boxWidth: 0.4 * width,
  });
  return end();
}
