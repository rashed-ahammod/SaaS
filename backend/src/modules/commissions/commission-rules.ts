/**
 * How commission is worked out (WP31; spec §6.4 "Sales targets per user and department feed
 * commission into payroll").
 *
 * Pure arithmetic, no database, so the figure a salesperson argues about can be reproduced
 * from the four numbers it came from: the basis, the target, the rate and the bands.
 *
 *   attainmentOf(basis, target)   how much of the month's target was reached, in percent
 *   rateFor(rule, attainment)     the rate that applies: none below the minimum, the base
 *                                 rate up to the bonus band, the bonus rate above it
 *   commissionOf(rule, ...)       the amount, rounded to paisa like every other money value
 *
 * The scheme is deliberately simple: one active rule per company, one basis (invoiced or
 * collected), one base rate and one optional bonus band. Everything a pilot asked for fits
 * in that, and anything that does not fit should be a new rule type with its own test rather
 * than a cleverer formula here.
 */
import { Money, TAKA_ROUNDING } from '../../platform/money/money.js';

export interface CommissionScheme {
  basis: 'invoiced' | 'collected';
  ratePercent: string;
  minAttainment: string;
  bonusAttainment: string | null;
  bonusRatePercent: string | null;
  clawback: boolean;
}

/** Percent of the target reached. No target (or a zero target) means attainment is unknown. */
export function attainmentOf(
  basisAmount: Money,
  target: Money | null,
): number | null {
  if (!target || target.compare('0') <= 0) return null;
  return (
    Math.round(
      (Number(basisAmount.toString()) / Number(target.toString())) * 10000,
    ) / 100
  );
}

/**
 * The rate that applies.
 *
 *   - below the minimum attainment: nothing is earned (a target the company set is a
 *     threshold, not a suggestion);
 *   - at or above the bonus band: the bonus rate on the whole basis (this is how the pilots
 *     described it — not a marginal rate, which nobody could check by hand);
 *   - otherwise: the base rate.
 *
 * With no target at all there is nothing to fall short of, so the base rate applies: a
 * salesperson is not punished because HR has not set their target.
 */
export function rateFor(
  scheme: CommissionScheme,
  attainment: number | null,
): string {
  const min = Number(scheme.minAttainment);
  if (attainment !== null && min > 0 && attainment < min) return '0';
  if (
    attainment !== null &&
    scheme.bonusAttainment &&
    scheme.bonusRatePercent &&
    attainment >= Number(scheme.bonusAttainment)
  )
    return scheme.bonusRatePercent;
  return scheme.ratePercent;
}

export interface CommissionResult {
  ratePercent: string;
  attainment: number | null;
  amount: Money;
}

export function commissionOf(
  scheme: CommissionScheme,
  basisAmount: Money,
  target: Money | null,
): CommissionResult {
  const attainment = attainmentOf(basisAmount, target);
  const ratePercent = rateFor(scheme, attainment);
  // commission is paid in whole taka, like every other payroll amount a human reads
  const amount = basisAmount
    .times(ratePercent)
    .dividedBy('100')
    .round(TAKA_ROUNDING);
  return { ratePercent, attainment, amount };
}

/** A scheme the database would accept but that means nothing. */
export function schemeProblem(scheme: {
  bonusAttainment?: string | number | null;
  bonusRatePercent?: string | number | null;
  minAttainment?: string | number | null;
}): string | null {
  const has = (v: unknown) => v !== null && v !== undefined && v !== '';
  if (has(scheme.bonusAttainment) !== has(scheme.bonusRatePercent))
    return 'A bonus rate needs the attainment it starts at, and the other way round';
  if (
    has(scheme.bonusAttainment) &&
    has(scheme.minAttainment) &&
    Number(scheme.bonusAttainment) < Number(scheme.minAttainment)
  )
    return 'The bonus band cannot start below the minimum attainment';
  return null;
}
