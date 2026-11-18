/**
 * Commission from sales into payroll (WP31; spec §6.4).
 *
 *   scheme / setScheme        one active rule per company: the basis (invoiced or collected
 *                             sales), the rate, and an optional bonus band above a target
 *   calculate(companyId, p)   works out the month for every salesperson, from the SOURCE
 *                             DOCUMENTS: their invoices (less credit notes) or the money
 *                             actually received against their invoices, against the sales
 *                             target set for them for that month (WP24). Each line keeps the
 *                             documents it came from, so the figure can be argued with.
 *   post(runId)               writes one payroll variable per line on the COMMISSION head
 *                             (the same route HR uses by hand), and records on the line which
 *                             variable it became — so commission can never reach payroll
 *                             twice. Refused once that month's payroll is approved.
 *   cancel(runId, reason)     before posting, or after a mistake: a cancelled run frees the
 *                             month to be calculated again, and the payroll variables it
 *                             created are cancelled with it.
 *
 * This module calculates commission and nothing else about money: the payslip line, the tax
 * on it and the journal are payroll's (WP6, WP7).
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
import { monthRange, todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  CommissionRule,
  CommissionRun,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { CrmAccess } from '../crm/crm-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { PayrollVariablesService } from '../payroll/payroll-variables.service.js';
import {
  commissionOf,
  schemeProblem,
  type CommissionScheme,
} from './commission-rules.js';
import type {
  CancelRunDto,
  CommissionRuleDto,
} from './dto/commissions.dto.js';

export const COMMISSION_HEAD = 'COMMISSION';

@Injectable()
export class CommissionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly crm: CrmAccess,
    private readonly variables: PayrollVariablesService,
  ) {}

  // ================================================================== scheme

  async scheme(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertView(companyId);
    const rules = await this.db.tx
      .selectFrom('commission_rules')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('is_active', 'desc')
      .orderBy('created_at', 'desc')
      .execute();
    return { rules: rules.map((r) => this.toRule(r)) };
  }

  async setScheme(companyId: string, dto: CommissionRuleDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('commission.manage', { companyId });
    const problem = schemeProblem(dto);
    if (problem)
      throw new BadRequestException({
        message: MSG.COMMISSION_RULE_INVALID,
        details: { problem },
      });
    const taken = await this.db.tx
      .selectFrom('commission_rules')
      .select('id')
      .where('company_id', '=', companyId)
      .where('code', '=', dto.code)
      .executeTakeFirst();
    if (taken) throw new ConflictException(MSG.COMMISSION_RULE_CODE_TAKEN);

    // one active scheme at a time: the old one is retired, not deleted, so old runs keep
    // pointing at the rule they were calculated with
    await this.db.tx
      .updateTable('commission_rules')
      .set({ is_active: false })
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .execute();
    const rule = await this.db.tx
      .insertInto('commission_rules')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name,
        basis: dto.basis ?? 'collected',
        rate_percent: dto.ratePercent,
        min_attainment: dto.minAttainment ?? '0',
        bonus_attainment: dto.bonusAttainment ?? null,
        bonus_rate_percent: dto.bonusRatePercent ?? null,
        clawback: dto.clawback ?? true,
        note: dto.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'commission_rule.set',
      entity: 'commission_rule',
      entityId: rule.id,
      after: {
        code: rule.code,
        basis: rule.basis,
        ratePercent: rule.rate_percent,
        bonusAttainment: rule.bonus_attainment,
      },
    });
    return this.scheme(companyId);
  }

  // ===================================================================== run

  async runs(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertView(companyId);
    const rows = await this.db.tx
      .selectFrom('commission_runs')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('period', 'desc')
      .limit(60)
      .execute();
    return { runs: rows.map((r) => this.toRun(r)) };
  }

  async run(runId: string) {
    const run = await this.find(runId);
    this.assertView(run.company_id);
    const scope = await this.lineScope(run.company_id);
    let q = this.db.tx
      .selectFrom('commission_lines as l')
      .leftJoin('users as u', 'u.id', 'l.user_id')
      .leftJoin('employees as e', 'e.id', 'l.employee_id')
      .select([
        'l.id',
        'l.user_id',
        'l.employee_id',
        'l.basis_amount',
        'l.target_amount',
        'l.attainment',
        'l.rate_percent',
        'l.amount',
        'l.detail',
        'l.payroll_variable_id',
        'u.email',
        'e.full_name_en',
        'e.employee_code',
      ])
      .where('l.run_id', '=', runId)
      .orderBy('l.amount', 'desc');
    if (!scope.all) q = q.where('l.user_id', 'in', scope.userIds);
    const lines = await q.execute();
    return {
      ...this.toRun(run),
      lines: lines.map((l) => ({
        id: l.id,
        userId: l.user_id,
        employeeId: l.employee_id,
        name: l.full_name_en ?? l.email,
        employeeCode: l.employee_code,
        basisAmount: l.basis_amount,
        targetAmount: l.target_amount,
        attainment: l.attainment,
        ratePercent: l.rate_percent,
        amount: l.amount,
        detail: l.detail,
        payrollVariableId: l.payroll_variable_id,
      })),
    };
  }

  /**
   * Work out one month for every salesperson of the company. Idempotent in the sense that
   * matters: a month with a live run is refused, so the same month is never calculated into
   * two runs that both reach payroll.
   */
  async calculate(companyId: string, period: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('commission.manage', { companyId });
    const rule = await this.db.tx
      .selectFrom('commission_rules')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!rule) throw new BadRequestException(MSG.COMMISSION_NO_RULE);
    const live = await this.db.tx
      .selectFrom('commission_runs')
      .select('id')
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .where('state', 'in', ['calculated', 'posted'])
      .executeTakeFirst();
    if (live)
      throw new ConflictException({
        message: MSG.COMMISSION_RUN_EXISTS,
        details: { runId: live.id },
      });

    const scheme = this.schemeOf(rule);
    const { from, to } = monthRange(period);
    const salespeople = await this.crm.salespeople(companyId);
    const run = await this.db.tx
      .insertInto('commission_runs')
      .values({
        company_id: companyId,
        period,
        rule_id: rule.id,
        rule_snapshot: JSON.stringify({
          code: rule.code,
          name: rule.name,
          ...scheme,
        }),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    let total = Money.of('0');
    for (const userId of salespeople) {
      const basis =
        scheme.basis === 'invoiced'
          ? await this.invoicedBy(companyId, userId, from, to, scheme.clawback)
          : await this.collectedBy(companyId, userId, from, to);
      const target = await this.targetOf(companyId, userId, period);
      const result = commissionOf(scheme, basis.amount, target);
      if (result.amount.compare('0') <= 0 && basis.amount.compare('0') <= 0)
        continue; // nothing sold and nothing earned: no line at all
      const employee = await this.db.tx
        .selectFrom('users')
        .select('employee_id')
        .where('id', '=', userId)
        .executeTakeFirst();
      await this.db.tx
        .insertInto('commission_lines')
        .values({
          run_id: run.id,
          user_id: userId,
          employee_id: employee?.employee_id ?? null,
          basis_amount: basis.amount.toDb(),
          target_amount: target ? target.toDb() : null,
          attainment: result.attainment === null ? null : String(result.attainment),
          rate_percent: result.ratePercent,
          amount: result.amount.toDb(),
          detail: JSON.stringify(basis.detail),
        })
        .execute();
      total = total.plus(result.amount);
    }
    await this.db.tx
      .updateTable('commission_runs')
      .set({ total: total.toDb() })
      .where('id', '=', run.id)
      .execute();
    await this.audit.record({
      action: 'commission_run.calculated',
      entity: 'commission_run',
      entityId: run.id,
      after: { period, basis: scheme.basis, total: total.toDb() },
    });
    return this.run(run.id);
  }

  /**
   * Post the run to payroll: one payroll variable per line on the COMMISSION head, for the
   * same period. Refused when that month's payroll is already approved — at that point the
   * money is decided, and commission for it belongs in the next month's run with a note.
   */
  async post(runId: string) {
    const run = await this.find(runId);
    this.access.assert('commission.manage', { companyId: run.company_id });
    if (run.state !== 'calculated')
      throw new ConflictException(MSG.COMMISSION_RUN_WRONG_STATE);
    const approvedPayroll = await this.db.tx
      .selectFrom('payroll_runs')
      .select('id')
      .where('company_id', '=', run.company_id)
      .where('period', '=', run.period)
      .where('state', 'in', ['approved', 'disbursed'])
      .executeTakeFirst();
    if (approvedPayroll)
      throw new ConflictException(MSG.COMMISSION_PERIOD_LOCKED);

    const lines = await this.db.tx
      .selectFrom('commission_lines')
      .selectAll()
      .where('run_id', '=', runId)
      .where('payroll_variable_id', 'is', null)
      .execute();
    let posted = 0;
    for (const line of lines) {
      if (!line.employee_id) continue; // a salesperson with no employee record is not paid here
      if (Money.of(line.amount).compare('0') <= 0) continue;
      const variable = await this.variables.addVariable(run.company_id, {
        employeeId: line.employee_id,
        period: run.period,
        headCode: COMMISSION_HEAD,
        amount: line.amount,
        note: `Commission ${run.period} (run ${runId.slice(0, 8)})`,
      });
      const variableId = (variable as { id?: string }).id;
      await this.db.tx
        .updateTable('commission_lines')
        .set({ payroll_variable_id: variableId ?? null })
        .where('id', '=', line.id)
        .execute();
      posted += 1;
    }
    await this.db.tx
      .updateTable('commission_runs')
      .set({
        state: 'posted',
        posted_at: this.clock.now(),
        posted_by: this.access.current().userId,
      })
      .where('id', '=', runId)
      .execute();
    await this.audit.record({
      action: 'commission_run.posted',
      entity: 'commission_run',
      entityId: runId,
      after: { period: run.period, lines: posted, total: run.total },
    });
    await this.outbox.add({
      type: 'commission.posted',
      entityId: runId,
      payload: {
        runId,
        companyId: run.company_id,
        period: run.period,
        people: posted,
        // no amount in an event payload (guide §15)
      },
    });
    return this.run(runId);
  }

  async cancel(runId: string, dto: CancelRunDto) {
    const run = await this.find(runId);
    this.access.assert('commission.manage', { companyId: run.company_id });
    if (run.state === 'cancelled')
      throw new ConflictException(MSG.COMMISSION_RUN_WRONG_STATE);
    if (run.state === 'posted') {
      const approvedPayroll = await this.db.tx
        .selectFrom('payroll_runs')
        .select('id')
        .where('company_id', '=', run.company_id)
        .where('period', '=', run.period)
        .where('state', 'in', ['approved', 'disbursed'])
        .executeTakeFirst();
      if (approvedPayroll)
        throw new ConflictException(MSG.COMMISSION_PERIOD_LOCKED);
      // the payroll variables it created go with it
      const lines = await this.db.tx
        .selectFrom('commission_lines')
        .select(['id', 'payroll_variable_id'])
        .where('run_id', '=', runId)
        .where('payroll_variable_id', 'is not', null)
        .execute();
      for (const line of lines) {
        await this.variables.cancelVariable(line.payroll_variable_id!, {
          reason: `Commission run cancelled: ${dto.reason}`,
        });
        await this.db.tx
          .updateTable('commission_lines')
          .set({ payroll_variable_id: null })
          .where('id', '=', line.id)
          .execute();
      }
    }
    await this.db.tx
      .updateTable('commission_runs')
      .set({
        state: 'cancelled',
        cancel_reason: dto.reason,
        // the posting is undone with the run (its payroll items were cancelled above), so
        // the posted marks go too; who posted it and when stays in the audit log
        posted_at: null,
        posted_by: null,
      })
      .where('id', '=', runId)
      .execute();
    await this.audit.record({
      action: 'commission_run.cancelled',
      entity: 'commission_run',
      entityId: runId,
      before: { state: run.state },
      after: { reason: dto.reason },
    });
    return this.run(runId);
  }

  /** What one salesperson earned, for their own screen. */
  async mine(companyId: string, period?: string) {
    await this.org.assertCompanyExists(companyId);
    const me = this.access.current().userId;
    if (!me) throw new ForbiddenException(MSG.FORBIDDEN);
    let q = this.db.tx
      .selectFrom('commission_lines as l')
      .innerJoin('commission_runs as r', 'r.id', 'l.run_id')
      .select([
        'l.id',
        'r.period',
        'r.state',
        'l.basis_amount',
        'l.target_amount',
        'l.attainment',
        'l.rate_percent',
        'l.amount',
        'l.payroll_variable_id',
      ])
      .where('l.user_id', '=', me)
      .where('r.company_id', '=', companyId)
      .where('r.state', '<>', 'cancelled')
      .orderBy('r.period', 'desc')
      .limit(24);
    if (period) q = q.where('r.period', '=', period);
    const rows = await q.execute();
    return {
      months: rows.map((l) => ({
        id: l.id,
        period: l.period,
        runState: l.state,
        basisAmount: l.basis_amount,
        targetAmount: l.target_amount,
        attainment: l.attainment,
        ratePercent: l.rate_percent,
        amount: l.amount,
        paidThroughPayroll: !!l.payroll_variable_id,
      })),
    };
  }

  // ================================================================= sources

  /**
   * Invoiced: the invoices of the salesperson's own orders in the month, less the credit
   * notes raised against them (clawback, spec: "clawback on credit notes").
   */
  private async invoicedBy(
    companyId: string,
    userId: string,
    from: string,
    to: string,
    clawback: boolean,
  ) {
    const invoices = await this.db.tx
      .selectFrom('sales_invoices as i')
      .innerJoin('sales_orders as o', 'o.id', 'i.order_id')
      .select(['i.id', 'i.invoice_no', 'i.value', 'i.invoice_date'])
      .where('i.company_id', '=', companyId)
      .where('o.owner_id', '=', userId)
      .where('i.invoice_date', '>=', from)
      .where('i.invoice_date', '<=', to)
      .execute();
    let amount = Money.sum(invoices.map((i) => Money.of(i.value)));
    const credits = clawback
      ? await this.db.tx
          .selectFrom('credit_notes as c')
          .innerJoin('sales_invoices as i', 'i.id', 'c.invoice_id')
          .innerJoin('sales_orders as o', 'o.id', 'i.order_id')
          .select(['c.id', 'c.number', 'c.value', 'c.note_date'])
          .where('c.company_id', '=', companyId)
          .where('o.owner_id', '=', userId)
          .where('c.note_date', '>=', from)
          .where('c.note_date', '<=', to)
          .execute()
      : [];
    for (const credit of credits) amount = amount.minus(Money.of(credit.value));
    if (amount.compare('0') < 0) amount = Money.of('0');
    return {
      amount,
      detail: {
        basis: 'invoiced',
        invoices: invoices.map((i) => ({
          number: i.invoice_no,
          date: i.invoice_date,
          value: i.value,
        })),
        creditNotes: credits.map((c) => ({
          number: c.number,
          date: c.note_date,
          value: c.value,
        })),
      },
    };
  }

  /**
   * Collected: the money received in the month against invoices of the salesperson's own
   * orders. Allocations are what count — money "on account" is not commission yet, because
   * nobody knows whose invoice it pays.
   */
  private async collectedBy(
    companyId: string,
    userId: string,
    from: string,
    to: string,
  ) {
    const rows = await this.db.tx
      .selectFrom('customer_receipt_allocations as a')
      .innerJoin('customer_receipts as r', 'r.id', 'a.receipt_id')
      .innerJoin('receivable_items as it', 'it.id', 'a.item_id')
      .innerJoin('sales_invoices as i', 'i.id', 'it.sales_invoice_id')
      .innerJoin('sales_orders as o', 'o.id', 'i.order_id')
      .select([
        'a.id',
        'a.amount',
        'r.number as receipt_no',
        'r.receipt_date',
        'i.invoice_no',
      ])
      .where('r.company_id', '=', companyId)
      .where('o.owner_id', '=', userId)
      .where('r.receipt_date', '>=', from)
      .where('r.receipt_date', '<=', to)
      .execute();
    return {
      amount: Money.sum(rows.map((r) => Money.of(r.amount))),
      detail: {
        basis: 'collected',
        receipts: rows.map((r) => ({
          receipt: r.receipt_no,
          invoice: r.invoice_no,
          date: r.receipt_date,
          amount: r.amount,
        })),
      },
    };
  }

  /** The sales target set for that person for that month (WP24), if there is one. */
  private async targetOf(
    companyId: string,
    userId: string,
    period: string,
  ): Promise<Money | null> {
    // sales_targets.month is a date: the first day of the month (WP24)
    const row = await this.db.tx
      .selectFrom('sales_targets')
      .select('amount')
      .where('company_id', '=', companyId)
      .where('month', '=', `${period}-01`)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row ? Money.of(row.amount) : null;
  }

  // ================================================================= helpers

  async find(runId: string): Promise<CommissionRun> {
    const run = await this.db.tx
      .selectFrom('commission_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirst();
    if (!run) throw new NotFoundException(MSG.COMMISSION_RUN_NOT_FOUND);
    return run;
  }

  private schemeOf(rule: CommissionRule): CommissionScheme {
    return {
      basis: rule.basis,
      ratePercent: rule.rate_percent,
      minAttainment: rule.min_attainment,
      bonusAttainment: rule.bonus_attainment,
      bonusRatePercent: rule.bonus_rate_percent,
      clawback: rule.clawback,
    };
  }

  private assertView(companyId: string) {
    const resource = { companyId };
    if (
      this.access.allows('commission.view', resource) ||
      this.access.allows('commission.manage', resource) ||
      this.access.current().has('commission.view')
    )
      return;
    this.access.assert('commission.view', resource); // throws
  }

  /** A Sales head sees their own department's lines; HR, Accounts and the Admin see all. */
  private async lineScope(
    companyId: string,
  ): Promise<{ all: boolean; userIds: string[] }> {
    const company = { companyId };
    if (
      this.access.allows('commission.view', company) ||
      this.access.allows('commission.manage', company)
    )
      return { all: true, userIds: [] };
    const scope = await this.crm.listScope(companyId);
    if (scope.all) return { all: true, userIds: [] };
    const me = this.access.current().userId;
    return {
      all: false,
      userIds: [...new Set([...scope.ownerIds, ...(me ? [me] : [])])],
    };
  }

  private toRule(r: CommissionRule) {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      basis: r.basis,
      ratePercent: r.rate_percent,
      minAttainment: r.min_attainment,
      bonusAttainment: r.bonus_attainment,
      bonusRatePercent: r.bonus_rate_percent,
      clawback: r.clawback,
      isActive: r.is_active,
      note: r.note,
      createdAt: r.created_at,
      version: r.version,
    };
  }

  private toRun(r: CommissionRun) {
    return {
      id: r.id,
      companyId: r.company_id,
      period: r.period,
      ruleId: r.rule_id,
      rule: r.rule_snapshot,
      state: r.state,
      total: r.total,
      postedAt: r.posted_at,
      postedBy: r.posted_by,
      cancelReason: r.cancel_reason,
      createdAt: r.created_at,
      version: r.version,
    };
  }

  today() {
    return todayInDhaka(this.clock.now());
  }
}
