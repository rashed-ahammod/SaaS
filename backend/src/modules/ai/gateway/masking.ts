/**
 * Data minimization before anything leaves the system (spec §8 guardrail 3):
 * NID, bank / wallet account, tax (TIN) and phone numbers never reach the AI
 * provider.
 *
 *   maskText(text)   any run of 9 or more digits (ASCII or Bangla, spaces and
 *                    dashes allowed inside) becomes "[number hidden]". NIDs are
 *                    10, 13 or 17 digits, TINs 12, bank accounts 10-17, mobile
 *                    (= bKash / Nagad wallet) numbers 11. Amounts are shorter
 *                    or carry separators (12,34,567.00), so they stay.
 *   maskData(value)  the same for every string in an object, and fields whose
 *                    NAME says they hold such a number are dropped entirely.
 */
export const HIDDEN = '[number hidden]';

// 9+ digits, allowing single spaces / dashes between them (e.g. "1990 1234 5678 9")
const LONG_NUMBER = /[0-9০-৯](?:[\s-]?[0-9০-৯]){8,}/g;
const E_TIN_HINT =
  /\b(?:e-?tin|tin|nid)\s*(?:no\.?|number)?\s*[:#-]?\s*[0-9০-৯][0-9০-৯\s-]{3,}/gi;

/** Field names whose values are identity, bank, tax or contact numbers. */
const SENSITIVE_KEY =
  /(^|_)(nid|national_?id|tin|e_?tin|tax_?id|passport|birth_?reg|account_?(no|number)|bank_?account|iban|routing|card_?(no|number)|wallet_?(no|number)|phone|mobile|msisdn)($|_)/i;

export function maskText(text: string): string {
  return text
    .replace(E_TIN_HINT, (m) => m.replace(/[0-9০-৯][0-9০-৯\s-]*/, HIDDEN))
    .replace(LONG_NUMBER, HIDDEN);
}

export function maskData<T>(value: T): T {
  return mask(value) as T;
}

function mask(value: unknown): unknown {
  if (typeof value === 'string') return maskText(value);
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(snake(k))) continue;
      out[k] = mask(v);
    }
    return out;
  }
  return value;
}

function snake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
