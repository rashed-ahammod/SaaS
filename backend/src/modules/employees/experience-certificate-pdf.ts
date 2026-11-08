/**
 * Experience certificate (spec §6.1 step 6), issued after the final settlement,
 * in Bangla or English. A plain "to whom it may concern" letter: who, what job,
 * from when to when. The wording is a placeholder until HR signs it off.
 */
import { toBanglaDigits } from '../../platform/money/format.js';
import { createCanvas } from '../../platform/pdf/pdf-canvas.js';

export interface ExperienceCertificate {
  lang: 'bn' | 'en';
  companyName: string;
  number: string;
  issuedOn: string;
  employee: {
    code: string;
    name: string;
    gender: 'male' | 'female' | 'other' | null;
    designation: string | null;
    department: string | null;
    joinDate: string;
    lastWorkingDay: string;
  };
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

/** "2026-10-31" -> "31 October 2026" / "৩১ অক্টোবর ২০২৬" */
function longDate(date: string, lang: 'bn' | 'en'): string {
  const [y, m, d] = date.split('-').map(Number);
  const text = `${d} ${MONTHS[lang][m - 1]} ${y}`;
  return lang === 'bn' ? toBanglaDigits(text) : text;
}

function body(c: ExperienceCertificate): string[] {
  const e = c.employee;
  const role = [e.designation, e.department].filter(Boolean).join(', ');
  if (c.lang === 'bn') {
    return [
      `এই মর্মে প্রত্যয়ন করা যাচ্ছে যে ${e.name} (কর্মী কোড ${e.code}) ${longDate(e.joinDate, 'bn')} থেকে ${longDate(e.lastWorkingDay, 'bn')} পর্যন্ত ${c.companyName}-এ${role ? ` ${role} হিসেবে` : ''} কর্মরত ছিলেন।`,
      'কর্মকালে তাঁর আচরণ ও কাজ সন্তোষজনক ছিল। তাঁর পাওনা চূড়ান্তভাবে নিষ্পত্তি করা হয়েছে।',
      'আমরা তাঁর ভবিষ্যৎ সাফল্য কামনা করি।',
    ];
  }
  const pronoun =
    e.gender === 'female'
      ? ['She', 'her']
      : e.gender === 'male'
        ? ['He', 'his']
        : ['They', 'their'];
  return [
    `This is to certify that ${e.name} (employee code ${e.code}) worked with ${c.companyName}${role ? ` as ${role}` : ''} from ${longDate(e.joinDate, 'en')} to ${longDate(e.lastWorkingDay, 'en')}.`,
    `${pronoun[0]} ${pronoun[0] === 'They' ? 'were' : 'was'} found sincere and ${pronoun[1]} conduct satisfactory during this period. ${pronoun[1][0].toUpperCase() + pronoun[1].slice(1)} dues have been settled in full.`,
    `We wish ${pronoun[0] === 'She' ? 'her' : pronoun[0] === 'He' ? 'him' : 'them'} every success in the future.`,
  ];
}

export async function renderExperienceCertificatePdf(
  c: ExperienceCertificate,
): Promise<Buffer> {
  const { pdf, left, width, draw, paragraph, rule, end } = createCanvas({
    title: `Experience certificate ${c.employee.code}`,
    author: c.companyName,
  });
  const bn = c.lang === 'bn';
  const t = bn
    ? {
        title: 'অভিজ্ঞতা সনদ',
        ref: 'সূত্র',
        date: 'তারিখ',
        whom: 'সংশ্লিষ্ট সকলের অবগতির জন্য',
        sign: 'মানবসম্পদ বিভাগ\nঅনুমোদিত স্বাক্ষর ও সিল',
      }
    : {
        title: 'Experience certificate',
        ref: 'Ref',
        date: 'Date',
        whom: 'To whom it may concern',
        sign: 'Human Resources\nAuthorised signature and seal',
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
  y += 40;
  draw(t.title, left, y, {
    size: 15,
    bold: true,
    align: 'center',
    boxWidth: width,
  });
  y += 40;
  draw(t.whom, left, y, { size: 11, bold: true });
  y += 28;

  for (const text of body(c))
    y = paragraph(text, left, y, width, { size: 11 }) + 10;

  y += 70;
  pdf
    .moveTo(left, y)
    .lineTo(left + 200, y)
    .lineWidth(0.5)
    .stroke();
  for (const [i, line] of t.sign.split('\n').entries())
    draw(line, left, y + 6 + i * 14, { size: 9 });
  return end();
}
