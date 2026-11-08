/**
 * Salary income tax (spec §6.4 step 4, guide §12.2 step 6).
 *
 *   exemption  = lower of (annual salary income / divisor) and cap   (divisor 3 = one third)
 *   taxable    = annual income - exemption
 *   tax        = slab rates on taxable; at least the minimum tax when any is due
 *
 * Monthly withholding = (annual tax - tax already withheld this fiscal year)
 *                       / months left in the fiscal year (incl. this one)
 *
 * All rates and limits come from the rule pack per fiscal year. NOT yet
 * included: investment rebate (needs employees' investment declarations), and
 * special thresholds for women / senior / disabled taxpayers; see ADR 0009.
 */
import { Money } from '../platform/money/money.js';
import type { TaxRules } from './types.js';

export interface AnnualTax {
  income: Money;
  exemption: Money;
  taxable: Money;
  tax: Money;
  bySlab: Array<{ upTo: string | null; rate: string; amount: string }>;
}

export function annualTax(income: Money, rules: TaxRules): AnnualTax {
  const positive = income.isNegative() ? Money.zero() : income;
  const byShare = positive.dividedBy(rules.exemptionDivisor);
  const exemption = byShare.lessThan(rules.exemptionCap)
    ? byShare
    : Money.of(rules.exemptionCap);
  const taxable = positive.minus(exemption);

  let tax = Money.zero();
  let lower = Money.zero();
  const bySlab: AnnualTax['bySlab'] = [];
  for (const slab of rules.slabs) {
    if (!taxable.greaterThan(lower)) break;
    const upper =
      slab.upTo === null
        ? taxable
        : Money.of(slab.upTo).lessThan(taxable)
          ? Money.of(slab.upTo)
          : taxable;
    const amount = upper.minus(lower).times(slab.rate);
    tax = tax.plus(amount);
    bySlab.push({
      upTo: slab.upTo,
      rate: slab.rate,
      amount: amount.toPreciseString(),
    });
    lower = upper;
  }
  if (tax.isPositive() && tax.lessThan(rules.minimumTax))
    tax = Money.of(rules.minimumTax);
  return { income: positive, exemption, taxable, tax, bySlab };
}

/** This month's withholding: what is still due, spread over the remaining months. */
export function monthlyWithholding(
  annual: Money,
  alreadyWithheld: Money,
  monthsLeftIncludingThis: number,
): Money {
  const due = annual.minus(alreadyWithheld);
  if (!due.isPositive() || monthsLeftIncludingThis <= 0) return Money.zero();
  return due.dividedBy(monthsLeftIncludingThis);
}
