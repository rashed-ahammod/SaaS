/**
 * Financial reports from posted vouchers only (spec §6.6 "Reports"; Phase 2 WP14):
 *
 *   trialBalance(asOf, from?)  every account: opening, debits and credits in the
 *                              range, closing; totals prove debits = credits
 *   generalLedger(account)     opening balance, every posted line, running balance
 *   profitAndLoss(from, to)    income and expense accounts by group, net profit;
 *                              optionally one cost centre (department)
 *   balanceSheet(asOf)         assets = liabilities + equity, where equity includes
 *                              retained earnings brought forward (all earlier years'
 *                              profit) and this fiscal year's profit to date: no
 *                              closing entries are needed
 *   checks()                   nightly integrity checks (spec §11): the books balance,
 *                              and every approved payroll run and settled salary file
 *                              (since the books started) is posted
 *
 * Signs: a balance is shown on the account type's normal side (debit for assets
 * and expenses, credit for liabilities, equity and income).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { businessDate } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { AccountType } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { fiscalYearFor } from './fiscal.js';
import {
  PAYROLL_SOURCE,
  SALARY_PAYMENT_SOURCE,
} from './ledger-posting.service.js';

const DEBIT_NORMAL: AccountType[] = ['asset', 'expense'];

interface Sums {
  account_id: string;
  debit: string;
  credit: string;
}

export type LedgerCheck = (
  companyId: string,
) => Promise<Array<{ check: string; detail: string }>>;

@Injectable()
export class LedgerReportsService {
  private readonly extraChecks: LedgerCheck[] = [];

  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  /** Sub-ledger modules add their own nightly checks (e.g. payables control = open bills). */
  registerCheck(check: LedgerCheck) {
    this.extraChecks.push(check);
  }

  // ========================================================= trial balance

  async trialBalance(companyId: string, asOf: string, from?: string) {
    await this.assertView(companyId);
    const start = from ?? (await this.fiscalYearStart(companyId, asOf));
    const accounts = await this.accounts(companyId);
    const opening = await this.sums(companyId, { before: start });
    const movement = await this.sums(companyId, { from: start, to: asOf });

    const rows = accounts
      .filter((a) => a.postable)
      .map((a) => {
        const o = net(opening.get(a.id));
        const m = movement.get(a.id);
        const closing = o.plus(m?.debit ?? '0').minus(m?.credit ?? '0');
        return {
          accountId: a.id,
          code: a.code,
          name: a.name_en,
          type: a.type,
          opening: o.toDb(),
          debit: Money.of(m?.debit ?? '0').toDb(),
          credit: Money.of(m?.credit ?? '0').toDb(),
          closingDebit: closing.isPositive() ? closing.toDb() : '0.00',
          closingCredit: closing.isNegative()
            ? closing.negate().toDb()
            : '0.00',
        };
      })
      .filter(
        (r) =>
          r.opening !== '0.00' || r.debit !== '0.00' || r.credit !== '0.00',
      );
    const totals = {
      debit: Money.sum(rows.map((r) => r.debit)).toDb(),
      credit: Money.sum(rows.map((r) => r.credit)).toDb(),
      closingDebit: Money.sum(rows.map((r) => r.closingDebit)).toDb(),
      closingCredit: Money.sum(rows.map((r) => r.closingCredit)).toDb(),
    };
    return {
      companyId,
      from: start,
      asOf,
      rows,
      totals,
      balanced:
        totals.debit === totals.credit &&
        totals.closingDebit === totals.closingCredit,
    };
  }

  // ========================================================= general ledger

  async generalLedger(accountId: string, from: string | undefined, to: string) {
    const account = await this.db.tx
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (!account) throw new NotFoundException(MSG.ACCOUNT_NOT_FOUND);
    await this.assertView(account.company_id);
    const start = from ?? (await this.fiscalYearStart(account.company_id, to));
    const opening = net(
      (await this.sums(account.company_id, { before: start, accountId })).get(
        accountId,
      ),
    );
    const lines = await this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .leftJoin('departments as d', 'd.id', 'l.department_id')
      .select([
        'v.id as voucher_id',
        'v.number',
        'v.voucher_date',
        'v.narration',
        'v.voucher_type',
        'l.debit',
        'l.credit',
        'l.narration as line_narration',
        'd.name as department',
        'l.party_type',
        'l.party_id',
      ])
      .where('l.account_id', '=', accountId)
      .where('v.state', '=', 'posted')
      .where('v.voucher_date', '>=', start)
      .where('v.voucher_date', '<=', to)
      .orderBy('v.voucher_date')
      .orderBy('v.number')
      .orderBy('l.line_no')
      .execute();
    let running = opening;
    const sign = DEBIT_NORMAL.includes(account.type) ? 1 : -1;
    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name_en,
        type: account.type,
      },
      from: start,
      to,
      opening: Money.of(opening.toDb()).times(sign).toDb(),
      lines: lines.map((l) => {
        running = running.plus(l.debit).minus(l.credit);
        return {
          voucherId: l.voucher_id,
          number: l.number,
          date: l.voucher_date,
          type: l.voucher_type,
          narration: l.line_narration ?? l.narration,
          department: l.department,
          partyType: l.party_type,
          partyId: l.party_id,
          debit: l.debit,
          credit: l.credit,
          balance: running.times(sign).toDb(),
        };
      }),
      closing: running.times(sign).toDb(),
    };
  }

  // ======================================================== profit and loss

  async profitAndLoss(
    companyId: string,
    from: string | undefined,
    to: string,
    departmentId?: string,
  ) {
    await this.assertView(companyId);
    const start = from ?? (await this.fiscalYearStart(companyId, to));
    const accounts = await this.accounts(companyId);
    const sums = await this.sums(companyId, { from: start, to, departmentId });
    const section = (type: 'income' | 'expense') => {
      const lines = accounts
        .filter((a) => a.type === type && a.postable)
        .map((a) => {
          const s = net(sums.get(a.id));
          const amount = type === 'income' ? s.negate() : s;
          return {
            accountId: a.id,
            code: a.code,
            name: a.name_en,
            group: groupName(accounts, a.parent_id),
            amount: amount.toDb(),
          };
        })
        .filter((l) => l.amount !== '0.00');
      return { lines, total: Money.sum(lines.map((l) => l.amount)).toDb() };
    };
    const income = section('income');
    const expenses = section('expense');
    return {
      companyId,
      from: start,
      to,
      departmentId: departmentId ?? null,
      income,
      expenses,
      netProfit: Money.of(income.total).minus(expenses.total).toDb(),
    };
  }

  // ========================================================== balance sheet

  async balanceSheet(companyId: string, asOf: string) {
    await this.assertView(companyId);
    const yearStart = await this.fiscalYearStart(companyId, asOf);
    const accounts = await this.accounts(companyId);
    const all = await this.sums(companyId, { to: asOf });
    const beforeYear = await this.sums(companyId, { before: yearStart });

    const section = (type: 'asset' | 'liability' | 'equity') => {
      const lines = accounts
        .filter((a) => a.type === type && a.postable)
        .map((a) => {
          const s = net(all.get(a.id));
          return {
            accountId: a.id,
            code: a.code,
            name: a.name_en,
            group: groupName(accounts, a.parent_id),
            amount: (type === 'asset' ? s : s.negate()).toDb(),
          };
        })
        .filter((l) => l.amount !== '0.00');
      return lines;
    };
    // profit = income - expense (credit-normal), split into earlier years and this year
    const profit = (sums: Map<string, Sums>) =>
      accounts
        .filter((a) => a.type === 'income' || a.type === 'expense')
        .reduce((p, a) => p.minus(net(sums.get(a.id))), Money.zero());
    const broughtForward = profit(beforeYear);
    const thisYear = profit(all).minus(broughtForward);

    const assets = section('asset');
    const liabilities = section('liability');
    const equity = section('equity');
    if (!broughtForward.isZero())
      equity.push({
        accountId: '',
        code: '',
        name: 'Retained earnings brought forward (earlier years)',
        group: null,
        amount: broughtForward.toDb(),
      });
    equity.push({
      accountId: '',
      code: '',
      name: 'Profit for the year to date',
      group: null,
      amount: thisYear.toDb(),
    });
    const totalAssets = Money.sum(assets.map((l) => l.amount));
    const totalLiabilities = Money.sum(liabilities.map((l) => l.amount));
    const totalEquity = Money.sum(equity.map((l) => l.amount));
    return {
      companyId,
      asOf,
      fiscalYearStart: yearStart,
      assets: { lines: assets, total: totalAssets.toDb() },
      liabilities: { lines: liabilities, total: totalLiabilities.toDb() },
      equity: { lines: equity, total: totalEquity.toDb() },
      balanced: totalAssets.equals(totalLiabilities.plus(totalEquity)),
    };
  }

  // ============================================================== checks

  /** Nightly integrity checks (also on request). An empty list = all good. */
  async checks(companyId: string, options: { skipAccess?: boolean } = {}) {
    if (!options.skipAccess) await this.assertView(companyId);
    // sourceId: what Accounts can post from the screen (a skipped payroll run or salary file)
    const problems: Array<{
      check: string;
      detail: string;
      sourceId?: string;
    }> = [];

    // 1. the books balance
    const total = await this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .select([
        sql<string>`coalesce(sum(l.debit), 0)`.as('debit'),
        sql<string>`coalesce(sum(l.credit), 0)`.as('credit'),
      ])
      .where('v.company_id', '=', companyId)
      .where('v.state', '=', 'posted')
      .executeTakeFirstOrThrow();
    if (!Money.of(total.debit).equals(total.credit))
      problems.push({
        check: 'books_balance',
        detail: `debits ${total.debit} <> credits ${total.credit}`,
      });

    // only for companies with books
    const hasLedger = await this.db.tx
      .selectFrom('accounts')
      .select('id')
      .where('company_id', '=', companyId)
      .limit(1)
      .executeTakeFirst();
    if (!hasLedger) return { companyId, ok: problems.length === 0, problems };
    const firstPeriod = await this.db.tx
      .selectFrom('accounting_periods')
      .select(sql<string>`min(period)`.as('p'))
      .where('company_id', '=', companyId)
      .executeTakeFirst();

    // 2. every approved payroll run of the books' time is posted
    const runs = await this.db.tx
      .selectFrom('payroll_runs as r')
      .leftJoin('vouchers as v', (j) =>
        j
          .onRef('v.source_id', '=', 'r.id')
          .on('v.source_type', '=', PAYROLL_SOURCE)
          .on('v.state', '=', 'posted')
          .on('v.reversal_of', 'is', null),
      )
      .select(['r.id', 'r.period', 'r.run_type', 'v.number'])
      .where('r.company_id', '=', companyId)
      .where('r.state', 'in', ['approved', 'disbursed'])
      .where('r.period', '>=', firstPeriod?.p ?? '9999-12')
      .execute();
    for (const r of runs) {
      if (!r.number)
        problems.push({
          check: 'payroll_not_posted',
          detail: `${r.period} ${r.run_type} run`,
          sourceId: r.id,
        });
    }

    // 3. every settled salary file of the books' time is posted
    const files = await this.db.tx
      .selectFrom('disbursement_files as f')
      .leftJoin('vouchers as v', (j) =>
        j
          .onRef('v.source_id', '=', 'f.id')
          .on('v.source_type', '=', SALARY_PAYMENT_SOURCE)
          .on('v.state', '=', 'posted'),
      )
      .select(['f.id', 'f.file_name', 'f.settled_at', 'v.number'])
      .where('f.company_id', '=', companyId)
      .where('f.state', '=', 'settled')
      .execute();
    const booksFrom = firstPeriod?.p ? `${firstPeriod.p}-01` : '9999-12-31';
    for (const f of files) {
      if (
        !f.number &&
        f.settled_at &&
        f.settled_at.toISOString().slice(0, 10) >= booksFrom
      )
        problems.push({
          check: 'salary_payment_not_posted',
          detail: f.file_name,
          sourceId: f.id,
        });
    }

    // 4. sub-ledgers equal their control accounts
    for (const check of this.extraChecks)
      problems.push(...(await check(companyId)));
    return { companyId, ok: problems.length === 0, problems };
  }

  // =============================================================== helpers

  private async assertView(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
  }

  private accounts(companyId: string) {
    return this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code', 'name_en', 'type', 'parent_id', 'postable'])
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
  }

  /** Debit and credit totals per account of posted vouchers in a date window. */
  private async sums(
    companyId: string,
    w: {
      before?: string;
      from?: string;
      to?: string;
      accountId?: string;
      departmentId?: string;
    },
  ): Promise<Map<string, Sums>> {
    let q = this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .select([
        'l.account_id',
        sql<string>`sum(l.debit)`.as('debit'),
        sql<string>`sum(l.credit)`.as('credit'),
      ])
      .where('v.company_id', '=', companyId)
      .where('v.state', '=', 'posted');
    if (w.before) q = q.where('v.voucher_date', '<', w.before);
    if (w.from) q = q.where('v.voucher_date', '>=', w.from);
    if (w.to) q = q.where('v.voucher_date', '<=', w.to);
    if (w.accountId) q = q.where('l.account_id', '=', w.accountId);
    if (w.departmentId) q = q.where('l.department_id', '=', w.departmentId);
    const rows = await q.groupBy('l.account_id').execute();
    return new Map(rows.map((r) => [r.account_id, r]));
  }

  private async fiscalYearStart(
    companyId: string,
    date: string,
  ): Promise<string> {
    const company = await this.db.tx
      .selectFrom('companies')
      .select('fiscal_year_start')
      .where('id', '=', companyId)
      .executeTakeFirstOrThrow();
    return fiscalYearFor(businessDate(date), company.fiscal_year_start)
      .startsOn;
  }
}

/** debit - credit */
function net(s: Sums | undefined): Money {
  return s ? Money.of(s.debit).minus(s.credit) : Money.zero();
}

function groupName(
  accounts: Array<{ id: string; name_en: string }>,
  parentId: string | null,
): string | null {
  return parentId
    ? (accounts.find((a) => a.id === parentId)?.name_en ?? null)
    : null;
}
