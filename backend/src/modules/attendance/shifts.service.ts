/**
 * Shifts, temporary overrides (e.g. Ramadan hours), shift assignments and each
 * employee's attendance profile (biometric user number, web-punch permission).
 * Spec §3: shifts are HR master data; spec §6.2: shift = start, end, grace,
 * half-day threshold, with temporary overrides.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  eachDay,
  toBusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { Shift } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { AttendanceComputeService } from './attendance-compute.service.js';
import { ConsentsService } from './consents.service.js';
import type {
  AssignShiftDto,
  CreateShiftDto,
  CreateShiftOverrideDto,
  UpdateAttendanceProfileDto,
  UpdateShiftDto,
} from './dto/attendance.dto.js';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly consents: ConsentsService,
    private readonly compute: AttendanceComputeService,
    private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ shifts

  async createShift(companyId: string, dto: CreateShiftDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('attendance.manage', { companyId });
    if (dto.startTime === dto.endTime)
      throw new BadRequestException('startTime and endTime must differ');

    const shift = await this.db.tx
      .insertInto('shifts')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name.trim(),
        start_time: dto.startTime,
        end_time: dto.endTime,
        grace_minutes: dto.graceMinutes,
        half_day_minutes: dto.halfDayMinutes,
        is_default: dto.isDefault,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'shift.created',
      entity: 'shift',
      entityId: shift.id,
      after: toShiftResponse(shift),
    });
    return toShiftResponse(shift);
  }

  async listShifts(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const rows = await this.db.tx
      .selectFrom('shifts')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    return rows.map(toShiftResponse);
  }

  /** Changes apply to days computed from now on; past unlocked days change on recompute. */
  async updateShift(shiftId: string, dto: UpdateShiftDto) {
    const before = await this.findShift(shiftId);
    this.access.assert('attendance.manage', { companyId: before.company_id });
    assertVersion(before, dto.version);

    const changes = changesOnly({
      name: dto.name?.trim(),
      start_time: dto.startTime,
      end_time: dto.endTime,
      grace_minutes: dto.graceMinutes,
      half_day_minutes: dto.halfDayMinutes,
      is_default: dto.isDefault,
      is_active: dto.isActive,
    });
    if (!changes) return toShiftResponse(before);

    const result = await this.db.tx
      .updateTable('shifts')
      .set(changes)
      .where('id', '=', shiftId)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);
    const after = await this.findShift(shiftId);
    await this.audit.record({
      action: 'shift.updated',
      entity: 'shift',
      entityId: shiftId,
      ...auditDiff(before, after),
    });
    return toShiftResponse(after);
  }

  // ------------------------------------------------------------------ overrides

  async createOverride(companyId: string, dto: CreateShiftOverrideDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('attendance.manage', { companyId });
    if (dto.toDate < dto.fromDate)
      throw new BadRequestException('toDate must not be before fromDate');

    const override = await this.db.tx
      .insertInto('shift_overrides')
      .values({
        company_id: companyId,
        branch_id: dto.branchId ?? null,
        name: dto.name.trim(),
        from_date: dto.fromDate,
        to_date: dto.toDate,
        start_time: dto.startTime,
        end_time: dto.endTime,
        grace_minutes: dto.graceMinutes ?? null,
        half_day_minutes: dto.halfDayMinutes ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'shift_override.created',
      entity: 'shift_override',
      entityId: override.id,
      after: dto,
    });

    // days already passed in the range are recomputed with the new times
    const lastDay = [dto.toDate, toBusinessDate(this.clock.now())].sort()[0];
    if (dto.fromDate <= lastDay) {
      for (const date of eachDay(
        businessDate(dto.fromDate),
        businessDate(lastDay),
      ))
        await this.compute.recomputeDate(date, companyId);
    }
    return override;
  }

  async listOverrides(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    return this.db.tx
      .selectFrom('shift_overrides')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('from_date', 'desc')
      .execute();
  }

  // ------------------------------------------------------------------ assignments

  /**
   * From a date the employee works this shift. An open assignment that covers
   * the date is ended there, so periods never overlap.
   */
  async assignShift(employeeId: string, dto: AssignShiftDto) {
    const employee = await this.employeeAccess.check(
      'attendance.manage',
      employeeId,
    );
    const shift = await this.findShift(dto.shiftId);
    if (shift.company_id !== employee.company_id)
      throw new NotFoundException(MSG.SHIFT_NOT_FOUND);

    // close the current open-ended assignment
    await this.db.tx
      .updateTable('shift_assignments')
      .set({ effective_to: dto.effectiveFrom })
      .where('employee_id', '=', employeeId)
      .where('effective_from', '<', dto.effectiveFrom)
      .where('effective_to', 'is', null)
      .execute();

    const assignment = await this.db.tx
      .insertInto('shift_assignments')
      .values({
        company_id: employee.company_id,
        employee_id: employeeId,
        shift_id: dto.shiftId,
        effective_from: dto.effectiveFrom,
        effective_to: dto.effectiveTo ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'employee.shift_assigned',
      entity: 'employee',
      entityId: employeeId,
      after: { shift: shift.code, ...dto },
    });

    // back-dated: recompute the days already passed
    const today = toBusinessDate(this.clock.now());
    const end =
      dto.effectiveTo && dto.effectiveTo <= today ? dto.effectiveTo : today;
    if (dto.effectiveFrom <= end) {
      for (const date of eachDay(
        businessDate(dto.effectiveFrom),
        businessDate(end),
      ))
        await this.compute.recomputeDay(employeeId, date, 'shift_changed');
    }
    return assignment;
  }

  async listAssignments(employeeId: string) {
    await this.employeeAccess.check('employee.view', employeeId);
    return this.db.tx
      .selectFrom('shift_assignments as a')
      .innerJoin('shifts as s', 's.id', 'a.shift_id')
      .select([
        'a.id',
        'a.shift_id',
        's.code',
        's.name',
        's.start_time',
        's.end_time',
        'a.effective_from',
        'a.effective_to',
      ])
      .where('a.employee_id', '=', employeeId)
      .orderBy('a.effective_from')
      .execute();
  }

  // ------------------------------------------------------------------ profile

  async updateProfile(employeeId: string, dto: UpdateAttendanceProfileDto) {
    const employee = await this.employeeAccess.check(
      'attendance.manage',
      employeeId,
    );
    const changes = changesOnly({
      device_user_id: dto.deviceUserId,
      web_punch_allowed: dto.webPunchAllowed,
    });
    // enrolling someone on the biometric device needs their consent (spec §11)
    if (dto.deviceUserId)
      await this.consents.require(employeeId, 'biometric_attendance');

    // update the profile, or create it the first time (a device user number is unique per company)
    const existing = await this.db.tx
      .selectFrom('attendance_profiles')
      .select('id')
      .where('employee_id', '=', employeeId)
      .executeTakeFirst();
    const profile = existing
      ? changes
        ? await this.db.tx
            .updateTable('attendance_profiles')
            .set(changes)
            .where('id', '=', existing.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await this.db.tx
            .selectFrom('attendance_profiles')
            .selectAll()
            .where('id', '=', existing.id)
            .executeTakeFirstOrThrow()
      : await this.db.tx
          .insertInto('attendance_profiles')
          .values({
            company_id: employee.company_id,
            employee_id: employeeId,
            ...changes,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'employee.attendance_profile_updated',
      entity: 'employee',
      entityId: employeeId,
      after: dto,
    });
    return {
      employeeId,
      deviceUserId: profile.device_user_id,
      webPunchAllowed: profile.web_punch_allowed,
    };
  }

  async getProfile(employeeId: string) {
    await this.employeeAccess.check('employee.view', employeeId);
    const profile = await this.db.tx
      .selectFrom('attendance_profiles')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .executeTakeFirst();
    return {
      employeeId,
      deviceUserId: profile?.device_user_id ?? null,
      webPunchAllowed: profile?.web_punch_allowed ?? false,
    };
  }

  private async findShift(id: string): Promise<Shift> {
    const shift = await this.db.tx
      .selectFrom('shifts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!shift) throw new NotFoundException(MSG.SHIFT_NOT_FOUND);
    return shift;
  }
}

function toShiftResponse(s: Shift) {
  return {
    id: s.id,
    companyId: s.company_id,
    code: s.code,
    name: s.name,
    startTime: s.start_time.slice(0, 5),
    endTime: s.end_time.slice(0, 5),
    nightShift: s.end_time <= s.start_time,
    graceMinutes: s.grace_minutes,
    halfDayMinutes: s.half_day_minutes,
    isDefault: s.is_default,
    isActive: s.is_active,
    version: s.version,
  };
}
