/**
 * Depreciation schedule (WP19; spec §6.7 "depreciation method per asset class"). Pure
 * code: the same asset always gives the same schedule, month by month, so any run can
 * be reproduced and checked.
 *
 * Rules (placeholders until the accountant confirms them):
 *   - depreciation starts in the in-service month (a full month), or the month after
 *     the opening date for an asset brought from the old books;
 *   - straight line: (cost - residual - opening accumulated) spread evenly over the
 *     months of life left; each month = the rounded cumulative amount minus the one
 *     before, so the paisa never drift and the last month lands exactly;
 *   - reducing balance: book value at the start of the month x yearly rate / 12,
 *     rounded to the paisa; never below the residual value;
 *   - nothing after the life ends or once the book value reaches the residual.
 */
import { Decimal } from 'decimal.js';

export interface DepreciableAsset {
  cost: string;
  residualValue: string;
  inServiceDate: string; // 2026-07-15
  openingAccumulated: string;
  openingAsOf: string | null; // 2026-06-30
  method: 'straight_line' | 'reducing_balance';
  usefulLifeMonths: number | null;
  annualRatePercent: string | null;
}

export interface ScheduleRow {
  period: string; // 2026-07
  charge: string;
  accumulated: string;
  bookValue: string;
}

const paisa = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Months from `a` to `b` (same month = 0). */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** The schedule from the first depreciable month up to `until` (inclusive) or the end. */
export function schedule(
  asset: DepreciableAsset,
  until: string,
): ScheduleRow[] {
  const cost = new Decimal(asset.cost);
  const residual = new Decimal(asset.residualValue);
  const opening = new Decimal(asset.openingAccumulated);
  const firstMonth = asset.openingAsOf
    ? addMonths(asset.openingAsOf.slice(0, 7), 1)
    : asset.inServiceDate.slice(0, 7);
  const rows: ScheduleRow[] = [];
  if (monthsBetween(firstMonth, until) < 0) return rows;

  let accumulated = opening;
  if (asset.method === 'straight_line') {
    const life = asset.usefulLifeMonths!;
    const used = asset.openingAsOf
      ? monthsBetween(
          asset.inServiceDate.slice(0, 7),
          asset.openingAsOf.slice(0, 7),
        ) + 1
      : 0;
    const left = Math.max(1, life - used);
    const amount = cost.minus(residual).minus(opening);
    if (amount.lessThanOrEqualTo(0)) return rows;
    for (let k = 1; k <= left; k++) {
      const period = addMonths(firstMonth, k - 1);
      if (monthsBetween(period, until) < 0) break;
      const charge = paisa(amount.times(k).dividedBy(left)).minus(
        paisa(amount.times(k - 1).dividedBy(left)),
      );
      accumulated = accumulated.plus(charge);
      rows.push({
        period,
        charge: charge.toFixed(2),
        accumulated: accumulated.toFixed(2),
        bookValue: cost.minus(accumulated).toFixed(2),
      });
    }
    return rows;
  }

  // reducing balance
  const rate = new Decimal(asset.annualRatePercent!).dividedBy(1200);
  for (
    let period = firstMonth;
    monthsBetween(period, until) >= 0;
    period = addMonths(period, 1)
  ) {
    const book = cost.minus(accumulated);
    if (book.lessThanOrEqualTo(residual)) break;
    let charge = paisa(book.times(rate));
    if (book.minus(charge).lessThan(residual)) charge = book.minus(residual);
    if (charge.lessThanOrEqualTo(0)) break;
    accumulated = accumulated.plus(charge);
    rows.push({
      period,
      charge: charge.toFixed(2),
      accumulated: accumulated.toFixed(2),
      bookValue: cost.minus(accumulated).toFixed(2),
    });
    if (rows.length > 1200) break; // 100 years: a guard, never reached in practice
  }
  return rows;
}

/** Accumulated depreciation at the end of `period` (the opening amount before the schedule starts). */
export function accumulatedAt(asset: DepreciableAsset, period: string): string {
  const rows = schedule(asset, period);
  return rows.length
    ? rows[rows.length - 1].accumulated
    : new Decimal(asset.openingAccumulated).toFixed(2);
}
