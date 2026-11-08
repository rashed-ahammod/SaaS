/**
 * Amount in words for payslips and cheques (spec §7 Localization), using the
 * South Asian number system (thousand, lakh, crore).
 *
 *   amountInWords(Money.of('1234567.50'), 'en')
 *     -> "Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven Taka and Fifty Paisa Only"
 *   amountInWords(Money.of('1234567.50'), 'bn')
 *     -> "বারো লক্ষ চৌত্রিশ হাজার পাঁচশত সাতষট্টি টাকা পঞ্চাশ পয়সা মাত্র"
 *
 * Amounts of 100 crore and above repeat the scheme, e.g. "One Hundred Fifty Crore".
 * NOTE: the Bangla word list should be proof-read by a native speaker before the
 * first payslip goes to a pilot (guide §19: test with real data).
 */
import type { Money } from './money.js';
import type { Language } from './format.js';

// ---------------------------------------------------------------- English ---
const EN_ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const EN_TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function enBelow100(n: number): string {
  if (n < 20) return EN_ONES[n];
  const tens = EN_TENS[Math.floor(n / 10)];
  return n % 10 ? `${tens}-${EN_ONES[n % 10]}` : tens;
}

// ----------------------------------------------------------------- Bangla ---
// Bangla numbers 0-99 are irregular, so every word is listed.
const BN_0_TO_99 = [
  'শূন্য',
  'এক',
  'দুই',
  'তিন',
  'চার',
  'পাঁচ',
  'ছয়',
  'সাত',
  'আট',
  'নয়',
  'দশ',
  'এগারো',
  'বারো',
  'তেরো',
  'চৌদ্দ',
  'পনেরো',
  'ষোলো',
  'সতেরো',
  'আঠারো',
  'উনিশ',
  'বিশ',
  'একুশ',
  'বাইশ',
  'তেইশ',
  'চব্বিশ',
  'পঁচিশ',
  'ছাব্বিশ',
  'সাতাশ',
  'আটাশ',
  'ঊনত্রিশ',
  'ত্রিশ',
  'একত্রিশ',
  'বত্রিশ',
  'তেত্রিশ',
  'চৌত্রিশ',
  'পঁয়ত্রিশ',
  'ছত্রিশ',
  'সাঁইত্রিশ',
  'আটত্রিশ',
  'ঊনচল্লিশ',
  'চল্লিশ',
  'একচল্লিশ',
  'বিয়াল্লিশ',
  'তেতাল্লিশ',
  'চুয়াল্লিশ',
  'পঁয়তাল্লিশ',
  'ছেচল্লিশ',
  'সাতচল্লিশ',
  'আটচল্লিশ',
  'ঊনপঞ্চাশ',
  'পঞ্চাশ',
  'একান্ন',
  'বাহান্ন',
  'তিপ্পান্ন',
  'চুয়ান্ন',
  'পঞ্চান্ন',
  'ছাপ্পান্ন',
  'সাতান্ন',
  'আটান্ন',
  'ঊনষাট',
  'ষাট',
  'একষট্টি',
  'বাষট্টি',
  'তেষট্টি',
  'চৌষট্টি',
  'পঁয়ষট্টি',
  'ছেষট্টি',
  'সাতষট্টি',
  'আটষট্টি',
  'ঊনসত্তর',
  'সত্তর',
  'একাত্তর',
  'বাহাত্তর',
  'তিয়াত্তর',
  'চুয়াত্তর',
  'পঁচাত্তর',
  'ছিয়াত্তর',
  'সাতাত্তর',
  'আটাত্তর',
  'ঊনআশি',
  'আশি',
  'একাশি',
  'বিরাশি',
  'তিরাশি',
  'চুরাশি',
  'পঁচাশি',
  'ছিয়াশি',
  'সাতাশি',
  'আটাশি',
  'ঊননব্বই',
  'নব্বই',
  'একানব্বই',
  'বিরানব্বই',
  'তিরানব্বই',
  'চুরানব্বই',
  'পঁচানব্বই',
  'ছিয়ানব্বই',
  'সাতানব্বই',
  'আটানব্বই',
  'নিরানব্বই',
];

interface WordSet {
  below100(n: number): string;
  hundred(n: number): string; // "Five Hundred" / "পাঁচশত"
  thousand: string;
  lakh: string;
  crore: string;
  currency: string;
  subunit: string;
  and: string;
  only: string;
}

const WORDS: Record<Language, WordSet> = {
  en: {
    below100: enBelow100,
    hundred: (n) => `${EN_ONES[n]} Hundred`,
    thousand: 'Thousand',
    lakh: 'Lakh',
    crore: 'Crore',
    currency: 'Taka',
    subunit: 'Paisa',
    and: 'and',
    only: 'Only',
  },
  bn: {
    below100: (n) => BN_0_TO_99[n],
    hundred: (n) => `${BN_0_TO_99[n]}শত`,
    thousand: 'হাজার',
    lakh: 'লক্ষ',
    crore: 'কোটি',
    currency: 'টাকা',
    subunit: 'পয়সা',
    and: '',
    only: 'মাত্র',
  },
};

/** Words for a whole number >= 1, e.g. 1234567n -> "Twelve Lakh Thirty-Four Thousand ...". */
function wholeToWords(n: bigint, w: WordSet): string {
  const parts: string[] = [];
  const crore = n / 10_000_000n;
  let rest = n % 10_000_000n;
  if (crore > 0n) parts.push(`${wholeToWords(crore, w)} ${w.crore}`);

  const lakh = Number(rest / 100_000n);
  rest %= 100_000n;
  const thousand = Number(rest / 1_000n);
  rest %= 1_000n;
  const hundred = Number(rest / 100n);
  const belowHundred = Number(rest % 100n);

  if (lakh) parts.push(`${w.below100(lakh)} ${w.lakh}`);
  if (thousand) parts.push(`${w.below100(thousand)} ${w.thousand}`);
  if (hundred) parts.push(w.hundred(hundred));
  if (belowHundred) parts.push(w.below100(belowHundred));
  return parts.join(' ');
}

export function amountInWords(amount: Money, lang: Language = 'en'): string {
  const w = WORDS[lang];
  const [wholeText, paisaText] = amount.toString().replace('-', '').split('.');
  const whole = BigInt(wholeText);
  const paisa = Number(paisaText);

  const pieces: string[] = [];
  if (amount.isNegative()) pieces.push(lang === 'bn' ? 'ঋণাত্মক' : 'Minus');
  pieces.push(
    `${whole === 0n ? w.below100(0) : wholeToWords(whole, w)} ${w.currency}`,
  );
  if (paisa) {
    if (w.and) pieces.push(w.and);
    pieces.push(`${w.below100(paisa)} ${w.subunit}`);
  }
  pieces.push(w.only);
  return pieces.join(' ');
}
