/**
 * Increment and promotion proposals (WP30; spec §6.5: "increment and promotion proposals ->
 * Admin approval -> effective-dated salary change -> arrears in payroll").
 *
 *   propose(appraisalId)   HR proposes from a CALIBRATED appraisal. Without the calibrated
 *                          rating the proposal is refused, which is what "ratings are
 *                          calibrated before proposals go out" means in code.
 *   approved               the engine calls back on the Admin's approval
 *   apply(proposalId)      writes the effective-dated salary (PayrollSetupService.addSalary)
 *                          and, for a promotion, the job event. A date inside a month that
 *                          was already paid is NOT a problem: payroll pays the difference as
 *                          arrears by itself (WP6, engine.computeArrears), which is why this
 *                          module does not calculate any money.
 *   withdraw               by HR while it waits
 *
 * The proposal is the only thing in this module that touches payroll, and it touches it
 * through the same service HR uses by hand. There is no second path to a salary.
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
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  IncrementProposal,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { conditionalChain, defaultChain, step } from '../approvals/chains.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { JobHistoryService } from '../employees/job-history.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { PayrollSetupService } from '../payroll/payroll-setup.service.js';
import { AppraisalsService } from './appraisals.service.js';
import type { ProposalDto, ReasonDto } from './dto/performance.dto.js';

export const INCREMENT_PROPOSAL = 'increment_proposal';

@Injectable()
export class ProposalsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly appraisals: AppraisalsService,
    private readonly payrollSetup: PayrollSetupService,
    private readonly jobHistory: JobHistoryService,
    private readonly directory: EmployeeDirectory,
  ) {}

  onModuleInit() {
    this.handlers.register(
      INCREMENT_PROPOSAL,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
      },
      [
        // spec §6.5: the Admin approves what an appraisal leads to. A promotion also changes
        // the post, so it goes through HR's own head first when one exists.
        conditionalChain(
          'Promotion (default)',
          { kinds: ['promotion', 'both'] },
          step(1, 'role:hr'),
          step(2, 'role:admin'),
        ),
        defaultChain('Increment (default)', step(1, 'role:admin')),
      ],
    );
  }

  async list(companyId: string, state?: string) {
    await this.org.assertCompanyExists(companyId);
    const company = { companyId };
    const all =
      this.access.allows('performance.view', company) ||
      this.access.allows('performance.manage', company) ||
      this.access.allows('performance.propose', company);
    // a Dept Head holds performance.view in their department's scope: they see the
    // proposals of their own people and nobody else's
    const departmentIds = all ? [] : this.departmentsInScope();
    let q = this.db.tx
      .selectFrom('increment_proposals as p')
      .innerJoin('employees as e', 'e.id', 'p.employee_id')
      .select([
        'p.id',
        'p.kind',
        'p.state',
        'p.new_gross',
        'p.effective_from',
        'p.justification',
        'p.appraisal_id',
        'p.approval_request_id',
        'p.applied_at',
        'e.employee_code',
        'e.full_name_en',
      ])
      .where('p.company_id', '=', companyId)
      .orderBy('p.created_at', 'desc')
      .limit(300);
    if (!all)
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('employee_assignments as a')
            .select('a.employee_id')
            .whereRef('a.employee_id', '=', 'p.employee_id')
            .where('a.department_id', 'in', departmentIds)
            .where('a.effective_from', '<=', this.today())
            .where((inner) =>
              inner.or([
                inner('a.effective_to', 'is', null),
                inner('a.effective_to', '>', this.today()),
              ]),
            ),
        ),
      );
    if (state) q = q.where('p.state', '=', state as never);
    const rows = await q.execute();
    const seesSalary = this.access.canSeeField('salary', { companyId });
    return {
      proposals: rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        state: p.state,
        employeeCode: p.employee_code,
        employeeName: p.full_name_en,
        newGross: seesSalary ? p.new_gross : null,
        effectiveFrom: p.effective_from,
        justification: p.justification,
        appraisalId: p.appraisal_id,
        approvalRequestId: p.approval_request_id,
        appliedAt: p.applied_at,
      })),
    };
  }

  async get(proposalId: string) {
    const proposal = await this.find(proposalId);
    await this.assertSee(proposal);
    const employee = await this.db.tx
      .selectFrom('employees')
      .select(['employee_code', 'full_name_en'])
      .where('id', '=', proposal.employee_id)
      .executeTakeFirst();
    const names = await this.org.names({
      designationIds: proposal.new_designation_id
        ? [proposal.new_designation_id]
        : [],
      gradeIds: proposal.new_grade_id ? [proposal.new_grade_id] : [],
    });
    const seesSalary = this.access.canSeeField('salary', {
      companyId: proposal.company_id,
    });
    return {
      id: proposal.id,
      companyId: proposal.company_id,
      appraisalId: proposal.appraisal_id,
      employeeId: proposal.employee_id,
      employeeCode: employee?.employee_code ?? null,
      employeeName: employee?.full_name_en ?? null,
      kind: proposal.kind,
      newGross: seesSalary ? proposal.new_gross : null,
      structureId: proposal.structure_id,
      newDesignationId: proposal.new_designation_id,
      newDesignationName: proposal.new_designation_id
        ? (names.designations.get(proposal.new_designation_id)?.nameEn ?? null)
        : null,
      newGradeId: proposal.new_grade_id,
      newGradeName: proposal.new_grade_id
        ? (names.grades.get(proposal.new_grade_id)?.name ?? null)
        : null,
      effectiveFrom: proposal.effective_from,
      justification: proposal.justification,
      state: proposal.state,
      approvalRequestId: proposal.approval_request_id,
      appliedSalaryId: proposal.applied_salary_id,
      appliedEventId: proposal.applied_event_id,
      appliedAt: proposal.applied_at,
      createdAt: proposal.created_at,
      version: proposal.version,
    };
  }

  async propose(appraisalId: string, dto: ProposalDto) {
    const appraisal = await this.appraisals.find(appraisalId);
    this.access.assert('performance.propose', {
      companyId: appraisal.company_id,
    });
    // the gate the acceptance criterion names
    if (appraisal.calibrated_rating === null)
      throw new ConflictException(MSG.NOT_CALIBRATED);
    const live = await this.db.tx
      .selectFrom('increment_proposals')
      .select('id')
      .where('appraisal_id', '=', appraisalId)
      .where('state', 'in', ['in_approval', 'approved'])
      .executeTakeFirst();
    if (live) throw new ConflictException(MSG.PROPOSAL_LIVE_EXISTS);

    const wantsSalary = dto.kind === 'increment' || dto.kind === 'both';
    const wantsPost = dto.kind === 'promotion' || dto.kind === 'both';
    if (wantsSalary && (!dto.newGross || !dto.structureId))
      throw new BadRequestException(MSG.PROPOSAL_NOTHING_TO_DO);
    if (wantsPost && !dto.newDesignationId && !dto.newGradeId)
      throw new BadRequestException(MSG.PROPOSAL_NOTHING_TO_DO);
    if (wantsPost)
      await this.org.assertPlacement(appraisal.company_id, {
        designationId: dto.newDesignationId,
        gradeId: dto.newGradeId,
      });

    const cycle = await this.appraisals.findCycle(appraisal.cycle_id);
    const effectiveFrom = businessDate(
      dto.effectiveFrom ?? cycle.increment_from ?? this.appraisals.today(),
    );
    const employee = await this.db.tx
      .selectFrom('employees')
      .select(['employee_code', 'full_name_en'])
      .where('id', '=', appraisal.employee_id)
      .executeTakeFirstOrThrow();

    const proposal = await this.db.tx
      .insertInto('increment_proposals')
      .values({
        company_id: appraisal.company_id,
        appraisal_id: appraisalId,
        employee_id: appraisal.employee_id,
        kind: dto.kind,
        new_gross: wantsSalary ? Money.of(dto.newGross!).toDb() : null,
        structure_id: wantsSalary ? dto.structureId! : null,
        new_designation_id: wantsPost ? (dto.newDesignationId ?? null) : null,
        new_grade_id: wantsPost ? (dto.newGradeId ?? null) : null,
        effective_from: effectiveFrom,
        justification: dto.justification,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const approval = await this.approvals.submit({
      requestType: INCREMENT_PROPOSAL,
      sourceId: proposal.id,
      subjectEmployeeId: appraisal.employee_id,
      companyId: appraisal.company_id,
      kind: dto.kind,
      amount: wantsSalary ? Money.of(dto.newGross!).toDb() : null,
      summary: `${dto.kind === 'promotion' ? 'Promotion' : dto.kind === 'both' ? 'Promotion and increment' : 'Increment'}: ${employee.full_name_en} (${employee.employee_code}) from ${effectiveFrom}, appraisal rating ${appraisal.calibrated_rating}/5`,
      snapshot: {
        employee: `${employee.employee_code} ${employee.full_name_en}`,
        kind: dto.kind,
        effectiveFrom,
        calibratedRating: appraisal.calibrated_rating,
        cycle: cycle.name,
        justification: dto.justification,
        // the amount is in `amount` on the request; the snapshot carries no salary figure
      },
    });
    await this.db.tx
      .updateTable('increment_proposals')
      .set({ approval_request_id: approval.id })
      .where('id', '=', proposal.id)
      .execute();
    await this.audit.record({
      action: 'increment_proposal.raised',
      entity: 'increment_proposal',
      entityId: proposal.id,
      after: {
        kind: dto.kind,
        effectiveFrom,
        calibratedRating: appraisal.calibrated_rating,
      },
    });
    return this.get(proposal.id);
  }

  /**
   * Put the approved proposal into effect. Two writes, both through the services HR uses by
   * hand: the salary (effective-dated, so payroll's arrears do the rest) and the job event.
   */
  async apply(proposalId: string) {
    const proposal = await this.find(proposalId);
    this.access.assert('performance.propose', {
      companyId: proposal.company_id,
    });
    if (proposal.state !== 'approved')
      throw new ConflictException(MSG.PROPOSAL_WRONG_STATE);

    let salaryId: string | null = null;
    let eventId: string | null = null;

    if (proposal.new_gross && proposal.structure_id) {
      await this.payrollSetup.addSalary(proposal.employee_id, {
        effectiveFrom: proposal.effective_from,
        gross: proposal.new_gross,
        structureId: proposal.structure_id,
        reason: `Appraisal increment (proposal ${proposal.id.slice(0, 8)})`,
      });
      const salary = await this.db.tx
        .selectFrom('employee_salaries')
        .select('id')
        .where('employee_id', '=', proposal.employee_id)
        .where('effective_from', '=', proposal.effective_from)
        .where('status', '=', 'active')
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      salaryId = salary?.id ?? null;
    }

    if (proposal.new_designation_id || proposal.new_grade_id) {
      const event = await this.jobHistory.createJobEvent(
        proposal.employee_id,
        {
          type: 'promotion',
          effectiveFrom: proposal.effective_from,
          ...(proposal.new_designation_id
            ? { designationId: proposal.new_designation_id }
            : {}),
          ...(proposal.new_grade_id ? { gradeId: proposal.new_grade_id } : {}),
          reason: `Appraisal promotion (proposal ${proposal.id.slice(0, 8)})`,
        },
      );
      eventId =
        (event as { id?: string }).id ??
        (
          await this.db.tx
            .selectFrom('employee_job_events')
            .select('id')
            .where('employee_id', '=', proposal.employee_id)
            .where('effective_from', '=', proposal.effective_from)
            .orderBy('created_at', 'desc')
            .executeTakeFirst()
        )?.id ??
        null;
    }

    await this.db.tx
      .updateTable('increment_proposals')
      .set({
        state: 'applied',
        applied_salary_id: salaryId,
        applied_event_id: eventId,
        applied_at: this.clock.now(),
      })
      .where('id', '=', proposalId)
      .execute();
    await this.audit.record({
      action: 'increment_proposal.applied',
      entity: 'increment_proposal',
      entityId: proposalId,
      after: {
        effectiveFrom: proposal.effective_from,
        salaryId,
        jobEventId: eventId,
      },
    });
    await this.outbox.add({
      type: 'increment.applied',
      entityId: proposalId,
      payload: {
        proposalId,
        companyId: proposal.company_id,
        employeeId: proposal.employee_id,
        kind: proposal.kind,
        effectiveFrom: proposal.effective_from,
        // no salary figure in an event payload (guide §15)
      },
    });
    return this.get(proposalId);
  }

  async withdraw(proposalId: string, dto: ReasonDto) {
    const proposal = await this.find(proposalId);
    this.access.assert('performance.propose', {
      companyId: proposal.company_id,
    });
    if (!['in_approval', 'approved'].includes(proposal.state))
      throw new ConflictException(MSG.PROPOSAL_WRONG_STATE);
    if (proposal.approval_request_id && proposal.state === 'in_approval')
      await this.approvals.cancel(proposal.approval_request_id, dto.reason);
    else
      await this.db.tx
        .updateTable('increment_proposals')
        .set({ state: 'withdrawn' })
        .where('id', '=', proposalId)
        .execute();
    return this.get(proposalId);
  }

  // ================================================================ approval

  private async approved(r: ApprovalRequest) {
    await this.db.tx
      .updateTable('increment_proposals')
      .set({ state: 'approved' })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  private async closed(
    r: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    if (outcome === 'returned') return;
    await this.db.tx
      .updateTable('increment_proposals')
      .set({ state: outcome === 'cancelled' ? 'withdrawn' : 'rejected' })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  /**
   * Who may read one proposal: HR and the Admin anywhere, and the Dept Head of the
   * employee it is about — it is their own person's increment, and they see it without the
   * amount (the salary field group decides that separately).
   */
  private async assertSee(proposal: IncrementProposal) {
    const placement = await this.directory.currentOrFirstPlacement(
      proposal.employee_id,
    );
    const resource = {
      companyId: proposal.company_id,
      departmentId: placement?.departmentId,
      employeeId: proposal.employee_id,
    };
    if (
      this.access.allows('performance.view', resource) ||
      this.access.allows('performance.manage', resource) ||
      this.access.allows('performance.propose', resource)
    )
      return;
    throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private departmentsInScope(): string[] {
    const filter = this.access.scopeFilter('performance.view');
    const ids = filter.all ? [] : filter.departmentIds;
    if (!ids.length) throw new ForbiddenException(MSG.FORBIDDEN);
    return ids;
  }

  private today() {
    return todayInDhaka(this.clock.now());
  }

  async find(proposalId: string): Promise<IncrementProposal> {
    const proposal = await this.db.tx
      .selectFrom('increment_proposals')
      .selectAll()
      .where('id', '=', proposalId)
      .executeTakeFirst();
    if (!proposal) throw new NotFoundException(MSG.PROPOSAL_NOT_FOUND);
    return proposal;
  }
}
