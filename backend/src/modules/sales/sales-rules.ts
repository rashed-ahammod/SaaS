/**
 * Sales rules that need no database (Phase 3 WP25-WP27).
 *
 *   priceLine(line, rate)      quantity × unit price, less the discount, then SD and VAT on the
 *                              value (the Mushak 6.3 order: SD on the value, VAT on value + SD)
 *   totalsOf(lines)            a document's totals, added from its lines (never typed)
 *   limitFor(limits, who)      the discount limit that applies: the most specific one wins
 *                              (user + product > user > product > customer type > company)
 *   creditCheck(...)           the order against the customer's credit limit
 *   remindersDue(daysLate, sent)   which reminder stages are reached and not yet sent
 *   creditLine(invoiceLine, qty)   a credit note line: the invoice line's share for a quantity
 */
import { Money } from '../../platform/money/money.js';
import { saleLine } from '../vat/mushak.js';

/** Days past due at which a reminder goes; from the second stage on, the account manager is told (placeholders). */
export const REMINDER_STAGES = [1, 7, 15, 30] as const;
export const ESCALATE_FROM_STAGE = 15;
/** The discount anyone may give when the company has set no limit (placeholder: verify with the owner). */
export const DEFAULT_DISCOUNT_LIMIT = '5';

export interface LineInput {
  quantity: string;
  unitPrice: string;
  discountPercent: string;
}

export function priceLine(
  l: LineInput,
  rate: { vatPercent: string; sdPercent: string },
) {
  const gross = Money.of(l.unitPrice).times(l.quantity).round();
  const discount = gross.times(l.discountPercent).dividedBy(100).round();
  const value = gross.minus(discount);
  return {
    gross: gross.toDb(),
    discount: discount.toDb(),
    value: value.toDb(),
    ...saleLine(value.toDb(), rate),
  };
}

export function totalsOf(
  lines: Array<{
    gross?: string;
    value: string;
    sdAmount: string;
    vatAmount: string;
  }>,
) {
  const value = Money.sum(lines.map((l) => l.value));
  const subtotal = Money.sum(lines.map((l) => l.gross ?? l.value));
  const sd = Money.sum(lines.map((l) => l.sdAmount));
  const vat = Money.sum(lines.map((l) => l.vatAmount));
  return {
    subtotal: subtotal.toDb(),
    discount: subtotal.minus(value).toDb(),
    value: value.toDb(),
    sd: sd.toDb(),
    vat: vat.toDb(),
    total: value.plus(sd).plus(vat).toDb(),
  };
}

export interface Limit {
  userId: string | null;
  productId: string | null;
  customerType: string | null;
  maxPercent: string;
}

/** The limit for a salesperson, product and customer type; the company default when none is set. */
export function limitFor(
  limits: Limit[],
  who: { userId: string; productId: string; customerType: string },
): string {
  const fits = limits.filter(
    (l) =>
      (!l.userId || l.userId === who.userId) &&
      (!l.productId || l.productId === who.productId) &&
      (!l.customerType || l.customerType === who.customerType),
  );
  if (!fits.length) return Money.of(DEFAULT_DISCOUNT_LIMIT).toDb();
  const weight = (l: Limit) =>
    (l.userId ? 4 : 0) + (l.productId ? 2 : 0) + (l.customerType ? 1 : 0);
  const best = Math.max(...fits.map(weight));
  // equally specific limits: the lower one (the stricter rule)
  return fits
    .filter((l) => weight(l) === best)
    .map((l) => Money.of(l.maxPercent))
    .reduce((a, b) => (a.lessThan(b) ? a : b))
    .toDb();
}

/** Owed now (open invoices and open orders) plus this order, against the limit. */
export function creditCheck(input: {
  creditLimit: string;
  openInvoices: string;
  openOrders: string;
  order: string;
}) {
  const exposure = Money.of(input.openInvoices)
    .plus(input.openOrders)
    .plus(input.order);
  return {
    creditLimit: Money.of(input.creditLimit).toDb(),
    openInvoices: Money.of(input.openInvoices).toDb(),
    openOrders: Money.of(input.openOrders).toDb(),
    order: Money.of(input.order).toDb(),
    exposure: exposure.toDb(),
    over: exposure.greaterThan(input.creditLimit),
    overBy: (exposure.greaterThan(input.creditLimit)
      ? exposure.minus(input.creditLimit)
      : Money.zero()
    ).toDb(),
  };
}

/** The stages reached by an invoice this late and not yet sent; only the latest one goes out. */
export function remindersDue(
  daysLate: number,
  sent: number[],
): { record: number[]; send: number | null; escalate: boolean } {
  const reached = REMINDER_STAGES.filter(
    (s) => daysLate >= s && !sent.includes(s),
  );
  const send = reached.length ? reached[reached.length - 1] : null;
  return {
    record: [...reached],
    send,
    escalate: send !== null && send >= ESCALATE_FROM_STAGE,
  };
}

/** A credit note line: the invoice line's value, SD and VAT for part of its quantity. */
export function creditLine(
  line: {
    quantity: string;
    value: string;
    sd_amount: string;
    vat_amount: string;
  },
  quantity: string,
) {
  const share = (amount: string) =>
    Money.of(quantity).equals(line.quantity)
      ? Money.of(amount)
      : Money.of(amount).times(quantity).dividedBy(line.quantity).round();
  return {
    value: share(line.value).toDb(),
    sdAmount: share(line.sd_amount).toDb(),
    vatAmount: share(line.vat_amount).toDb(),
  };
}

/** Days from one business date to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );

/** A business date plus days. */
export function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
