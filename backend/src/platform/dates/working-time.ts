/**
 * Working-hours arithmetic for SLAs (spec §5: "SLA counted in working hours,
 * excluding weekends and holidays").
 *
 * Interpretation (ADR 0005): hours run normally on working days and stop
 * completely on weekend and holiday days (Asia/Dhaka calendar). So with a
 * Friday + Saturday weekend:
 *
 *   submitted Thursday 15:00, 24 working hours  ->  due Sunday 15:00
 *   submitted Friday 10:00 (weekend), 24 hours  ->  due Monday 00:00
 */
import { addDays, toBusinessDate, type BusinessDate } from './business-date.js';

/** Dhaka has no daylight saving time: every day starts at 00:00 +06:00. */
const DHAKA_OFFSET = '+06:00';

/**
 * Working hours between two instants, the same clock the other way round
 * (WP28: how long a ticket waited for the customer, which is not the team's
 * delay, so the resolution deadline moves out by exactly this much).
 */
export function workingHoursBetween(
  from: Date,
  to: Date,
  isWorkingDay: (date: BusinessDate) => boolean,
): number {
  if (to <= from) return 0;
  let cursor = from.getTime();
  const end = to.getTime();
  let worked = 0;

  for (let days = 0; cursor < end; days++) {
    if (days > 3660)
      throw new Error('workingHoursBetween: more than 10 years apart');
    const today = toBusinessDate(new Date(cursor));
    const nextMidnight = Date.parse(
      `${addDays(today, 1)}T00:00:00${DHAKA_OFFSET}`,
    );
    const until = Math.min(end, nextMidnight);
    if (isWorkingDay(today)) worked += until - cursor;
    cursor = until;
  }
  return worked / 3_600_000;
}

export function addWorkingHours(
  start: Date,
  hours: number,
  isWorkingDay: (date: BusinessDate) => boolean,
): Date {
  let cursor = start.getTime();
  let remaining = hours * 3_600_000;

  for (let days = 0; remaining > 0; days++) {
    if (days > 3660)
      throw new Error('addWorkingHours: no working day found within 10 years');

    const today = toBusinessDate(new Date(cursor));
    const nextMidnight = Date.parse(
      `${addDays(today, 1)}T00:00:00${DHAKA_OFFSET}`,
    );

    if (!isWorkingDay(today)) {
      cursor = nextMidnight; // the clock stops for the whole day
      continue;
    }
    const used = Math.min(remaining, nextMidnight - cursor);
    cursor += used;
    remaining -= used;
  }
  return new Date(cursor);
}
