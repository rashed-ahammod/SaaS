/**
 * New-position requests (WP29; spec §5 default chain "New position (headcount): Dept Head ->
 * HR -> Admin", "Checked against an approved manpower plan").
 *
 *   raise(companyId, dto)   the Dept Head asks for a post; the plan check is taken NOW and
 *                           travels with the request, so the approvers see what was true
 *                           when it was raised (within the plan or not, and why)
 *   approved                the engine calls back: the request becomes 'approved' and HR can
 *                           open it for recruitment (openings.service.ts)
 *   cancel                  by the requester, while it waits
 *
 * The request is deliberately NOT refused when it falls outside the plan: that is a business
 * decision for the Admin, not a rule the software should make (the plan may simply be out of
 * date). What the software guarantees is that nobody can hide it.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  fiscalYearOf,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  PositionRequest,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { ManpowerService } from './manpower.service.js';
import type {
  PositionRequestDto,
  PositionQueryDto,
} from './dto/recruitment.dto.js';

export const NEW_POSITION_REQUEST = 'new_position';

@Injectable()
export class PositionsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly manpower: ManpowerService,
  ) {}

  onModuleInit() {
    this.handlers.register(
      NEW_POSITION_REQUEST,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
      },
      [
        // Spec §5 says "Dept Head -> HR -> Admin". The Dept Head's step IS raising the
        // request: they are the requester, and the engine never lets a requester approve
        // their own request (no self-approval, guide §9). So the chain that remains is HR
        // (checks the plan and the terms) then the Admin (decides the money). A customer
        // who wants a literal third step configures its own chain.
        defaultChain(
          'New position (default)',
          step(1, 'role:hr'),
          step(2, 'role:admin'),
        ),
      ],
    );
  }

  async list(companyId: string, query: PositionQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const scope = this.scopeOf(companyId);
    let q = this.db.tx
      .selectFrom('position_requests as p')
      .innerJoin('departments as d', 'd.id', 'p.department_id')
      .innerJoin('designations as g', 'g.id', 'p.designation_id')
      .select([
        'p.id',
        'p.number',
        'p.state',
        'p.headcount',
        'p.employment_type',
        'p.within_plan',
        'p.reason',
        'p.created_at',
        'p.created_by',
        'p.approval_request_id',
        'd.id as department_id',
        'd.name as department_name',
        'g.name_en as designation_name',
      ])
      .where('p.company_id', '=', companyId)
      .orderBy('p.created_at', 'desc')
      .limit(300);
    if (!scope.all)
      q = q.where('p.department_id', 'in', scope.departmentIds);
    if (query.state) q = q.where('p.state', '=', query.state);
    const rows = await q.execute();
    return {
      requests: rows.map((r) => ({
        id: r.id,
        number: r.number,
        state: r.state,
        headcount: r.headcount,
        employmentType: r.employment_type,
        withinPlan: r.within_plan,
        reason: r.reason,
        departmentId: r.department_id,
        departmentName: r.department_name,
        designationName: r.designation_name,
        approvalRequestId: r.approval_request_id,
        createdAt: r.created_at,
        createdBy: r.created_by,
      })),
    };
  }

  async get(requestId: string) {
    const request = await this.find(requestId);
    await this.assertSee(request);
    const names = await this.org.names({
      departmentIds: [request.department_id],
      designationIds: [request.designation_id],
      gradeIds: [request.grade_id],
      branchIds: [request.branch_id],
    });
    const opening = await this.db.tx
      .selectFrom('job_openings')
      .select(['id', 'number', 'state'])
      .where('position_request_id', '=', request.id)
      .executeTakeFirst();
    return {
      ...this.toRequest(request),
      departmentName: names.departments.get(request.department_id) ?? null,
      designationName: names.designations.get(request.designation_id) ?? null,
      gradeName: names.grades.get(request.grade_id) ?? null,
      branchName: names.branches.get(request.branch_id) ?? null,
      opening: opening ?? null,
    };
  }

  async raise(companyId: string, dto: PositionRequestDto) {
    await this.org.assertCompanyExists(companyId);
    await this.org.assertPlacement(companyId, {
      branchId: dto.branchId,
      departmentId: dto.departmentId,
      designationId: dto.designationId,
      gradeId: dto.gradeId,
    });
    // the Dept Head of that department, or HR / the Admin for anyone
    const resource = { companyId, departmentId: dto.departmentId };
    if (
      !this.access.allows('recruitment.request_own', resource) &&
      !this.access.allows('recruitment.manage', resource) &&
      !this.access.allows('recruitment.plan', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);

    const check = await this.manpower.check(
      companyId,
      dto.departmentId,
      dto.designationId,
      dto.headcount,
    );
    const request = await this.db.tx
      .insertInto('position_requests')
      .values({
        company_id: companyId,
        number: await this.nextNumber(companyId),
        department_id: dto.departmentId,
        designation_id: dto.designationId,
        grade_id: dto.gradeId,
        branch_id: dto.branchId,
        employment_type: dto.employmentType ?? 'permanent',
        headcount: dto.headcount,
        replacement_for: dto.replacementFor ?? null,
        reason: dto.reason,
        within_plan: check.withinPlan,
        plan_detail: JSON.stringify(check.detail),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const names = await this.org.names({
      departmentIds: [dto.departmentId],
      designationIds: [dto.designationId],
    });
    const approval = await this.approvals.submit({
      requestType: NEW_POSITION_REQUEST,
      sourceId: request.id,
      // a replacement is about that employee, which also gives the chain its department
      subjectEmployeeId: dto.replacementFor ?? null,
      companyId,
      summary: `New position ${request.number}: ${dto.headcount} x ${names.designations.get(dto.designationId) ?? 'post'} in ${names.departments.get(dto.departmentId) ?? 'department'}${check.withinPlan ? '' : ' - OUTSIDE the manpower plan'}`,
      snapshot: {
        number: request.number,
        headcount: dto.headcount,
        department: names.departments.get(dto.departmentId),
        designation: names.designations.get(dto.designationId),
        employmentType: request.employment_type,
        reason: dto.reason,
        withinPlan: check.withinPlan,
        plan: check.detail,
      },
    });
    await this.db.tx
      .updateTable('position_requests')
      .set({ approval_request_id: approval.id })
      .where('id', '=', request.id)
      .execute();
    await this.audit.record({
      action: 'position_request.raised',
      entity: 'position_request',
      entityId: request.id,
      after: {
        number: request.number,
        headcount: dto.headcount,
        withinPlan: check.withinPlan,
      },
    });
    return this.get(request.id);
  }

  async cancel(requestId: string, reason: string) {
    const request = await this.find(requestId);
    if (request.state !== 'in_approval')
      throw new ConflictException(MSG.POSITION_REQUEST_WRONG_STATE);
    if (
      request.created_by !== this.access.current().userId &&
      !this.access.allows('recruitment.manage', {
        companyId: request.company_id,
        departmentId: request.department_id,
      })
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    if (request.approval_request_id)
      await this.approvals.cancel(request.approval_request_id, reason);
    return this.get(requestId);
  }

  // ================================================================ approval

  private async approved(r: ApprovalRequest) {
    await this.db.tx
      .updateTable('position_requests')
      .set({ state: 'approved' })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
    const request = await this.db.tx
      .selectFrom('position_requests')
      .selectAll()
      .where('id', '=', r.source_id)
      .executeTakeFirstOrThrow();
    await this.outbox.add({
      type: 'position.approved',
      entityId: request.id,
      payload: {
        positionRequestId: request.id,
        companyId: request.company_id,
        number: request.number,
        departmentId: request.department_id,
        designationId: request.designation_id,
        headcount: request.headcount,
        withinPlan: request.within_plan,
      },
    });
  }

  private async closed(
    r: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    if (outcome === 'returned') return; // it comes back to the approvers
    await this.db.tx
      .updateTable('position_requests')
      .set({ state: outcome === 'cancelled' ? 'cancelled' : 'rejected' })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  // ================================================================= helpers

  /** Marks an approved request as opened once its job opening exists. */
  async markOpened(requestId: string) {
    await this.db.tx
      .updateTable('position_requests')
      .set({ state: 'opened' })
      .where('id', '=', requestId)
      .where('state', '=', 'approved')
      .execute();
  }

  async find(requestId: string): Promise<PositionRequest> {
    const request = await this.db.tx
      .selectFrom('position_requests')
      .selectAll()
      .where('id', '=', requestId)
      .executeTakeFirst();
    if (!request)
      throw new NotFoundException(MSG.POSITION_REQUEST_NOT_FOUND);
    return request;
  }

  async assertSee(request: PositionRequest) {
    const resource = {
      companyId: request.company_id,
      departmentId: request.department_id,
    };
    if (
      this.access.allows('recruitment.view', resource) ||
      this.access.allows('recruitment.manage', resource) ||
      this.access.allows('recruitment.plan', resource) ||
      (this.access.allows('recruitment.request_own', resource) &&
        request.created_by === this.access.current().userId)
    )
      return;
    throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private scopeOf(companyId: string): {
    all: boolean;
    departmentIds: string[];
  } {
    const company = { companyId };
    if (
      this.access.allows('recruitment.view', company) ||
      this.access.allows('recruitment.manage', company) ||
      this.access.allows('recruitment.plan', company)
    )
      return { all: true, departmentIds: [] };
    const filter = this.access.scopeFilter('recruitment.view');
    const own = this.access.scopeFilter('recruitment.request_own');
    const departmentIds = [
      ...new Set([
        ...(filter.all ? [] : filter.departmentIds),
        ...(own.all ? [] : own.departmentIds),
      ]),
    ];
    if (!departmentIds.length) throw new ForbiddenException(MSG.FORBIDDEN);
    return { all: false, departmentIds };
  }

  private async nextNumber(companyId: string): Promise<string> {
    const fy = fiscalYearOf(todayInDhaka(this.clock.now()), '07-01');
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'position_request',
        fiscal_year_code: fy,
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'kind', 'fiscal_year_code'])
          .doUpdateSet({ last_no: sql`payables_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return `NP/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  private toRequest(r: PositionRequest) {
    return {
      id: r.id,
      number: r.number,
      companyId: r.company_id,
      departmentId: r.department_id,
      designationId: r.designation_id,
      gradeId: r.grade_id,
      branchId: r.branch_id,
      employmentType: r.employment_type,
      headcount: r.headcount,
      replacementFor: r.replacement_for,
      reason: r.reason,
      withinPlan: r.within_plan,
      plan: r.plan_detail,
      state: r.state,
      approvalRequestId: r.approval_request_id,
      createdAt: r.created_at,
      createdBy: r.created_by,
      version: r.version,
    };
  }
}
