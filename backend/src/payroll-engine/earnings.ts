/**
 * Salary-derived earnings for one month (guide §12.2 steps 1-3):
 *   - split gross into heads by the salary structure,
 *   - prorate by paid days: joiners, leavers and mid-month salary changes are
 *     handled by computing each salary segment's share of the month,
 *   - unpaid days (absent, leave without pay, late penalty) as a negative line,
 *   - maternity days replaced by maternity pay (monthly wage / 26 per day).
 *
 * Used for the current month AND to re-compute earlier months when salary
 * history changed afterwards (arrears).
 */
import {
  addDays,
  businessDate,
  daysBetween,
  type BusinessDate,
} from '../platform/dates/business-date.js';
import { Money } from '../platform/money/money.js';
import type { PayrollSettings, SalarySegment, StructureRule } from './types.js';

/** Full-month amount of each head for a gross salary. */
export function applyStructure(
  gross: Money,
  structure: StructureRule[],
): Map<string, Money> {
  const heads = new Map<string, Money>();
  for (const rule of structure) {
    let amount: Money;
    if (rule.remainder) {
      amount = gross.minus(Money.sum(heads.values()));
    } else if (rule.fixed !== undefined) {
      amount = Money.of(rule.fixed);
    } else {
      const base = rule.of === 'GROSS' || !rule.of ? gross : heads.get(rule.of);
      if (!base)
        throw new Error(
          `Structure rule for ${rule.head} refers to ${rule.of}, which comes later or does not exist`,
        );
      amount = base.times(rule.percent ?? '0').dividedBy(100);
    }
    heads.set(rule.head, (heads.get(rule.head) ?? Money.zero()).plus(amount));
  }
  return heads;
}

export interface SalaryEarningsInput {
  period: { from: string; to: string };
  employment: { from: string; to: string }; // join / last working day clipped to the month
  salary: SalarySegment[];
  unpaidDates: string[];
  latePenaltyDays: number;
  maternityDates: string[];
  maternityDivisor: number;
  settings: Pick<PayrollSettings, 'unpaidDayBasis'>;
}

export interface SalaryEarnings {
  /** Unrounded amount per structure head. */
  heads: Map<string, Money>;
  unpaid: Money; // negative or zero
  maternity: Money;
  trace: Array<Record<string, unknown>>;
}

/** Salary segment covering a date. */
export function segmentOn(
  salary: SalarySegment[],
  date: string,
): SalarySegment | undefined {
  return salary.find((s) => s.from <= date && (s.to === null || date <= s.to));
}

export function salaryEarnings(input: SalaryEarningsInput): SalaryEarnings {
  const periodDays =
    daysBetween(
      businessDate(input.period.from),
      businessDate(input.period.to),
    ) + 1;
  const maternity = new Set(input.maternityDates);
  const heads = new Map<string, Money>();
  const trace: Array<Record<string, unknown>> = [];

  // 1-2. each salary segment's share of the month
  for (const segment of input.salary) {
    const from = maxDate(segment.from, input.employment.from);
    const to = minDate(segment.to ?? input.employment.to, input.employment.to);
    if (from > to) continue;
    let paidDays = 0;
    for (let d = businessDate(from); d <= to; d = addDays(d, 1))
      if (!maternity.has(d)) paidDays++;
    if (paidDays === 0) continue;

    const full = applyStructure(Money.of(segment.gross), segment.structure);
    for (const [head, amount] of full) {
      heads.set(
        head,
        (heads.get(head) ?? Money.zero()).plus(
          amount.times(paidDays).dividedBy(periodDays),
        ),
      );
    }
    trace.push({
      segment: `${from}..${to}`,
      gross: segment.gross,
      paidDays,
      periodDays,
    });
  }

  // 3. unpaid days at the per-day rate of the salary on that day
  let unpaid = Money.zero();
  for (const date of input.unpaidDates) {
    const seg = segmentOn(input.salary, date);
    if (!seg || date < input.employment.from || date > input.employment.to)
      continue;
    unpaid = unpaid.minus(
      dayRate(Money.of(seg.gross), input.period, input.settings.unpaidDayBasis),
    );
  }
  if (input.latePenaltyDays > 0) {
    const seg =
      segmentOn(input.salary, input.employment.to) ?? input.salary.at(-1);
    if (seg)
      unpaid = unpaid.minus(
        dayRate(
          Money.of(seg.gross),
          input.period,
          input.settings.unpaidDayBasis,
        ).times(input.latePenaltyDays),
      );
  }

  // maternity pay: monthly wage / divisor for each maternity day
  let maternityPay = Money.zero();
  for (const date of input.maternityDates) {
    const seg = segmentOn(input.salary, date);
    if (seg && date >= input.employment.from && date <= input.employment.to)
      maternityPay = maternityPay.plus(
        Money.of(seg.gross).dividedBy(input.maternityDivisor),
      );
  }

  return { heads, unpaid, maternity: maternityPay, trace };
}

export function dayRate(
  gross: Money,
  period: { from: string; to: string },
  basis: PayrollSettings['unpaidDayBasis'],
): Money {
  const days =
    basis === 'fixed30'
      ? 30
      : basis === 'fixed26'
        ? 26
        : daysBetween(businessDate(period.from), businessDate(period.to)) + 1;
  return gross.dividedBy(days);
}

export const maxDate = (a: string, b: string) =>
  (a > b ? a : b) as BusinessDate;
export const minDate = (a: string, b: string) =>
  (a < b ? a : b) as BusinessDate;
