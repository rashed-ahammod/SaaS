/**
 * Holiday calendars and holidays (spec §3: owned by HR; spec §7: "holiday
 * calendar editable at short notice, because Eid dates depend on moon sighting").
 *
 * Every add / move / remove tells WorkCalendarService listeners which dates
 * changed, so attendance recomputes them in the same transaction (unlocked days
 * directly, locked days as adjustments for the next payroll).
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import {
  businessDate,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { Holiday } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  CreateHolidayCalendarDto,
  CreateHolidayDto,
  RemoveHolidayDto,
  UpdateHolidayDto,
} from './dto/calendar.dto.js';
import { WorkCalendarService } from './work-calendar.service.js';

@Injectable()
export class HolidaysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly calendar: WorkCalendarService,
  ) {}

  async createCalendar(companyId: string, dto: CreateHolidayCalendarDto) {
    // check company and access
    await this.org.assertCompanyExists(companyId);
    this.access.assert('attendance.manage', { companyId });

    // save
    const calendar = await this.db.tx
      .insertInto('holiday_calendars')
      .values({ company_id: companyId, name: dto.name.trim() })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'holiday_calendar.created',
      entity: 'holiday_calendar',
      entityId: calendar.id,
      after: { name: calendar.name },
    });
    return {
      id: calendar.id,
      companyId,
      name: calendar.name,
      isActive: calendar.is_active,
      version: calendar.version,
    };
  }

  async listCalendars(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const rows = await this.db.tx
      .selectFrom('holiday_calendars')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('name')
      .execute();
    return rows.map((c) => ({
      id: c.id,
      companyId: c.company_id,
      name: c.name,
      isActive: c.is_active,
      version: c.version,
    }));
  }

  async addHoliday(calendarId: string, dto: CreateHolidayDto) {
    // check calendar and access
    const calendar = await this.findCalendar(calendarId);
    this.access.assert('attendance.manage', { companyId: calendar.company_id });

    // save (one holiday per date per calendar)
    const holiday = await this.db.tx
      .insertInto('holidays')
      .values({
        calendar_id: calendarId,
        holiday_date: dto.date,
        name_en: dto.nameEn.trim(),
        name_bn: dto.nameBn ?? null,
        holiday_type: dto.type,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'holiday.added',
      entity: 'holiday',
      entityId: holiday.id,
      after: toHolidayResponse(holiday),
    });
    await this.calendar.notifyHolidaysChanged({
      calendarId,
      dates: [businessDate(dto.date)],
    });
    return toHolidayResponse(holiday);
  }

  async listHolidays(calendarId: string, year?: number) {
    await this.findCalendar(calendarId);
    let q = this.db.tx
      .selectFrom('holidays')
      .selectAll()
      .where('calendar_id', '=', calendarId)
      .where('is_active', '=', true);
    if (year)
      q = q
        .where('holiday_date', '>=', `${year}-01-01`)
        .where('holiday_date', '<=', `${year}-12-31`);
    return (await q.orderBy('holiday_date').execute()).map(toHolidayResponse);
  }

  /** Rename or move a holiday (e.g. Eid one day later after moon sighting). */
  async updateHoliday(holidayId: string, dto: UpdateHolidayDto) {
    // find, check access and version
    const before = await this.findHoliday(holidayId);
    const calendar = await this.findCalendar(before.calendar_id);
    this.access.assert('attendance.manage', { companyId: calendar.company_id });
    assertVersion(before, dto.version);

    const changes = changesOnly({
      holiday_date: dto.date,
      name_en: dto.nameEn?.trim(),
      name_bn: dto.nameBn,
      holiday_type: dto.type,
    });
    if (!changes) return toHolidayResponse(before);

    // save
    const result = await this.db.tx
      .updateTable('holidays')
      .set(changes)
      .where('id', '=', holidayId)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);
    const after = await this.findHoliday(holidayId);
    await this.audit.record({
      action: 'holiday.updated',
      entity: 'holiday',
      entityId: holidayId,
      ...auditDiff(before, after),
    });

    // a moved holiday changes attendance on both dates
    if (dto.date && dto.date !== before.holiday_date) {
      await this.calendar.notifyHolidaysChanged({
        calendarId: before.calendar_id,
        dates: [businessDate(before.holiday_date), businessDate(dto.date)],
      });
    }
    return toHolidayResponse(after);
  }

  async removeHoliday(holidayId: string, dto: RemoveHolidayDto) {
    const before = await this.findHoliday(holidayId);
    if (!before.is_active)
      throw new BadRequestException('Holiday is already removed');
    const calendar = await this.findCalendar(before.calendar_id);
    this.access.assert('attendance.manage', { companyId: calendar.company_id });

    const after = await this.db.tx
      .updateTable('holidays')
      .set({ is_active: false, removed_reason: dto.reason })
      .where('id', '=', holidayId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'holiday.removed',
      entity: 'holiday',
      entityId: holidayId,
      after: { reason: dto.reason },
    });
    await this.calendar.notifyHolidaysChanged({
      calendarId: before.calendar_id,
      dates: [businessDate(before.holiday_date)],
    });
    return toHolidayResponse(after);
  }

  // ------------------------------------------------------------------ helpers

  private async findCalendar(id: string) {
    const calendar = await this.db.tx
      .selectFrom('holiday_calendars')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!calendar) throw new NotFoundException(MSG.NOT_FOUND);
    return calendar;
  }

  private async findHoliday(id: string): Promise<Holiday> {
    const holiday = await this.db.tx
      .selectFrom('holidays')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!holiday) throw new NotFoundException(MSG.NOT_FOUND);
    return holiday;
  }
}

function toHolidayResponse(h: Holiday) {
  return {
    id: h.id,
    calendarId: h.calendar_id,
    date: h.holiday_date as BusinessDate,
    nameEn: h.name_en,
    nameBn: h.name_bn,
    type: h.holiday_type,
    isActive: h.is_active,
    removedReason: h.removed_reason,
    version: h.version,
  };
}
