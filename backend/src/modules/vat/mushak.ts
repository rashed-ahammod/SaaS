/**
 * VAT arithmetic and the monthly return (Mushak 9.1) figures. Pure: no database.
 *
 *   saleLine(value, rate)     supplementary duty on the value, VAT on value + SD (as the
 *                             VAT and SD Act 2012 charges it), both to the paisa
 *   classOf(percent)          the rate class of a bill line without a VAT item
 *   returnFigures(...)        the Mushak 9.1 data: sales by rate class (output tax),
 *                             purchases by rate class (input tax), the adjustments, the net
 *                             tax, what is to be deposited or carried to next month
 *
 * PLACEHOLDERS (verify against the VAT and SD Act 2012, the VAT and SD Rules 2016 and the
 * current Finance Act / NBR orders): the rates in DEFAULT_ITEMS, the note numbers of the
 * form, and the treatment of VAT deducted at source in the net tax.
 */
import { Money } from '../../platform/money/money.js';
import type { VatRateClass } from '../../platform/db/schema.js';

export const RATE_CLASSES: VatRateClass[] = [
  'standard',
  'reduced',
  'truncated',
  'zero',
  'exempt',
];

/** Standard items to start with (placeholder rates for fiscal year 2026-27). */
export const DEFAULT_ITEMS: Array<{
  code: string;
  nameEn: string;
  nameBn: string;
  kind: 'goods' | 'service';
  nbrCode: string | null;
  unit: string | null;
  rateClass: VatRateClass;
  vatPercent: string;
  sdPercent?: string;
}> = [
  {
    code: 'GOODS-STD',
    nameEn: 'Goods at the standard rate',
    nameBn: 'আদর্শ হারের পণ্য',
    kind: 'goods',
    nbrCode: null,
    unit: 'pcs',
    rateClass: 'standard',
    vatPercent: '15',
  },
  {
    code: 'TRADE-5',
    nameEn: 'Goods sold at the trading stage',
    nameBn: 'ব্যবসায়ী পর্যায়ে পণ্য বিক্রয়',
    kind: 'goods',
    nbrCode: null,
    unit: 'pcs',
    rateClass: 'truncated',
    vatPercent: '5',
  },
  {
    code: 'S099',
    nameEn: 'Renting of space (office rent)',
    nameBn: 'স্থান ও স্থাপনা ভাড়া (অফিস ভাড়া)',
    kind: 'service',
    nbrCode: 'S074.00',
    unit: 'month',
    rateClass: 'standard',
    vatPercent: '15',
  },
  {
    code: 'S-CONSULT',
    nameEn: 'Consultancy and advisory services',
    nameBn: 'পরামর্শক সেবা',
    kind: 'service',
    nbrCode: 'S099.60',
    unit: null,
    rateClass: 'standard',
    vatPercent: '15',
  },
  {
    code: 'S-ISP',
    nameEn: 'Internet service',
    nameBn: 'ইন্টারনেট সেবা',
    kind: 'service',
    nbrCode: 'S099.20',
    unit: 'month',
    rateClass: 'reduced',
    vatPercent: '5',
  },
  {
    code: 'S-ELEC',
    nameEn: 'Electricity',
    nameBn: 'বিদ্যুৎ',
    kind: 'service',
    nbrCode: 'S057.00',
    unit: 'kWh',
    rateClass: 'reduced',
    vatPercent: '5',
  },
  {
    code: 'S-CLEAN',
    nameEn: 'Cleaning and security services',
    nameBn: 'পরিচ্ছন্নতা ও নিরাপত্তা সেবা',
    kind: 'service',
    nbrCode: 'S068.00',
    unit: 'month',
    rateClass: 'reduced',
    vatPercent: '10',
  },
  {
    code: 'S-TRANS',
    nameEn: 'Transport of goods',
    nameBn: 'পণ্য পরিবহন',
    kind: 'service',
    nbrCode: 'S072.00',
    unit: null,
    rateClass: 'reduced',
    vatPercent: '10',
  },
  {
    code: 'EXPORT',
    nameEn: 'Export of goods',
    nameBn: 'পণ্য রপ্তানি',
    kind: 'goods',
    nbrCode: null,
    unit: 'pcs',
    rateClass: 'zero',
    vatPercent: '0',
  },
  {
    code: 'EXEMPT-AGRI',
    nameEn: 'Unprocessed agricultural produce',
    nameBn: 'অপ্রক্রিয়াজাত কৃষিপণ্য',
    kind: 'goods',
    nbrCode: null,
    unit: 'kg',
    rateClass: 'exempt',
    vatPercent: '0',
  },
];

/** Mushak 9.1 note numbers for the parts used here (PLACEHOLDER: verify against the form). */
export const NOTES = {
  sales: { zero: 1, exempt: 3, standard: 4, reduced: 7, truncated: 8 },
  purchases: {
    zero: 10,
    exempt: 12,
    standard: 14,
    reduced: 18,
    truncated: 19,
    notClaimable: 21,
  },
  increasingVds: 24,
  decreasingVds: 29,
  carryForwardIn: 52,
  netPayable: 65,
  carryForwardOut: 66,
} as const;

export function saleLine(
  value: string,
  rate: { vatPercent: string; sdPercent: string },
) {
  const sd = Money.of(value).times(rate.sdPercent).dividedBy(100).round();
  const vat = Money.of(value)
    .plus(sd)
    .times(rate.vatPercent)
    .dividedBy(100)
    .round();
  return { sdAmount: sd.toDb(), vatAmount: vat.toDb() };
}

/** A bill line typed with a percent and no VAT item. */
export function classOf(vatPercent: string): VatRateClass {
  const p = Money.of(vatPercent);
  if (p.isZero()) return 'exempt';
  return p.equals('15') ? 'standard' : 'reduced';
}

export interface SaleRow {
  rateClass: VatRateClass;
  value: string;
  sdAmount: string;
  vatAmount: string;
}
export interface PurchaseRow {
  rateClass: VatRateClass;
  value: string;
  vatAmount: string;
  claimable: boolean;
}

type Totals = { value: string; sd: string; vat: string };
const zero = (): Totals => ({ value: '0.00', sd: '0.00', vat: '0.00' });
const add = (t: Totals, value: string, sd: string, vat: string): Totals => ({
  value: Money.of(t.value).plus(value).toDb(),
  sd: Money.of(t.sd).plus(sd).toDb(),
  vat: Money.of(t.vat).plus(vat).toDb(),
});

export interface ReturnInputs {
  period: string;
  sales: SaleRow[];
  purchases: PurchaseRow[];
  /** VAT the company deducted at source from its suppliers this month (it deposits it by VDS challan) */
  vdsDeducted: string;
  /** VDS challans deposited for this month */
  vdsDeposited: string;
  /** VAT the company's customers deducted at source (their Mushak 6.6 certificates) */
  vdsByCustomers: string;
  /** credit carried from the previous month's return */
  carryForwardIn: string;
}

export function returnFigures(i: ReturnInputs) {
  const salesBy = Object.fromEntries(
    RATE_CLASSES.map((c) => [c, zero()]),
  ) as Record<VatRateClass, Totals>;
  let salesTotal = zero();
  for (const s of i.sales) {
    salesBy[s.rateClass] = add(
      salesBy[s.rateClass],
      s.value,
      s.sdAmount,
      s.vatAmount,
    );
    salesTotal = add(salesTotal, s.value, s.sdAmount, s.vatAmount);
  }
  const purchasesBy = Object.fromEntries(
    RATE_CLASSES.map((c) => [c, zero()]),
  ) as Record<VatRateClass, Totals>;
  let notClaimable = zero();
  let purchasesTotal = zero();
  for (const p of i.purchases) {
    if (p.claimable) {
      purchasesBy[p.rateClass] = add(
        purchasesBy[p.rateClass],
        p.value,
        '0',
        p.vatAmount,
      );
      purchasesTotal = add(purchasesTotal, p.value, '0', p.vatAmount);
    } else notClaimable = add(notClaimable, p.value, '0', p.vatAmount);
  }
  const outputTax = Money.of(salesTotal.vat).plus(salesTotal.sd);
  // net tax of the month: output (with SD) - input - VAT the customers already deposited - last month's credit
  const net = outputTax
    .minus(purchasesTotal.vat)
    .minus(i.vdsByCustomers)
    .minus(i.carryForwardIn);
  return {
    period: i.period,
    sales: { byClass: salesBy, total: salesTotal },
    purchases: { byClass: purchasesBy, notClaimable, total: purchasesTotal },
    outputTax: outputTax.toDb(),
    inputTax: purchasesTotal.vat,
    increasing: { vdsDeducted: Money.of(i.vdsDeducted).toDb() },
    decreasing: { vdsByCustomers: Money.of(i.vdsByCustomers).toDb() },
    carryForwardIn: Money.of(i.carryForwardIn).toDb(),
    netTax: net.toDb(),
    // VAT deducted at source is deposited by its own challans, not with the return
    vds: {
      deducted: Money.of(i.vdsDeducted).toDb(),
      deposited: Money.of(i.vdsDeposited).toDb(),
      stillToDeposit: Money.of(i.vdsDeducted).minus(i.vdsDeposited).toDb(),
    },
    netPayable: (net.isPositive() ? net : Money.zero()).toDb(),
    carryForwardOut: (net.isNegative() ? net.negate() : Money.zero()).toDb(),
    notes: NOTES,
  };
}

export type ReturnFigures = ReturnType<typeof returnFigures>;
