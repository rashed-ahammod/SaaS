/**
 * Annual salary tax certificate (spec §6.4) in Bangla or English: the salary
 * paid in an income year (July to June), the tax deducted at source each month
 * with the challans that deposited it, and tax deducted earlier (opening, prior
 * employer).
 *
 * The layout follows the usual certificate of tax deducted from salary; the
 * legal wording and section reference are placeholders until the tax adviser
 * signs them off (verify).
 */
import { formatAmount, toBanglaDigits } from '../../platform/money/format.js';
import { Money } from '../../platform/money/money.js';
import { createCanvas } from '../../platform/pdf/pdf-canvas.js';
import { monthName, type PayslipLanguage } from './payslip-pdf.js';

export interface TaxCertificate {
  lang: PayslipLanguage;
  number: string;
  fiscalYear: string; // 2025-26
  from: string;
  to: string;
  /** false while the income year is still running (provisional) */
  final: boolean;
  issuedOn: string;
  company: { name: string; tin: string | null };
  employee: {
    id: string;
    code: string;
    name: string;
    tin: string | null;
    department: string | null;
    designation: string | null;
  };
  months: Array<{
    period: string;
    gross: string;
    taxableIncome: string;
    tax: string;
    challans: Array<{ challanNo: string; challanDate: string }>;
  }>;
  income: Array<{
    head: string;
    label: string;
    taxable: boolean;
    amount: string;
  }>;
  earlier: Array<{
    kind: 'opening' | 'prior_employer';
    taxableIncome: string;
    taxWithheld: string;
  }>;
  totals: {
    gross: string;
    taxableIncome: string;
    tax: string;
    taxIncludingEarlier: string;
  };
}

const T = {
  en: {
    title: 'Certificate of tax deducted at source from salary',
    provisional: 'PROVISIONAL - the income year is not over yet',
    section:
      'Under section 86 of the Income Tax Act 2023 (placeholder, verify)',
    number: 'Certificate no.',
    year: 'Income year',
    employer: 'Employer',
    employerTin: 'Employer TIN',
    employee: 'Employee',
    code: 'Employee code',
    tin: 'Employee TIN',
    designation: 'Designation',
    department: 'Department',
    income: 'Salary paid in the year',
    head: 'Head',
    taxable: 'Taxable',
    exempt: 'Exempt',
    amount: 'Amount (Tk)',
    totalGross: 'Total salary',
    monthly: 'Tax deducted month by month',
    month: 'Month',
    gross: 'Salary',
    taxableIncome: 'Taxable',
    tax: 'Tax deducted',
    challan: 'Challan no. and date',
    notDeposited: 'not yet recorded',
    total: 'Total',
    earlier: 'Tax deducted before this system',
    opening: 'Earlier this year (opening)',
    prior: 'Previous employer this year',
    grand: 'Total tax deducted in the income year',
    certify:
      'Certified that the tax shown above was deducted from the salary of the employee and deposited to the Government treasury.',
    sign: 'Authorised signature and seal',
    issued: 'Issued on',
  },
  bn: {
    title: 'বেতন থেকে উৎসে কর কর্তনের সনদ',
    provisional: 'অস্থায়ী - আয়বর্ষ এখনো শেষ হয়নি',
    section: 'আয়কর আইন ২০২৩-এর ধারা ৮৬ অনুযায়ী (খসড়া, যাচাই করুন)',
    number: 'সনদ নম্বর',
    year: 'আয়বর্ষ',
    employer: 'নিয়োগকর্তা',
    employerTin: 'নিয়োগকর্তার টিআইএন',
    employee: 'কর্মী',
    code: 'কর্মী কোড',
    tin: 'কর্মীর টিআইএন',
    designation: 'পদবি',
    department: 'বিভাগ',
    income: 'বছরে প্রদত্ত বেতন',
    head: 'খাত',
    taxable: 'করযোগ্য',
    exempt: 'করমুক্ত',
    amount: 'টাকা',
    totalGross: 'মোট বেতন',
    monthly: 'মাসভিত্তিক কর কর্তন',
    month: 'মাস',
    gross: 'বেতন',
    taxableIncome: 'করযোগ্য',
    tax: 'কর্তিত কর',
    challan: 'চালান নম্বর ও তারিখ',
    notDeposited: 'এখনো লেখা হয়নি',
    total: 'মোট',
    earlier: 'এই সিস্টেমের আগে কর্তিত কর',
    opening: 'এ বছরের আগের অংশ (প্রারম্ভিক)',
    prior: 'এ বছরে আগের নিয়োগকর্তা',
    grand: 'আয়বর্ষে মোট কর্তিত কর',
    certify:
      'প্রত্যয়ন করা হচ্ছে যে উপরের কর কর্মীর বেতন থেকে কর্তন করে সরকারি কোষাগারে জমা দেওয়া হয়েছে।',
    sign: 'অনুমোদিত স্বাক্ষর ও সিল',
    issued: 'ইস্যুর তারিখ',
  },
} as const;

export async function renderTaxCertificatePdf(
  doc: TaxCertificate,
): Promise<Buffer> {
  const { pdf, left, width, draw, paragraph, rule, end } = createCanvas({
    title: `Tax certificate ${doc.employee.code} ${doc.fiscalYear}`,
    author: doc.company.name,
  });
  const t = T[doc.lang];
  const digits = (s: string) => (doc.lang === 'bn' ? toBanglaDigits(s) : s);
  const money = (amount: string) => formatAmount(Money.of(amount), doc.lang);
  const bottom = pdf.page.height - 70;

  let y = 48;
  /** Start a new page when the next block does not fit. */
  const need = (height: number) => {
    if (y + height <= bottom) return;
    pdf.addPage();
    y = 48;
  };

  // header
  draw(doc.company.name, left, y, {
    size: 15,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 22;
  draw(t.title, left, y, {
    size: 12,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 17;
  draw(t.section, left, y, { size: 8, align: 'center', boxWidth: width });
  y += 14;
  if (!doc.final) {
    draw(t.provisional, left, y, {
      size: 9,
      bold: true,
      align: 'center',
      boxWidth: width,
    });
    y += 14;
  }
  rule(y);
  y += 10;

  // who
  const facts: Array<[string, string, string, string]> = [
    [t.number, doc.number, t.year, digits(doc.fiscalYear)],
    [
      t.employer,
      doc.company.name,
      t.employerTin,
      doc.company.tin ? digits(doc.company.tin) : '-',
    ],
    [t.employee, doc.employee.name, t.code, doc.employee.code],
    [
      t.designation,
      doc.employee.designation ?? '-',
      t.tin,
      doc.employee.tin ? digits(doc.employee.tin) : '-',
    ],
    [t.department, doc.employee.department ?? '-', '', ''],
  ];
  const half = width / 2;
  for (const [l1, v1, l2, v2] of facts) {
    draw(l1, left, y, { size: 9 });
    draw(v1, left + 95, y, { size: 9, bold: true });
    if (l2) {
      draw(l2, left + half + 10, y, { size: 9 });
      draw(v2, left + half + 110, y, { size: 9, bold: true });
    }
    y += 14;
  }
  y += 4;
  rule(y);
  y += 12;

  // income by head
  draw(t.income, left, y, { size: 11, bold: true });
  y += 16;
  draw(t.head, left + 10, y, { size: 8, bold: true });
  draw(t.amount, left, y, {
    size: 8,
    bold: true,
    align: 'right',
    boxWidth: width,
  });
  y += 13;
  for (const line of doc.income) {
    need(14);
    draw(line.label, left + 10, y, { size: 9 });
    draw(line.taxable ? t.taxable : t.exempt, left + 300, y, { size: 8 });
    draw(money(line.amount), left, y, {
      size: 9,
      align: 'right',
      boxWidth: width,
    });
    y += 13;
  }
  rule(y + 1, 0.3);
  y += 5;
  draw(t.totalGross, left + 10, y, { size: 9, bold: true });
  draw(money(doc.totals.gross), left, y, {
    size: 9,
    bold: true,
    align: 'right',
    boxWidth: width,
  });
  y += 22;

  // month by month
  need(60);
  draw(t.monthly, left, y, { size: 11, bold: true });
  y += 16;
  const col = {
    month: left + 4,
    gross: left + 120,
    taxable: left + 200,
    tax: left + 280,
    challan: left + 300,
  };
  draw(t.month, col.month, y, { size: 8, bold: true });
  draw(t.gross, left, y, {
    size: 8,
    bold: true,
    align: 'right',
    boxWidth: col.gross - left + 40,
  });
  draw(t.taxableIncome, left, y, {
    size: 8,
    bold: true,
    align: 'right',
    boxWidth: col.taxable - left + 40,
  });
  draw(t.tax, left, y, {
    size: 8,
    bold: true,
    align: 'right',
    boxWidth: col.tax - left + 40,
  });
  draw(t.challan, col.challan + 40, y, { size: 8, bold: true });
  y += 13;
  for (const m of doc.months) {
    need(14);
    draw(monthName(m.period, doc.lang), col.month, y, { size: 9 });
    draw(money(m.gross), left, y, {
      size: 9,
      align: 'right',
      boxWidth: col.gross - left + 40,
    });
    draw(money(m.taxableIncome), left, y, {
      size: 9,
      align: 'right',
      boxWidth: col.taxable - left + 40,
    });
    draw(money(m.tax), left, y, {
      size: 9,
      align: 'right',
      boxWidth: col.tax - left + 40,
    });
    const challan = Money.of(m.tax).isZero()
      ? '-'
      : m.challans.length
        ? m.challans
            .map((c) => `${c.challanNo} (${digits(c.challanDate)})`)
            .join(', ')
        : t.notDeposited;
    draw(challan, col.challan + 40, y, { size: 8 });
    y += 13;
  }
  rule(y + 1, 0.3);
  y += 5;
  draw(t.total, col.month, y, { size: 9, bold: true });
  draw(money(doc.totals.gross), left, y, {
    size: 9,
    bold: true,
    align: 'right',
    boxWidth: col.gross - left + 40,
  });
  draw(money(doc.totals.taxableIncome), left, y, {
    size: 9,
    bold: true,
    align: 'right',
    boxWidth: col.taxable - left + 40,
  });
  draw(money(doc.totals.tax), left, y, {
    size: 9,
    bold: true,
    align: 'right',
    boxWidth: col.tax - left + 40,
  });
  y += 22;

  // earlier this year
  if (doc.earlier.length) {
    need(50);
    draw(t.earlier, left, y, { size: 11, bold: true });
    y += 16;
    for (const e of doc.earlier) {
      draw(e.kind === 'opening' ? t.opening : t.prior, left + 10, y, {
        size: 9,
      });
      draw(money(e.taxWithheld), left, y, {
        size: 9,
        align: 'right',
        boxWidth: width,
      });
      y += 13;
    }
    y += 8;
  }

  // grand total and signature
  need(110);
  rule(y, 1);
  y += 10;
  draw(t.grand, left, y, { size: 12, bold: true });
  draw(`৳ ${money(doc.totals.taxIncludingEarlier)}`, left, y, {
    size: 12,
    bold: true,
    align: 'right',
    boxWidth: width,
  });
  y += 20;
  rule(y, 1);
  y += 14;
  y = paragraph(t.certify, left, y, width, { size: 9 }) + 30;
  pdf
    .moveTo(left + width - 180, y)
    .lineTo(left + width, y)
    .lineWidth(0.5)
    .stroke();
  draw(t.sign, left + width - 180, y + 4, { size: 8 });
  draw(`${t.issued}: ${digits(doc.issuedOn)}`, left, y + 4, { size: 8 });

  return end();
}
