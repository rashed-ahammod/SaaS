/**
 * The manpower plan (WP29; spec §5: a new-position request is "checked against an approved
 * manpower plan").
 *
 *   plan(companyId, fy)       the plan with its lines, and how many posts are already used
 *   savePlan / addLine        HR or the Admin prepares it while it is a draft
 *   approve(planId)           the Admin approves it; after that it is not edited
 *   check(...)                what a position request records: is this post in the plan, and
 *                             how much of it is left. A request outside the plan is NOT
 *                             refused — the approvers are told, and they decide.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  fiscalYearOf,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { RecruitmentAccess } from './recruitment-access.js';
import type { PlanDto } from './dto/recruitment.dto.js';

export interface PlanCheck {
  withinPlan: boolean;
  detail: {
    planned: number | null;
    /** approved or open position requests against the same plan line */
    requested: number;
    /** people already in that department and designation */
    filled: number;
    left: number | null;
    fiscalYear: string;
    reason: string;
  };
}

@Injectable()
export class ManpowerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly scope: RecruitmentAccess,
  ) {}

  fiscalYear(): string {
    return fiscalYearOf(todayInDhaka(this.clock.now()), '07-01');
  }

  async plan(companyId: string, fiscalYear?: string) {
    await this.org.assertCompanyExists(companyId);
    // A Dept Head's grant is held over their department, so asking about the
    // company refused them the plan their own position requests are checked
    // against. They see their own departments' lines, and nobody else's.
    const scope = await this.scope.departmentScope(companyId);
    const fy = fiscalYear ?? this.fiscalYear();
    const plan = await this.db.tx
      .selectFrom('manpower_plans')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('fiscal_year_code', '=', fy)
      .executeTakeFirst();
    if (!plan) return { fiscalYear: fy, plan: null, lines: [] };
    const lines = await this.db.tx
      .selectFrom('manpower_plan_lines as l')
      .innerJoin('departments as d', 'd.id', 'l.department_id')
      .innerJoin('designations as g', 'g.id', 'l.designation_id')
      .select([
        'l.id',
        'l.department_id',
        'l.designation_id',
        'l.headcount',
        'd.name as department_name',
        'g.name_en as designation_name',
      ])
      .where('l.plan_id', '=', plan.id)
      .$if(!scope.all, (qb) =>
        qb.where('l.department_id', 'in', scope.departmentIds),
      )
      .orderBy('d.name')
      .execute();
    const used = await Promise.all(
      lines.map((l) => this.usage(companyId, l.department_id, l.designation_id)),
    );
    return {
      fiscalYear: fy,
      plan: {
        id: plan.id,
        state: plan.state,
        note: plan.note,
        approvedAt: plan.approved_at,
        approvedBy: plan.approved_by,
        version: plan.version,
      },
      lines: lines.map((l, i) => ({
        id: l.id,
        departmentId: l.department_id,
        departmentName: l.department_name,
        designationId: l.designation_id,
        designationName: l.designation_name,
        headcount: l.headcount,
        filled: used[i].filled,
        requested: used[i].requested,
        left: l.headcount - used[i].filled - used[i].requested,
      })),
    };
  }

  /** Create or replace the draft plan of a fiscal year with these lines. */
  async savePlan(companyId: string, dto: PlanDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('recruitment.plan', { companyId });
    const fy = dto.fiscalYear ?? this.fiscalYear();
    const existing = await this.db.tx
      .selectFrom('manpower_plans')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('fiscal_year_code', '=', fy)
      .executeTakeFirst();
    if (existing?.state === 'approved')
      throw new ConflictException(MSG.MANPOWER_PLAN_FINAL);

    const plan =
      existing ??
      (await this.db.tx
        .insertInto('manpower_plans')
        .values({
          company_id: companyId,
          fiscal_year_code: fy,
          note: dto.note ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow());
    if (existing)
      await this.db.tx
        .updateTable('manpower_plans')
        .set({ note: dto.note ?? existing.note })
        .where('id', '=', plan.id)
        .execute();

    await this.db.tx
      .deleteFrom('manpower_plan_lines')
      .where('plan_id', '=', plan.id)
      .execute();
    for (const line of dto.lines) {
      await this.org.assertPlacement(companyId, {
        departmentId: line.departmentId,
        designationId: line.designationId,
      });
      await this.db.tx
        .insertInto('manpower_plan_lines')
        .values({
          plan_id: plan.id,
          department_id: line.departmentId,
          designation_id: line.designationId,
          headcount: line.headcount,
        })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'plan_id', 'department_id', 'designation_id'])
            .doUpdateSet({ headcount: line.headcount }),
        )
        .execute();
    }
    await this.audit.record({
      action: 'manpower_plan.saved',
      entity: 'manpower_plan',
      entityId: plan.id,
      after: { fiscalYear: fy, lines: dto.lines.length },
    });
    return this.plan(companyId, fy);
  }

  async approve(planId: string) {
    const plan = await this.db.tx
      .selectFrom('manpower_plans')
      .selectAll()
      .where('id', '=', planId)
      .executeTakeFirst();
    if (!plan) throw new NotFoundException(MSG.MANPOWER_PLAN_NOT_FOUND);
    this.access.assert('recruitment.plan', { companyId: plan.company_id });
    if (plan.state === 'approved')
      throw new ConflictException(MSG.MANPOWER_PLAN_FINAL);
    await this.db.tx
      .updateTable('manpower_plans')
      .set({
        state: 'approved',
        approved_at: this.clock.now(),
        approved_by: this.access.current().userId,
      })
      .where('id', '=', planId)
      .execute();
    await this.audit.record({
      action: 'manpower_plan.approved',
      entity: 'manpower_plan',
      entityId: planId,
      after: { fiscalYear: plan.fiscal_year_code },
    });
    return this.plan(plan.company_id, plan.fiscal_year_code);
  }

  /**
   * The check a position request carries. No plan at all, or no line for this post, is
   * "outside the plan": the request still goes to the approvers, who see exactly that.
   */
  async check(
    companyId: string,
    departmentId: string,
    designationId: string,
    headcount: number,
  ): Promise<PlanCheck> {
    const fy = this.fiscalYear();
    const plan = await this.db.tx
      .selectFrom('manpower_plans')
      .select(['id', 'state'])
      .where('company_id', '=', companyId)
      .where('fiscal_year_code', '=', fy)
      .where('state', '=', 'approved')
      .executeTakeFirst();
    const usage = await this.usage(companyId, departmentId, designationId);
    if (!plan)
      return {
        withinPlan: false,
        detail: {
          planned: null,
          requested: usage.requested,
          filled: usage.filled,
          left: null,
          fiscalYear: fy,
          reason: `No approved manpower plan for ${fy}`,
        },
      };
    const line = await this.db.tx
      .selectFrom('manpower_plan_lines')
      .select('headcount')
      .where('plan_id', '=', plan.id)
      .where('department_id', '=', departmentId)
      .where('designation_id', '=', designationId)
      .executeTakeFirst();
    if (!line)
      return {
        withinPlan: false,
        detail: {
          planned: 0,
          requested: usage.requested,
          filled: usage.filled,
          left: 0,
          fiscalYear: fy,
          reason: `The ${fy} plan has no post of this designation in this department`,
        },
      };
    const left = line.headcount - usage.filled - usage.requested;
    return {
      withinPlan: left >= headcount,
      detail: {
        planned: line.headcount,
        requested: usage.requested,
        filled: usage.filled,
        left,
        fiscalYear: fy,
        reason:
          left >= headcount
            ? `${left} of ${line.headcount} planned post(s) still open`
            : `Only ${Math.max(left, 0)} of ${line.headcount} planned post(s) left, ${headcount} asked for`,
      },
    };
  }

  /** How much of a plan line is taken: people in post, plus posts already requested. */
  private async usage(
    companyId: string,
    departmentId: string,
    designationId: string,
  ): Promise<{ filled: number; requested: number }> {
    const today = todayInDhaka(this.clock.now());
    const filled = await this.db.tx
      .selectFrom('employee_assignments as a')
      .innerJoin('employees as e', 'e.id', 'a.employee_id')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('e.company_id', '=', companyId)
      .where('e.status', 'in', ['draft', 'probation', 'active', 'notice'])
      .where('a.department_id', '=', departmentId)
      .where('a.designation_id', '=', designationId)
      .where('a.effective_from', '<=', today)
      .where((eb) =>
        eb.or([
          eb('a.effective_to', 'is', null),
          eb('a.effective_to', '>', today),
        ]),
      )
      .executeTakeFirst();
    const requested = await this.db.tx
      .selectFrom('position_requests')
      .select((eb) => eb.fn.sum<string>('headcount').as('n'))
      .where('company_id', '=', companyId)
      .where('department_id', '=', departmentId)
      .where('designation_id', '=', designationId)
      .where('state', 'in', ['in_approval', 'approved', 'opened'])
      .executeTakeFirst();
    return {
      filled: Number(filled?.n ?? 0),
      requested: Number(requested?.n ?? 0),
    };
  }
}
