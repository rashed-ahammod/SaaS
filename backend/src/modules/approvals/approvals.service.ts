/**
 * The approval engine (spec §5, guide §9). One engine for every request type.
 *
 *   submit  -> step 1 approvers resolved from org data, SLA deadlines set
 *   approve -> next step, or (last step) the owning module's onApproved() runs
 *              in the same transaction and the request becomes "executed"
 *   reject / return (comment required)  -> closed, module's onClosed() runs
 *   cancel  -> requester only, before final approval
 *
 * Rules enforced here (not only in the UI):
 *   - nobody approves their own request: the requester, and the employee the
 *     request is about, can never act on it (also not through a delegation);
 *   - only a current-step approver, or their active delegate, can act; the
 *     delegate's action records both names;
 *   - each action stores the request's snapshot, so later edits cannot change
 *     what was approved.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { toBusinessDate } from '../../platform/dates/business-date.js';
import { addWorkingHours } from '../../platform/dates/working-time.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalActionType,
  ApprovalAssignment,
  ApprovalRequest,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { UserDirectory } from '../identity/user-directory.service.js';
import { WorkCalendarService } from '../calendar/work-calendar.service.js';
import { ApprovalHandlers } from './approval-handlers.js';
import {
  ApproverResolver,
  type RoutingContext,
} from './approver-resolver.service.js';
import { pickChain, type ChainDefinition, type ChainStep } from './chains.js';
import type { ListRequestsQueryDto } from './dto/approvals.dto.js';

/** What a module sends when it needs an approval. */
export interface SubmitApprovalInput {
  requestType: string;
  /** The module's own record (e.g. the pending bank account). */
  sourceId: string;
  /** The employee the request is about; routing uses their manager and department. */
  subjectEmployeeId: string | null;
  companyId: string;
  /** One line for the approver's inbox, e.g. "Bank account change: Rafi (bKash ****5678)". */
  summary: string;
  amount?: string | null;
  days?: number | null;
  /** Module-defined kind used by chain conditions, e.g. the leave type code. */
  kind?: string | null;
  /** The values being approved; stored with every action. No full account numbers or NIDs. */
  snapshot: Record<string, unknown>;
}

export type Decision = 'approve' | 'reject' | 'return';

const STATUS_FOR: Record<Decision, 'approved' | 'rejected' | 'returned'> = {
  approve: 'approved',
  reject: 'rejected',
  return: 'returned',
};

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly handlers: ApprovalHandlers,
    private readonly resolver: ApproverResolver,
    private readonly employees: EmployeeDirectory,
    private readonly users: UserDirectory,
    private readonly calendar: WorkCalendarService,
    private readonly access: AccessService,
  ) {}

  // =================================================================== submit

  async submit(input: SubmitApprovalInput): Promise<ApprovalRequest> {
    const requester = requestContext.get().userId;
    if (!requester) throw new ForbiddenException(MSG.FORBIDDEN);
    this.handlers.get(input.requestType); // the type must have a handler

    // pick the chain: configured first, then the built-in default
    const placement = input.subjectEmployeeId
      ? await this.employees.currentOrFirstPlacement(input.subjectEmployeeId)
      : undefined;
    const chain = pickChain(
      await this.configuredChains(input.requestType),
      this.handlers.defaultChains(input.requestType),
      {
        amount: input.amount,
        days: input.days,
        companyId: input.companyId,
        departmentId: placement?.departmentId,
        kind: input.kind,
      },
    );
    if (!chain || chain.steps.length === 0)
      throw new BadRequestException(MSG.APPROVAL_NO_CHAIN);

    // save the request with its steps frozen
    const now = this.clock.now();
    const request = await this.db.tx
      .insertInto('approval_requests')
      .values({
        request_type: input.requestType,
        source_id: input.sourceId,
        requester_user_id: requester,
        subject_employee_id: input.subjectEmployeeId,
        company_id: input.companyId,
        chain_id: chain.id,
        chain_name: chain.name,
        steps: JSON.stringify(chain.steps),
        summary: input.summary,
        amount: input.amount ? Money.of(input.amount).toDb() : null,
        days: input.days != null ? String(input.days) : null,
        snapshot: JSON.stringify(input.snapshot),
        submitted_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.recordAction(request, 'submit', {
      stepNo: null,
      actor: requester,
    });
    await this.audit.record({
      action: 'approval.submitted',
      entity: 'approval_request',
      entityId: request.id,
      after: {
        type: request.request_type,
        chain: chain.name,
        summary: request.summary,
      },
    });

    // first step: find approvers and start the SLA clock
    await this.activateStep(request, 1, now);
    return this.findRequest(request.id);
  }

  // =================================================================== act

  async decide(requestId: string, decision: Decision, comment?: string) {
    const actor = requestContext.get().userId!;
    const now = this.clock.now();

    // lock the request (two approvers acting at once are handled one after the other)
    const request = await this.lockOpenRequest(requestId);

    // nobody approves their own request (also not as somebody's delegate)
    const actorEmployee = await this.users.employeeOfUser(actor);
    if (
      actor === request.requester_user_id ||
      (actorEmployee && actorEmployee === request.subject_employee_id)
    ) {
      throw new ForbiddenException(MSG.APPROVAL_SELF_APPROVAL);
    }
    if (decision !== 'approve' && !comment?.trim())
      throw new BadRequestException(MSG.APPROVAL_COMMENT_REQUIRED);

    // my assignment in the current step, or one I hold by delegation
    const { assignment, onBehalfOf } = await this.findActorAssignment(
      request,
      actor,
      now,
    );

    // four-eyes request types: whoever approved an earlier step cannot approve this one
    if (
      decision === 'approve' &&
      this.handlers.get(request.request_type).distinctApprovers
    ) {
      const earlier = await this.earlierApprovers(request);
      if (earlier.has(actor) || (onBehalfOf && earlier.has(onBehalfOf)))
        throw new ForbiddenException(
          MSG.APPROVAL_ALREADY_APPROVED_EARLIER_STEP,
        );
    }

    // record the decision
    await this.db.tx
      .updateTable('approval_step_assignments')
      .set({ status: STATUS_FOR[decision], acted_at: now })
      .where('id', '=', assignment.id)
      .execute();
    await this.recordAction(request, decision, {
      stepNo: request.current_step,
      actor,
      onBehalfOf,
      comment,
    });
    await this.audit.record({
      action: `approval.${decision}`,
      entity: 'approval_request',
      entityId: request.id,
      after: {
        step: request.current_step,
        onBehalfOf,
        comment: comment ?? null,
      },
    });

    if (decision === 'reject') await this.close(request, 'rejected', now);
    else if (decision === 'return') await this.close(request, 'returned', now);
    else await this.afterApproval(request, assignment, now);

    return this.getRequest(requestId);
  }

  /**
   * For modules: close their own open request (e.g. HR cancels an employee's
   * pending leave). The module has already checked the caller's permission.
   */
  async withdraw(requestId: string, reason: string): Promise<void> {
    const request = await this.lockOpenRequest(requestId);
    await this.recordAction(request, 'cancel', {
      stepNo: request.current_step,
      actor: requestContext.get().userId ?? null,
      comment: reason,
    });
    await this.audit.record({
      action: 'approval.withdrawn',
      entity: 'approval_request',
      entityId: request.id,
      after: { reason },
    });
    await this.close(request, 'cancelled', this.clock.now());
  }

  async cancel(requestId: string, comment?: string) {
    const actor = requestContext.get().userId!;
    const request = await this.lockOpenRequest(requestId);
    if (request.requester_user_id !== actor)
      throw new ForbiddenException(MSG.APPROVAL_CANCEL_NOT_ALLOWED);

    await this.recordAction(request, 'cancel', {
      stepNo: request.current_step,
      actor,
      comment,
    });
    await this.audit.record({
      action: 'approval.cancelled',
      entity: 'approval_request',
      entityId: request.id,
      after: { comment: comment ?? null },
    });
    await this.close(request, 'cancelled', this.clock.now());
    return this.getRequest(requestId);
  }

  // =================================================================== read

  /** Pending approvals for me, and for people who delegated to me. */
  async inbox() {
    const me = requestContext.get().userId!;
    const now = this.clock.now();
    const delegators = await this.users.delegatorsFor(me, toBusinessDate(now));
    const rows = await this.db.tx
      .selectFrom('approval_step_assignments as a')
      .innerJoin('approval_requests as r', 'r.id', 'a.request_id')
      .select([
        'r.id',
        'r.request_type',
        'r.summary',
        'r.amount',
        'r.days',
        'r.requester_user_id',
        'r.subject_employee_id',
        'r.submitted_at',
        'r.current_step',
        'a.approver_user_id',
        'a.reason',
        'a.remind_at',
        'a.escalate_at',
      ])
      .where('a.approver_user_id', 'in', [me, ...delegators])
      .where('a.status', '=', 'pending')
      .where('r.state', '=', 'in_approval')
      .whereRef('a.step_no', '=', 'r.current_step')
      .orderBy('a.escalate_at')
      .execute();

    return rows.map((r) => ({
      requestId: r.id,
      requestType: r.request_type,
      summary: r.summary,
      amount: r.amount,
      days: r.days,
      step: r.current_step,
      requesterUserId: r.requester_user_id,
      subjectEmployeeId: r.subject_employee_id,
      submittedAt: r.submitted_at,
      onBehalfOf: r.approver_user_id === me ? null : r.approver_user_id,
      assignedBecause: r.reason,
      reminderAt: r.remind_at,
      escalationAt: r.escalate_at,
      // past its time: the server's clock, so the inbox can colour it without guessing
      overdue: !!r.escalate_at && r.escalate_at < now,
    }));
  }

  /** Requests I submitted. */
  async myRequests() {
    const me = requestContext.get().userId!;
    const rows = await this.db.tx
      .selectFrom('approval_requests')
      .selectAll()
      .where('requester_user_id', '=', me)
      .orderBy('submitted_at', 'desc')
      .limit(100)
      .execute();
    return rows.map(toRequestSummary);
  }

  /**
   * Every request of the company, for the holder of approvals.view_all (Admin,
   * Auditor). Until this existed the permission could only be used to open a
   * request whose id you already knew, so "which approvals are stuck?" — the one
   * question an Admin is asked — had no answer. `overdue` means the current step
   * has passed its escalation time.
   */
  async listCompanyRequests(query: ListRequestsQueryDto) {
    this.access.assert('approvals.view_all', { companyId: query.companyId });
    const now = this.clock.now();

    let q = this.db.tx
      .selectFrom('approval_requests as r')
      .selectAll('r')
      .select((eb) => [
        // the earliest escalation still pending on the current step
        eb
          .selectFrom('approval_step_assignments as a')
          .select((e) => e.fn.min('a.escalate_at').as('due'))
          .whereRef('a.request_id', '=', 'r.id')
          .whereRef('a.step_no', '=', 'r.current_step')
          .where('a.status', '=', 'pending')
          .as('escalation_at'),
      ])
      .where('r.company_id', '=', query.companyId);
    if (query.requestType)
      q = q.where('r.request_type', '=', query.requestType);
    if (query.state) q = q.where('r.state', '=', query.state);
    if (query.open) q = q.where('r.state', '=', 'in_approval');

    const rows = await q.orderBy('r.submitted_at', 'desc').limit(200).execute();
    const names = await this.users.namesOf(
      rows.map((r) => r.requester_user_id),
    );
    const list = rows.map((r) => ({
      ...toRequestSummary(r),
      requesterName: names.get(r.requester_user_id) ?? null,
      chainName: r.chain_name,
      escalationAt: r.escalation_at,
      overdue: !!r.escalation_at && new Date(r.escalation_at) < now,
    }));
    return query.overdue ? list.filter((r) => r.overdue) : list;
  }

  /**
   * One request with its steps, approvers and full action history. Visible to the
   * requester, anyone assigned (or their delegate), and approvals.view_all holders.
   */
  async getRequest(requestId: string) {
    const request = await this.findRequest(requestId);
    const assignments = await this.db.tx
      .selectFrom('approval_step_assignments')
      .selectAll()
      .where('request_id', '=', requestId)
      .orderBy('step_no')
      .orderBy('slot')
      .orderBy('created_at')
      .execute();
    await this.assertCanSee(request, assignments);

    const actions = await this.db.tx
      .selectFrom('approval_actions')
      .selectAll()
      .where('request_id', '=', requestId)
      .orderBy('created_at')
      .execute();

    const now = this.clock.now();
    // the people, by name: an approval is a conversation, not a list of user ids
    const names = await this.users.namesOf([
      request.requester_user_id,
      ...assignments.map((a) => a.approver_user_id),
      ...actions
        .flatMap((a) => [a.actor_user_id, a.on_behalf_of_user_id])
        .filter((id): id is string => !!id),
    ]);

    return {
      ...toRequestSummary(request),
      requesterName: names.get(request.requester_user_id) ?? null,
      chainName: request.chain_name,
      steps: request.steps as ChainStep[],
      snapshot: request.snapshot,
      approvers: assignments.map((a) => ({
        step: a.step_no,
        slot: a.slot,
        userId: a.approver_user_id,
        name: names.get(a.approver_user_id) ?? null,
        // the business clock decides whether a deadline has passed, not the browser's
        overdue:
          a.status === 'pending' && !!a.escalate_at && a.escalate_at < now,
        assignedBecause: a.reason,
        status: a.status,
        actedAt: a.acted_at,
        reminderAt: a.remind_at,
        escalationAt: a.escalate_at,
        remindedAt: a.reminded_at,
        escalatedAt: a.escalated_at,
      })),
      history: actions.map((a) => ({
        action: a.action,
        step: a.step_no,
        actorUserId: a.actor_user_id,
        actorName: a.actor_user_id
          ? (names.get(a.actor_user_id) ?? null)
          : null,
        onBehalfOfUserId: a.on_behalf_of_user_id,
        onBehalfOfName: a.on_behalf_of_user_id
          ? (names.get(a.on_behalf_of_user_id) ?? null)
          : null,
        comment: a.comment,
        at: a.created_at,
      })),
    };
  }

  // =================================================================== SLA (called by ApprovalSlaService)

  /**
   * Reminder and escalation for one pending assignment, if due (spec §5:
   * reminder at 24 working hours, escalation to the approver's manager at 48).
   * Escalation adds the manager to the same slot: either of them can now approve.
   */
  async handleSla(
    assignmentId: string,
    now: Date,
  ): Promise<{ reminded: boolean; escalatedTo?: string }> {
    const assignment = await this.db.tx
      .selectFrom('approval_step_assignments')
      .selectAll()
      .where('id', '=', assignmentId)
      .forUpdate()
      .executeTakeFirst();
    if (!assignment || assignment.status !== 'pending')
      return { reminded: false };
    const request = await this.findRequest(assignment.request_id);
    if (
      request.state !== 'in_approval' ||
      request.current_step !== assignment.step_no
    )
      return { reminded: false };

    const result: { reminded: boolean; escalatedTo?: string } = {
      reminded: false,
    };

    // reminder
    if (!assignment.reminded_at && assignment.remind_at <= now) {
      await this.db.tx
        .updateTable('approval_step_assignments')
        .set({ reminded_at: now })
        .where('id', '=', assignment.id)
        .execute();
      await this.recordAction(request, 'remind', {
        stepNo: assignment.step_no,
        actor: null,
        comment: `Reminder to ${assignment.approver_user_id}`,
      });
      await this.outbox.add({
        type: 'approval.pending',
        entityId: request.id,
        payload: {
          requestId: request.id,
          requestType: request.request_type,
          approverUserId: assignment.approver_user_id,
          reminder: true,
        },
      });
      result.reminded = true;
    }

    // escalation
    if (!assignment.escalated_at && assignment.escalate_at <= now) {
      await this.db.tx
        .updateTable('approval_step_assignments')
        .set({ escalated_at: now })
        .where('id', '=', assignment.id)
        .execute();

      const inStep = await this.db.tx
        .selectFrom('approval_step_assignments')
        .select('approver_user_id')
        .where('request_id', '=', request.id)
        .where('step_no', '=', assignment.step_no)
        .execute();
      const target = await this.resolver.escalationTarget(
        assignment.approver_user_id,
        await this.routingContext(request),
        new Set(inStep.map((a) => a.approver_user_id)),
      );

      if (target) {
        const step = (request.steps as ChainStep[])[assignment.step_no - 1];
        const deadlines = await this.deadlines(request, step, now);
        await this.db.tx
          .insertInto('approval_step_assignments')
          .values({
            request_id: request.id,
            step_no: assignment.step_no,
            slot: assignment.slot,
            approver_user_id: target,
            reason: 'escalation',
            ...deadlines,
          })
          .execute();
        result.escalatedTo = target;
      }
      await this.recordAction(request, 'escalate', {
        stepNo: assignment.step_no,
        actor: null,
        comment: target
          ? `Escalated from ${assignment.approver_user_id} to ${target}`
          : 'No one to escalate to',
      });
      await this.outbox.add({
        type: 'approval.sla_breached',
        entityId: request.id,
        payload: {
          requestId: request.id,
          requestType: request.request_type,
          lateApproverUserId: assignment.approver_user_id,
          escalatedToUserId: target ?? null,
        },
      });
    }
    return result;
  }

  // =================================================================== internals

  /** Resolve the approvers of a step and start their SLA clocks. */
  private async activateStep(
    request: ApprovalRequest,
    stepNo: number,
    now: Date,
  ): Promise<void> {
    const step = (request.steps as ChainStep[])[stepNo - 1];
    const resolved = await this.resolver.resolve(
      step.approverRule,
      await this.routingContext(request),
    );
    const { reason } = resolved;
    let userIds = resolved.userIds;
    if (this.handlers.get(request.request_type).distinctApprovers) {
      const earlier = await this.earlierApprovers(request);
      userIds = userIds.filter((id) => !earlier.has(id));
    }
    if (userIds.length === 0)
      throw new BadRequestException(MSG.APPROVAL_NO_APPROVER);

    const deadlines = await this.deadlines(request, step, now);
    await this.db.tx
      .insertInto('approval_step_assignments')
      .values(
        userIds.map((userId, i) => ({
          request_id: request.id,
          step_no: stepNo,
          slot: step.mode === 'all' ? i + 1 : 1,
          approver_user_id: userId,
          reason,
          ...deadlines,
        })),
      )
      .execute();
    await this.db.tx
      .updateTable('approval_requests')
      .set({ current_step: stepNo })
      .where('id', '=', request.id)
      .execute();

    for (const userId of userIds) {
      await this.outbox.add({
        type: 'approval.pending',
        entityId: request.id,
        payload: {
          requestId: request.id,
          requestType: request.request_type,
          approverUserId: userId,
          step: stepNo,
        },
      });
    }
  }

  /** After an approval: wait for others in the step, go to the next step, or finish. */
  private async afterApproval(
    request: ApprovalRequest,
    assignment: ApprovalAssignment,
    now: Date,
  ): Promise<void> {
    // the other approvers of the same slot (e.g. other HR officers, an escalation) are no longer needed
    await this.db.tx
      .updateTable('approval_step_assignments')
      .set({ status: 'superseded' })
      .where('request_id', '=', request.id)
      .where('step_no', '=', assignment.step_no)
      .where('slot', '=', assignment.slot)
      .where('status', '=', 'pending')
      .execute();

    // "all" mode: other slots still waiting?
    const waiting = await this.db.tx
      .selectFrom('approval_step_assignments')
      .select('id')
      .where('request_id', '=', request.id)
      .where('step_no', '=', assignment.step_no)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (waiting) return;

    const steps = request.steps as ChainStep[];
    if (request.current_step < steps.length) {
      await this.handlers
        .get(request.request_type)
        .onStepApproved?.(request, request.current_step);
      await this.activateStep(request, request.current_step + 1, now);
      return;
    }

    // final approval: the owning module applies the change in this same transaction
    await this.db.tx
      .updateTable('approval_requests')
      .set({ approved_at: now })
      .where('id', '=', request.id)
      .execute();
    await this.handlers
      .get(request.request_type)
      .onApproved(await this.findRequest(request.id));
    await this.db.tx
      .updateTable('approval_requests')
      .set({ state: 'executed', completed_at: now })
      .where('id', '=', request.id)
      .execute();
    await this.recordAction(request, 'execute', {
      stepNo: request.current_step,
      actor: null,
    });
    await this.outbox.add({
      type: 'approval.completed',
      entityId: request.id,
      payload: {
        requestId: request.id,
        requestType: request.request_type,
        outcome: 'approved',
        requesterUserId: request.requester_user_id,
      },
    });
  }

  /** Rejected, returned or cancelled. */
  private async close(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
    now: Date,
  ): Promise<void> {
    await this.db.tx
      .updateTable('approval_step_assignments')
      .set({ status: outcome === 'cancelled' ? 'cancelled' : 'superseded' })
      .where('request_id', '=', request.id)
      .where('status', '=', 'pending')
      .execute();
    await this.db.tx
      .updateTable('approval_requests')
      .set({ state: outcome, completed_at: now })
      .where('id', '=', request.id)
      .execute();
    await this.handlers
      .get(request.request_type)
      .onClosed?.(await this.findRequest(request.id), outcome);
    await this.outbox.add({
      type: 'approval.completed',
      entityId: request.id,
      payload: {
        requestId: request.id,
        requestType: request.request_type,
        outcome,
        requesterUserId: request.requester_user_id,
      },
    });
  }

  private async findActorAssignment(
    request: ApprovalRequest,
    actor: string,
    now: Date,
  ) {
    const pending = await this.db.tx
      .selectFrom('approval_step_assignments')
      .selectAll()
      .where('request_id', '=', request.id)
      .where('step_no', '=', request.current_step)
      .where('status', '=', 'pending')
      .execute();

    const own = pending.find((a) => a.approver_user_id === actor);
    if (own) return { assignment: own, onBehalfOf: null };

    const delegators = await this.users.delegatorsFor(
      actor,
      toBusinessDate(now),
    );
    const delegated = pending.find((a) =>
      delegators.includes(a.approver_user_id),
    );
    if (delegated)
      return { assignment: delegated, onBehalfOf: delegated.approver_user_id };

    throw new ForbiddenException(MSG.APPROVAL_NOT_YOUR_TURN);
  }

  /** Reminder and escalation times, in working hours of the subject's branch (weekends and holidays skipped). */
  private async deadlines(
    request: ApprovalRequest,
    step: ChainStep,
    from: Date,
  ) {
    const placement = request.subject_employee_id
      ? await this.employees.currentOrFirstPlacement(
          request.subject_employee_id,
        )
      : undefined;
    const isWorkingDay = await this.calendar.workingDayChecker(
      placement?.branchId ?? null,
      toBusinessDate(from),
    );
    return {
      remind_at: addWorkingHours(from, step.reminderHours, isWorkingDay),
      escalate_at: addWorkingHours(from, step.escalationHours, isWorkingDay),
    };
  }

  private async routingContext(
    request: ApprovalRequest,
  ): Promise<RoutingContext> {
    const placement = request.subject_employee_id
      ? await this.employees.currentOrFirstPlacement(
          request.subject_employee_id,
        )
      : undefined;
    return {
      requesterUserId: request.requester_user_id,
      subjectEmployeeId: request.subject_employee_id,
      companyId: request.company_id,
      departmentId: placement?.departmentId ?? null,
    };
  }

  private async configuredChains(
    requestType: string,
  ): Promise<ChainDefinition[]> {
    const chains = await this.db.tx
      .selectFrom('approval_chains')
      .selectAll()
      .where('request_type', '=', requestType)
      .where('is_active', '=', true)
      .orderBy('priority')
      .orderBy('created_at')
      .execute();
    if (chains.length === 0) return [];
    const steps = await this.db.tx
      .selectFrom('approval_chain_steps')
      .selectAll()
      .where(
        'chain_id',
        'in',
        chains.map((c) => c.id),
      )
      .orderBy('step_no')
      .execute();
    return chains.map((c) => ({
      id: c.id,
      name: c.name,
      conditions: c.conditions as ChainDefinition['conditions'],
      steps: steps
        .filter((s) => s.chain_id === c.id)
        .map((s) => ({
          stepNo: s.step_no,
          approverRule: s.approver_rule as ChainStep['approverRule'],
          mode: s.mode,
          reminderHours: s.reminder_hours,
          escalationHours: s.escalation_hours,
        })),
    }));
  }

  private async recordAction(
    request: ApprovalRequest,
    action: ApprovalActionType,
    p: {
      stepNo: number | null;
      actor: string | null;
      onBehalfOf?: string | null;
      comment?: string | null;
    },
  ): Promise<void> {
    const ctx = requestContext.get();
    await this.db.tx
      .insertInto('approval_actions')
      .values({
        request_id: request.id,
        step_no: p.stepNo,
        actor_user_id: p.actor,
        on_behalf_of_user_id: p.onBehalfOf ?? null,
        action,
        comment: p.comment ?? null,
        ip: p.actor ? (ctx.ip ?? null) : null,
        device: p.actor ? (ctx.device ?? null) : null,
        snapshot: JSON.stringify(request.snapshot),
      })
      .execute();
  }

  /** Users who approved an earlier step of this request (themselves or as someone's delegate). */
  private async earlierApprovers(
    request: ApprovalRequest,
  ): Promise<Set<string>> {
    const rows = await this.db.tx
      .selectFrom('approval_actions')
      .select(['actor_user_id', 'on_behalf_of_user_id'])
      .where('request_id', '=', request.id)
      .where('action', '=', 'approve')
      .execute();
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.actor_user_id) ids.add(r.actor_user_id);
      if (r.on_behalf_of_user_id) ids.add(r.on_behalf_of_user_id);
    }
    return ids;
  }

  private async lockOpenRequest(requestId: string): Promise<ApprovalRequest> {
    const request = await this.db.tx
      .selectFrom('approval_requests')
      .selectAll()
      .where('id', '=', requestId)
      .forUpdate()
      .executeTakeFirst();
    if (!request) throw new NotFoundException(MSG.APPROVAL_NOT_FOUND);
    if (request.state !== 'in_approval')
      throw new ConflictException(MSG.APPROVAL_NOT_OPEN);
    return request;
  }

  private async findRequest(requestId: string): Promise<ApprovalRequest> {
    const request = await this.db.tx
      .selectFrom('approval_requests')
      .selectAll()
      .where('id', '=', requestId)
      .executeTakeFirst();
    if (!request) throw new NotFoundException(MSG.APPROVAL_NOT_FOUND);
    return request;
  }

  private async assertCanSee(
    request: ApprovalRequest,
    assignments: ApprovalAssignment[],
  ): Promise<void> {
    const me = requestContext.get().userId!;
    if (request.requester_user_id === me) return;
    if (assignments.some((a) => a.approver_user_id === me)) return;
    const delegators = await this.users.delegatorsFor(
      me,
      toBusinessDate(this.clock.now()),
    );
    if (assignments.some((a) => delegators.includes(a.approver_user_id)))
      return;
    if (
      this.access.allows('approvals.view_all', {
        companyId: request.company_id,
      })
    )
      return;
    // looks the same as "not found": do not reveal that the request exists
    throw new NotFoundException(MSG.APPROVAL_NOT_FOUND);
  }
}

function toRequestSummary(r: ApprovalRequest) {
  return {
    id: r.id,
    requestType: r.request_type,
    summary: r.summary,
    state: r.state,
    currentStep: r.current_step,
    amount: r.amount,
    days: r.days,
    requesterUserId: r.requester_user_id,
    subjectEmployeeId: r.subject_employee_id,
    submittedAt: r.submitted_at,
    approvedAt: r.approved_at,
    completedAt: r.completed_at,
  };
}
