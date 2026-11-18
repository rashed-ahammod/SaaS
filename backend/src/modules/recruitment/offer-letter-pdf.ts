/**
 * Offer letter (WP29), in Bangla or English: what post, on what terms, from when, and by
 * when the candidate must answer. The wording is a PLACEHOLDER until HR and the company's
 * lawyer sign it off — the same standing as the experience certificate's wording.
 */
import { formatAmount, toBanglaDigits } from '../../platform/money/format.js';
import { Money } from '../../platform/money/money.js';
import { createCanvas } from '../../platform/pdf/pdf-canvas.js';

export interface OfferLetter {
  lang: 'bn' | 'en';
  companyName: string;
  number: string;
  issuedOn: string;
  candidateName: string;
  designation: string;
  department: string;
  branch: string;
  grade: string;
  grossSalary: string;
  joiningOn: string;
  probationMonths: number;
  validUntil: string;
  terms: string | null;
}

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

function longDate(date: string, lang: 'bn' | 'en'): string {
  const [y, m, d] = date.split('-').map(Number);
  const text = `${d} ${MONTHS[lang][m - 1]} ${y}`;
  return lang === 'bn' ? toBanglaDigits(text) : text;
}

function body(c: OfferLetter): string[] {
  const salary = `৳${formatAmount(Money.of(c.grossSalary), c.lang)}`;
  const where = [c.department, c.branch].filter(Boolean).join(', ');
  if (c.lang === 'bn') {
    const months = toBanglaDigits(String(c.probationMonths));
    return [
      `আমরা আনন্দের সঙ্গে আপনাকে ${c.companyName}-এ ${c.designation} পদে${where ? ` (${where})` : ''} নিয়োগের প্রস্তাব দিচ্ছি।`,
      `যোগদানের তারিখ: ${longDate(c.joiningOn, 'bn')}। গ্রেড: ${c.grade || '—'}। মাসিক সর্বমোট বেতন: ${salary}।`,
      c.probationMonths > 0
        ? `শুরুতে ${months} মাস শিক্ষানবিশকাল থাকবে; সন্তোষজনক কাজের ভিত্তিতে তা স্থায়ী করা হবে।`
        : 'এই নিয়োগে কোনো শিক্ষানবিশকাল নেই।',
      'ছুটি, উৎসব ভাতা, ভবিষ্য তহবিল ও অন্যান্য সুবিধা কোম্পানির নীতিমালা এবং বাংলাদেশ শ্রম আইন অনুযায়ী প্রযোজ্য হবে।',
      `এই প্রস্তাব ${longDate(c.validUntil, 'bn')} পর্যন্ত বলবৎ থাকবে। সম্মত থাকলে এই পত্রে স্বাক্ষর করে মানবসম্পদ বিভাগে ফেরত দিন।`,
    ];
  }
  return [
    `We are pleased to offer you the post of ${c.designation}${where ? ` (${where})` : ''} at ${c.companyName}.`,
    `Date of joining: ${longDate(c.joiningOn, 'en')}. Grade: ${c.grade || '—'}. Monthly gross salary: ${salary}.`,
    c.probationMonths > 0
      ? `The appointment begins with a probation of ${c.probationMonths} month(s); it is confirmed on satisfactory performance.`
      : 'This appointment carries no probation period.',
    'Leave, festival bonus, provident fund and other benefits follow the company policy and the Bangladesh Labour Act.',
    `This offer stands until ${longDate(c.validUntil, 'en')}. If you accept, please sign this letter and return it to Human Resources.`,
  ];
}

export async function renderOfferLetterPdf(c: OfferLetter): Promise<Buffer> {
  const { pdf, left, width, draw, paragraph, rule, end } = createCanvas({
    title: `Offer letter ${c.number}`,
    author: c.companyName,
  });
  const bn = c.lang === 'bn';
  const t = bn
    ? {
        title: 'নিয়োগের প্রস্তাব',
        ref: 'সূত্র',
        date: 'তারিখ',
        to: 'প্রতি',
        sign: 'মানবসম্পদ বিভাগ\nঅনুমোদিত স্বাক্ষর ও সিল',
        accept: 'প্রার্থীর স্বাক্ষর ও তারিখ',
        terms: 'অন্যান্য শর্ত',
      }
    : {
        title: 'Letter of offer',
        ref: 'Ref',
        date: 'Date',
        to: 'To',
        sign: 'Human Resources\nAuthorised signature and seal',
        accept: 'Candidate’s signature and date',
        terms: 'Other terms',
      };

  let y = 60;
  draw(c.companyName, left, y, {
    size: 16,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 26;
  rule(y);
  y += 16;
  draw(`${t.ref}: ${c.number}`, left, y, { size: 10 });
  draw(`${t.date}: ${longDate(c.issuedOn, c.lang)}`, left, y, {
    size: 10,
    align: 'right',
    boxWidth: width,
  });
  y += 36;
  draw(t.title, left, y, {
    size: 15,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 36;
  draw(`${t.to}: ${c.candidateName}`, left, y, { size: 11, bold: true });
  y += 26;

  for (const text of body(c))
    y = paragraph(text, left, y, width, { size: 11 }) + 8;

  if (c.terms) {
    y += 8;
    draw(t.terms, left, y, { size: 11, bold: true });
    y = paragraph(c.terms, left, y + 18, width, { size: 10 }) + 8;
  }

  y += 60;
  pdf
    .moveTo(left, y)
    .lineTo(left + 200, y)
    .lineWidth(0.5)
    .stroke();
  for (const [i, line] of t.sign.split('\n').entries())
    draw(line, left, y + 6 + i * 14, { size: 9 });
  pdf
    .moveTo(left + width - 200, y)
    .lineTo(left + width, y)
    .lineWidth(0.5)
    .stroke();
  draw(t.accept, left + width - 200, y + 6, { size: 9 });
  return end();
}
