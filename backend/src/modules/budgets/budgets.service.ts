/**
 * Budgets (WP18; spec §6.6, §4 "Budgets: Admin A, Accounts F, Dept Head V (dept),
 * request change").
 *
 *   draft --submit--> in_approval (Admin) --approved--> approved
 *   returned -> draft; rejected or withdrawn -> cancelled; a draft can be cancelled
 *
 * An approved budget changes only through a revision: Accounts, or the Dept Head for
 * their department, asks for new yearly amounts (with a reason); the Admin approves;
 * the lines change (database guard: only with the revision flag set).
 *
 * Alerts (worker): once a line or the department total reaches the warning percent
 * (80) or 100 %, one budget.threshold_reached event per level; notifications tell the
 * Dept Head, and at 100 % the Admin too.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ApprovalRequest, Budget } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { levelsReached, position, type Position } from './budget-math.js';
import { BudgetPositionService } from './budget-position.service.js';
import type {
  BudgetLineDto,
  BudgetQueryDto,
  BudgetRevisionDto,
  BudgetSettingsDto,
  CreateBudgetDto,
  UpdateBudgetDto,
} from './dto/budgets.dto.js';

export const BUDGET_REQUEST = 'budget';
export const BUDGET_REVISION_REQUEST = 'budget_revision';

@Injectable()
export class BudgetsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly positions: BudgetPositionService,
  ) {}

  onModuleInit() {
    this.handlers.register(
      BUDGET_REQUEST,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
        distinctApprovers: true,
      },
      [defaultChain('Budget (default)', step(1, 'role:admin'))],
    );
    this.handlers.register(
      BUDGET_REVISION_REQUEST,
      {
        onApproved: (r) => this.revisionApproved(r),
        onClosed: (r, outcome) => this.revisionClosed(r, outcome),
        distinctApprovers: true,
      },
      [defaultChain('Budget change (default)', step(1, 'role:admin'))],
    );
  }

  // ================================================================ settings

  async getSettings(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    // the warning level is no secret: any budget reader (a Dept Head sees it on the budget page)
    if (
      !this.access.current().has('budgets.view') &&
      !this.access.current().has('budgets.manage')
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    return this.positions.settings(companyId);
  }

  async saveSettings(companyId: string, dto: BudgetSettingsDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('budgets.manage', { companyId });
    const before = await this.positions.settings(companyId);
    const values = {
      warning_percent: dto.warningPercent ?? before.warningPercent,
      no_budget_needs_admin:
        dto.noBudgetNeedsAdmin ?? before.noBudgetNeedsAdmin,
    };
    await this.db.tx
      .insertInto('budget_settings')
      .values({ company_id: companyId, ...values })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id'])
          .doUpdateSet({ ...values, updated_at: new Date() }),
      )
      .execute();
    await this.audit.record({
      action: 'budget.settings_saved',
      entity: 'company',
      entityId: companyId,
      before,
      after: dto,
    });
    return this.positions.settings(companyId);
  }

  // ================================================================ budgets (Accounts)

  async create(companyId: string, dto: CreateBudgetDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('budgets.manage', { companyId });
    await this.positions.fiscalYear(companyId, dto.fiscalYear); // valid year
    const department = await this.db.tx
      .selectFrom('departments')
      .select(['id', 'company_id'])
      .where('id', '=', dto.departmentId)
      .executeTakeFirst();
    if (!department || department.company_id !== companyId)
      throw new NotFoundException(MSG.DEPARTMENT_NOT_FOUND);
    const clash = await this.db.tx
      .selectFrom('budgets')
      .select('id')
      .where('company_id', '=', companyId)
      .where('fiscal_year_code', '=', dto.fiscalYear)
      .where('department_id', '=', dto.departmentId)
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    if (clash)
      throw new ConflictException({
        message: MSG.BUDGET_EXISTS,
        details: { budgetId: clash.id },
      });
    await this.assertAccounts(companyId, dto.lines);

    const budget = await this.db.tx
      .insertInto('budgets')
      .values({
        company_id: companyId,
        fiscal_year_code: dto.fiscalYear,
        department_id: dto.departmentId,
        note: dto.note ?? null,
        total: total(dto.lines),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('budget_lines')
      .values(
        dto.lines.map((l) => ({
          budget_id: budget.id,
          account_id: l.accountId,
          amount: Money.of(l.amount).toDb(),
        })),
      )
      .execute();
    await this.audit.record({
      action: 'budget.created',
      entity: 'budget',
      entityId: budget.id,
      after: {
        fiscalYear: dto.fiscalYear,
        departmentId: dto.departmentId,
        total: budget.total,
      },
    });
    return this.get(budget.id);
  }

  async update(id: string, dto: UpdateBudgetDto) {
    const b = await this.find(id);
    this.access.assert('budgets.manage', { companyId: b.company_id });
    if (b.state !== 'draft')
      throw new ConflictException(MSG.BUDGET_WRONG_STATE);
    if (b.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    if (dto.lines) {
      await this.assertAccounts(b.company_id, dto.lines);
      await this.db.tx
        .deleteFrom('budget_lines')
        .where('budget_id', '=', id)
        .execute();
      await this.db.tx
        .insertInto('budget_lines')
        .values(
          dto.lines.map((l) => ({
            budget_id: id,
            account_id: l.accountId,
            amount: Money.of(l.amount).toDb(),
          })),
        )
        .execute();
    }
    await this.db.tx
      .updateTable('budgets')
      .set({
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.lines ? { total: total(dto.lines) } : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'budget.updated',
      entity: 'budget',
      entityId: id,
      after: dto,
    });
    return this.get(id);
  }

  async submit(id: string) {
    const b = await this.find(id);
    this.access.assert('budgets.manage', { companyId: b.company_id });
    if (b.state !== 'draft')
      throw new ConflictException(MSG.BUDGET_WRONG_STATE);
    const department = await this.db.tx
      .selectFrom('departments')
      .select(['name', 'code'])
      .where('id', '=', b.department_id)
      .executeTakeFirstOrThrow();
    const lines = await this.linesWithNames(id);
    const request = await this.approvals.submit({
      requestType: BUDGET_REQUEST,
      sourceId: id,
      subjectEmployeeId: null,
      companyId: b.company_id,
      amount: b.total,
      summary: `Budget ${b.fiscal_year_code}: ${department.name}, Tk ${b.total}`,
      snapshot: {
        fiscalYear: b.fiscal_year_code,
        department: `${department.code} ${department.name}`,
        total: b.total,
        note: b.note,
        lines: lines
          .map((l) => `${l.code} ${l.name_en}: Tk ${l.amount}`)
          .join('; '),
      },
    });
    await this.db.tx
      .updateTable('budgets')
      .set({ state: 'in_approval', approval_request_id: request.id })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'budget.submitted',
      entity: 'budget',
      entityId: id,
      after: { approvalRequestId: request.id },
    });
    return this.get(id);
  }

  async cancel(id: string, reason: string) {
    const b = await this.find(id);
    this.access.assert('budgets.manage', { companyId: b.company_id });
    if (b.state !== 'draft')
      throw new ConflictException(MSG.BUDGET_WRONG_STATE);
    await this.db.tx
      .updateTable('budgets')
      .set({ state: 'cancelled', cancel_reason: reason })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'budget.cancelled',
      entity: 'budget',
      entityId: id,
      after: { reason },
    });
    return this.get(id);
  }

  private async approved(request: ApprovalRequest) {
    await this.db.tx
      .updateTable('budgets')
      .set({ state: 'approved', approved_at: new Date() })
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: 'budget.approved',
      entity: 'budget',
      entityId: request.source_id,
      after: { approvalRequestId: request.id },
    });
  }

  private async closed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    await this.db.tx
      .updateTable('budgets')
      .set(
        outcome === 'returned'
          ? { state: 'draft', approval_request_id: null }
          : {
              state: 'cancelled',
              cancel_reason:
                outcome === 'rejected' ? 'Rejected by the Admin' : 'Withdrawn',
            },
      )
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: `budget.${outcome}`,
      entity: 'budget',
      entityId: request.source_id,
      after: { approvalRequestId: request.id },
    });
  }

  // ================================================================ revisions

  /** New yearly amounts for some accounts of an approved budget (a new account adds a line). */
  async requestRevision(budgetId: string, dto: BudgetRevisionDto) {
    const b = await this.find(budgetId);
    const resource = { companyId: b.company_id, departmentId: b.department_id };
    if (
      !this.access.allows('budgets.manage', resource) &&
      !this.access.allows('budgets.request_change', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    if (b.state !== 'approved')
      throw new ConflictException(MSG.BUDGET_WRONG_STATE);
    const open = await this.db.tx
      .selectFrom('budget_revisions')
      .select('id')
      .where('budget_id', '=', budgetId)
      .where('state', '=', 'in_approval')
      .executeTakeFirst();
    if (open) throw new ConflictException(MSG.BUDGET_REVISION_OPEN);
    await this.assertAccounts(b.company_id, dto.lines);
    const current = new Map(
      (
        await this.db.tx
          .selectFrom('budget_lines')
          .select(['account_id', 'amount'])
          .where('budget_id', '=', budgetId)
          .execute()
      ).map((l) => [l.account_id, l.amount]),
    );
    const changes = dto.lines
      .map((l) => ({
        accountId: l.accountId,
        from: current.get(l.accountId) ?? '0.00',
        to: Money.of(l.amount).toDb(),
      }))
      .filter((c) => !Money.of(c.from).equals(c.to));
    if (!changes.length) throw new BadRequestException(MSG.VALIDATION_FAILED);

    const revision = await this.db.tx
      .insertInto('budget_revisions')
      .values({ budget_id: budgetId, reason: dto.reason })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('budget_revision_lines')
      .values(
        changes.map((c) => ({
          revision_id: revision.id,
          account_id: c.accountId,
          old_amount: c.from,
          new_amount: c.to,
        })),
      )
      .execute();
    const newTotal = changes.reduce(
      (t, c) => t.minus(c.from).plus(c.to),
      Money.of(b.total),
    );
    const department = await this.db.tx
      .selectFrom('departments')
      .select('name')
      .where('id', '=', b.department_id)
      .executeTakeFirstOrThrow();
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code', 'name_en'])
      .where(
        'id',
        'in',
        changes.map((c) => c.accountId),
      )
      .execute();
    const name = (id: string) => accounts.find((a) => a.id === id);
    const request = await this.approvals.submit({
      requestType: BUDGET_REVISION_REQUEST,
      sourceId: revision.id,
      subjectEmployeeId: null,
      companyId: b.company_id,
      amount: newTotal.toDb(),
      summary: `Budget change ${b.fiscal_year_code}: ${department.name}, Tk ${b.total} -> Tk ${newTotal.toDb()}`,
      snapshot: {
        fiscalYear: b.fiscal_year_code,
        department: department.name,
        reason: dto.reason,
        totalBefore: b.total,
        totalAfter: newTotal.toDb(),
        changes: changes
          .map(
            (c) =>
              `${name(c.accountId)?.code} ${name(c.accountId)?.name_en}: Tk ${c.from} -> Tk ${c.to}`,
          )
          .join('; '),
      },
    });
    await this.db.tx
      .updateTable('budget_revisions')
      .set({ approval_request_id: request.id })
      .where('id', '=', revision.id)
      .execute();
    await this.audit.record({
      action: 'budget.revision_requested',
      entity: 'budget',
      entityId: budgetId,
      after: { revisionId: revision.id, reason: dto.reason, changes },
    });
    return this.get(budgetId);
  }

  private async revisionApproved(request: ApprovalRequest) {
    const revision = await this.db.tx
      .selectFrom('budget_revisions')
      .selectAll()
      .where('id', '=', request.source_id)
      .executeTakeFirstOrThrow();
    const changes = await this.db.tx
      .selectFrom('budget_revision_lines')
      .selectAll()
      .where('revision_id', '=', revision.id)
      .execute();
    // the guard lets an approved budget's lines change only with this flag (this transaction only)
    await sql`SELECT set_config('app.budget_revision', 'on', true)`.execute(
      this.db.tx,
    );
    for (const c of changes) {
      await this.db.tx
        .insertInto('budget_lines')
        .values({
          budget_id: revision.budget_id,
          account_id: c.account_id,
          amount: c.new_amount,
        })
        .onConflict((oc) =>
          oc
            .columns(['budget_id', 'account_id'])
            .doUpdateSet({ amount: c.new_amount }),
        )
        .execute();
    }
    await sql`SELECT set_config('app.budget_revision', 'off', true)`.execute(
      this.db.tx,
    );
    const sum = await this.db.tx
      .selectFrom('budget_lines')
      .select(sql<string>`coalesce(sum(amount), 0)`.as('total'))
      .where('budget_id', '=', revision.budget_id)
      .executeTakeFirstOrThrow();
    await this.db.tx
      .updateTable('budgets')
      .set({ total: Money.of(sum.total).toDb() })
      .where('id', '=', revision.budget_id)
      .execute();
    await this.db.tx
      .updateTable('budget_revisions')
      .set({ state: 'approved', decided_at: new Date() })
      .where('id', '=', revision.id)
      .execute();
    await this.audit.record({
      action: 'budget.revised',
      entity: 'budget',
      entityId: revision.budget_id,
      after: { revisionId: revision.id, total: sum.total },
    });
  }

  private async revisionClosed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    await this.db.tx
      .updateTable('budget_revisions')
      .set({
        state: outcome === 'rejected' ? 'rejected' : 'cancelled',
        decided_at: new Date(),
      })
      .where('id', '=', request.source_id)
      .execute();
  }

  // ================================================================ read

  async list(companyId: string, query: BudgetQueryDto) {
    await this.org.assertCompanyExists(companyId);
    let q = this.db.tx
      .selectFrom('budgets as b')
      .innerJoin('departments as d', 'd.id', 'b.department_id')
      .selectAll('b')
      .select(['d.code as department_code', 'd.name as department_name'])
      .where('b.company_id', '=', companyId)
      .where('b.state', '<>', 'cancelled');
    if (query.fiscalYear)
      q = q.where('b.fiscal_year_code', '=', query.fiscalYear);
    if (query.departmentId)
      q = q.where('b.department_id', '=', query.departmentId);
    const rows = await q
      .orderBy('b.fiscal_year_code', 'desc')
      .orderBy('d.code')
      .execute();
    const out = [];
    for (const b of rows) {
      if (!this.canView({ companyId, departmentId: b.department_id })) continue;
      const pos =
        b.state === 'approved' ? await this.positions.budgetPosition(b) : null;
      out.push({
        ...summary(b),
        departmentCode: b.department_code,
        departmentName: b.department_name,
        position: pos?.total ?? null,
      });
    }
    if (!out.length && !this.canView({ companyId })) {
      const scope = this.access.scopeFilter('budgets.view');
      if (
        !scope.all &&
        !scope.companyIds.includes(companyId) &&
        !scope.departmentIds.length
      )
        throw new ForbiddenException(MSG.FORBIDDEN);
    }
    return out;
  }

  async get(id: string) {
    const b = await this.find(id);
    if (
      !this.canView({ companyId: b.company_id, departmentId: b.department_id })
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    const department = await this.db.tx
      .selectFrom('departments')
      .select(['code', 'name'])
      .where('id', '=', b.department_id)
      .executeTakeFirstOrThrow();
    const lines = await this.linesWithNames(id);
    const pos = await this.positions.budgetPosition(b);
    const accountIds = [
      ...lines.map((l) => l.account_id),
      ...pos.unbudgeted.map((u) => u.accountId),
    ];
    const accounts = accountIds.length
      ? await this.db.tx
          .selectFrom('accounts')
          .select(['id', 'code', 'name_en'])
          .where('id', 'in', accountIds)
          .execute()
      : [];
    const named = (id: string) => accounts.find((a) => a.id === id);
    const revisions = await this.db.tx
      .selectFrom('budget_revisions')
      .selectAll()
      .where('budget_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();
    const revLines = revisions.length
      ? await this.db.tx
          .selectFrom('budget_revision_lines')
          .selectAll()
          .where(
            'revision_id',
            'in',
            revisions.map((r) => r.id),
          )
          .execute()
      : [];
    const resource = { companyId: b.company_id, departmentId: b.department_id };
    return {
      ...summary(b),
      departmentCode: department.code,
      departmentName: department.name,
      warningPercent: pos.warningPercent,
      fiscalYearFrom: pos.fiscalYear.from,
      fiscalYearTo: pos.fiscalYear.to,
      lines: pos.lines.map((l) => ({
        ...l,
        accountCode: named(l.accountId)?.code ?? null,
        accountName: named(l.accountId)?.name_en ?? null,
      })),
      unbudgeted: pos.unbudgeted.map((l) => ({
        ...l,
        accountCode: named(l.accountId)?.code ?? null,
        accountName: named(l.accountId)?.name_en ?? null,
      })),
      position: pos.total,
      revisions: revisions.map((r) => ({
        id: r.id,
        reason: r.reason,
        state: r.state,
        approvalRequestId: r.approval_request_id,
        createdAt: r.created_at,
        decidedAt: r.decided_at,
        lines: revLines
          .filter((l) => l.revision_id === r.id)
          .map((l) => ({
            accountId: l.account_id,
            accountCode: named(l.account_id)?.code ?? null,
            oldAmount: l.old_amount,
            newAmount: l.new_amount,
          })),
      })),
      canRequestChange:
        b.state === 'approved' &&
        (this.access.allows('budgets.manage', resource) ||
          this.access.allows('budgets.request_change', resource)),
    };
  }

  /**
   * Budget vs actual for a fiscal year: each approved budget with its lines, and the
   * departments that spent without a budget.
   */
  async budgetVsActual(companyId: string, query: BudgetQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const fy = await (query.fiscalYear
      ? this.positions.fiscalYear(companyId, query.fiscalYear)
      : this.positions.fiscalYearOf(companyId, this.positions.today()));
    let q = this.db.tx
      .selectFrom('budgets')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('fiscal_year_code', '=', fy.code)
      .where('state', '=', 'approved');
    if (query.departmentId)
      q = q.where('department_id', '=', query.departmentId);
    const budgets = await q.execute();
    const departments = await this.db.tx
      .selectFrom('departments')
      .select(['id', 'code', 'name'])
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code', 'name_en', 'type'])
      .where('company_id', '=', companyId)
      .execute();
    const named = (id: string) => accounts.find((a) => a.id === id);

    const rows: Array<{
      departmentId: string;
      departmentCode: string;
      departmentName: string;
      budgetId: string | null;
      total: Position;
      lines: Array<
        Position & {
          accountId: string;
          accountCode: string | null;
          accountName: string | null;
        }
      >;
    }> = [];
    for (const d of departments) {
      if (query.departmentId && d.id !== query.departmentId) continue;
      if (!this.canView({ companyId, departmentId: d.id })) continue;
      const budget = budgets.find((b) => b.department_id === d.id);
      if (budget) {
        const pos = await this.positions.budgetPosition(budget);
        rows.push({
          departmentId: d.id,
          departmentCode: d.code,
          departmentName: d.name,
          budgetId: budget.id,
          total: pos.total,
          lines: [...pos.lines, ...pos.unbudgeted].map((l) => ({
            ...l,
            accountCode: named(l.accountId)?.code ?? null,
            accountName: named(l.accountId)?.name_en ?? null,
          })),
        });
      } else {
        // no budget: what the department spent on expense / asset accounts
        const actual = await this.positions.actuals(companyId, d.id, fy);
        const committed = await this.positions.commitments(companyId, d.id, fy);
        const ids = [
          ...new Set([...actual.keys(), ...committed.keys()]),
        ].filter((id) => ['expense', 'asset'].includes(named(id)?.type ?? ''));
        if (!ids.length) continue;
        const { warningPercent } = await this.positions.settings(companyId);
        const lines = ids.map((id) => ({
          accountId: id,
          accountCode: named(id)?.code ?? null,
          accountName: named(id)?.name_en ?? null,
          ...position(
            '0',
            (actual.get(id) ?? Money.zero()).toDb(),
            (committed.get(id) ?? Money.zero()).toDb(),
            warningPercent,
          ),
        }));
        const sum = (k: 'actual' | 'committed') =>
          Money.sum(lines.map((l) => l[k])).toDb();
        rows.push({
          departmentId: d.id,
          departmentCode: d.code,
          departmentName: d.name,
          budgetId: null,
          total: position('0', sum('actual'), sum('committed'), warningPercent),
          lines,
        });
      }
    }
    const used = (k: 'budget' | 'actual' | 'committed') =>
      Money.sum(rows.map((r) => r.total[k])).toDb();
    return {
      fiscalYear: fy.code,
      from: fy.from,
      to: fy.to,
      departments: rows,
      totals: {
        budget: used('budget'),
        actual: used('actual'),
        committed: used('committed'),
      },
    };
  }

  // ================================================================ alerts (worker)

  /** Budgets of the current fiscal year reaching 80 % / 100 %: one event per line and level. */
  async raiseAlerts(): Promise<number> {
    const companies = await this.org.activeCompanyIds();
    let raised = 0;
    for (const companyId of companies) {
      const fy = await this.positions.fiscalYearOf(
        companyId,
        this.positions.today(),
      );
      const budgets = await this.db.tx
        .selectFrom('budgets')
        .selectAll()
        .where('company_id', '=', companyId)
        .where('fiscal_year_code', '=', fy.code)
        .where('state', '=', 'approved')
        .execute();
      for (const b of budgets) {
        const pos = await this.positions.budgetPosition(b);
        const candidates = [
          ...pos.lines.map((l) => ({
            accountId: l.accountId as string | null,
            p: l,
          })),
          { accountId: null, p: pos.total },
        ];
        for (const c of candidates) {
          for (const level of levelsReached(c.p, pos.warningPercent)) {
            const inserted = await this.db.tx
              .insertInto('budget_alerts')
              .values({
                budget_id: b.id,
                account_id: c.accountId,
                level,
                percent: c.p.percent ?? '0',
              })
              .onConflict((oc) => oc.doNothing())
              .returning('id')
              .executeTakeFirst();
            if (!inserted) continue;
            await this.outbox.add({
              type: 'budget.threshold_reached',
              entityId: b.id,
              payload: {
                budgetId: b.id,
                companyId,
                departmentId: b.department_id,
                fiscalYear: b.fiscal_year_code,
                accountId: c.accountId,
                level,
                percent: c.p.percent,
                used: c.p.used,
                budget: c.p.budget,
              },
            });
            raised += 1;
          }
        }
      }
    }
    return raised;
  }

  // ================================================================ helpers

  async find(id: string): Promise<Budget> {
    const b = await this.db.tx
      .selectFrom('budgets')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!b) throw new NotFoundException(MSG.BUDGET_NOT_FOUND);
    return b;
  }

  private canView(resource: {
    companyId: string;
    departmentId?: string | null;
  }) {
    return (
      this.access.allows('budgets.view', resource) ||
      this.access.allows('budgets.manage', resource)
    );
  }

  /** Expense or asset accounts of the company that take postings (once each). */
  private async assertAccounts(companyId: string, lines: BudgetLineDto[]) {
    const ids = lines.map((l) => l.accountId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    const rows = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'postable', 'type', 'role'])
      .where('id', 'in', ids)
      .execute();
    const ok = (id: string) => {
      const a = rows.find((r) => r.id === id);
      return (
        a &&
        a.company_id === companyId &&
        a.postable &&
        (a.type === 'expense' || a.type === 'asset') &&
        !['cash', 'bank', 'receivables', 'employee_advances'].includes(
          a.role ?? '',
        )
      );
    };
    if (!ids.every(ok)) throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
  }

  private async linesWithNames(budgetId: string) {
    return this.db.tx
      .selectFrom('budget_lines as l')
      .innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select(['l.account_id', 'l.amount', 'a.code', 'a.name_en'])
      .where('l.budget_id', '=', budgetId)
      .orderBy('a.code')
      .execute();
  }
}

function total(lines: BudgetLineDto[]): string {
  return Money.sum(lines.map((l) => l.amount)).toDb();
}

function summary(b: Budget) {
  return {
    id: b.id,
    companyId: b.company_id,
    fiscalYear: b.fiscal_year_code,
    departmentId: b.department_id,
    state: b.state,
    total: b.total,
    note: b.note,
    approvalRequestId: b.approval_request_id,
    approvedAt: b.approved_at,
    cancelReason: b.cancel_reason,
    version: b.version,
  };
}
