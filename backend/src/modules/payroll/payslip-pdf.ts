/**
 * Payslip PDF in Bangla or English (guide §13 step 5, §19), optionally
 * password-protected.
 *
 * Bangla text is shaped by the PDF library (fontkit), so conjuncts such as
 * ক্ষ, ন্ত, র্ত render correctly. The embedded Noto Sans Bengali comes in two parts
 * (Bangla, Latin), so every text is drawn in runs: Bangla characters with the
 * Bangla part, everything else (digits, commas, codes) with the Latin part.
 */
import { amountInWords } from '../../platform/money/amount-in-words.js';
import { formatAmount, toBanglaDigits } from '../../platform/money/format.js';
import { Money } from '../../platform/money/money.js';
import { createCanvas } from '../../platform/pdf/pdf-canvas.js';

export { scriptRuns } from '../../platform/pdf/pdf-canvas.js';

export type PayslipLanguage = 'bn' | 'en';

export interface PayslipLine {
  label: string;
  amount: string;
}

export interface PayslipDocument {
  lang: PayslipLanguage;
  companyName: string;
  period: string; // 2026-09
  runType: 'regular' | 'bonus' | 'final_settlement';
  bonusName: string | null;
  employee: {
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
  };
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  gross: string;
  totalDeductions: string;
  net: string;
  generatedOn: string; // 2026-10-02
}

const T = {
  en: {
    payslip: 'Payslip',
    bonus: 'Festival bonus',
    settlement: 'Final settlement',
    employee: 'Employee',
    code: 'Employee code',
    department: 'Department',
    designation: 'Designation',
    period: 'Pay period',
    earnings: 'Earnings',
    deductions: 'Deductions',
    employer: 'Paid by the employer (not part of net pay)',
    gross: 'Total earnings',
    totalDeductions: 'Total deductions',
    net: 'Net pay',
    words: 'In words',
    amount: 'Amount (Tk)',
    generated: 'Generated on',
    footer:
      'System-generated payslip; no signature needed. Report any mistake to HR within 7 days.',
  },
  bn: {
    payslip: 'বেতন বিবরণী',
    bonus: 'উৎসব ভাতা',
    settlement: 'চূড়ান্ত নিষ্পত্তি',
    employee: 'কর্মী',
    code: 'কর্মী কোড',
    department: 'বিভাগ',
    designation: 'পদবি',
    period: 'বেতনের মাস',
    earnings: 'আয়',
    deductions: 'কর্তন',
    employer: 'নিয়োগকর্তার প্রদেয় (নিট বেতনের অংশ নয়)',
    gross: 'মোট আয়',
    totalDeductions: 'মোট কর্তন',
    net: 'নিট বেতন',
    words: 'কথায়',
    amount: 'টাকা',
    generated: 'তৈরির তারিখ',
    footer:
      'এই বেতন বিবরণী সিস্টেমে তৈরি; স্বাক্ষরের প্রয়োজন নেই। কোনো ভুল থাকলে ৭ দিনের মধ্যে মানবসম্পদ বিভাগকে জানান।',
  },
} as const;

const MONTHS = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  bn: [
    'জানুয়ারি',
    'ফেব্রুয়ারি',
    'মার্চ',
    'এপ্রিল',
    'মে',
    'জুন',
    'জুলাই',
    'আগস্ট',
    'সেপ্টেম্বর',
    'অক্টোবর',
    'নভেম্বর',
    'ডিসেম্বর',
  ],
};

/** "2026-09" -> "September 2026" / "সেপ্টেম্বর ২০২৬" */
export function monthName(period: string, lang: PayslipLanguage): string {
  const [y, m] = period.split('-').map(Number);
  const text = `${MONTHS[lang][m - 1]} ${y}`;
  return lang === 'bn' ? toBanglaDigits(text) : text;
}

/** Builds the PDF. With a password, it is needed to open the file. */
export async function renderPayslipPdf(
  doc: PayslipDocument,
  password?: string,
): Promise<Buffer> {
  const { pdf, left, width, draw, rule, end } = createCanvas(
    {
      title: `Payslip ${doc.employee.code} ${doc.period}`,
      author: doc.companyName,
    },
    password
      ? { user: password, owner: `${password}-owner-${doc.period}` }
      : undefined,
  );
  const t = T[doc.lang];
  const money = (amount: string) => formatAmount(Money.of(amount), doc.lang);

  // header
  let y = 48;
  draw(doc.companyName, left, y, {
    size: 16,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 24;
  const kind =
    doc.runType === 'bonus'
      ? `${t.bonus}${doc.bonusName ? ` - ${doc.bonusName}` : ''}`
      : doc.runType === 'final_settlement'
        ? t.settlement
        : t.payslip;
  draw(`${kind} - ${monthName(doc.period, doc.lang)}`, left, y, {
    size: 12,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 26;
  rule(y);
  y += 10;

  // employee
  const facts: Array<[string, string]> = [
    [t.employee, doc.employee.name],
    [t.code, doc.employee.code],
    [t.department, doc.employee.department ?? '-'],
    [t.designation, doc.employee.designation ?? '-'],
    [t.period, monthName(doc.period, doc.lang)],
  ];
  for (const [label, value] of facts) {
    draw(label, left, y, { size: 10 });
    draw(value, left + 130, y, { size: 10, bold: true });
    y += 16;
  }
  y += 6;
  rule(y);
  y += 10;

  // a section of lines with its total
  const section = (
    title: string,
    lines: PayslipLine[],
    totalLabel?: string,
    total?: string,
  ) => {
    draw(title, left, y, { size: 11, bold: true });
    draw(t.amount, left, y, { size: 9, align: 'right', boxWidth: width });
    y += 18;
    for (const line of lines) {
      draw(line.label, left + 10, y, { size: 10 });
      draw(money(line.amount), left, y, {
        size: 10,
        align: 'right',
        boxWidth: width,
      });
      y += 15;
    }
    if (totalLabel && total !== undefined) {
      rule(y + 2, 0.3);
      y += 6;
      draw(totalLabel, left + 10, y, { size: 10, bold: true });
      draw(money(total), left, y, {
        size: 10,
        bold: true,
        align: 'right',
        boxWidth: width,
      });
      y += 18;
    }
    y += 6;
  };
  section(t.earnings, doc.earnings, t.gross, doc.gross);
  if (doc.deductions.length)
    section(
      t.deductions,
      doc.deductions,
      t.totalDeductions,
      doc.totalDeductions,
    );

  // net pay
  rule(y, 1);
  y += 10;
  draw(t.net, left, y, { size: 13, bold: true });
  draw(`৳ ${money(doc.net)}`, left, y, {
    size: 13,
    bold: true,
    align: 'right',
    boxWidth: width,
  });
  y += 22;
  draw(`${t.words}: ${amountInWords(Money.of(doc.net), doc.lang)}`, left, y, {
    size: 9,
  });
  y += 20;
  rule(y, 1);
  y += 16;

  if (doc.employerContributions.length)
    section(t.employer, doc.employerContributions);

  // footer
  const generated =
    doc.lang === 'bn' ? toBanglaDigits(doc.generatedOn) : doc.generatedOn;
  draw(`${t.generated}: ${generated}`, left, pdf.page.height - 90, { size: 8 });
  draw(t.footer, left, pdf.page.height - 76, { size: 8 });

  return end();
}

/** Names of the heads the engine produces (company heads have their own names). */
export const SYSTEM_HEAD_LABELS: Record<string, { en: string; bn: string }> = {
  UNPAID_DAYS: { en: 'Unpaid days', bn: 'বিনা বেতনের দিন' },
  MATERNITY_PAY: { en: 'Maternity benefit', bn: 'মাতৃত্বকালীন সুবিধা' },
  ATTENDANCE_ADJUSTMENT: { en: 'Attendance adjustment', bn: 'হাজিরা সমন্বয়' },
  OVERTIME: { en: 'Overtime', bn: 'ওভারটাইম' },
  ARREAR: { en: 'Arrear', bn: 'বকেয়া' },
  LEAVE_ENCASHMENT: { en: 'Leave encashment', bn: 'ছুটি নগদায়ন' },
  FESTIVAL_BONUS: { en: 'Festival bonus', bn: 'উৎসব ভাতা' },
  GRATUITY: { en: 'Gratuity', bn: 'গ্র্যাচুইটি' },
  PF_EMPLOYEE: { en: 'Provident fund (employee)', bn: 'ভবিষ্য তহবিল (কর্মী)' },
  LOAN_RECOVERY: { en: 'Salary advance recovery', bn: 'অগ্রিম বেতন কর্তন' },
  NOTICE_SHORTFALL: {
    en: 'Notice period shortfall',
    bn: 'নোটিশ মেয়াদের ঘাটতি',
  },
  TAX: { en: 'Income tax', bn: 'আয়কর' },
  PF_EMPLOYER: {
    en: 'Provident fund (employer)',
    bn: 'ভবিষ্য তহবিল (নিয়োগকর্তা)',
  },
  GRATUITY_PROVISION: { en: 'Gratuity provision', bn: 'গ্র্যাচুইটি সঞ্চিতি' },
};
