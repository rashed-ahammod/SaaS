/**
 * Leave requests (spec §6.3, guide §11):
 *
 *   apply    eligibility, balance (minus pending), overlap, back-dated limit,
 *            half-day rule, document rule, sandwich rule; team-absence warning
 *   approve  through the approval engine (spec §5 defaults below); on final
 *            approval "taken" ledger entries are written and attendance shows "On leave"
 *   cancel   pending: withdrawn; approved: "reversal" entries restore the balance
 *   return   the approver sends it back; the employee edits and resubmits
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  addDays,
  businessDate,
  daysBetween,
  eachDay,
  toBusinessDate,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  Employee,
  LeaveEligibility,
  LeaveRequest,
  LeaveType,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { conditionalChain, defaultChain, step } from '../approvals/chains.js';
import { AttendanceComputeService } from '../attendance/attendance-compute.service.js';
import { WorkCalendarService } from '../calendar/work-calendar.service.js';
import { DocumentsService } from '../employees/documents.service.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { RulesService } from '../rules/rules.service.js';
import type {
  ApplyLeaveDto,
  CancelLeaveDto,
  TeamCalendarQueryDto,
} from './dto/leave.dto.js';
import { LeaveLedgerService } from './leave-ledger.service.js';
import {
  countLeaveDays,
  daysByLeaveYear,
  round2,
  serviceMonths,
} from './leave-rules.js';
import { LeaveTypesService } from './leave-types.service.js';

export const LEAVE_REQUEST = 'leave_request';
const MAX_RANGE_DAYS = 366;

/** The checked request, before it is saved (also the "preview" answer). */
interface Evaluation {
  employee: Employee;
  type: LeaveType;
  from: BusinessDate;
  to: BusinessDate;
  days: number;
  counted: Array<{ date: BusinessDate; days: number }>;
  available: number | null;
  warnings: TeamWarning[];
}

export interface TeamWarning {
  date: BusinessDate;
  onLeave: number; // including this request
  headcount: number;
  percent: number;
}

@Injectable()
export class LeaveRequestsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly employees: EmployeeDirectory,
    private readonly org: OrgLookupService,
    private readonly calendar: WorkCalendarService,
    private readonly rules: RulesService,
    private readonly types: LeaveTypesService,
    private readonly ledger: LeaveLedgerService,
    private readonly documents: DocumentsService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly attendance: AttendanceComputeService,
  ) {}

  onModuleInit() {
    // spec §5 default chains: up to 3 days -> line manager (HR notified by event);
    // over 3 days, maternity, unpaid -> Dept Head then HR
    this.handlers.register(
      LEAVE_REQUEST,
      {
        onApproved: (r) => this.applyApproval(r),
        onClosed: (r, outcome) => this.applyClosure(r, outcome),
      },
      [
        conditionalChain(
          'Maternity / unpaid leave (default)',
          { kinds: ['ML', 'LWP'] },
          step(1, 'dept_head'),
          step(2, 'role:hr'),
        ),
        conditionalChain(
          'Leave up to 3 days (default)',
          { maxDays: 3 },
          step(1, 'line_manager'),
        ),
        defaultChain(
          'Leave over 3 days (default)',
          step(1, 'dept_head'),
          step(2, 'role:hr'),
        ),
      ],
    );

    // attendance: a full day of approved leave is "On leave"
    this.attendance.setLeaveSource(async (employeeId, date) => {
      const row = await this.db.tx
        .selectFrom('leave_requests')
        .select('id')
        .where('employee_id', '=', employeeId)
        .where('state', '=', 'approved')
        .where('half_day', 'is', null)
        .where('from_date', '<=', date)
        .where('to_date', '>=', date)
        .executeTakeFirst();
      return row !== undefined;
    });
  }

  // ================================================================ apply

  /** Same checks as apply, nothing saved: days, balance, team warnings. */
  async preview(employeeId: string, dto: ApplyLeaveDto) {
    const e = await this.evaluate(employeeId, dto);
    return {
      leaveType: e.type.code,
      from: e.from,
      to: e.to,
      days: e.days,
      countedDates: e.counted,
      available: e.available,
      teamWarnings: e.warnings,
    };
  }

  async apply(employeeId: string, dto: ApplyLeaveDto) {
    const e = await this.evaluate(employeeId, dto);

    // save
    const request = await this.db.tx
      .insertInto('leave_requests')
      .values({
        employee_id: employeeId,
        company_id: e.employee.company_id,
        leave_type_id: e.type.id,
        from_date: e.from,
        to_date: e.to,
        half_day: dto.halfDay ?? null,
        days_counted: e.days.toFixed(2),
        reason: dto.reason ?? null,
        document_id: dto.documentId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // approval + events
    await this.submitForApproval(request, e);
    await this.audit.record({
      action: 'leave.applied',
      entity: 'leave_request',
      entityId: request.id,
      after: { leaveType: e.type.code, from: e.from, to: e.to, days: e.days },
    });
    return { ...(await this.getRequest(request.id)), teamWarnings: e.warnings };
  }

  /** A request returned for correction, sent again with new dates or reason. */
  async resubmit(requestId: string, dto: ApplyLeaveDto) {
    const request = await this.findRequest(requestId);
    if (request.state !== 'returned')
      throw new ConflictException(MSG.LEAVE_NOT_RETURNED);
    const e = await this.evaluate(request.employee_id, dto, request.id);

    await this.db.tx
      .updateTable('leave_requests')
      .set({
        leave_type_id: e.type.id,
        from_date: e.from,
        to_date: e.to,
        half_day: dto.halfDay ?? null,
        days_counted: e.days.toFixed(2),
        reason: dto.reason ?? null,
        document_id: dto.documentId ?? null,
        state: 'pending',
        decided_at: null,
      })
      .where('id', '=', requestId)
      .execute();
    await this.submitForApproval(await this.findRequest(requestId), e);
    await this.audit.record({
      action: 'leave.resubmitted',
      entity: 'leave_request',
      entityId: requestId,
      after: { from: e.from, to: e.to, days: e.days },
    });
    return { ...(await this.getRequest(requestId)), teamWarnings: e.warnings };
  }

  // ================================================================ cancel

  /**
   * Pending: withdrawn from approval. Approved: reversal entries restore the
   * balance and attendance is recomputed. An employee can cancel approved leave
   * only before it starts; HR can always.
   */
  async cancel(requestId: string, dto: CancelLeaveDto) {
    const request = await this.findRequest(requestId);
    const { isHr } = await this.checkOwnOrHr(request.employee_id);
    const today = this.today();

    if (request.state === 'pending') {
      await this.approvals.withdraw(request.approval_request_id!, dto.reason);
    } else if (request.state === 'approved') {
      if (!isHr && request.from_date <= today)
        throw new ForbiddenException(MSG.LEAVE_CANNOT_CANCEL);
      // reverse exactly what was taken
      const taken = await this.db.tx
        .selectFrom('leave_ledger')
        .selectAll()
        .where('source_type', '=', 'leave_request')
        .where('source_id', '=', requestId)
        .where('kind', '=', 'taken')
        .execute();
      for (const t of taken) {
        await this.ledger.write({
          employeeId: t.employee_id,
          leaveTypeId: t.leave_type_id,
          entryDate: businessDate(t.entry_date),
          kind: 'reversal',
          days: -Number(t.days),
          leaveYear: t.leave_year,
          sourceType: 'leave_request',
          sourceId: requestId,
          note: `Cancelled: ${dto.reason}`,
        });
      }
    } else if (request.state !== 'returned') {
      // a returned request waits for the employee: its approval is already closed
      throw new ConflictException(MSG.LEAVE_CANNOT_CANCEL);
    }

    await this.db.tx
      .updateTable('leave_requests')
      .set({
        state: 'cancelled',
        cancelled_at: new Date(),
        cancel_reason: dto.reason,
      })
      .where('id', '=', requestId)
      .execute();
    if (request.state === 'approved') await this.recomputeAttendance(request);
    await this.audit.record({
      action: 'leave.cancelled',
      entity: 'leave_request',
      entityId: requestId,
      before: { state: request.state },
      after: { reason: dto.reason },
    });
    await this.outbox.add({
      type: 'leave.cancelled',
      entityId: requestId,
      payload: {
        requestId,
        employeeId: request.employee_id,
        from: request.from_date,
        to: request.to_date,
        wasApproved: request.state === 'approved',
      },
    });
    return this.getRequest(requestId);
  }

  // ================================================================ read

  async getRequest(requestId: string) {
    const r = await this.findRequest(requestId);
    await this.checkCanSee(r.employee_id);
    const type = await this.types.findType(r.leave_type_id);
    const comments = await this.decisionComments([r.approval_request_id]);
    return {
      ...toRequestResponse(r, type),
      decisionComment: comments.get(r.approval_request_id ?? '') ?? null,
    };
  }

  /**
   * A doctor's certificate or other supporting document, uploaded while applying
   * (the employee for themself, or HR); the request then refers to it by documentId.
   */
  async uploadDocument(
    employeeId: string,
    file: Express.Multer.File | undefined,
  ) {
    await this.checkOwnOrHr(employeeId);
    return this.documents.uploadSupportingDocument(
      employeeId,
      file,
      'Leave supporting document',
    );
  }

  /** The last approver comment of each approval (rejected / returned: why). */
  private async decisionComments(
    approvalIds: Array<string | null>,
  ): Promise<Map<string, string>> {
    const ids = approvalIds.filter((a): a is string => !!a);
    if (!ids.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('approval_actions')
      .select(['request_id', 'comment', 'created_at'])
      .where('request_id', 'in', ids)
      .where('action', 'in', ['approve', 'reject', 'return'])
      .where('comment', 'is not', null)
      .orderBy('created_at')
      .execute();
    return new Map(rows.map((r) => [r.request_id, r.comment!]));
  }

  async listForEmployee(employeeId: string) {
    await this.checkCanSee(employeeId);
    const rows = await this.db.tx
      .selectFrom('leave_requests as r')
      .innerJoin('leave_types as t', 't.id', 'r.leave_type_id')
      .selectAll('r')
      .select(['t.code', 't.name_en', 't.name_bn'])
      .where('r.employee_id', '=', employeeId)
      .orderBy('r.from_date', 'desc')
      .execute();
    const comments = await this.decisionComments(
      rows.map((r) => r.approval_request_id),
    );
    return rows.map((r) => ({
      ...toRequestResponse(r),
      leaveType: { code: r.code, nameEn: r.name_en, nameBn: r.name_bn },
      decisionComment: comments.get(r.approval_request_id ?? '') ?? null,
    }));
  }

  /** Who is off when, in a department (and below): the approver's team calendar (spec §6.3). */
  async teamCalendar(query: TeamCalendarQueryDto) {
    if (!query.departmentId && !query.companyId)
      throw new BadRequestException('departmentId or companyId is required');
    const companyId = query.departmentId
      ? await this.org.companyOfDepartment(query.departmentId)
      : query.companyId!;
    if (daysBetween(businessDate(query.from), businessDate(query.to)) > 62)
      throw new BadRequestException('At most 62 days');

    // people placed in the department (or below), or everyone this caller may see
    let departmentIds: Set<string> | null = null;
    if (query.departmentId) {
      this.access.assert('leave.view', {
        companyId,
        departmentId: query.departmentId,
      });
      departmentIds = new Set(
        await this.org.departmentWithDescendants(query.departmentId),
      );
    } else if (!this.access.allows('leave.view', { companyId })) {
      // a Dept Head may ask for the whole company; they still see only their own departments
      const scope = this.access.scopeFilter('leave.view');
      if (scope.all) departmentIds = null;
      else if (scope.departmentIds.length)
        departmentIds = new Set(scope.departmentIds);
      else this.access.assert('leave.view', { companyId });
    }
    const all = await this.employees.employedOn(businessDate(query.from), {
      companyId,
    });
    const team = departmentIds
      ? all.filter((p) => departmentIds!.has(p.departmentId))
      : all;
    const employeeIds = team.map((p) => p.employeeId);

    const rows = employeeIds.length
      ? await this.db.tx
          .selectFrom('leave_requests as r')
          .innerJoin('employees as e', 'e.id', 'r.employee_id')
          .innerJoin('leave_types as t', 't.id', 'r.leave_type_id')
          .select([
            'r.id',
            'r.employee_id',
            'e.employee_code',
            'e.full_name_en',
            'e.full_name_bn',
            't.code',
            'r.from_date',
            'r.to_date',
            'r.half_day',
            'r.days_counted',
            'r.state',
          ])
          .where('r.employee_id', 'in', employeeIds)
          .where('r.state', 'in', ['pending', 'approved'])
          .where('r.from_date', '<=', query.to)
          .where('r.to_date', '>=', query.from)
          .orderBy('r.from_date')
          .execute()
      : [];
    return {
      departmentId: query.departmentId ?? null,
      companyId,
      from: query.from,
      to: query.to,
      headcount: team.length,
      leaves: rows.map((r) => ({
        requestId: r.id,
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        fullNameEn: r.full_name_en,
        fullNameBn: r.full_name_bn,
        leaveType: r.code,
        from: r.from_date,
        to: r.to_date,
        halfDay: r.half_day,
        days: Number(r.days_counted),
        state: r.state,
      })),
    };
  }

  // ================================================================ approval handler

  /** Final approval: write "taken" entries (split by leave year) and mark attendance. */
  private async applyApproval(approval: ApprovalRequest): Promise<void> {
    const request = await this.findRequest(approval.source_id);
    const type = await this.types.findType(request.leave_type_id);
    const policy = await this.types.policyFor(request.company_id);

    // balance may have changed since applying (another leave was approved meanwhile)
    if (type.accrual_method !== 'none') {
      const available = await this.ledger.available(
        request.employee_id,
        type.id,
        request.id,
      );
      if (available < Number(request.days_counted)) {
        throw new BadRequestException({
          message: MSG.LEAVE_INSUFFICIENT_BALANCE,
          details: { available, requested: Number(request.days_counted) },
        });
      }
      const counted = await this.countedDates(
        request.employee_id,
        type,
        businessDate(request.from_date),
        businessDate(request.to_date),
        !!request.half_day,
      );
      for (const [year, part] of daysByLeaveYear(
        counted,
        policy.leaveYearStart,
      )) {
        await this.ledger.write({
          employeeId: request.employee_id,
          leaveTypeId: type.id,
          entryDate: part.firstDate,
          kind: 'taken',
          days: -part.days,
          leaveYear: year,
          sourceType: 'leave_request',
          sourceId: request.id,
          note: `${type.code} ${request.from_date} to ${request.to_date}`,
        });
      }
    }

    await this.db.tx
      .updateTable('leave_requests')
      .set({ state: 'approved', decided_at: new Date() })
      .where('id', '=', request.id)
      .execute();
    await this.recomputeAttendance(request);
    await this.outbox.add({
      type: 'leave.approved',
      entityId: request.id,
      payload: {
        requestId: request.id,
        employeeId: request.employee_id,
        leaveType: type.code,
        from: request.from_date,
        to: request.to_date,
        days: Number(request.days_counted),
      },
    });
  }

  private async applyClosure(
    approval: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ): Promise<void> {
    await this.db.tx
      .updateTable('leave_requests')
      .set({
        state: outcome,
        decided_at: new Date(),
        ...(outcome === 'cancelled'
          ? {
              cancelled_at: new Date(),
              cancel_reason: 'Cancelled before approval',
            }
          : {}),
      })
      .where('id', '=', approval.source_id)
      .where('state', '=', 'pending')
      .execute();
    if (outcome === 'rejected') {
      const r = await this.findRequest(approval.source_id);
      await this.outbox.add({
        type: 'leave.rejected',
        entityId: r.id,
        payload: {
          requestId: r.id,
          employeeId: r.employee_id,
          from: r.from_date,
          to: r.to_date,
        },
      });
    }
  }

  // ================================================================ checks

  /** Every rule of spec §6.3 "On apply". Throws a clear error, or returns the evaluation. */
  private async evaluate(
    employeeId: string,
    dto: ApplyLeaveDto,
    excludeRequestId?: string,
  ): Promise<Evaluation> {
    const { employee, isHr } = await this.checkOwnOrHr(employeeId);
    const type = await this.types.findType(dto.leaveTypeId);
    if (type.company_id !== employee.company_id || !type.is_active)
      throw new NotFoundException(MSG.LEAVE_TYPE_NOT_FOUND);
    const policy = await this.types.policyFor(employee.company_id);
    const from = businessDate(dto.fromDate);
    const to = businessDate(dto.toDate);
    if (to < from)
      throw new BadRequestException('toDate must not be before fromDate');
    if (daysBetween(from, to) >= MAX_RANGE_DAYS)
      throw new BadRequestException(
        `At most ${MAX_RANGE_DAYS} days per request`,
      );

    // eligibility: status, gender, service length, probation
    await this.checkEligibility(employee, type, from);

    // back-dated limit (HR may enter older leave, e.g. sick leave reported late)
    if (!isHr && from < addDays(this.today(), -policy.maxBackdatedDays))
      throw new BadRequestException(MSG.LEAVE_TOO_FAR_BACK);

    // half day: allowed type, single day
    if (dto.halfDay && (!type.allow_half_day || from !== to))
      throw new BadRequestException(MSG.LEAVE_HALF_DAY_NOT_ALLOWED);

    // days counted (weekends, holidays, sandwich rule, calendar-day types)
    const counted = await this.countedDates(
      employeeId,
      type,
      from,
      to,
      !!dto.halfDay,
    );
    const days = round2(counted.reduce((s, c) => s + c.days, 0));
    if (days <= 0) throw new BadRequestException(MSG.LEAVE_NO_DAYS);

    // most days per request (e.g. maternity 120 from the rule pack)
    const max = type.max_days_rule_key
      ? Number((await this.rules.get(type.max_days_rule_key, from)).value)
      : type.max_days_per_request !== null
        ? Number(type.max_days_per_request)
        : null;
    if (max !== null && days > max)
      throw new BadRequestException({
        message: MSG.LEAVE_TOO_LONG,
        details: { max, requested: days },
      });

    // supporting document (e.g. sick leave over 2 days)
    if (
      type.document_required_over_days !== null &&
      days > Number(type.document_required_over_days)
    ) {
      if (!dto.documentId)
        throw new BadRequestException(MSG.LEAVE_DOCUMENT_REQUIRED);
      if (!(await this.employees.hasDocument(employeeId, dto.documentId)))
        throw new BadRequestException(MSG.LEAVE_DOCUMENT_REQUIRED);
    }

    // overlap with another open request
    let overlap = this.db.tx
      .selectFrom('leave_requests')
      .select('id')
      .where('employee_id', '=', employeeId)
      .where('state', 'in', ['pending', 'approved'])
      .where('from_date', '<=', to)
      .where('to_date', '>=', from);
    if (excludeRequestId) overlap = overlap.where('id', '<>', excludeRequestId);
    if (await overlap.executeTakeFirst())
      throw new ConflictException(MSG.LEAVE_OVERLAP);

    // balance (ledger sum minus other pending requests)
    let available: number | null = null;
    if (type.accrual_method !== 'none') {
      available = await this.ledger.available(
        employeeId,
        type.id,
        excludeRequestId,
      );
      if (available < days)
        throw new BadRequestException({
          message: MSG.LEAVE_INSUFFICIENT_BALANCE,
          details: { available, requested: days },
        });
    }

    const warnings = await this.teamWarnings(
      employee,
      counted.map((c) => c.date),
      policy.teamAbsenceWarnPct,
    );
    return { employee, type, from, to, days, counted, available, warnings };
  }

  private async checkEligibility(
    employee: Employee,
    type: LeaveType,
    from: BusinessDate,
  ): Promise<void> {
    const e = type.eligibility as LeaveEligibility;
    if (employee.status === 'draft' || employee.status === 'separated')
      throw new BadRequestException(MSG.LEAVE_NOT_ELIGIBLE);
    if (e.gender && e.gender !== employee.gender)
      throw new BadRequestException(MSG.LEAVE_NOT_ELIGIBLE);
    if (employee.status === 'probation' && e.allowDuringProbation === false)
      throw new BadRequestException(MSG.LEAVE_NOT_ELIGIBLE);

    const minMonths = e.minServiceRuleKey
      ? Number((await this.rules.get(e.minServiceRuleKey, from)).value)
      : (e.minServiceMonths ?? 0);
    const served = serviceMonths(businessDate(employee.join_date), from);
    if (served < minMonths)
      throw new BadRequestException({
        message: MSG.LEAVE_NOT_ELIGIBLE,
        details: { minServiceMonths: minMonths, serviceMonths: served },
      });
  }

  /** Counted leave days in the range, by the employee's branch calendar on each date. */
  private async countedDates(
    employeeId: string,
    type: LeaveType,
    from: BusinessDate,
    to: BusinessDate,
    halfDay: boolean,
  ) {
    const placement = await this.employees.placementOn(employeeId, from);
    if (!placement) throw new BadRequestException(MSG.ATTENDANCE_NOT_EMPLOYED);
    const policy = await this.types.policyFor(placement.companyId);
    const info = await this.calendar.dayInfo(placement.branchId, from, to);
    const days = eachDay(from, to).map((date) => ({
      date,
      working: !info.get(date)!.isWeekend && !info.get(date)!.holidayName,
    }));
    return countLeaveDays(days, {
      countsNonWorkingDays: type.counts_non_working_days,
      sandwichRule: policy.sandwichRule,
      halfDay,
    }).counted;
  }

  /** Days on which too many of the employee's department would be away (spec §6.3). */
  private async teamWarnings(
    employee: Employee,
    dates: BusinessDate[],
    thresholdPct: number,
  ): Promise<TeamWarning[]> {
    const warnings: TeamWarning[] = [];
    for (const date of dates) {
      const placement = await this.employees.placementOn(employee.id, date);
      if (!placement) continue;
      const team = (
        await this.employees.employedOn(date, {
          companyId: placement.companyId,
        })
      ).filter((p) => p.departmentId === placement.departmentId);
      const others = team
        .map((p) => p.employeeId)
        .filter((id) => id !== employee.id);
      const away = others.length
        ? await this.db.tx
            .selectFrom('leave_requests')
            .select('employee_id')
            .distinct()
            .where('employee_id', 'in', others)
            .where('state', 'in', ['pending', 'approved'])
            .where('from_date', '<=', date)
            .where('to_date', '>=', date)
            .execute()
        : [];
      const onLeave = away.length + 1;
      const percent = Math.round((onLeave / team.length) * 100);
      if (team.length > 1 && percent > thresholdPct)
        warnings.push({ date, onLeave, headcount: team.length, percent });
    }
    return warnings;
  }

  // ================================================================ helpers

  private async submitForApproval(
    request: LeaveRequest,
    e: Evaluation,
  ): Promise<void> {
    const approval = await this.approvals.submit({
      requestType: LEAVE_REQUEST,
      sourceId: request.id,
      subjectEmployeeId: request.employee_id,
      companyId: request.company_id,
      kind: e.type.code,
      days: e.days,
      summary: `Leave: ${e.employee.full_name_en} (${e.employee.employee_code}) ${e.type.code} ${e.from}${e.to !== e.from ? ` to ${e.to}` : ''}, ${e.days} day(s)`,
      snapshot: {
        employeeId: request.employee_id,
        leaveType: e.type.code,
        from: e.from,
        to: e.to,
        halfDay: request.half_day,
        days: e.days,
        reason: request.reason,
        availableBefore: e.available,
        teamWarnings: e.warnings,
      },
    });
    await this.db.tx
      .updateTable('leave_requests')
      .set({ approval_request_id: approval.id })
      .where('id', '=', request.id)
      .execute();
    // HR is notified of every request (spec §5: "HR notified, not an approver" for short leave)
    await this.outbox.add({
      type: 'leave.submitted',
      entityId: request.id,
      payload: {
        requestId: request.id,
        employeeId: request.employee_id,
        leaveType: e.type.code,
        from: e.from,
        to: e.to,
        days: e.days,
      },
    });
  }

  /** Past and today's days only; future days are computed by the daily job when they come. */
  private async recomputeAttendance(request: LeaveRequest): Promise<void> {
    const today = this.today();
    for (const date of eachDay(
      businessDate(request.from_date),
      businessDate(request.to_date),
    )) {
      if (date > today) break;
      await this.attendance.recomputeDay(
        request.employee_id,
        date,
        'leave_changed',
      );
    }
  }

  /** The employee themself (leave.apply_own) or HR (leave.manage) over them. */
  private async checkOwnOrHr(
    employeeId: string,
  ): Promise<{ employee: Employee; isHr: boolean }> {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    const isHr = this.access.allows('leave.manage', resource);
    if (!isHr && !this.access.allows('leave.apply_own', resource))
      throw new ForbiddenException(MSG.FORBIDDEN);
    return { employee, isHr };
  }

  private async checkCanSee(employeeId: string): Promise<void> {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (
      !this.access.allows('leave.view', resource) &&
      !this.access.allows('leave.apply_own', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private async findRequest(id: string): Promise<LeaveRequest> {
    const r = await this.db.tx
      .selectFrom('leave_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException(MSG.LEAVE_REQUEST_NOT_FOUND);
    return r;
  }

  private today(): BusinessDate {
    return toBusinessDate(this.clock.now());
  }
}

function toRequestResponse(r: LeaveRequest, type?: LeaveType) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    leaveTypeId: r.leave_type_id,
    ...(type
      ? {
          leaveType: {
            code: type.code,
            nameEn: type.name_en,
            nameBn: type.name_bn,
            paid: type.paid,
          },
        }
      : {}),
    from: r.from_date,
    to: r.to_date,
    halfDay: r.half_day,
    days: Number(r.days_counted),
    reason: r.reason,
    documentId: r.document_id,
    state: r.state,
    approvalRequestId: r.approval_request_id,
    appliedAt: r.created_at,
    decidedAt: r.decided_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}
