/**
 * Resignation from the app (2026-10-30). The employee hands it in with the last working day
 * they propose; it goes to their Dept Head, then HR (request "resignation"). Accepted: the
 * separation starts exactly as when HR records a notice (LifecycleService): status "notice",
 * the clearances, the notice shortfall against the company's notice period, the final
 * settlement later. Rejected, returned or withdrawn: nothing changes for the employee.
 *
 *   mine()     the latest request, with the company's notice period for resignations
 *   submit     { lastWorkingDay, reason }: today is the notice date
 *   withdraw   by the employee while it waits (the approval request is cancelled)
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  ResignationRequest,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { LifecycleService } from '../employees/lifecycle.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { ResignationDto } from './resignation.dto.js';

export const RESIGNATION_REQUEST = 'resignation';

@Injectable()
export class ResignationService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly employeeAccess: EmployeeAccess,
    private readonly lifecycle: LifecycleService,
  ) {}

  onModuleInit() {
    this.handlers.register(
      RESIGNATION_REQUEST,
      {
        onApproved: (r) => this.accepted(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
      },
      [
        defaultChain(
          'Resignation (default)',
          step(1, 'dept_head'),
          step(2, 'role:hr'),
        ),
      ],
    );
  }

  async mine() {
    const employee = await this.me();
    const rules = await this.org.getCompanyRules(employee.company_id);
    const latest = await this.db.tx
      .selectFrom('resignation_requests')
      .selectAll()
      .where('employee_id', '=', employee.id)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return {
      status: employee.status,
      lastWorkingDay: employee.last_working_day,
      noticeDays: rules.noticeDaysResignation,
      canResign:
        (employee.status === 'active' || employee.status === 'probation') &&
        latest?.state !== 'in_approval',
      request: latest ? this.toRequest(latest) : null,
    };
  }

  async submit(dto: ResignationDto) {
    const employee = await this.me();
    if (employee.status !== 'active' && employee.status !== 'probation')
      throw new ConflictException(MSG.RESIGNATION_NOT_POSSIBLE);
    const today = todayInDhaka(this.clock.now());
    const lastWorkingDay = businessDate(dto.lastWorkingDay);
    if (lastWorkingDay < today)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['The last working day cannot be in the past'] },
      });
    const live = await this.db.tx
      .selectFrom('resignation_requests')
      .select('id')
      .where('employee_id', '=', employee.id)
      .where('state', '=', 'in_approval')
      .executeTakeFirst();
    if (live) throw new ConflictException(MSG.RESIGNATION_PENDING);
    const rules = await this.org.getCompanyRules(employee.company_id);
    const given = Math.round(
      (Date.parse(`${lastWorkingDay}T00:00:00Z`) -
        Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    );

    const r = await this.db.tx
      .insertInto('resignation_requests')
      .values({
        company_id: employee.company_id,
        employee_id: employee.id,
        notice_date: today,
        last_working_day: lastWorkingDay,
        reason: dto.reason,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const request = await this.approvals.submit({
      requestType: RESIGNATION_REQUEST,
      sourceId: r.id,
      subjectEmployeeId: employee.id,
      companyId: employee.company_id,
      days: given,
      summary: `Resignation: ${employee.full_name_en} (${employee.employee_code}), last working day ${lastWorkingDay}${given < rules.noticeDaysResignation ? ` - ${rules.noticeDaysResignation - given} day(s) short of the notice period` : ''}`,
      snapshot: {
        employee: `${employee.employee_code} ${employee.full_name_en}`,
        noticeDate: today,
        lastWorkingDay,
        noticeGivenDays: given,
        noticeRequiredDays: rules.noticeDaysResignation,
        reason: dto.reason,
      },
    });
    await this.db.tx
      .updateTable('resignation_requests')
      .set({ approval_request_id: request.id })
      .where('id', '=', r.id)
      .execute();
    await this.audit.record({
      action: 'resignation.submitted',
      entity: 'employee',
      entityId: employee.id,
      after: { lastWorkingDay, reason: dto.reason },
    });
    return this.mine();
  }

  async withdraw(reason: string) {
    const employee = await this.me();
    const live = await this.db.tx
      .selectFrom('resignation_requests')
      .selectAll()
      .where('employee_id', '=', employee.id)
      .where('state', '=', 'in_approval')
      .executeTakeFirst();
    if (!live?.approval_request_id)
      throw new ConflictException(MSG.RESIGNATION_NOT_POSSIBLE);
    await this.approvals.cancel(live.approval_request_id, reason);
    return this.mine();
  }

  // ================================================================ approval

  private async accepted(r: ApprovalRequest) {
    const req = await this.db.tx
      .selectFrom('resignation_requests')
      .selectAll()
      .where('id', '=', r.source_id)
      .executeTakeFirstOrThrow();
    const separation = await this.lifecycle.recordAcceptedResignation(
      req.employee_id,
      {
        noticeDate: req.notice_date,
        lastWorkingDay: req.last_working_day,
        reason: `Resigned (from the app): ${req.reason}`,
      },
    );
    await this.db.tx
      .updateTable('resignation_requests')
      .set({ state: 'accepted', separation_id: separation.id })
      .where('id', '=', req.id)
      .execute();
  }

  private async closed(
    r: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    await this.db.tx
      .updateTable('resignation_requests')
      .set({ state: outcome === 'cancelled' ? 'withdrawn' : 'rejected' })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  private async me() {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) throw new ForbiddenException(MSG.FORBIDDEN);
    return this.employeeAccess.find(employeeId);
  }

  private toRequest(r: ResignationRequest) {
    return {
      id: r.id,
      noticeDate: r.notice_date,
      lastWorkingDay: r.last_working_day,
      reason: r.reason,
      state: r.state,
      approvalRequestId: r.approval_request_id,
      separationId: r.separation_id,
      createdAt: r.created_at,
    };
  }
}
