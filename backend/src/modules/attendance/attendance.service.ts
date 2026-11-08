/**
 * Attendance views and HR operations (guide §10 rules 4-7):
 *   - an employee's days, a team's day, the monthly summary (with the optional
 *     late penalty, OFF by default until legal review)
 *   - recompute a date range, lock a month before payroll, list adjustments
 *   - the daily job (worker): compute yesterday, announce attendance.daily_closed
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { EXPORT_MAX_ROWS, csvFile } from '../../platform/csv.js';
import {
  addDays,
  businessDate,
  daysBetween,
  eachDay,
  monthRange,
  toBusinessDate,
  todayInDhaka,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { AttendanceDay, DayStatus } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { AttendanceComputeService } from './attendance-compute.service.js';
import type {
  DaysQueryDto,
  LockMonthDto,
  PeriodQueryDto,
  RecomputeDto,
} from './dto/attendance.dto.js';

const STATUSES: DayStatus[] = [
  'present',
  'late',
  'half_day',
  'absent',
  'on_leave',
  'holiday',
  'weekend',
  'missing_punch',
];
const MAX_RANGE_DAYS = 62;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly org: OrgLookupService,
    private readonly compute: AttendanceComputeService,
    private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ views

  /** Days of one employee (own record, or within attendance.view scope). */
  async employeeDays(employeeId: string, from: string, to: string) {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (
      !this.access.allows('attendance.view', resource) &&
      !this.access.allows('attendance.own', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    checkRange(from, to);

    const days = await this.db.tx
      .selectFrom('attendance_days')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('work_date', '>=', from)
      .where('work_date', '<=', to)
      .orderBy('work_date')
      .execute();
    return {
      employeeId,
      from,
      to,
      days: days.map(toDayResponse),
      totals: countStatuses(days),
    };
  }

  async ownDays(from: string, to: string) {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) throw new BadRequestException(MSG.EMPLOYEE_NOT_FOUND);
    return this.employeeDays(employeeId, from, to);
  }

  /** One date for a team (Dept Head: own department and below; HR: company). */
  async teamDay(query: DaysQueryDto) {
    let q = this.db.tx
      .selectFrom('attendance_days as d')
      .innerJoin('employees as e', 'e.id', 'd.employee_id')
      .selectAll('d')
      .select(['e.employee_code', 'e.full_name_en', 'e.full_name_bn'])
      .where('d.work_date', '=', query.date);
    if (query.companyId) q = q.where('d.company_id', '=', query.companyId);
    if (query.status) q = q.where('d.status', '=', query.status);
    if (query.departmentId)
      q = q.where(
        'd.department_id',
        'in',
        await this.org.departmentWithDescendants(query.departmentId),
      );

    // only what the caller may see
    const scope = this.access.scopeFilter('attendance.view');
    if (!scope.all) {
      if (!scope.companyIds.length && !scope.departmentIds.length)
        return { date: query.date, days: [], totals: countStatuses([]) };
      q = q.where((eb) =>
        eb.or([
          ...(scope.companyIds.length
            ? [eb('d.company_id', 'in', scope.companyIds)]
            : []),
          ...(scope.departmentIds.length
            ? [eb('d.department_id', 'in', scope.departmentIds)]
            : []),
        ]),
      );
    }
    const rows = await q.orderBy('e.employee_code').execute();
    return {
      date: query.date,
      // employeeId so the screen can open the person whose day needs fixing
      days: rows.map((r) => ({
        ...toDayResponse(r),
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        fullNameEn: r.full_name_en,
        fullNameBn: r.full_name_bn,
      })),
      totals: countStatuses(rows),
    };
  }

  /** Per-employee totals for a month: input for payroll (WP6). */
  async monthlySummary(query: PeriodQueryDto) {
    const scope = this.viewScope(query.companyId);
    const { from, to } = monthRange(query.period);
    const rules = await this.org.getCompanyRules(query.companyId);

    let q = this.db.tx
      .selectFrom('attendance_days as d')
      .innerJoin('employees as e', 'e.id', 'd.employee_id')
      .selectAll('d')
      .select(['e.employee_code', 'e.full_name_en'])
      .where('d.company_id', '=', query.companyId)
      .where('d.work_date', '>=', from)
      .where('d.work_date', '<=', to);
    // a Dept Head sees the department's people only
    if (!scope.all) q = q.where('d.department_id', 'in', scope.departmentIds);
    const days = await q.orderBy('e.employee_code').execute();

    const byEmployee = new Map<string, typeof days>();
    for (const d of days)
      byEmployee.set(d.employee_id, [
        ...(byEmployee.get(d.employee_id) ?? []),
        d,
      ]);

    const locked = await this.db.tx
      .selectFrom('attendance_locks')
      .select('locked_at')
      .where('company_id', '=', query.companyId)
      .where('period', '=', query.period)
      .executeTakeFirst();
    return {
      period: query.period,
      locked: !!locked,
      latePenalty: {
        enabled: rules.latePenaltyEnabled,
        everyNLates: rules.latePenaltyEvery,
      },
      employees: [...byEmployee.values()].map((list) => {
        const totals = countStatuses(list);
        const lates = totals.late;
        return {
          employeeId: list[0].employee_id,
          employeeCode: list[0].employee_code,
          fullNameEn: list[0].full_name_en,
          ...totals,
          lateMinutes: list.reduce((s, d) => s + d.late_minutes, 0),
          otMinutes: list.reduce((s, d) => s + d.ot_minutes, 0),
          otApprovedMinutes: list.reduce(
            (s, d) => s + d.ot_approved_minutes,
            0,
          ),
          // spec §6.2: "N lates per month = one day deducted" - only when switched on
          latePenaltyDays: rules.latePenaltyEnabled
            ? Math.floor(lates / rules.latePenaltyEvery)
            : 0,
        };
      }),
    };
  }

  /**
   * The month's attendance sheet as a CSV file. Payroll verification compares it
   * against the run, and a labour inspection asks for the register on paper; the
   * screen alone could not answer either. Same access scope as the summary (a
   * Dept Head exports their own department), and the download is audited because
   * it is personal data leaving the system (spec §11).
   */
  async exportMonthlySummaryCsv(
    query: PeriodQueryDto,
  ): Promise<{ fileName: string; content: Buffer }> {
    const summary = await this.monthlySummary(query);
    const header = [
      'employee_code',
      'name_en',
      'present',
      'late',
      'half_day',
      'absent',
      'on_leave',
      'missing_punch',
      'late_minutes',
      'ot_minutes',
      'ot_approved_minutes',
      'late_penalty_days',
    ];
    const rows = summary.employees
      .slice(0, EXPORT_MAX_ROWS)
      .map((e) => [
        e.employeeCode,
        e.fullNameEn,
        e.present,
        e.late,
        e.half_day,
        e.absent,
        e.on_leave,
        e.missing_punch,
        e.lateMinutes,
        e.otMinutes,
        e.otApprovedMinutes,
        e.latePenaltyDays,
      ]);

    await this.audit.record({
      action: 'attendance.exported',
      entity: 'company',
      entityId: query.companyId,
      after: {
        period: query.period,
        rows: rows.length,
        locked: summary.locked,
      },
    });

    return {
      fileName: `attendance-${query.period}.csv`,
      content: csvFile(header, rows),
    };
  }

  async adjustments(companyId: string) {
    const scope = this.viewScope(companyId);
    let q = this.db.tx
      .selectFrom('attendance_adjustments as a')
      .innerJoin('employees as e', 'e.id', 'a.employee_id')
      .innerJoin('attendance_days as d', (j) =>
        j
          .onRef('d.employee_id', '=', 'a.employee_id')
          .onRef('d.work_date', '=', 'a.work_date'),
      )
      .select([
        'a.id',
        'a.employee_id',
        'e.employee_code',
        'e.full_name_en',
        'a.work_date',
        'a.previous',
        'a.corrected',
        'a.reason',
        'a.payroll_period',
        'a.created_at',
      ])
      .where('e.company_id', '=', companyId);
    if (!scope.all) q = q.where('d.department_id', 'in', scope.departmentIds);
    return q.orderBy('a.created_at', 'desc').limit(500).execute();
  }

  /**
   * Who may see the company's attendance lists (spec §4 "Attendance: Admin V, HR F,
   * Dept Head A (dept)"): company-wide viewers see everyone, a Dept Head the
   * departments in scope; anyone else is refused.
   */
  viewScope(
    companyId: string,
  ): { all: true } | { all: false; departmentIds: string[] } {
    if (this.access.allows('attendance.view', { companyId }))
      return { all: true };
    const scope = this.access.scopeFilter('attendance.view');
    if (scope.all) return { all: true };
    if (!scope.departmentIds.length)
      throw new ForbiddenException(MSG.FORBIDDEN);
    return { all: false, departmentIds: scope.departmentIds };
  }

  /**
   * Days actually worked in a period, for earned-leave accrual (spec §7: one day
   * per N days worked): present and late count 1, half-day counts 0.5.
   */
  async workedDays(
    employeeId: string,
    from: BusinessDate,
    to: BusinessDate,
  ): Promise<number> {
    const rows = await this.db.tx
      .selectFrom('attendance_days')
      .select('status')
      .where('employee_id', '=', employeeId)
      .where('work_date', '>=', from)
      .where('work_date', '<=', to)
      .where('status', 'in', ['present', 'late', 'half_day'])
      .execute();
    return rows.reduce(
      (sum, r) => sum + (r.status === 'half_day' ? 0.5 : 1),
      0,
    );
  }

  // ------------------------------------------------------------------ for payroll (WP6)

  /**
   * What payroll needs from a locked month, per employee: absent days (unpaid),
   * days on leave (payroll asks the leave module which were unpaid), approved
   * overtime, late penalty days and days still showing a missing punch.
   */
  async payrollFacts(
    companyId: string,
    period: string,
  ): Promise<{
    locked: boolean;
    employees: Map<string, PayrollAttendanceFacts>;
  }> {
    const { from, to } = monthRange(period);
    const lock = await this.db.tx
      .selectFrom('attendance_locks')
      .select('id')
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .executeTakeFirst();
    const rules = await this.org.getCompanyRules(companyId);
    const days = await this.db.tx
      .selectFrom('attendance_days')
      .select(['employee_id', 'work_date', 'status', 'ot_approved_minutes'])
      .where('company_id', '=', companyId)
      .where('work_date', '>=', from)
      .where('work_date', '<=', to)
      .orderBy('work_date')
      .execute();

    const employees = new Map<string, PayrollAttendanceFacts>();
    for (const d of days) {
      const facts = employees.get(d.employee_id) ?? {
        absentDates: [],
        onLeaveDates: [],
        otApprovedMinutes: 0,
        lates: 0,
        latePenaltyDays: 0,
        missingPunchDays: 0,
      };
      if (d.status === 'absent') facts.absentDates.push(d.work_date);
      if (d.status === 'on_leave') facts.onLeaveDates.push(d.work_date);
      if (d.status === 'late') facts.lates++;
      if (d.status === 'missing_punch') facts.missingPunchDays++;
      facts.otApprovedMinutes += d.ot_approved_minutes;
      employees.set(d.employee_id, facts);
    }
    for (const facts of employees.values())
      facts.latePenaltyDays = rules.latePenaltyEnabled
        ? Math.floor(facts.lates / rules.latePenaltyEvery)
        : 0;
    return { locked: !!lock, employees };
  }

  /**
   * Changes to locked days not yet paid by payroll. An absent day that became
   * worked (or a holiday) is refunded: unpaidDelta -1; the reverse is +1.
   */
  async pendingAdjustments(companyId: string) {
    const rows = await this.db.tx
      .selectFrom('attendance_adjustments as a')
      .innerJoin('employees as e', 'e.id', 'a.employee_id')
      .select([
        'a.id',
        'a.employee_id',
        'a.work_date',
        'a.previous',
        'a.corrected',
        'a.reason',
      ])
      .where('e.company_id', '=', companyId)
      .where('a.payroll_period', 'is', null)
      .orderBy('a.created_at')
      .execute();
    const unpaid = (v: unknown) =>
      (v as { status?: string }).status === 'absent' ? 1 : 0;
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      date: r.work_date,
      unpaidDelta: unpaid(r.corrected) - unpaid(r.previous),
      otMinutesDelta: 0, // overtime is paid on approval (ot_approved_minutes), not from raw minutes
      reason: r.reason,
    }));
  }

  /** Called inside the payroll approval: these adjustments are now paid. */
  async markAdjustmentsPaid(ids: string[], period: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.tx
      .updateTable('attendance_adjustments')
      .set({ payroll_period: period })
      .where('id', 'in', ids)
      .where('payroll_period', 'is', null)
      .execute();
  }

  // ------------------------------------------------------------------ HR

  async recompute(dto: RecomputeDto) {
    this.access.assert('attendance.manage', { companyId: dto.companyId });
    checkRange(dto.from, dto.to);
    const today = toBusinessDate(this.clock.now());
    const last = dto.to < today ? dto.to : today;
    let days = 0;
    for (const date of eachDay(businessDate(dto.from), businessDate(last)))
      days += await this.compute.recomputeDate(date, dto.companyId);
    await this.audit.record({
      action: 'attendance.recomputed',
      entity: 'company',
      entityId: dto.companyId,
      after: { from: dto.from, to: last, days },
    });
    return { from: dto.from, to: last, employeeDays: days };
  }

  /**
   * Monthly lock before payroll (spec §6.2): compute the month one last time,
   * then freeze it. Later changes to these days become adjustments.
   */
  async lockMonth(dto: LockMonthDto) {
    this.access.assert('attendance.manage', { companyId: dto.companyId });
    const { from, to } = monthRange(dto.period);
    if (to >= toBusinessDate(this.clock.now()))
      throw new BadRequestException(
        'A month can be locked only after it has ended',
      );
    const already = await this.db.tx
      .selectFrom('attendance_locks')
      .select('id')
      .where('company_id', '=', dto.companyId)
      .where('period', '=', dto.period)
      .executeTakeFirst();
    if (already) throw new ConflictException(MSG.ATTENDANCE_MONTH_LOCKED);

    // final computation, then freeze
    for (const date of eachDay(from, to))
      await this.compute.recomputeDate(date, dto.companyId);
    const frozen = await this.db.tx
      .updateTable('attendance_days')
      .set({ locked: true })
      .where('company_id', '=', dto.companyId)
      .where('work_date', '>=', from)
      .where('work_date', '<=', to)
      .executeTakeFirst();
    await this.db.tx
      .insertInto('attendance_locks')
      .values({ company_id: dto.companyId, period: dto.period })
      .execute();

    await this.audit.record({
      action: 'attendance.month_locked',
      entity: 'company',
      entityId: dto.companyId,
      after: { period: dto.period, days: Number(frozen.numUpdatedRows) },
    });
    await this.outbox.add({
      type: 'attendance.month_locked',
      entityId: dto.companyId,
      payload: { companyId: dto.companyId, period: dto.period },
    });
    return { period: dto.period, lockedDays: Number(frozen.numUpdatedRows) };
  }

  async listLocks(companyId: string) {
    this.viewScope(companyId);
    return this.db.tx
      .selectFrom('attendance_locks')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('period', 'desc')
      .execute();
  }

  // ------------------------------------------------------------------ daily job

  /**
   * Called by the worker for each tenant: compute a finished day for every
   * employee and announce it once per company (n8n sends the morning digest to
   * Dept Heads, spec §9).
   */
  async closeDay(date: BusinessDate): Promise<number> {
    const days = await this.compute.recomputeDate(date);
    const companies = await this.db.tx
      .selectFrom('attendance_days')
      .select('company_id')
      .distinct()
      .where('work_date', '=', date)
      .execute();
    for (const { company_id } of companies) {
      const entityId = `${company_id}:${date}`;
      const announced = await this.db.tx
        .selectFrom('outbox_events')
        .select('id')
        .where('type', '=', 'attendance.daily_closed')
        .where('entity_id', '=', entityId)
        .executeTakeFirst();
      if (!announced)
        await this.outbox.add({
          type: 'attendance.daily_closed',
          entityId,
          payload: { companyId: company_id, date },
        });
    }
    return days;
  }
}

function checkRange(from: string, to: string) {
  if (to < from)
    throw new BadRequestException('"to" must not be before "from"');
  if (daysBetween(businessDate(from), businessDate(to)) >= MAX_RANGE_DAYS)
    throw new BadRequestException(`At most ${MAX_RANGE_DAYS} days at a time`);
}

function countStatuses(
  days: Array<{ status: DayStatus }>,
): Record<DayStatus, number> {
  const totals = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    DayStatus,
    number
  >;
  for (const d of days) totals[d.status]++;
  return totals;
}

function toDayResponse(d: AttendanceDay) {
  return {
    date: d.work_date,
    status: d.status,
    firstIn: d.first_in,
    lastOut: d.last_out,
    workedMinutes: d.worked_minutes,
    lateMinutes: d.late_minutes,
    otMinutes: d.ot_minutes,
    otApprovedMinutes: d.ot_approved_minutes,
    holidayName: d.holiday_name,
    locked: d.locked,
  };
}

// exported for the worker
export const yesterdayInDhaka = () => addDays(todayInDhaka(), -1);

export interface PayrollAttendanceFacts {
  absentDates: string[];
  onLeaveDates: string[];
  otApprovedMinutes: number;
  lates: number;
  latePenaltyDays: number;
  missingPunchDays: number;
}
