/**
 * Displaying amounts the Bangladeshi way (guide §19):
 *   formatAmount(Money.of('1234567.5'), 'en')  ->  "12,34,567.50"   (lakh/crore grouping)
 *   formatAmount(Money.of('1234567.5'), 'bn')  ->  "১২,৩৪,৫৬৭.৫০"   (Bangla digits)
 *   formatTaka(Money.of('500'), 'en')          ->  "৳500.00"
 *
 * Formatting works on the decimal string (via BigInt), so very large amounts
 * keep every digit.
 */
import type { Money } from './money.js';

export type Language = 'bn' | 'en';

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const groupFormatter = new Intl.NumberFormat('en-IN', { useGrouping: true });

/** Replace 0-9 with Bangla digits. */
export function toBanglaDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => BANGLA_DIGITS[Number(d)]);
}

export function formatAmount(amount: Money, lang: Language = 'en'): string {
  const [whole, fraction] = amount.toString().split('.');
  const negative = whole.startsWith('-');
  const grouped = groupFormatter.format(
    BigInt(negative ? whole.slice(1) : whole),
  );
  const text = `${negative ? '-' : ''}${grouped}.${fraction}`;
  return lang === 'bn' ? toBanglaDigits(text) : text;
}

export function formatTaka(amount: Money, lang: Language = 'en'): string {
  const text = formatAmount(amount, lang);
  return text.startsWith('-') ? `-৳${text.slice(1)}` : `৳${text}`;
}
