/**
 * Appraisal cycles, goals, self-review, the manager's rating and HR's calibration
 * (WP30; spec §6.5).
 *
 *   cycle(create/advance)   HR runs the cycle: draft -> goals -> self_review ->
 *                           manager_review -> calibration -> proposals -> closed. Forward
 *                           only: a phase that has passed cannot be re-opened, because
 *                           ratings and proposals already depend on it.
 *   openAppraisals(cycleId) one appraisal per active employee, with the line manager of the
 *                           day recorded on it, so a later transfer does not silently move
 *                           who rated whom
 *   setGoals                the manager (or HR) writes the goals and their weights; the
 *                           weights must add up to 100 before the self-review opens
 *   selfReview              the employee scores their own goals and writes their review
 *   rate                    the Dept Head scores the goals and gives ONE rating, with the
 *                           weighted score shown as a suggestion
 *   calibrate               HR compares departments and sets the rating that counts. An
 *                           increment cannot be proposed before this (spec §6.5), which is
 *                           what "ratings are calibrated before proposals go out" means.
 *   feedback                continuous notes about an employee, visible in their review
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
import { businessDate, todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  Appraisal,
  AppraisalCycle,
  AppraisalState,
  CycleState,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import {
  canAppraisalMove,
  nextPhase,
  phaseReached,
  suggestedRating,
  weightedScore,
  weightsValid,
} from './performance-rules.js';
import type {
  CycleDto,
  FeedbackDto,
  GoalsDto,
  RateDto,
  SelfReviewDto,
  CalibrateDto,
} from './dto/performance.dto.js';

/**
 * Whose appraisals a performance screen may show: the whole company, the
 * departments a Dept Head leads, or just the viewer's own appraisal.
 */
interface PerformanceScope {
  all: boolean;
  /** When not all: these departments. */
  departmentIds: string[];
  /** When not all: these employees — an employee's own appraisal. */
  employeeIds: string[];
}

@Injectable()
export class AppraisalsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly directory: EmployeeDirectory,
  ) {}

  // ================================================================== cycles

  async cycles(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    // A cycle belongs to the company, not to a department, so a Dept Head —
    // whose grant is held over their department — was refused the list of the
    // very cycles they rate their team in. The calendar is the same for all of
    // them; what differs is whose appraisals they are counted over.
    const scope = await this.assertSee(companyId);
    const rows = await this.db.tx
      .selectFrom('appraisal_cycles')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('period_from', 'desc')
      .execute();
    const counts = await this.counts(rows.map((r) => r.id), scope);
    return {
      cycles: rows.map((c) => ({
        ...this.toCycle(c),
        appraisals: counts.get(c.id) ?? 0,
      })),
    };
  }

  async createCycle(companyId: string, dto: CycleDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('performance.manage', { companyId });
    if (businessDate(dto.periodTo) <= businessDate(dto.periodFrom))
      throw new BadRequestException(MSG.INVALID_DATE);
    const taken = await this.db.tx
      .selectFrom('appraisal_cycles')
      .select('id')
      .where('company_id', '=', companyId)
      .where('name', '=', dto.name)
      .executeTakeFirst();
    if (taken) throw new ConflictException(MSG.CYCLE_NAME_TAKEN);
    const cycle = await this.db.tx
      .insertInto('appraisal_cycles')
      .values({
        company_id: companyId,
        name: dto.name,
        kind: dto.kind,
        period_from: dto.periodFrom,
        period_to: dto.periodTo,
        increment_from: dto.incrementFrom ?? null,
        note: dto.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'appraisal_cycle.created',
      entity: 'appraisal_cycle',
      entityId: cycle.id,
      after: { name: cycle.name, kind: cycle.kind },
    });
    return this.cycle(cycle.id);
  }

  async cycle(cycleId: string) {
    const cycle = await this.findCycle(cycleId);
    const scope = await this.assertSee(cycle.company_id);
    const appraisals = await this.db.tx
      .selectFrom('appraisals as a')
      .innerJoin('employees as e', 'e.id', 'a.employee_id')
      .leftJoin('departments as d', 'd.id', 'a.department_id')
      .select([
        'a.id',
        'a.employee_id',
        'a.state',
        'a.manager_rating',
        'a.calibrated_rating',
        'a.manager_employee_id',
        'e.employee_code',
        'e.full_name_en',
        'd.name as department_name',
      ])
      .where('a.cycle_id', '=', cycleId)
      // the same scope as the list of cycles: a Dept Head reads their own
      // departments' appraisals here, an employee only their own, never the
      // whole company's
      .$if(!scope.all, (qb) =>
        qb.where((eb) =>
          eb.or([
            ...(scope.departmentIds.length
              ? [eb('a.department_id', 'in', scope.departmentIds)]
              : []),
            ...(scope.employeeIds.length
              ? [eb('a.employee_id', 'in', scope.employeeIds)]
              : []),
          ]),
        ),
      )
      .orderBy('d.name')
      .orderBy('e.full_name_en')
      .execute();
    return {
      ...this.toCycle(cycle),
      appraisals: appraisals.map((a) => ({
        id: a.id,
        employeeId: a.employee_id,
        employeeCode: a.employee_code,
        employeeName: a.full_name_en,
        departmentName: a.department_name,
        managerEmployeeId: a.manager_employee_id,
        state: a.state,
        managerRating: a.manager_rating,
        calibratedRating: a.calibrated_rating,
      })),
    };
  }

  /** HR moves the cycle to its next phase. Forward only. */
  async advanceCycle(cycleId: string) {
    const cycle = await this.findCycle(cycleId);
    this.access.assert('performance.manage', { companyId: cycle.company_id });
    const next = nextPhase(cycle.state);
    if (!next) throw new ConflictException(MSG.CYCLE_WRONG_STATE);

    // The self-review opens for the appraisals whose goals are set. One manager who has
    // not written their goals yet does not hold up the whole company — their people simply
    // stay at the goals step, because there is nothing for them to review against. The
    // phase is refused only when NOBODY has goals.
    if (next === 'self_review') {
      const ready = await this.db.tx
        .selectFrom('appraisals as a')
        .select('a.id')
        .where('a.cycle_id', '=', cycleId)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('appraisal_goals as g')
              .select('g.id')
              .whereRef('g.appraisal_id', '=', 'a.id'),
          ),
        )
        .executeTakeFirst();
      if (!ready) throw new ConflictException(MSG.GOALS_NEEDED);
    }

    await this.db.tx
      .updateTable('appraisal_cycles')
      .set({ state: next })
      .where('id', '=', cycleId)
      .execute();
    // The appraisals follow the cycle's phase, except the ones already further on. The
    // states are compared by their PLACE in the sequence, not alphabetically: 'calibration'
    // sorts before 'goals' as text, which would move appraisals backwards.
    const moveTo: Partial<
      Record<CycleState, { to: AppraisalState; from: AppraisalState[] }>
    > = {
      self_review: { to: 'self_review', from: ['goals'] },
      manager_review: {
        to: 'manager_review',
        from: ['goals', 'self_review'],
      },
      calibration: {
        to: 'calibration',
        from: ['goals', 'self_review', 'manager_review'],
      },
    };
    const move = moveTo[next];
    if (move)
      await this.db.tx
        .updateTable('appraisals')
        .set({ state: move.to })
        .where('cycle_id', '=', cycleId)
        .where('state', 'in', move.from)
        // only an appraisal with goals: there is nothing to review or rate without them
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('appraisal_goals as g')
              .select('g.id')
              .whereRef('g.appraisal_id', '=', 'appraisals.id'),
          ),
        )
        .execute();
    await this.audit.record({
      action: 'appraisal_cycle.advanced',
      entity: 'appraisal_cycle',
      entityId: cycleId,
      before: { state: cycle.state },
      after: { state: next },
    });
    await this.outbox.add({
      type: 'appraisal_cycle.phase_changed',
      entityId: cycleId,
      payload: {
        cycleId,
        companyId: cycle.company_id,
        name: cycle.name,
        from: cycle.state,
        to: next,
      },
    });
    return this.cycle(cycleId);
  }

  /** One appraisal per active employee of the company, with their manager of the day. */
  async openAppraisals(cycleId: string) {
    const cycle = await this.findCycle(cycleId);
    this.access.assert('performance.manage', { companyId: cycle.company_id });
    if (cycle.state !== 'draft' && cycle.state !== 'goals')
      throw new ConflictException(MSG.CYCLE_WRONG_STATE);

    const employees = await this.db.tx
      .selectFrom('employees')
      .select(['id'])
      .where('company_id', '=', cycle.company_id)
      .where('status', 'in', ['probation', 'active', 'notice'])
      .execute();
    let opened = 0;
    for (const employee of employees) {
      const placement = await this.directory.currentOrFirstPlacement(
        employee.id,
      );
      const result = await this.db.tx
        .insertInto('appraisals')
        .values({
          company_id: cycle.company_id,
          cycle_id: cycleId,
          employee_id: employee.id,
          manager_employee_id: placement?.lineManagerId ?? null,
          department_id: placement?.departmentId ?? null,
          state: 'goals',
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'cycle_id', 'employee_id']).doNothing(),
        )
        .executeTakeFirst();
      opened += Number(result.numInsertedOrUpdatedRows ?? 0n);
    }
    if (cycle.state === 'draft')
      await this.db.tx
        .updateTable('appraisal_cycles')
        .set({ state: 'goals' })
        .where('id', '=', cycleId)
        .execute();
    await this.audit.record({
      action: 'appraisal_cycle.opened',
      entity: 'appraisal_cycle',
      entityId: cycleId,
      after: { appraisals: opened },
    });
    return this.cycle(cycleId);
  }

  // ============================================================== appraisals

  /** My own appraisal in a cycle (the employee app and the portal both use this). */
  async mine(cycleId: string) {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) throw new ForbiddenException(MSG.FORBIDDEN);
    const appraisal = await this.db.tx
      .selectFrom('appraisals')
      .select('id')
      .where('cycle_id', '=', cycleId)
      .where('employee_id', '=', employeeId)
      .executeTakeFirst();
    if (!appraisal) throw new NotFoundException(MSG.APPRAISAL_NOT_FOUND);
    return this.get(appraisal.id);
  }

  /** The appraisals of my team, for the Dept Head's rating screen. */
  async myTeam(cycleId: string) {
    const cycle = await this.findCycle(cycleId);
    const me = this.access.current().employeeId;
    // "My team" is the appraisals this person manages. A login with no employee
    // record of its own — the workspace owner — manages nobody, which is an
    // empty team, not a refusal: the screen is in their menu and says so.
    if (!me) return { cycle: this.toCycle(cycle), appraisals: [] };
    const rows = await this.db.tx
      .selectFrom('appraisals as a')
      .innerJoin('employees as e', 'e.id', 'a.employee_id')
      .select([
        'a.id',
        'a.state',
        'a.manager_rating',
        'a.calibrated_rating',
        'a.self_submitted_at',
        'e.employee_code',
        'e.full_name_en',
      ])
      .where('a.cycle_id', '=', cycle.id)
      .where('a.manager_employee_id', '=', me)
      .orderBy('e.full_name_en')
      .execute();
    return {
      cycle: this.toCycle(cycle),
      appraisals: rows.map((a) => ({
        id: a.id,
        employeeCode: a.employee_code,
        employeeName: a.full_name_en,
        state: a.state,
        selfReviewDone: !!a.self_submitted_at,
        managerRating: a.manager_rating,
        calibratedRating: a.calibrated_rating,
      })),
    };
  }

  async get(appraisalId: string) {
    const appraisal = await this.find(appraisalId);
    await this.assertSeeAppraisal(appraisal);
    const goals = await this.goalsOf(appraisalId);
    const cycle = await this.findCycle(appraisal.cycle_id);
    const employee = await this.db.tx
      .selectFrom('employees')
      .select(['employee_code', 'full_name_en'])
      .where('id', '=', appraisal.employee_id)
      .executeTakeFirst();
    const proposal = await this.db.tx
      .selectFrom('increment_proposals')
      .select(['id', 'kind', 'state', 'effective_from'])
      .where('appraisal_id', '=', appraisalId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const score = weightedScore(
      goals.map((g) => ({
        weight: g.weight,
        score: g.managerScore ?? g.selfScore ?? null,
      })),
    );
    return {
      id: appraisal.id,
      cycle: this.toCycle(cycle),
      employeeId: appraisal.employee_id,
      employeeCode: employee?.employee_code ?? null,
      employeeName: employee?.full_name_en ?? null,
      managerEmployeeId: appraisal.manager_employee_id,
      departmentId: appraisal.department_id,
      state: appraisal.state,
      goals,
      weights: goals.reduce((n, g) => n + g.weight, 0),
      weightedScore: score,
      suggestedRating: suggestedRating(score),
      selfReview: appraisal.self_review,
      selfSubmittedAt: appraisal.self_submitted_at,
      managerRating: appraisal.manager_rating,
      managerComment: appraisal.manager_comment,
      managerSubmittedAt: appraisal.manager_submitted_at,
      calibratedRating: appraisal.calibrated_rating,
      calibrationNote: appraisal.calibration_note,
      calibratedAt: appraisal.calibrated_at,
      finalRating: appraisal.calibrated_rating ?? appraisal.manager_rating,
      proposal: proposal ?? null,
      version: appraisal.version,
    };
  }

  /** The manager (or HR) writes the goals; they replace whatever was there. */
  async setGoals(appraisalId: string, dto: GoalsDto) {
    const appraisal = await this.find(appraisalId);
    await this.assertRate(appraisal);
    if (appraisal.state !== 'goals' && appraisal.state !== 'self_review')
      throw new ConflictException(MSG.APPRAISAL_WRONG_STATE);
    if (!weightsValid(dto.goals))
      throw new BadRequestException(MSG.GOAL_WEIGHTS_INVALID);

    for (const goal of dto.goals)
      if (goal.kpiId) {
        const kpi = await this.db.tx
          .selectFrom('kpi_library')
          .select('id')
          .where('id', '=', goal.kpiId)
          .where('company_id', '=', appraisal.company_id)
          .where('is_active', '=', true)
          .executeTakeFirst();
        if (!kpi) throw new NotFoundException(MSG.KPI_NOT_FOUND);
      }

    await this.db.tx
      .deleteFrom('appraisal_goals')
      .where('appraisal_id', '=', appraisalId)
      .execute();
    for (const goal of dto.goals)
      await this.db.tx
        .insertInto('appraisal_goals')
        .values({
          appraisal_id: appraisalId,
          kpi_id: goal.kpiId ?? null,
          title: goal.title,
          target: goal.target ?? null,
          weight: goal.weight,
        })
        .execute();
    await this.audit.record({
      action: 'appraisal.goals_set',
      entity: 'appraisal',
      entityId: appraisalId,
      after: { goals: dto.goals.length },
    });
    return this.get(appraisalId);
  }

  /** The employee scores their own goals and writes their review. */
  async selfReview(appraisalId: string, dto: SelfReviewDto) {
    const appraisal = await this.find(appraisalId);
    if (appraisal.employee_id !== this.access.current().employeeId)
      throw new ForbiddenException(MSG.APPRAISAL_NOT_MINE);
    this.access.assert('performance.own', {
      companyId: appraisal.company_id,
      employeeId: appraisal.employee_id,
    });
    const cycle = await this.findCycle(appraisal.cycle_id);
    if (!phaseReached(cycle.state, 'self_review'))
      throw new ConflictException(MSG.CYCLE_WRONG_STATE);
    if (appraisal.state !== 'self_review')
      throw new ConflictException(MSG.APPRAISAL_WRONG_STATE);

    for (const score of dto.scores ?? [])
      await this.db.tx
        .updateTable('appraisal_goals')
        .set({ self_score: score.score, self_note: score.note ?? null })
        .where('id', '=', score.goalId)
        .where('appraisal_id', '=', appraisalId)
        .execute();
    await this.db.tx
      .updateTable('appraisals')
      .set({
        self_review: dto.review,
        self_submitted_at: this.clock.now(),
        state: 'manager_review',
      })
      .where('id', '=', appraisalId)
      .execute();
    await this.audit.record({
      action: 'appraisal.self_reviewed',
      entity: 'appraisal',
      entityId: appraisalId,
      after: { scored: (dto.scores ?? []).length },
    });
    return this.get(appraisalId);
  }

  /** The Dept Head scores the goals and gives the rating. */
  async rate(appraisalId: string, dto: RateDto) {
    const appraisal = await this.find(appraisalId);
    await this.assertRate(appraisal);
    if (appraisal.state !== 'manager_review')
      throw new ConflictException(MSG.APPRAISAL_WRONG_STATE);

    for (const score of dto.scores ?? [])
      await this.db.tx
        .updateTable('appraisal_goals')
        .set({ manager_score: score.score, manager_note: score.note ?? null })
        .where('id', '=', score.goalId)
        .where('appraisal_id', '=', appraisalId)
        .execute();
    await this.db.tx
      .updateTable('appraisals')
      .set({
        manager_rating: dto.rating,
        manager_comment: dto.comment,
        manager_submitted_at: this.clock.now(),
        manager_user_id: this.access.current().userId,
        state: 'calibration',
      })
      .where('id', '=', appraisalId)
      .execute();
    await this.audit.record({
      action: 'appraisal.rated',
      entity: 'appraisal',
      entityId: appraisalId,
      after: { rating: dto.rating },
    });
    return this.get(appraisalId);
  }

  /**
   * HR's calibration across departments (spec §6.5). This is the gate the acceptance
   * criterion names: a proposal reads `calibrated_rating`, and nothing else.
   */
  async calibrate(appraisalId: string, dto: CalibrateDto) {
    const appraisal = await this.find(appraisalId);
    this.access.assert('performance.manage', {
      companyId: appraisal.company_id,
    });
    if (!canAppraisalMove(appraisal.state, 'done') && appraisal.state !== 'done')
      throw new ConflictException(MSG.APPRAISAL_WRONG_STATE);
    if (appraisal.manager_rating === null)
      throw new ConflictException(MSG.APPRAISAL_WRONG_STATE);

    await this.db.tx
      .updateTable('appraisals')
      .set({
        calibrated_rating: dto.rating,
        calibration_note: dto.note ?? null,
        calibrated_by: this.access.current().userId,
        calibrated_at: this.clock.now(),
        state: 'done',
      })
      .where('id', '=', appraisalId)
      .execute();
    await this.audit.record({
      action: 'appraisal.calibrated',
      entity: 'appraisal',
      entityId: appraisalId,
      before: { managerRating: appraisal.manager_rating },
      after: { calibratedRating: dto.rating, note: dto.note ?? null },
    });
    return this.get(appraisalId);
  }

  /** The spread of ratings per department, which is what calibration is looking at. */
  async calibrationView(cycleId: string) {
    const cycle = await this.findCycle(cycleId);
    this.access.assert('performance.manage', { companyId: cycle.company_id });
    const rows = await this.db.tx
      .selectFrom('appraisals as a')
      .leftJoin('departments as d', 'd.id', 'a.department_id')
      .select([
        'd.id as department_id',
        'd.name as department_name',
        'a.manager_rating',
        'a.calibrated_rating',
      ])
      .where('a.cycle_id', '=', cycleId)
      .execute();
    const byDepartment = new Map<
      string,
      {
        departmentId: string | null;
        departmentName: string | null;
        counts: Record<string, number>;
        rated: number;
        calibrated: number;
      }
    >();
    for (const row of rows) {
      const key = row.department_id ?? 'none';
      const entry =
        byDepartment.get(key) ??
        {
          departmentId: row.department_id,
          departmentName: row.department_name,
          counts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
          rated: 0,
          calibrated: 0,
        };
      const rating = row.calibrated_rating ?? row.manager_rating;
      if (rating) {
        entry.counts[String(rating)] += 1;
        entry.rated += 1;
      }
      if (row.calibrated_rating) entry.calibrated += 1;
      byDepartment.set(key, entry);
    }
    return {
      cycle: this.toCycle(cycle),
      departments: [...byDepartment.values()],
    };
  }

  // ================================================================ feedback

  /** Continuous feedback about an employee. Anyone who may rate or manage may write it. */
  async addFeedback(employeeId: string, dto: FeedbackDto) {
    const employee = await this.db.tx
      .selectFrom('employees')
      .select(['id', 'company_id'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    if (!employee) throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    if (!dto.body.trim()) throw new BadRequestException(MSG.FEEDBACK_EMPTY);
    const resource = await this.resourceOf(employee.company_id, employeeId);
    if (
      !this.access.allows('performance.rate', resource) &&
      !this.access.allows('performance.manage', resource) &&
      !this.access.allows('performance.view', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);

    await this.db.tx
      .insertInto('feedback_notes')
      .values({
        company_id: employee.company_id,
        employee_id: employeeId,
        body: dto.body,
        kind: dto.kind ?? 'note',
        shared_with_employee: dto.sharedWithEmployee ?? false,
      })
      .execute();
    await this.audit.record({
      action: 'feedback.added',
      entity: 'employee',
      entityId: employeeId,
      after: { kind: dto.kind ?? 'note', shared: !!dto.sharedWithEmployee },
    });
    return this.feedback(employeeId);
  }

  /**
   * The feedback about an employee. The employee themself sees only the notes shared with
   * them; their manager, HR and the Admin see all of it.
   */
  async feedback(employeeId: string, opts: { since?: string } = {}) {
    const employee = await this.db.tx
      .selectFrom('employees')
      .select(['id', 'company_id'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    if (!employee) throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    const resource = await this.resourceOf(employee.company_id, employeeId);
    const isMine = this.access.current().employeeId === employeeId;
    const full =
      this.access.allows('performance.view', resource) ||
      this.access.allows('performance.manage', resource) ||
      this.access.allows('performance.rate', resource);
    if (!full && !(isMine && this.access.allows('performance.own', resource)))
      throw new ForbiddenException(MSG.FORBIDDEN);

    let q = this.db.tx
      .selectFrom('feedback_notes')
      .select([
        'id',
        'body',
        'kind',
        'shared_with_employee',
        'author_user_id',
        'created_at',
      ])
      .where('employee_id', '=', employeeId)
      .orderBy('created_at', 'desc')
      .limit(200);
    if (!full) q = q.where('shared_with_employee', '=', true);
    if (opts.since) q = q.where('created_at', '>=', new Date(opts.since));
    const rows = await q.execute();
    return {
      notes: rows.map((n) => ({
        id: n.id,
        body: n.body,
        kind: n.kind,
        sharedWithEmployee: n.shared_with_employee,
        authorUserId: full ? n.author_user_id : null,
        at: n.created_at,
      })),
    };
  }

  // ================================================================= helpers

  async find(appraisalId: string): Promise<Appraisal> {
    const appraisal = await this.db.tx
      .selectFrom('appraisals')
      .selectAll()
      .where('id', '=', appraisalId)
      .executeTakeFirst();
    if (!appraisal) throw new NotFoundException(MSG.APPRAISAL_NOT_FOUND);
    return appraisal;
  }

  async findCycle(cycleId: string): Promise<AppraisalCycle> {
    const cycle = await this.db.tx
      .selectFrom('appraisal_cycles')
      .selectAll()
      .where('id', '=', cycleId)
      .executeTakeFirst();
    if (!cycle) throw new NotFoundException(MSG.CYCLE_NOT_FOUND);
    return cycle;
  }

  async goalsOf(appraisalId: string) {
    const rows = await this.db.tx
      .selectFrom('appraisal_goals as g')
      .leftJoin('kpi_library as k', 'k.id', 'g.kpi_id')
      .select([
        'g.id',
        'g.kpi_id',
        'g.title',
        'g.target',
        'g.weight',
        'g.self_score',
        'g.self_note',
        'g.manager_score',
        'g.manager_note',
        'k.code as kpi_code',
        'k.measure',
      ])
      .where('g.appraisal_id', '=', appraisalId)
      .orderBy('g.weight', 'desc')
      .execute();
    return rows.map((g) => ({
      id: g.id,
      kpiId: g.kpi_id,
      kpiCode: g.kpi_code,
      measure: g.measure,
      title: g.title,
      target: g.target,
      weight: g.weight,
      selfScore: g.self_score,
      selfNote: g.self_note,
      managerScore: g.manager_score,
      managerNote: g.manager_note,
    }));
  }

  /**
   * The access resource of one employee: their company, their current department and
   * themself. Without the department a Dept Head's department-scoped grant can never
   * match, and they are exactly the person who writes feedback about their own people.
   */
  private async resourceOf(companyId: string, employeeId: string) {
    const placement = await this.directory.currentOrFirstPlacement(employeeId);
    return {
      companyId,
      departmentId: placement?.departmentId,
      employeeId,
    };
  }

  /** Who may write goals and rate: the recorded manager, or HR. */
  private async assertRate(appraisal: Appraisal) {
    const resource = {
      companyId: appraisal.company_id,
      departmentId: appraisal.department_id ?? undefined,
      employeeId: appraisal.employee_id,
    };
    if (this.access.allows('performance.manage', resource)) return;
    const me = this.access.current().employeeId;
    if (
      me &&
      appraisal.manager_employee_id === me &&
      this.access.current().has('performance.rate')
    )
      return;
    throw new ForbiddenException(MSG.APPRAISAL_NOT_MINE);
  }

  async assertSeeAppraisal(appraisal: Appraisal) {
    const resource = {
      companyId: appraisal.company_id,
      departmentId: appraisal.department_id ?? undefined,
      employeeId: appraisal.employee_id,
    };
    const me = this.access.current().employeeId;
    if (
      this.access.allows('performance.view', resource) ||
      this.access.allows('performance.manage', resource) ||
      (me === appraisal.employee_id &&
        this.access.allows('performance.own', resource)) ||
      (me &&
        appraisal.manager_employee_id === me &&
        this.access.current().has('performance.rate'))
    )
      return;
    throw new ForbiddenException(MSG.FORBIDDEN);
  }

  /**
   * May this user see this company's appraisals at all, and whose?
   *
   * `{ all: true }` for a company-wide grant (Admin, HR, an auditor). A Dept
   * Head holds performance.view and performance.rate over their department, so
   * a question asked about the company alone is false for them by design
   * (access-grants.spec.ts pins that); they are answered for the departments
   * they lead instead. An employee's own appraisal has its own route.
   */
  private async assertSee(companyId: string): Promise<PerformanceScope> {
    const resource = { companyId };
    if (
      this.access.allows('performance.view', resource) ||
      this.access.allows('performance.manage', resource) ||
      this.access.allows('performance.rate', resource) ||
      this.access.allows('performance.own', resource)
    )
      return { all: true, departmentIds: [], employeeIds: [] };
    const granted = [
      ...new Set(
        (['performance.view', 'performance.rate', 'performance.manage'] as const)
          .map((k) => this.access.scopeFilter(k))
          .flatMap((f) => (f.all ? [] : f.departmentIds)),
      ),
    ];
    // their departments, of THIS company: a cycle belongs to the company, so a
    // head of another company must not pass this gate and read its cycles
    const departmentIds = await this.org.departmentsOfCompany(
      companyId,
      granted,
    );
    // An employee holds performance.own over themself. They reach their own
    // appraisal through the cycle, so they are let in and shown that one row —
    // the appraisal is theirs, and the cycle's name and dates are the company's
    // own calendar, which they are being appraised against.
    const own = this.access.scopeFilter('performance.own');
    const employeeIds =
      !departmentIds.length && !own.all
        ? await this.ownAppraisalEmployees(companyId, own.employeeIds)
        : [];
    if (!departmentIds.length && !employeeIds.length)
      throw new ForbiddenException(MSG.FORBIDDEN);
    return { all: false, departmentIds, employeeIds };
  }

  /** Of these employees, the ones employed by this company (never another's). */
  private async ownAppraisalEmployees(
    companyId: string,
    employeeIds: string[],
  ): Promise<string[]> {
    if (!employeeIds.length) return [];
    const rows = await this.db.tx
      .selectFrom('employees')
      .select('id')
      .where('company_id', '=', companyId)
      .where('id', 'in', employeeIds)
      .execute();
    return rows.map((r) => r.id);
  }

  private async counts(
    cycleIds: string[],
    scope: PerformanceScope,
  ): Promise<Map<string, number>> {
    if (!cycleIds.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('appraisals')
      .select(['cycle_id', (eb) => eb.fn.countAll<string>().as('n')])
      .where('cycle_id', 'in', cycleIds)
      // a Dept Head is told how many of their own people are in the cycle, an
      // employee about their own appraisal — not how many the company has
      .$if(!scope.all, (qb) =>
        qb.where((eb) =>
          eb.or([
            ...(scope.departmentIds.length
              ? [eb('department_id', 'in', scope.departmentIds)]
              : []),
            ...(scope.employeeIds.length
              ? [eb('employee_id', 'in', scope.employeeIds)]
              : []),
          ]),
        ),
      )
      .groupBy('cycle_id')
      .execute();
    return new Map(rows.map((r) => [r.cycle_id, Number(r.n)]));
  }

  private toCycle(c: AppraisalCycle) {
    return {
      id: c.id,
      companyId: c.company_id,
      name: c.name,
      kind: c.kind,
      periodFrom: c.period_from,
      periodTo: c.period_to,
      state: c.state,
      incrementFrom: c.increment_from,
      note: c.note,
      createdAt: c.created_at,
      version: c.version,
    };
  }

  today() {
    return todayInDhaka(this.clock.now());
  }
}
