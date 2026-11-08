/**
 * "Is this a working day at this branch?" — the one place that knows weekends
 * (branch setting) and holidays (the branch's holiday calendar).
 *
 * Used by attendance (daily status) and the approval engine (SLA in working
 * hours, spec §5).
 *
 * Other modules can react when holidays change (e.g. Eid moved after moon
 * sighting): attendance registers a listener and recomputes the affected days
 * in the same transaction.
 */
import { Injectable } from '@nestjs/common';
import {
  addDays,
  weekdayOf,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';

export interface DayInfo {
  isWeekend: boolean;
  holidayName: string | null;
}

export interface HolidayChange {
  calendarId: string;
  /** Dates whose holiday status changed (old and new date of a moved holiday). */
  dates: BusinessDate[];
}

export type HolidayChangeListener = (change: HolidayChange) => Promise<void>;

const DEFAULT_WEEKEND = ['FRI'];

@Injectable()
export class WorkCalendarService {
  private readonly listeners: HolidayChangeListener[] = [];

  constructor(
    private readonly db: DatabaseService,
    private readonly org: OrgLookupService,
  ) {}

  /** Weekend and holiday for each date, at a branch (null branch = Friday weekend, no holidays). */
  async dayInfo(
    branchId: string | null,
    from: BusinessDate,
    to: BusinessDate,
  ): Promise<Map<BusinessDate, DayInfo>> {
    const branch = branchId ? await this.org.branchInfo(branchId) : null;
    const weekend = branch?.weekendDays ?? DEFAULT_WEEKEND;
    const holidays = branch?.holidayCalendarId
      ? await this.holidaysBetween(branch.holidayCalendarId, from, to)
      : new Map<string, string>();

    const result = new Map<BusinessDate, DayInfo>();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      result.set(d, {
        isWeekend: weekend.includes(weekdayOf(d)),
        holidayName: holidays.get(d) ?? null,
      });
    }
    return result;
  }

  /**
   * A synchronous checker for working-hours arithmetic, with holidays loaded
   * for the next year from `from` (SLA deadlines are days or weeks away).
   */
  async workingDayChecker(
    branchId: string | null,
    from: BusinessDate,
  ): Promise<(date: BusinessDate) => boolean> {
    const info = await this.dayInfo(branchId, from, addDays(from, 366));
    return (date) => {
      const day = info.get(date);
      return day ? !day.isWeekend && !day.holidayName : true;
    };
  }

  onHolidaysChanged(listener: HolidayChangeListener): void {
    this.listeners.push(listener);
  }

  /** Called by HolidaysService after a holiday is added, moved or removed (same transaction). */
  async notifyHolidaysChanged(change: HolidayChange): Promise<void> {
    for (const listener of this.listeners) await listener(change);
  }

  private async holidaysBetween(
    calendarId: string,
    from: BusinessDate,
    to: BusinessDate,
  ): Promise<Map<string, string>> {
    const rows = await this.db.tx
      .selectFrom('holidays')
      .select(['holiday_date', 'name_en'])
      .where('calendar_id', '=', calendarId)
      .where('is_active', '=', true)
      .where('holiday_date', '>=', from)
      .where('holiday_date', '<=', to)
      .execute();
    return new Map(rows.map((r) => [r.holiday_date, r.name_en]));
  }
}
