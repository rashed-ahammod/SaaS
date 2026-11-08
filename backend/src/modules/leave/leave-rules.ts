/**
 * Leave arithmetic (spec §6.3). Pure functions: no database (leave-rules.spec.ts).
 * Days are numbers with at most 2 decimals (half days, earned-leave fractions);
 * round2() keeps sums exact.
 */
import {
  addDays,
  addMonths,
  businessDate,
  daysBetween,
  type BusinessDate,
} from '../../platform/dates/business-date.js';

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const roundHalf = (n: number) => Math.round(n * 2) / 2;

export interface LeaveYear {
  label: string; // "2026" for a calendar year, "2026-27" for July-June
  from: BusinessDate;
  to: BusinessDate; // inclusive
}

/** The leave year a date falls in. start = "MM-01" (company setting, default "01-01"). */
export function leaveYearOf(date: BusinessDate, start = '01-01'): LeaveYear {
  const year = Number(date.slice(0, 4));
  const startYear = date.slice(5) >= start ? year : year - 1;
  const from = businessDate(`${startYear}-${start}`);
  const to = addDays(addMonths(from, 12), -1);
  const label =
    start === '01-01'
      ? String(startYear)
      : `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return { label, from, to };
}

export interface CalendarDay {
  date: BusinessDate;
  working: boolean; // not a weekend or holiday at the employee's branch
}

export interface CountOptions {
  /** Count weekends and holidays too (maternity: calendar days). */
  countsNonWorkingDays: boolean;
  /** A weekend / holiday between two leave days counts as leave (company setting). */
  sandwichRule: boolean;
  halfDay: boolean;
}

/**
 * Which days of a range are leave days, and how many in total.
 *
 *   Thu-Sun with a Fri+Sat weekend:  no sandwich -> Thu, Sun = 2 days
 *                                    sandwich    -> Thu, Fri, Sat, Sun = 4 days
 *   a weekend at the start or end of the range never counts (it is not "between")
 */
export function countLeaveDays(
  days: CalendarDay[],
  opts: CountOptions,
): { total: number; counted: Array<{ date: BusinessDate; days: number }> } {
  if (opts.halfDay) {
    const day = days[0];
    const counted =
      day && (day.working || opts.countsNonWorkingDays)
        ? [{ date: day.date, days: 0.5 }]
        : [];
    return { total: counted.length ? 0.5 : 0, counted };
  }
  if (opts.countsNonWorkingDays)
    return {
      total: days.length,
      counted: days.map((d) => ({ date: d.date, days: 1 })),
    };

  const firstWorking = days.findIndex((d) => d.working);
  const lastWorking =
    days.length - 1 - [...days].reverse().findIndex((d) => d.working);
  const counted = days
    .filter(
      (d, i) =>
        d.working ||
        (opts.sandwichRule &&
          firstWorking >= 0 &&
          i > firstWorking &&
          i < lastWorking),
    )
    .map((d) => ({ date: d.date, days: 1 }));
  return { total: counted.length, counted };
}

/** Group counted days by leave year (a request over New Year is split in the ledger). */
export function daysByLeaveYear(
  counted: Array<{ date: BusinessDate; days: number }>,
  start: string,
): Map<string, { days: number; firstDate: BusinessDate }> {
  const result = new Map<string, { days: number; firstDate: BusinessDate }>();
  for (const c of counted) {
    const label = leaveYearOf(c.date, start).label;
    const entry = result.get(label) ?? { days: 0, firstDate: c.date };
    entry.days = round2(entry.days + c.days);
    result.set(label, entry);
  }
  return result;
}

/**
 * Entitlement for part of a leave year (joined during the year), rounded to the
 * nearest half day. Joined before the year: the full entitlement.
 */
export function prorate(
  entitlement: number,
  joinDate: BusinessDate,
  year: LeaveYear,
): number {
  if (joinDate <= year.from) return entitlement;
  if (joinDate > year.to) return 0;
  const yearDays = daysBetween(year.from, year.to) + 1;
  const remaining = daysBetween(joinDate, year.to) + 1;
  return roundHalf((entitlement * remaining) / yearDays);
}

/** Completed months of service on a date. */
export function serviceMonths(
  joinDate: BusinessDate,
  onDate: BusinessDate,
): number {
  let months = 0;
  while (addMonths(joinDate, months + 1) <= onDate) months++;
  return months;
}

/**
 * Year end for one balance: keep up to the carry cap, encash the rest if the type
 * is encashable, else it lapses.
 */
export function yearEndSplit(
  balance: number,
  action: 'lapse' | 'carry',
  carryCap: number | null,
  encashable: boolean,
) {
  if (balance <= 0) return { carry: 0, encash: 0, lapse: 0 };
  const carry = action === 'carry' ? Math.min(balance, carryCap ?? balance) : 0;
  const rest = round2(balance - carry);
  return {
    carry: round2(carry),
    encash: encashable ? rest : 0,
    lapse: encashable ? 0 : rest,
  };
}
