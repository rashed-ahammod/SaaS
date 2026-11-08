/**
 * Pay periods. A pay period is a calendar month ("2026-10"). Salary income tax
 * follows the Bangladesh income year, July to June (fiscal year "2026-27").
 */
import {
  businessDate,
  daysInMonth,
  eachDay,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import type { Period } from '../../payroll-engine/index.js';

export function monthPeriod(label: string): Period {
  const [y, m] = label.split('-').map(Number);
  const fyStart = m >= 7 ? y : y - 1;
  return {
    label,
    from: `${label}-01`,
    to: `${label}-${String(daysInMonth(y, m)).padStart(2, '0')}`,
    fiscalYear: {
      label: `${fyStart}-${String(fyStart + 1).slice(2)}`,
      from: `${fyStart}-07-01`,
      to: `${fyStart + 1}-06-30`,
    },
  };
}

/** First and last month label of the fiscal year a period belongs to, e.g. "2026-07" .. "2027-06". */
export function fiscalYearMonths(period: Period): {
  first: string;
  last: string;
} {
  return {
    first: period.fiscalYear.from.slice(0, 7),
    last: period.fiscalYear.to.slice(0, 7),
  };
}

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

/** Days of [from, to] that fall inside [clipFrom, clipTo]. */
export function datesWithin(
  from: string,
  to: string,
  clipFrom: string,
  clipTo: string,
): BusinessDate[] {
  const a = from > clipFrom ? from : clipFrom;
  const b = to < clipTo ? to : clipTo;
  return a > b ? [] : eachDay(businessDate(a), businessDate(b));
}

/** Completed whole years between two dates (service length for gratuity). */
export function completedYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years--;
  return Math.max(0, years);
}

/** Run states whose results count as paid (year-to-date tax, arrears, payslips). */
export const PAID_STATES: Array<'approved' | 'disbursed'> = [
  'approved',
  'disbursed',
];
