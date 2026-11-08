/**
 * Daily attendance status (spec §6.2). Pure function: no database
 * (day-status.spec.ts). AttendanceService collects the inputs and stores the result.
 *
 * Order of decisions:
 *   1. approved leave                    -> on_leave
 *   2. holiday (branch calendar)         -> holiday   (work on it counts as overtime)
 *   3. weekend (branch weekly off days)  -> weekend   (work on it counts as overtime)
 *   4. working day:
 *        no punch                        -> absent
 *        one punch                       -> missing_punch (needs a correction request)
 *        worked < half-day threshold     -> half_day
 *        first in after start + grace    -> late   (late minutes counted from shift start)
 *        otherwise                       -> present
 *
 * Overtime: only for OT-eligible grades: time after shift end on a working day,
 * or all time worked on a holiday / weekend. It becomes payable only after
 * Dept Head approval (ot_approved_minutes).
 *
 * Times are Asia/Dhaka (UTC+6, no daylight saving). A shift whose end is not
 * after its start ends the next day (night shift).
 */
import {
  addDays,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import type { DayStatus } from '../../platform/db/schema.js';

export interface ShiftTimes {
  startTime: string; // 'HH:MM' or 'HH:MM:SS'
  endTime: string;
  graceMinutes: number;
  halfDayMinutes: number;
}

export interface DayInput {
  date: BusinessDate;
  shift: ShiftTimes | null;
  isWeekend: boolean;
  holidayName: string | null;
  onLeave: boolean;
  /** Punches inside this day's window (see punchWindow). */
  punches: Date[];
  otEligible: boolean;
}

export interface DayResult {
  status: DayStatus;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  otMinutes: number;
  holidayName: string | null;
}

/** Punches up to 4 h before the shift and 6 h after it belong to that day. */
const BEFORE_SHIFT_MS = 4 * 3_600_000;
const AFTER_SHIFT_MS = 6 * 3_600_000;
const DEFAULT_SHIFT: ShiftTimes = {
  startTime: '09:00',
  endTime: '17:00',
  graceMinutes: 0,
  halfDayMinutes: 0,
};

/** Shift start and end as instants on a business date. */
export function shiftInstants(
  date: BusinessDate,
  shift: ShiftTimes,
): { start: Date; end: Date } {
  const start = dhakaInstant(date, shift.startTime);
  let end = dhakaInstant(date, shift.endTime);
  if (end <= start) end = dhakaInstant(addDays(date, 1), shift.endTime); // night shift
  return { start, end };
}

/** Which punches count for a date: [shift start - 4h, shift end + 6h). */
export function punchWindow(
  date: BusinessDate,
  shift: ShiftTimes | null,
): { from: Date; to: Date } {
  const { start, end } = shiftInstants(date, shift ?? DEFAULT_SHIFT);
  return {
    from: new Date(start.getTime() - BEFORE_SHIFT_MS),
    to: new Date(end.getTime() + AFTER_SHIFT_MS),
  };
}

export function computeDay(input: DayInput): DayResult {
  const punches = [...input.punches].sort((a, b) => a.getTime() - b.getTime());
  const firstIn = punches[0] ?? null;
  const lastOut = punches.length >= 2 ? punches[punches.length - 1] : null;
  const workedMinutes =
    firstIn && lastOut ? minutesBetween(firstIn, lastOut) : 0;
  const base = {
    firstIn,
    lastOut,
    workedMinutes,
    lateMinutes: 0,
    otMinutes: 0,
    holidayName: input.holidayName,
  };

  // 1-3. not a working day for this employee
  if (input.onLeave) return { ...base, status: 'on_leave' };
  if (input.holidayName || input.isWeekend) {
    return {
      ...base,
      status: input.holidayName ? 'holiday' : 'weekend',
      otMinutes: input.otEligible ? workedMinutes : 0,
    };
  }

  // 4. working day
  if (punches.length === 0) return { ...base, status: 'absent' };
  if (punches.length === 1) return { ...base, status: 'missing_punch' };

  const shift = input.shift;
  if (!shift) return { ...base, status: 'present' };
  const { start, end } = shiftInstants(input.date, shift);

  const lateMinutes =
    firstIn!.getTime() > start.getTime() + shift.graceMinutes * 60_000
      ? minutesBetween(start, firstIn!)
      : 0;
  const otMinutes =
    input.otEligible && lastOut! > end ? minutesBetween(end, lastOut!) : 0;

  if (workedMinutes < shift.halfDayMinutes)
    return { ...base, status: 'half_day', lateMinutes, otMinutes };
  return {
    ...base,
    status: lateMinutes > 0 ? 'late' : 'present',
    lateMinutes,
    otMinutes,
  };
}

/** A local Dhaka date + time as an instant. */
export function dhakaInstant(date: BusinessDate, time: string): Date {
  const hhmm = time.length === 5 ? `${time}:00` : time.slice(0, 8);
  return new Date(`${date}T${hhmm}+06:00`);
}

function minutesBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 60_000);
}

/**
 * Distance in metres between two points (haversine). Used for the mobile-punch
 * geo-fence check.
 */
export function distanceMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
