/**
 * The pipeline board, the weighted forecast and sales targets (Phase 3 WP24; spec §6.8 step 3
 * "pipeline board; weighted forecast; targets per user / department / month").
 *
 *   board(company)        the open opportunities by stage (count, value, weighted value),
 *                         and what was won and lost this month
 *   forecast(company)     open opportunities by expected close month, owner and stage:
 *                         weighted = Σ value × probability / 100, rounded to the paisa once on
 *                         the total; open ones already past their close date are shown apart
 *                         ("late"), and what was won in each month beside it
 *   targets(company, month)    each salesperson's and department's target, what they won that
 *                         month (opportunities won with a close date in the month; a department
 *                         counts its sub-departments) and the weighted value still expected to
 *                         close in it
 *   setTargets            Sales head for the department's salespeople; Admin for anyone and for
 *                         departments
 *
 * Everything runs within the viewer's scope: own (Sales user), department (Sales head), company.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { OpportunityState } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { CrmAccess, type ListScope } from './crm-access.js';
import { monthEnd, monthsBetween } from './crm-rules.js';
import type {
  ForecastQueryDto,
  PipelineQueryDto,
  SetTargetsDto,
} from './dto/opportunities.dto.js';
import { OpportunitiesService, weightOf } from './opportunities.service.js';

type Row = { value: string; probability: number };

/** Count, value and weighted value of some opportunities. */
export function totalsOf(rows: Row[]) {
  return {
    count: rows.length,
    value: rows.reduce((a, r) => a.plus(r.value), Money.of('0')).toDb(),
    weighted: rows
      .reduce((a, r) => a.plus(weightOf(r)), Money.of('0'))
      .round()
      .toDb(),
  };
}

const sumValue = (rows: Row[]) =>
  rows.reduce((a, r) => a.plus(r.value), Money.of('0'));

@Injectable()
export class SalesPipelineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly crm: CrmAccess,
    private readonly opportunities: OpportunitiesService,
  ) {}

  async board(companyId: string, filter: PipelineQueryDto) {
    await this.org.assertCompanyExists(companyId);
    await this.opportunities.ensureStages(companyId);
    const scope = await this.crm.listScope(companyId);
    const month = todayInDhaka(this.clock.now()).slice(0, 7);
    const stages = await this.db.tx
      .selectFrom('opportunity_stages')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .orderBy('name')
      .execute();
    const open = await this.rows(companyId, scope, filter, { state: 'open' });
    const won = await this.rows(companyId, scope, filter, {
      state: 'won',
      closedFrom: `${month}-01`,
      closedTo: monthEnd(month),
    });
    const lost = await this.rows(companyId, scope, filter, {
      state: 'lost',
      closedFrom: `${month}-01`,
      closedTo: monthEnd(month),
    });
    return {
      month,
      stages: stages.map((s) => {
        const here = open.filter((o) => o.stage_id === s.id);
        return {
          id: s.id,
          name: s.name,
          nameBn: s.name_bn,
          probability: s.probability,
          ...totalsOf(here),
          opportunities: here.map((o) => ({
            id: o.id,
            number: o.number,
            title: o.title,
            customer: `${o.customer_code} · ${o.customer_name}`,
            ownerName: o.owner_name ?? o.owner_email,
            value: o.value,
            probability: o.probability,
            weighted: weightOf(o).round().toDb(),
            expectedCloseOn: o.expected_close_on,
            late: o.expected_close_on < todayInDhaka(this.clock.now()),
          })),
        };
      }),
      open: totalsOf(open),
      wonThisMonth: totalsOf(won),
      lostThisMonth: totalsOf(lost),
    };
  }

  async forecast(companyId: string, q: ForecastQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const months = monthsBetween(q.from, q.to);
    if (!months.length || months.length > 24)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: ['from must not be after to, and at most 24 months'],
        },
      });
    const scope = await this.crm.listScope(companyId);
    const start = `${q.from}-01`;
    const end = monthEnd(q.to);
    const open = await this.rows(companyId, scope, q, {
      state: 'open',
      expectedTo: end,
    });
    const inWindow = open.filter((o) => o.expected_close_on >= start);
    const late = open.filter((o) => o.expected_close_on < start);
    const won = await this.rows(companyId, scope, q, {
      state: 'won',
      closedFrom: start,
      closedTo: end,
    });
    const stageNames = new Map(
      (
        await this.db.tx
          .selectFrom('opportunity_stages')
          .select(['id', 'name', 'name_bn', 'sort_order'])
          .where('company_id', '=', companyId)
          .execute()
      ).map((s) => [s.id, s]),
    );

    const group = <K extends string>(
      rows: typeof inWindow,
      key: (o: (typeof inWindow)[number]) => K,
    ) => {
      const map = new Map<K, typeof inWindow>();
      for (const o of rows) map.set(key(o), [...(map.get(key(o)) ?? []), o]);
      return map;
    };
    const byOwner = group(inWindow, (o) => o.owner_id);
    const byStage = group(inWindow, (o) => o.stage_id);
    return {
      from: q.from,
      to: q.to,
      months: months.map((m) => ({
        month: m,
        ...totalsOf(inWindow.filter((o) => o.expected_close_on.startsWith(m))),
        won: sumValue(won.filter((o) => o.closed_on!.startsWith(m))).toDb(),
      })),
      byOwner: [...byOwner.entries()]
        .map(([ownerId, rows]) => ({
          ownerId,
          name: rows[0].owner_name ?? rows[0].owner_email,
          ...totalsOf(rows),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      byStage: [...byStage.entries()]
        .map(([stageId, rows]) => ({
          stageId,
          name: stageNames.get(stageId)?.name ?? '',
          nameBn: stageNames.get(stageId)?.name_bn ?? null,
          order: stageNames.get(stageId)?.sort_order ?? 0,
          ...totalsOf(rows),
        }))
        .sort((a, b) => a.order - b.order),
      total: totalsOf(inWindow),
      late: totalsOf(late),
      won: sumValue(won).toDb(),
    };
  }

  async targets(companyId: string, month: string) {
    await this.org.assertCompanyExists(companyId);
    const scope = await this.crm.listScope(companyId);
    const start = `${month}-01`;
    const end = monthEnd(month);
    const targets = await this.db.tx
      .selectFrom('sales_targets')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('month', '=', start)
      .execute();
    const sees = (userId: string) =>
      scope.all || scope.ownerIds.includes(userId);

    const people = new Set(
      (await this.crm.salespeople(companyId)).filter(sees),
    );
    targets.forEach(
      (t) => t.user_id && sees(t.user_id) && people.add(t.user_id),
    );
    const won = await this.rows(
      companyId,
      scope,
      {},
      { state: 'won', closedFrom: start, closedTo: end },
    );
    const open = (
      await this.rows(companyId, scope, {}, { state: 'open', expectedTo: end })
    ).filter((o) => o.expected_close_on >= start);

    // departments with a target this month, that the viewer may see (Admin: all; Sales head: theirs)
    const view = this.access.scopeFilter('crm.view');
    const deptOf = new Map<string, string | undefined>();
    for (const u of people)
      deptOf.set(
        u,
        (await this.crm.resourceOf(companyId, u)).departmentId ?? undefined,
      );
    const departments = targets
      .map((t) => t.department_id)
      .filter(
        (d): d is string =>
          !!d && (scope.all || view.all || view.departmentIds.includes(d)),
      );
    // a department's sales are those of its sub-departments too
    const subtree = new Map<string, string[]>();
    for (const d of departments)
      subtree.set(d, await this.org.departmentWithDescendants(d));

    const names = await this.userNames([...people]);
    const deptNames = (await this.org.names({ departmentIds: departments }))
      .departments;
    const line = (amount: string | null, wonRows: Row[], openRows: Row[]) => {
      const w = sumValue(wonRows);
      return {
        amount,
        won: w.toDb(),
        expected: totalsOf(openRows).weighted,
        attainment:
          amount && Money.of(amount).isPositive()
            ? Math.round((Number(w.toDb()) * 1000) / Number(amount)) / 10
            : null,
      };
    };
    const rows = [];
    for (const userId of people) {
      const t = targets.find((x) => x.user_id === userId);
      rows.push({
        kind: 'user' as const,
        userId,
        departmentId: deptOf.get(userId) ?? null,
        name: names.get(userId) ?? userId,
        targetId: t?.id ?? null,
        version: t?.version ?? null,
        ...line(
          t?.amount ?? null,
          won.filter((o) => o.owner_id === userId),
          open.filter((o) => o.owner_id === userId),
        ),
        canSet: await this.crm.assertAssign(companyId, userId).then(
          () => true,
          () => false,
        ),
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const deptRows = departments.map((departmentId) => {
      const t = targets.find((x) => x.department_id === departmentId);
      return {
        kind: 'department' as const,
        userId: null,
        departmentId,
        name: deptNames.get(departmentId)?.name ?? departmentId,
        targetId: t?.id ?? null,
        version: t?.version ?? null,
        ...line(
          t?.amount ?? null,
          won.filter((o) =>
            subtree.get(departmentId)!.includes(o.department_id ?? ''),
          ),
          open.filter((o) =>
            subtree.get(departmentId)!.includes(o.department_id ?? ''),
          ),
        ),
        canSet: this.access.allows('crm.manage', { companyId, departmentId }),
      };
    });
    return {
      month,
      rows: [...deptRows.sort((a, b) => a.name.localeCompare(b.name)), ...rows],
    };
  }

  async setTargets(companyId: string, dto: SetTargetsDto) {
    await this.org.assertCompanyExists(companyId);
    const month = `${dto.month}-01`;
    for (const t of dto.targets) {
      if (!!t.userId === !!t.departmentId)
        throw new BadRequestException(MSG.TARGET_INVALID);
      if (t.userId) {
        await this.crm.assertSalesperson(companyId, t.userId);
        await this.crm.assertAssign(companyId, t.userId);
      } else {
        if ((await this.org.companyOfDepartment(t.departmentId!)) !== companyId)
          throw new BadRequestException(MSG.TARGET_INVALID);
        this.access.assert('crm.manage', {
          companyId,
          departmentId: t.departmentId,
        });
      }
      const amount = Money.of(t.amount).toDb();
      let existing = this.db.tx
        .selectFrom('sales_targets')
        .selectAll()
        .where('company_id', '=', companyId)
        .where('month', '=', month);
      existing = t.userId
        ? existing.where('user_id', '=', t.userId)
        : existing.where('department_id', '=', t.departmentId!);
      const before = await existing.executeTakeFirst();
      if (before && Money.of(before.amount).equals(amount)) continue;
      const row = before
        ? await this.db.tx
            .updateTable('sales_targets')
            .set({ amount })
            .where('id', '=', before.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await this.db.tx
            .insertInto('sales_targets')
            .values({
              company_id: companyId,
              month,
              user_id: t.userId ?? null,
              department_id: t.departmentId ?? null,
              amount,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
      await this.audit.record({
        action: 'sales_target.set',
        entity: 'sales_target',
        entityId: row.id,
        before: before ? { amount: before.amount } : undefined,
        after: {
          month: dto.month,
          userId: t.userId ?? null,
          departmentId: t.departmentId ?? null,
          amount,
        },
      });
    }
    return this.targets(companyId, dto.month);
  }

  // ================================================================ internals

  private async rows(
    companyId: string,
    scope: ListScope,
    f: PipelineQueryDto,
    only: {
      state: OpportunityState;
      closedFrom?: string;
      closedTo?: string;
      expectedTo?: string;
    },
  ) {
    let q = this.db.tx
      .selectFrom('opportunities as o')
      .innerJoin('customers as c', 'c.id', 'o.customer_id')
      .innerJoin('users as u', 'u.id', 'o.owner_id')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .selectAll('o')
      .select([
        'c.code as customer_code',
        'c.name as customer_name',
        'e.full_name_en as owner_name',
        'u.email as owner_email',
      ])
      .where('o.company_id', '=', companyId)
      .where('o.state', '=', only.state);
    if (!scope.all) q = q.where('o.owner_id', 'in', scope.ownerIds);
    if (f.ownerId) q = q.where('o.owner_id', '=', f.ownerId);
    if (f.departmentId) q = q.where('o.department_id', '=', f.departmentId);
    if (only.closedFrom) q = q.where('o.closed_on', '>=', only.closedFrom);
    if (only.closedTo) q = q.where('o.closed_on', '<=', only.closedTo);
    if (only.expectedTo)
      q = q.where('o.expected_close_on', '<=', only.expectedTo);
    return q.orderBy('o.expected_close_on').orderBy('o.number').execute();
  }

  private async userNames(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const rows = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select(['u.id', 'u.email', 'e.full_name_en'])
      .where('u.id', 'in', ids)
      .execute();
    return new Map(rows.map((r) => [r.id, r.full_name_en ?? r.email]));
  }
}
