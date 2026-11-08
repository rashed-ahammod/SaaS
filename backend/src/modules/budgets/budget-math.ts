/**
 * Budget arithmetic (WP18; spec §6.6). Pure code.
 *
 *   used      = actual + committed
 *   available = budget - used            (negative = over budget)
 *   percent   = used / budget x 100
 *   status    within | warning (from the warning percent, 80) | over (more than 100 %)
 *
 * A check of new spending (a requisition, a purchase order) looks at the position
 * after it: projected = used + new amount. More than the budget needs the Admin;
 * reaching exactly 100 % does not.
 */
import { Decimal } from 'decimal.js';

export type BudgetStatus = 'within' | 'warning' | 'over';

export interface Position {
  budget: string;
  actual: string;
  committed: string;
  used: string;
  available: string;
  /** null when the budget is 0 */
  percent: string | null;
  status: BudgetStatus;
}

const money = (d: Decimal) =>
  d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export function position(
  budget: string,
  actual: string,
  committed: string,
  warningPercent: string,
): Position {
  const b = new Decimal(budget);
  const used = new Decimal(actual).plus(committed);
  const percent = b.isZero() ? null : used.dividedBy(b).times(100);
  const status: BudgetStatus = used.greaterThan(b)
    ? 'over'
    : percent !== null && percent.greaterThanOrEqualTo(warningPercent)
      ? 'warning'
      : 'within';
  return {
    budget: money(b),
    actual: money(new Decimal(actual)),
    committed: money(new Decimal(committed)),
    used: money(used),
    available: money(b.minus(used)),
    percent:
      percent === null
        ? null
        : percent.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    status,
  };
}

/** The position after new spending of `amount`. */
export function projected(
  p: Position,
  amount: string,
  warningPercent: string,
): Position {
  return position(
    p.budget,
    p.actual,
    new Decimal(p.committed).plus(amount).toFixed(2),
    warningPercent,
  );
}

/** The alert levels a position has reached: 80 (the warning percent) and 100. */
export function levelsReached(
  p: Position,
  warningPercent: string,
): Array<80 | 100> {
  if (new Decimal(p.budget).isZero()) return [];
  // the exact share, not the rounded percent shown (79.999 % has not reached 80 %)
  const pct = new Decimal(p.used).dividedBy(p.budget).times(100);
  const out: Array<80 | 100> = [];
  if (pct.greaterThanOrEqualTo(warningPercent)) out.push(80);
  if (pct.greaterThanOrEqualTo(100)) out.push(100);
  return out;
}
