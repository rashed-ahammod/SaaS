/**
 * Builds attendance_days from punches, shifts, overrides, holidays, weekends and
 * leave (guide §10 rules 4-5). Called:
 *   - after every punch / device upload            (the affected days)
 *   - when a correction or overtime is approved     (that day)
 *   - when a holiday is added, moved or removed     (those dates, every employee of the branches)
 *   - by the daily job (yesterday) and HR's "recompute" (a date range)
 *
 * Locked days (monthly lock) are never changed. If a locked day would now come
 * out differently, an attendance_adjustments row records the difference for the
 * next payroll (guide §10 rule 5).
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { canonicalJson } from '../../platform/crypto/canonical-json.js';
import {
  addDays,
  toBusinessDate,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { AttendanceDay, Shift } from '../../platform/db/schema.js';
import { WorkCalendarService } from '../calendar/work-calendar.service.js';
import {
  EmployeeDirectory,
  type PlacementFacts,
} from '../employees/employee-directory.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import {
  computeDay,
  punchWindow,
  type DayResult,
  type ShiftTimes,
} from './day-status.js';

/** Approved leave on a date. The leave module (WP5) plugs in here; until then nobody is on leave. */
export type LeaveSource = (
  employeeId: string,
  date: BusinessDate,
) => Promise<boolean>;

@Injectable()
export class AttendanceComputeService implements OnModuleInit {
  private leaveSource: LeaveSource = async () => false;

  constructor(
    private readonly db: DatabaseService,
    private readonly employees: EmployeeDirectory,
    private readonly org: OrgLookupService,
    private readonly calendar: WorkCalendarService,
  ) {}

  /** Holidays moved / added / removed: recompute those dates for the branches using the calendar. */
  onModuleInit() {
    this.calendar.onHolidaysChanged(async ({ calendarId, dates }) => {
      const branchIds = await this.org.branchesUsingCalendar(calendarId);
      for (const date of dates) {
        for (const p of await this.employees.employedOn(date, { branchIds })) {
          await this.recomputeDay(p.employeeId, date, 'holiday_changed');
        }
      }
    });
  }

  setLeaveSource(source: LeaveSource): void {
    this.leaveSource = source;
  }

  /** Recompute every employee of a company (or all companies) for one date. Returns how many days. */
  async recomputeDate(date: BusinessDate, companyId?: string): Promise<number> {
    const placements = await this.employees.employedOn(date, { companyId });
    for (const p of placements)
      await this.recomputeDay(p.employeeId, date, 'recompute', p);
    return placements.length;
  }

  /** Days touched by punches at these instants (the punch date, and the day before for night shifts). */
  async recomputeForPunches(
    employeeId: string,
    instants: Date[],
    reason: string,
  ): Promise<void> {
    const dates = new Set<BusinessDate>();
    for (const at of instants) {
      const d = toBusinessDate(at);
      dates.add(d);
      dates.add(addDays(d, -1));
    }
    for (const d of [...dates].sort())
      await this.recomputeDay(employeeId, d, reason);
  }

  /**
   * Compute one employee-day and store it, or record an adjustment if the day is
   * locked. Returns the stored / would-be result, or undefined when the employee
   * was not employed that day.
   */
  async recomputeDay(
    employeeId: string,
    date: BusinessDate,
    reason: string,
    known?: PlacementFacts,
  ): Promise<DayResult | undefined> {
    // employed that day?
    const placement =
      known ?? (await this.employees.placementOn(employeeId, date));
    if (!placement) return undefined;

    // inputs: shift, calendar, leave, punches, OT eligibility
    const shift = await this.shiftFor(employeeId, placement, date);
    const info = (
      await this.calendar.dayInfo(placement.branchId, date, date)
    ).get(date)!;
    const window = punchWindow(date, shift?.times ?? null);
    const punches = await this.db.tx
      .selectFrom('attendance_punches')
      .select('punched_at')
      .where('employee_id', '=', employeeId)
      .where('punched_at', '>=', window.from)
      .where('punched_at', '<', window.to)
      .execute();

    const result = computeDay({
      date,
      shift: shift?.times ?? null,
      isWeekend: info.isWeekend,
      holidayName: info.holidayName,
      onLeave: await this.leaveSource(employeeId, date),
      punches: punches.map((p) => p.punched_at),
      otEligible: await this.org.gradeOtEligible(placement.gradeId),
    });

    // locked: never change it; keep the difference for payroll
    const existing = await this.db.tx
      .selectFrom('attendance_days')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('work_date', '=', date)
      .executeTakeFirst();
    if (existing?.locked) {
      await this.recordAdjustmentIfChanged(existing, result, reason);
      return result;
    }

    // save
    const row = {
      company_id: placement.companyId,
      branch_id: placement.branchId,
      department_id: placement.departmentId,
      shift_id: shift?.id ?? null,
      status: result.status,
      first_in: result.firstIn,
      last_out: result.lastOut,
      worked_minutes: result.workedMinutes,
      late_minutes: result.lateMinutes,
      ot_minutes: result.otMinutes,
      // approved overtime can never exceed what was actually worked
      ot_approved_minutes: Math.min(
        existing?.ot_approved_minutes ?? 0,
        result.otMinutes,
      ),
      holiday_name: result.holidayName,
      computed_at: new Date(),
    };
    await this.db.tx
      .insertInto('attendance_days')
      .values({ employee_id: employeeId, work_date: date, ...row })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'employee_id', 'work_date']).doUpdateSet(row),
      )
      .execute();
    return result;
  }

  // ------------------------------------------------------------------ helpers

  /** Assigned shift on the date, else the company default; an override (e.g. Ramadan) replaces the times. */
  private async shiftFor(
    employeeId: string,
    placement: PlacementFacts,
    date: BusinessDate,
  ): Promise<{ id: string; times: ShiftTimes } | null> {
    const assigned = await this.db.tx
      .selectFrom('shift_assignments as a')
      .innerJoin('shifts as s', 's.id', 'a.shift_id')
      .selectAll('s')
      .where('a.employee_id', '=', employeeId)
      .where('a.effective_from', '<=', date)
      .where((eb) =>
        eb.or([
          eb('a.effective_to', 'is', null),
          eb('a.effective_to', '>', date),
        ]),
      )
      .executeTakeFirst();
    const shift: Shift | undefined =
      assigned ??
      (await this.db.tx
        .selectFrom('shifts')
        .selectAll()
        .where('company_id', '=', placement.companyId)
        .where('is_default', '=', true)
        .where('is_active', '=', true)
        .executeTakeFirst());
    if (!shift) return null;

    const override = await this.db.tx
      .selectFrom('shift_overrides')
      .selectAll()
      .where('company_id', '=', placement.companyId)
      .where('is_active', '=', true)
      .where('from_date', '<=', date)
      .where('to_date', '>=', date)
      .where((eb) =>
        eb.or([
          eb('branch_id', 'is', null),
          eb('branch_id', '=', placement.branchId),
        ]),
      )
      .orderBy('branch_id', (ob) => ob.asc().nullsLast()) // a branch-specific override wins
      .executeTakeFirst();

    return {
      id: shift.id,
      times: {
        startTime: override?.start_time ?? shift.start_time,
        endTime: override?.end_time ?? shift.end_time,
        graceMinutes: override?.grace_minutes ?? shift.grace_minutes,
        halfDayMinutes: override?.half_day_minutes ?? shift.half_day_minutes,
      },
    };
  }

  private async recordAdjustmentIfChanged(
    locked: AttendanceDay,
    now: DayResult,
    reason: string,
  ): Promise<void> {
    const previous = {
      status: locked.status,
      workedMinutes: locked.worked_minutes,
      lateMinutes: locked.late_minutes,
      otMinutes: locked.ot_minutes,
    };
    const corrected = {
      status: now.status,
      workedMinutes: now.workedMinutes,
      lateMinutes: now.lateMinutes,
      otMinutes: now.otMinutes,
    };
    if (canonicalJson(previous) === canonicalJson(corrected)) return;

    // already recorded the same correction (e.g. the job ran twice)?
    const last = await this.db.tx
      .selectFrom('attendance_adjustments')
      .select('corrected')
      .where('employee_id', '=', locked.employee_id)
      .where('work_date', '=', locked.work_date)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    // (canonical JSON: jsonb does not keep key order)
    if (last && canonicalJson(last.corrected) === canonicalJson(corrected))
      return;

    await this.db.tx
      .insertInto('attendance_adjustments')
      .values({
        employee_id: locked.employee_id,
        work_date: locked.work_date,
        previous: JSON.stringify(previous),
        corrected: JSON.stringify(corrected),
        reason,
      })
      .execute();
  }
}
