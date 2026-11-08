/**
 * Tax deducted at source on a vendor bill (spec §6.6 "VAT deducted at source on
 * purchases when the company is a withholding entity, income tax withheld from
 * vendor payments by payment category"). Pure code: the rates come from the rule
 * pack (tax.tds.vendor_categories, tax.tds.no_tin_surcharge_percent), the cases
 * are in test/withholding-cases/*.yaml.
 *
 *   income tax (TDS)   on the bill amount before VAT, at the category's rate; a
 *                      category with slabs takes the rate of the slab the whole
 *                      amount falls in; a vendor without a TIN pays a surcharge
 *                      on the rate
 *   VAT (VDS)          only when the company is a VAT withholding entity: the
 *                      category's share of the invoice VAT
 *   input VAT          claimable only on a VAT-registered vendor's invoice (BIN);
 *                      otherwise the VAT is part of the cost
 *
 * Amounts withheld are rounded to the taka (placeholder: verify with the NBR rules).
 * PLACEHOLDER: every rate in the rule pack is "verify" until the tax adviser confirms it.
 */
import { Money, TAKA_ROUNDING } from '../../platform/money/money.js';

export interface WithholdingCategory {
  code: string;
  nameEn: string;
  nameBn?: string;
  section?: string;
  /** a flat rate, or ... */
  tdsPercent?: string;
  /** ... the rate of the slab the whole amount falls in (upTo null = no upper limit) */
  tdsSlabs?: Array<{ upTo: string | null; percent: string }>;
  /** share of the invoice VAT a withholding entity deducts (100 = all of it) */
  vdsShareOfVatPercent: string;
}

export interface WithholdingInput {
  categoryCode: string;
  /** bill amount before VAT */
  base: string;
  /** VAT on the vendor's invoice */
  vat: string;
  vendorHasTin: boolean;
  vendorHasBin: boolean;
  companyIsVdsEntity: boolean;
}

export interface WithholdingRules {
  categories: WithholdingCategory[];
  noTinSurchargePercent: string;
}

export interface WithholdingResult {
  categoryCode: string;
  tdsPercent: string;
  tds: string;
  vdsPercent: string;
  vds: string;
  /** VAT the company may claim back (input VAT) */
  inputVat: string;
  /** VAT that is part of the cost (vendor without BIN) */
  vatInCost: string;
  /** what the vendor receives: base + VAT - TDS - VDS */
  netPayable: string;
}

export function computeWithholding(
  input: WithholdingInput,
  rules: WithholdingRules,
): WithholdingResult {
  const category = rules.categories.find((c) => c.code === input.categoryCode);
  if (!category)
    throw new Error(`Unknown withholding category ${input.categoryCode}`);
  const base = Money.of(input.base);
  const vat = Money.of(input.vat);

  // income tax: the category rate (or its slab), plus the surcharge without a TIN
  let percent = Money.of(tdsPercentFor(category, base));
  if (!input.vendorHasTin && percent.isPositive())
    percent = percent.plus(
      percent.times(rules.noTinSurchargePercent).dividedBy(100),
    );
  const tds = base
    .times(percent.toPreciseString())
    .dividedBy(100)
    .round(TAKA_ROUNDING);

  // VAT at source: only a withholding entity, only VAT actually charged
  const vdsPercent =
    input.companyIsVdsEntity && vat.isPositive()
      ? category.vdsShareOfVatPercent
      : '0';
  let vds = vat.times(vdsPercent).dividedBy(100).round(TAKA_ROUNDING);
  if (vds.greaterThan(vat)) vds = vat;

  return {
    categoryCode: category.code,
    tdsPercent: percent.toPreciseString(),
    tds: tds.toDb(),
    vdsPercent,
    vds: vds.toDb(),
    inputVat: input.vendorHasBin ? vat.toDb() : '0.00',
    vatInCost: input.vendorHasBin ? '0.00' : vat.toDb(),
    netPayable: base.plus(vat).minus(tds).minus(vds).toDb(),
  };
}

function tdsPercentFor(category: WithholdingCategory, base: Money): string {
  if (category.tdsSlabs?.length) {
    const slab = category.tdsSlabs.find(
      (s) => s.upTo === null || !base.greaterThan(s.upTo),
    );
    return (
      slab?.percent ?? category.tdsSlabs[category.tdsSlabs.length - 1].percent
    );
  }
  return category.tdsPercent ?? '0';
}

/** A rule pack value is usable: every category has a rate and a VDS share. */
export function validateCategories(
  value: unknown,
): value is WithholdingCategory[] {
  return (
    Array.isArray(value) &&
    value.every(
      (c) =>
        c &&
        typeof c.code === 'string' &&
        typeof c.vdsShareOfVatPercent === 'string' &&
        (typeof c.tdsPercent === 'string' || Array.isArray(c.tdsSlabs)),
    )
  );
}
