/**
 * Business dates (guide §5 rule 10).
 *
 * Two kinds of time exist in this system:
 *   - Instants (when something happened): JS Date, stored as timestamptz in UTC.
 *   - Business dates (which attendance day, leave day, payroll month): a
 *     'YYYY-MM-DD' string in the Asia/Dhaka calendar, stored as `date`.
 *
 * A punch at 2026-10-13T19:30Z is on business date 2026-10-14 in Dhaka (UTC+6).
 * Never use `new Date('2026-10-14')` for a business date; use these helpers.
 */

export const BUSINESS_TIMEZONE = 'Asia/Dhaka';

/** 'YYYY-MM-DD'. The brand stops plain strings being passed by mistake. */
export type BusinessDate = string & { readonly __brand: 'BusinessDate' };

export type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';
const WEEKDAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const dhakaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Validate and brand a 'YYYY-MM-DD' string. Throws on impossible dates like 2026-02-30. */
export function businessDate(text: string): BusinessDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new RangeError(`Not a date (YYYY-MM-DD): '${text}'`);
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) {
    throw new RangeError(`Not a real calendar date: '${text}'`);
  }
  return text as BusinessDate;
}

/** The Dhaka calendar date of an instant. */
export function toBusinessDate(instant: Date): BusinessDate {
  return dhakaDateFormatter.format(instant) as BusinessDate; // en-CA formats as YYYY-MM-DD
}

/** Today's date in Dhaka. Pass `now` in tests. */
export function todayInDhaka(now: Date = new Date()): BusinessDate {
  return toBusinessDate(now);
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) as BusinessDate;
}

/**
 * Add calendar months; the day is capped at the end of the target month.
 *   addMonths('2026-01-31', 1) -> '2026-02-28'
 */
export function addMonths(date: BusinessDate, months: number): BusinessDate {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as BusinessDate;
}

/** Whole days from `from` to `to` (to - from). Same date = 0. */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

export function weekdayOf(date: BusinessDate): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Every date from `from` to `to`, both included. */
export function eachDay(from: BusinessDate, to: BusinessDate): BusinessDate[] {
  const out: BusinessDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Number of days in a month, e.g. daysInMonth(2026, 2) = 28. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The first and last day of a month, e.g. '2026-11' -> 2026-11-01 … 2026-11-30.
 *
 * Worth having in one place: a hard-coded `${month}-31` is accepted by Postgres
 * for a 31-day month and rejected outright for the other five, so the bug hides
 * for most of the year.
 */
export function monthRange(period: string): {
  from: BusinessDate;
  to: BusinessDate;
} {
  const [year, month] = period.split('-').map(Number);
  return {
    from: businessDate(`${period}-01`),
    to: businessDate(
      `${period}-${String(daysInMonth(year, month)).padStart(2, '0')}`,
    ),
  };
}

/**
 * Fiscal year label for a date. Bangladesh's fiscal year runs July-June
 * (company setting `fiscal_year_start`, default '07-01').
 *   fiscalYearOf('2026-10-14') -> '2026-27'
 *   fiscalYearOf('2027-03-01') -> '2026-27'
 */
export function fiscalYearOf(
  date: BusinessDate,
  startMonthDay = '07-01',
): string {
  const year = Number(date.slice(0, 4));
  const startYear = date.slice(5) >= startMonthDay ? year : year - 1;
  if (startMonthDay === '01-01') return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
