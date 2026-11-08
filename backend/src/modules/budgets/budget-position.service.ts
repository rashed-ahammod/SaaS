/**
 * Where a budget stands (WP18): actual and committed amounts from the source
 * documents, and the checks procurement asks before new spending.
 *
 *   actual     posted vouchers: debit - credit on the account with the department as
 *              cost centre, dated in the fiscal year (bills, claims, journals alike)
 *   committed  issued purchase orders of the department (order date in the year):
 *              each line's amount before VAT, less what approved bills of that line
 *              already made actual
 *
 * Budgets are used once a company has an approved budget for the year; until then
 * every check answers "not_used" and nothing is routed by budget.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Clock } from '../../platform/clock.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { position, projected, type Position } from './budget-math.js';

export const DEFAULT_BUDGET_SETTINGS = {
  warningPercent: '80.00',
  noBudgetNeedsAdmin: true,
};

export interface FiscalYear {
  code: string;
  from: string;
  to: string;
}

/** The answer to "may this be spent?" */
export interface BudgetCheck {
  /** not_used: the company has no approved budget this year */
  status: 'within' | 'warning' | 'over' | 'no_budget' | 'not_used';
  needsAdmin: boolean;
  fiscalYear: string;
  budgetId: string | null;
  /** department total, or per account for a purchase order */
  lines: Array<{
    accountId: string | null;
    amount: string;
    before: Position | null;
    after: Position | null;
  }>;
}

@Injectable()
export class BudgetPositionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly clock: Clock,
  ) {}

  today() {
    return todayInDhaka(this.clock.now());
  }

  async settings(companyId: string) {
    const row = await this.db.tx
      .selectFrom('budget_settings')
      .selectAll()
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    return row
      ? {
          warningPercent: row.warning_percent,
          noBudgetNeedsAdmin: row.no_budget_needs_admin,
        }
      : DEFAULT_BUDGET_SETTINGS;
  }

  /** "2026-27" -> its dates (the ledger's fiscal year, else from the company's year start). */
  async fiscalYear(companyId: string, code: string): Promise<FiscalYear> {
    if (
      !/^\d{4}-\d{2}$/.test(code) ||
      Number(code.slice(5)) !== (Number(code.slice(0, 4)) + 1) % 100
    )
      throw new BadRequestException(MSG.FISCAL_YEAR_INVALID);
    const row = await this.db.tx
      .selectFrom('fiscal_years')
      .select(['code', 'starts_on', 'ends_on'])
      .where('company_id', '=', companyId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (row) return { code, from: row.starts_on, to: row.ends_on };
    const company = await this.db.tx
      .selectFrom('companies')
      .select('fiscal_year_start')
      .where('id', '=', companyId)
      .executeTakeFirstOrThrow();
    const start = Number(code.slice(0, 4));
    const [m] = company.fiscal_year_start.split('-').map(Number);
    const from = `${start}-${String(m).padStart(2, '0')}-01`;
    const endMonth = m === 1 ? 12 : m - 1;
    const endYear = m === 1 ? start : start + 1;
    const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
    return {
      code,
      from,
      to: `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  /** The fiscal year a date falls in. */
  async fiscalYearOf(companyId: string, date: string): Promise<FiscalYear> {
    const row = await this.db.tx
      .selectFrom('fiscal_years')
      .select(['code', 'starts_on', 'ends_on'])
      .where('company_id', '=', companyId)
      .where('starts_on', '<=', date)
      .where('ends_on', '>=', date)
      .executeTakeFirst();
    if (row) return { code: row.code, from: row.starts_on, to: row.ends_on };
    const company = await this.db.tx
      .selectFrom('companies')
      .select('fiscal_year_start')
      .where('id', '=', companyId)
      .executeTakeFirstOrThrow();
    const [y, m] = date.split('-').map(Number);
    const startMonth = Number(company.fiscal_year_start.slice(0, 2));
    const start = m >= startMonth ? y : y - 1;
    return this.fiscalYear(companyId, `${start}-${String(start + 1).slice(2)}`);
  }

  // ================================================================ amounts

  /** Actual per account for a department in a period (posted vouchers). */
  async actuals(
    companyId: string,
    departmentId: string,
    fy: FiscalYear,
  ): Promise<Map<string, Money>> {
    const rows = await this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .select([
        'l.account_id',
        sql<string>`sum(l.debit) - sum(l.credit)`.as('amount'),
      ])
      .where('v.company_id', '=', companyId)
      .where('v.state', '=', 'posted')
      .where('v.voucher_date', '>=', fy.from)
      .where('v.voucher_date', '<=', fy.to)
      .where('l.department_id', '=', departmentId)
      .groupBy('l.account_id')
      .execute();
    return new Map(rows.map((r) => [r.account_id, Money.of(r.amount)]));
  }

  /** Committed per account: issued orders of the department, less what approved bills made actual. */
  async commitments(
    companyId: string,
    departmentId: string,
    fy: FiscalYear,
  ): Promise<Map<string, Money>> {
    const lines = await this.db.tx
      .selectFrom('purchase_order_lines as l')
      .innerJoin('purchase_orders as o', 'o.id', 'l.purchase_order_id')
      .select(['l.id', 'l.account_id', 'l.quantity', 'l.unit_price'])
      .where('o.company_id', '=', companyId)
      .where('o.department_id', '=', departmentId)
      .where('o.state', 'in', ['issued', 'partially_received', 'received'])
      .where('o.order_date', '>=', fy.from)
      .where('o.order_date', '<=', fy.to)
      .execute();
    if (!lines.length) return new Map();
    const billed = await this.db.tx
      .selectFrom('vendor_bill_lines as b')
      .innerJoin('vendor_bills as v', 'v.id', 'b.bill_id')
      .select(['b.po_line_id', sql<string>`sum(b.amount)`.as('amount')])
      .where(
        'b.po_line_id',
        'in',
        lines.map((l) => l.id),
      )
      .where('v.state', '=', 'approved')
      .groupBy('b.po_line_id')
      .execute();
    const billedOf = new Map(
      billed.map((b) => [b.po_line_id!, Money.of(b.amount)]),
    );
    const out = new Map<string, Money>();
    for (const l of lines) {
      const ordered = Money.of(l.unit_price).times(l.quantity).round();
      const open = ordered.minus(billedOf.get(l.id) ?? Money.zero());
      if (open.isPositive())
        out.set(
          l.account_id,
          (out.get(l.account_id) ?? Money.zero()).plus(open),
        );
    }
    return out;
  }

  /** Does the company use budgets this year (any approved budget)? */
  async inUse(companyId: string, fiscalYearCode: string): Promise<boolean> {
    return Boolean(
      await this.db.tx
        .selectFrom('budgets')
        .select('id')
        .where('company_id', '=', companyId)
        .where('fiscal_year_code', '=', fiscalYearCode)
        .where('state', '=', 'approved')
        .executeTakeFirst(),
    );
  }

  async approvedBudget(
    companyId: string,
    departmentId: string,
    fiscalYearCode: string,
  ) {
    return this.db.tx
      .selectFrom('budgets')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('department_id', '=', departmentId)
      .where('fiscal_year_code', '=', fiscalYearCode)
      .where('state', '=', 'approved')
      .executeTakeFirst();
  }

  /** Each line of a budget, and the department total. */
  async budgetPosition(budget: {
    id: string;
    company_id: string;
    department_id: string;
    fiscal_year_code: string;
  }) {
    const fy = await this.fiscalYear(
      budget.company_id,
      budget.fiscal_year_code,
    );
    const { warningPercent } = await this.settings(budget.company_id);
    const lines = await this.db.tx
      .selectFrom('budget_lines')
      .select(['account_id', 'amount'])
      .where('budget_id', '=', budget.id)
      .execute();
    const actual = await this.actuals(
      budget.company_id,
      budget.department_id,
      fy,
    );
    const committed = await this.commitments(
      budget.company_id,
      budget.department_id,
      fy,
    );
    const budgeted = new Set(lines.map((l) => l.account_id));
    const at = (id: string, amount: string) =>
      position(
        amount,
        (actual.get(id) ?? Money.zero()).toDb(),
        (committed.get(id) ?? Money.zero()).toDb(),
        warningPercent,
      );
    const perLine = lines.map((l) => ({
      accountId: l.account_id,
      ...at(l.account_id, l.amount),
    }));
    // spending on accounts the budget does not name (expense and asset accounts only)
    const others = [...new Set([...actual.keys(), ...committed.keys()])].filter(
      (id) => !budgeted.has(id),
    );
    const kinds = others.length
      ? await this.db.tx
          .selectFrom('accounts')
          .select(['id', 'type', 'role'])
          .where('id', 'in', others)
          .execute()
      : [];
    const unbudgeted = kinds
      .filter(
        (a) =>
          (a.type === 'expense' || a.type === 'asset') &&
          ![
            'cash',
            'bank',
            'payables',
            'receivables',
            'employee_advances',
          ].includes(a.role ?? ''),
      )
      .map((a) => ({ accountId: a.id, ...at(a.id, '0') }))
      .filter((p) => p.used !== '0.00');
    const sum = (
      rows: Array<{ budget: string; actual: string; committed: string }>,
      key: 'budget' | 'actual' | 'committed',
    ) => Money.sum(rows.map((r) => r[key])).toDb();
    const all = [...perLine, ...unbudgeted];
    const total = position(
      sum(perLine, 'budget'),
      sum(all, 'actual'),
      sum(all, 'committed'),
      warningPercent,
    );
    return {
      fiscalYear: fy,
      warningPercent,
      lines: perLine,
      unbudgeted,
      total,
    };
  }

  // ================================================================ checks before spending

  /**
   * A requisition (no accounts yet): the department's whole budget after the
   * estimate. Over it, or no budget where the company uses budgets -> the Admin.
   */
  async departmentCheck(
    companyId: string,
    departmentId: string | null,
    date: string,
    amount: string,
  ): Promise<BudgetCheck> {
    const fy = await this.fiscalYearOf(companyId, date);
    const settings = await this.settings(companyId);
    if (!departmentId || !(await this.inUse(companyId, fy.code)))
      return {
        status: 'not_used',
        needsAdmin: false,
        fiscalYear: fy.code,
        budgetId: null,
        lines: [],
      };
    const budget = await this.approvedBudget(companyId, departmentId, fy.code);
    if (!budget)
      return {
        status: 'no_budget',
        needsAdmin: settings.noBudgetNeedsAdmin,
        fiscalYear: fy.code,
        budgetId: null,
        lines: [{ accountId: null, amount, before: null, after: null }],
      };
    const now = (await this.budgetPosition(budget)).total;
    const after = projected(now, amount, settings.warningPercent);
    return {
      status: after.status,
      needsAdmin: after.status === 'over',
      fiscalYear: fy.code,
      budgetId: budget.id,
      lines: [{ accountId: null, amount, before: now, after }],
    };
  }

  /**
   * A purchase order (accounts known): each department x account line after the
   * order. Any line over its budget (an account the budget does not name counts as
   * a budget of 0) -> the Admin.
   */
  async linesCheck(
    companyId: string,
    departmentId: string | null,
    date: string,
    lines: Array<{ accountId: string; amount: string }>,
  ): Promise<BudgetCheck> {
    const fy = await this.fiscalYearOf(companyId, date);
    const settings = await this.settings(companyId);
    if (!departmentId || !(await this.inUse(companyId, fy.code)))
      return {
        status: 'not_used',
        needsAdmin: false,
        fiscalYear: fy.code,
        budgetId: null,
        lines: [],
      };
    const budget = await this.approvedBudget(companyId, departmentId, fy.code);
    const byAccount = new Map<string, Money>();
    for (const l of lines)
      byAccount.set(
        l.accountId,
        (byAccount.get(l.accountId) ?? Money.zero()).plus(l.amount),
      );
    if (!budget) {
      return {
        status: 'no_budget',
        needsAdmin: settings.noBudgetNeedsAdmin,
        fiscalYear: fy.code,
        budgetId: null,
        lines: [...byAccount].map(([accountId, amount]) => ({
          accountId,
          amount: amount.toDb(),
          before: null,
          after: null,
        })),
      };
    }
    const pos = await this.budgetPosition(budget);
    const out: BudgetCheck['lines'] = [];
    for (const [accountId, amount] of byAccount) {
      const before =
        pos.lines.find((l) => l.accountId === accountId) ??
        pos.unbudgeted.find((l) => l.accountId === accountId) ??
        position('0', '0', '0', settings.warningPercent);
      out.push({
        accountId,
        amount: amount.toDb(),
        before,
        after: projected(before, amount.toDb(), settings.warningPercent),
      });
    }
    const worst = out.some((l) => l.after!.status === 'over')
      ? 'over'
      : out.some((l) => l.after!.status === 'warning')
        ? 'warning'
        : 'within';
    return {
      status: worst,
      needsAdmin: worst === 'over',
      fiscalYear: fy.code,
      budgetId: budget.id,
      lines: out,
    };
  }
}
