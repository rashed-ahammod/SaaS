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
