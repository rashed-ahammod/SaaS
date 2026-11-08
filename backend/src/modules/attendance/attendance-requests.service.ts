/**
 * Requests that need approval (spec §5 default chains: Dept Head):
 *
 *   attendance_correction  a forgotten / wrong punch. Limited per month (company
 *                          setting). On approval the requested times are added as
 *                          "correction" punches and the day is recomputed; on a
 *                          locked day the difference becomes a payroll adjustment.
 *   overtime               OT is payable only after Dept Head approval (spec §6.2),
 *                          and never more than the eligible OT actually worked.
 *
 * The employee asks for their own days; HR may ask for anyone in scope.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  addDays,
  businessDate,
  monthRange,
  toBusinessDate,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ApprovalRequest, Employee } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { AttendanceComputeService } from './attendance-compute.service.js';
import { dhakaInstant } from './day-status.js';
import type {
  CreateCorrectionDto,
  CreateOvertimeRequestDto,
} from './dto/attendance.dto.js';

export const ATTENDANCE_CORRECTION = 'attendance_correction';
export const OVERTIME = 'overtime';

@Injectable()
export class AttendanceRequestsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly compute: AttendanceComputeService,
    private readonly clock: Clock,
  ) {}

  onModuleInit() {
    this.handlers.register(
      ATTENDANCE_CORRECTION,
      {
        onApproved: (r) => this.applyCorrection(r),
        onClosed: (r, outcome) =>
          this.closeRequest('attendance_corrections', r, outcome),
      },
      [defaultChain('Attendance correction (default)', step(1, 'dept_head'))],
    );
    this.handlers.register(
      OVERTIME,
      {
        onApproved: (r) => this.applyOvertime(r),
        onClosed: (r, outcome) =>
          this.closeRequest('overtime_requests', r, outcome),
      },
      [defaultChain('Overtime (default)', step(1, 'dept_head'))],
    );
  }

  // ------------------------------------------------------------- corrections

  async requestCorrection(employeeId: string, dto: CreateCorrectionDto) {
    // own record, or HR over the employee; not for future dates
    const employee = await this.checkOwnOrManaged(employeeId);
    const date = businessDate(dto.date);
    if (date > toBusinessDate(this.clock.now()))
      throw new BadRequestException(MSG.ATTENDANCE_DATE_IN_FUTURE);

    // monthly limit (company setting, spec §5)
    const { attendanceCorrectionLimit } = await this.org.getCompanyRules(
      employee.company_id,
    );
    // the month's real last day: '2026-11-31' is not a date, and Postgres refuses it
    const month = monthRange(date.slice(0, 7));
    const { used } = await this.db.tx
      .selectFrom('attendance_corrections')
      .select((eb) => eb.fn.countAll<number>().as('used'))
      .where('employee_id', '=', employeeId)
      .where('status', 'in', ['pending', 'approved'])
      .where('work_date', '>=', month.from)
      .where('work_date', '<=', month.to)
      .executeTakeFirstOrThrow();
    if (Number(used) >= attendanceCorrectionLimit)
      throw new BadRequestException(MSG.ATTENDANCE_CORRECTION_LIMIT);

    // requested times as instants (an out time before the in time is the next morning)
    const requestedIn = dto.inTime ? dhakaInstant(date, dto.inTime) : null;
    let requestedOut = dto.outTime ? dhakaInstant(date, dto.outTime) : null;
    if (requestedIn && requestedOut && requestedOut <= requestedIn)
      requestedOut = dhakaInstant(addDays(date, 1), dto.outTime!);

    // save + approval
    const correction = await this.db.tx
      .insertInto('attendance_corrections')
      .values({
        employee_id: employeeId,
        work_date: date,
        requested_in: requestedIn,
        requested_out: requestedOut,
        reason: dto.reason,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const request = await this.approvals.submit({
      requestType: ATTENDANCE_CORRECTION,
      sourceId: correction.id,
      subjectEmployeeId: employeeId,
      companyId: employee.company_id,
      summary: `Attendance correction: ${employee.full_name_en} (${employee.employee_code}) ${date} in ${dto.inTime ?? '-'} out ${dto.outTime ?? '-'}`,
      snapshot: {
        employeeId,
        date,
        inTime: dto.inTime ?? null,
        outTime: dto.outTime ?? null,
        reason: dto.reason,
      },
    });
    await this.db.tx
      .updateTable('attendance_corrections')
      .set({ approval_request_id: request.id })
      .where('id', '=', correction.id)
      .execute();
    await this.audit.record({
      action: 'attendance.correction_requested',
      entity: 'employee',
      entityId: employeeId,
      after: {
        correctionId: correction.id,
        date,
        inTime: dto.inTime ?? null,
        outTime: dto.outTime ?? null,
        reason: dto.reason,
      },
    });
    return {
      correctionId: correction.id,
      approvalRequestId: request.id,
      status: 'pending',
    };
  }

  async listCorrections(employeeId: string) {
    await this.checkOwnOrViewed(employeeId);
    return this.db.tx
      .selectFrom('attendance_corrections')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('work_date', 'desc')
      .execute();
  }

  /** Final approval: the requested times become punches; the day is recomputed (or adjusted if locked). */
  private async applyCorrection(request: ApprovalRequest): Promise<void> {
    const c = await this.db.tx
      .selectFrom('attendance_corrections')
      .selectAll()
      .where('id', '=', request.source_id)
      .executeTakeFirstOrThrow();
    for (const at of [c.requested_in, c.requested_out]) {
      if (!at) continue;
      await this.db.tx
        .insertInto('attendance_punches')
        .values({
          employee_id: c.employee_id,
          punched_at: at,
          source: 'correction',
          device_ref: c.id,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    await this.db.tx
      .updateTable('attendance_corrections')
      .set({ status: 'approved' })
      .where('id', '=', c.id)
      .execute();
    await this.compute.recomputeDay(
      c.employee_id,
      c.work_date as BusinessDate,
      'correction_approved',
    );
  }

  // ------------------------------------------------------------- overtime

  async requestOvertime(employeeId: string, dto: CreateOvertimeRequestDto) {
    const employee = await this.checkOwnOrManaged(employeeId);
    const date = businessDate(dto.date);

    // eligible OT must have been worked that day
    const day = await this.db.tx
      .selectFrom('attendance_days')
      .select(['ot_minutes', 'ot_approved_minutes'])
      .where('employee_id', '=', employeeId)
      .where('work_date', '=', date)
      .executeTakeFirst();
    if (!day || day.ot_minutes <= 0)
      throw new BadRequestException(MSG.ATTENDANCE_NO_OVERTIME);
    const minutes = dto.minutes ?? day.ot_minutes;
    if (minutes > day.ot_minutes)
      throw new BadRequestException({
        message: MSG.ATTENDANCE_OVERTIME_TOO_MUCH,
        details: { workedMinutes: day.ot_minutes, date },
      });

    // save + approval (one open request per day: unique index)
    const ot = await this.db.tx
      .insertInto('overtime_requests')
      .values({
        employee_id: employeeId,
        work_date: date,
        minutes,
        reason: dto.reason ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const request = await this.approvals.submit({
      requestType: OVERTIME,
      sourceId: ot.id,
      subjectEmployeeId: employeeId,
      companyId: employee.company_id,
      summary: `Overtime: ${employee.full_name_en} (${employee.employee_code}) ${date}, ${minutes} min`,
      snapshot: { employeeId, date, minutes, reason: dto.reason ?? null },
    });
    await this.db.tx
      .updateTable('overtime_requests')
      .set({ approval_request_id: request.id })
      .where('id', '=', ot.id)
      .execute();
    await this.audit.record({
      action: 'attendance.overtime_requested',
      entity: 'employee',
      entityId: employeeId,
      after: { overtimeRequestId: ot.id, date, minutes },
    });
    return {
      overtimeRequestId: ot.id,
      approvalRequestId: request.id,
      minutes,
      status: 'pending',
    };
  }

  async listOvertime(employeeId: string) {
    await this.checkOwnOrViewed(employeeId);
    return this.db.tx
      .selectFrom('overtime_requests')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('work_date', 'desc')
      .execute();
  }

  /** Approved overtime becomes payable (locked day: recorded as an adjustment instead). */
  private async applyOvertime(request: ApprovalRequest): Promise<void> {
    const ot = await this.db.tx
      .selectFrom('overtime_requests')
      .selectAll()
      .where('id', '=', request.source_id)
      .executeTakeFirstOrThrow();
    await this.db.tx
      .updateTable('overtime_requests')
      .set({ status: 'approved' })
      .where('id', '=', ot.id)
      .execute();

    const day = await this.db.tx
      .selectFrom('attendance_days')
      .selectAll()
      .where('employee_id', '=', ot.employee_id)
      .where('work_date', '=', ot.work_date)
      .executeTakeFirstOrThrow();
    const minutes = Math.min(ot.minutes, day.ot_minutes);
    if (day.locked) {
      await this.db.tx
        .insertInto('attendance_adjustments')
        .values({
          employee_id: ot.employee_id,
          work_date: ot.work_date,
          previous: JSON.stringify({
            otApprovedMinutes: day.ot_approved_minutes,
          }),
          corrected: JSON.stringify({ otApprovedMinutes: minutes }),
          reason: 'overtime_approved_after_lock',
        })
        .execute();
    } else {
      await this.db.tx
        .updateTable('attendance_days')
        .set({ ot_approved_minutes: minutes })
        .where('id', '=', day.id)
        .execute();
    }
  }

  // ------------------------------------------------------------------ helpers

  private async closeRequest(
    table: 'attendance_corrections' | 'overtime_requests',
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    await this.db.tx
      .updateTable(table)
      .set({ status: outcome === 'cancelled' ? 'cancelled' : 'rejected' })
      .where('id', '=', request.source_id)
      .where('status', '=', 'pending')
      .execute();
  }

  /** The employee themself (attendance.own) or someone who manages their attendance. */
  private async checkOwnOrManaged(employeeId: string): Promise<Employee> {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (
      !this.access.allows('attendance.own', resource) &&
      !this.access.allows('attendance.manage', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    return employee;
  }

  private async checkOwnOrViewed(employeeId: string): Promise<Employee> {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (
      !this.access.allows('attendance.own', resource) &&
      !this.access.allows('attendance.view', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    return employee;
  }
}
