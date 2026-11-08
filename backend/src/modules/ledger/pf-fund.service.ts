/**
 * The provident fund beyond the monthly contributions (2026-10-30; spec §6.4 "PF ledger with
 * company match", Labour Act 2006 ch. 15). The fund is held in the company's books on the PF
 * payable account (2170), where payroll credits both parts every month.
 *
 *   creditInterest(year, rate)   the rate the trustees declared, on each member's balance at the
 *                     end of the fiscal year, to both parts in proportion; once per member and
 *                     year; posted at once: Dr PF interest (5140), Cr PF payable
 *   withdraw          out of the member's own part only, never more than it holds; Accounts
 *                     prepares the payment voucher for the checker (Dr PF payable, Cr bank / cash)
 *   settlementPreview / settle   on leaving (notice or separated): the member's own part, and
 *                     the employer part as far as it has vested by years of service (PF_VESTING,
 *                     a PLACEHOLDER: verify against the PF trust deed); the rest is forfeited to the
 *                     company. One payment voucher to the checker: Dr PF payable (all of it),
 *                     Cr bank (paid), Cr other income (forfeited). Afterwards the balance is nil.
 *
 * Withdrawals and settlements count in the ledger once their voucher is posted.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Voucher } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { PAID_STATES } from '../payroll/payroll-periods.js';
import { PayrollSetupService } from '../payroll/payroll-setup.service.js';
import type {
  PfInterestDto,
  PfSettlementDto,
  PfWithdrawalDto,
} from './dto/pf-fund.dto.js';
import { LedgerSetupService } from './ledger-setup.service.js';
import { VouchersService } from './vouchers.service.js';

export const PF_INTEREST_SOURCE = 'pf_interest';
export const PF_PAYMENT_SOURCE = 'pf_payment';

/** Employer part vested by completed years of service (PLACEHOLDER: verify against the trust deed). */
export const PF_VESTING = [
  { years: 5, percent: '100' },
  { years: 3, percent: '50' },
] as const;

export function vestedPercent(years: number): string {
  return PF_VESTING.find((v) => years >= v.years)?.percent ?? '0';
}

/** Completed years between two business dates. */
export function completedYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}

@Injectable()
export class PfFundService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly setup: LedgerSetupService,
    private readonly vouchers: VouchersService,
    private readonly payroll: PayrollSetupService,
  ) {}

  onModuleInit() {
    this.vouchers.registerSource(PF_PAYMENT_SOURCE, {
      onPosted: (v) => this.paymentState(v, 'posted'),
      onDropped: (v) => this.paymentState(v, 'cancelled'),
      // a PF payment out is not undone by a reversal: the member has the money
      assertReversible: () =>
        Promise.reject(new ConflictException(MSG.PF_PAYMENT_NOT_REVERSIBLE)),
    });
    this.vouchers.registerSource(PF_INTEREST_SOURCE, {
      assertReversible: () =>
        Promise.reject(new ConflictException(MSG.PF_PAYMENT_NOT_REVERSIBLE)),
    });
  }

  /** A member's two parts on a date: opening + contributions + posted interest, withdrawals and settlement. */
  async balanceAsOf(employeeId: string, date: string) {
    const opening = await this.db.tx
      .selectFrom('pf_openings')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('as_of', '<=', date)
      .executeTakeFirst();
    let q = this.db.tx
      .selectFrom('payroll_lines as l')
      .innerJoin('payroll_runs as r', 'r.id', 'l.run_id')
      .select([
        'l.head_code',
        sql<string>`coalesce(sum(l.amount), 0)::text`.as('s'),
      ])
      .where('l.employee_id', '=', employeeId)
      .where('l.head_code', 'in', ['PF_EMPLOYEE', 'PF_EMPLOYER'])
      .where('r.state', 'in', PAID_STATES)
      .where('r.period', '<=', date.slice(0, 7))
      .groupBy('l.head_code');
    if (opening) q = q.where('r.period', '>', opening.as_of.slice(0, 7));
    const runs = await q.execute();
    const txns = await this.db.tx
      .selectFrom('pf_transactions')
      .select([
        sql<string>`coalesce(sum(employee_part), 0)::text`.as('e'),
        sql<string>`coalesce(sum(employer_part), 0)::text`.as('r'),
      ])
      .where('employee_id', '=', employeeId)
      .where('state', '=', 'posted')
      .where('txn_date', '<=', date)
      .executeTakeFirstOrThrow();
    const employee = Money.of(opening?.employee_part ?? '0')
      .plus(runs.find((r) => r.head_code === 'PF_EMPLOYEE')?.s ?? '0')
      .plus(txns.e);
    const employer = Money.of(opening?.employer_part ?? '0')
      .plus(runs.find((r) => r.head_code === 'PF_EMPLOYER')?.s ?? '0')
      .plus(txns.r);
    return { employee, employer };
  }

  // ================================================================ interest

  async creditInterest(companyId: string, dto: PfInterestDto) {
    await this.org.assertCompanyExists(companyId);
    if (
      !this.access.allows('payroll.prepare', { companyId }) &&
      !this.access.allows('ledger.vouchers.prepare', { companyId })
    )
      this.access.assert('payroll.prepare', { companyId });
    const [start] = dto.fiscalYear.split('-').map(Number);
    const yearEnd = `${start + 1}-06-30`;
    if (yearEnd > todayInDhaka(this.clock.now()))
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: [
            `Interest for ${dto.fiscalYear} is credited after 30 June ${start + 1}`,
          ],
        },
      });
    const account = await this.accounts(companyId, [
      'pf.payable',
      'pf.interest',
    ]);
    const members = await this.members(companyId);
    const done = new Set(
      (
        await this.db.tx
          .selectFrom('pf_transactions')
          .select('employee_id')
          .where('company_id', '=', companyId)
          .where('kind', '=', 'interest')
          .where('fiscal_year', '=', dto.fiscalYear)
          .execute()
      ).map((r) => r.employee_id),
    );
    const rows: Array<{
      employeeId: string;
      employeePart: string;
      employerPart: string;
    }> = [];
    for (const employeeId of members) {
      if (done.has(employeeId)) continue;
      const b = await this.balanceAsOf(employeeId, yearEnd);
      const e = b.employee.times(dto.ratePercent).dividedBy(100).round();
      const r = b.employer.times(dto.ratePercent).dividedBy(100).round();
      if (!e.isPositive() && !r.isPositive()) continue;
      rows.push({ employeeId, employeePart: e.toDb(), employerPart: r.toDb() });
    }
    if (!rows.length)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: [
            `No member is due interest for ${dto.fiscalYear} (credited already, or no balance)`,
          ],
        },
      });
    const total = Money.sum(
      rows.flatMap((r) => [r.employeePart, r.employerPart]),
    ).toDb();
    const sourceId = (
      await this.db.tx
        .insertInto('pf_transactions')
        .values(
          rows.map((r) => ({
            company_id: companyId,
            employee_id: r.employeeId,
            kind: 'interest' as const,
            txn_date: yearEnd,
            employee_part: r.employeePart,
            employer_part: r.employerPart,
            fiscal_year: dto.fiscalYear,
            rate_percent: dto.ratePercent,
            note: `Interest ${dto.ratePercent}% for ${dto.fiscalYear}`,
          })),
        )
        .returning('id')
        .execute()
    )[0].id;
    const voucher = await this.vouchers.postAutomatic({
      companyId,
      voucherType: 'journal',
      voucherDate: yearEnd,
      narration: `PF interest ${dto.ratePercent}% for ${dto.fiscalYear} (${rows.length} members)`,
      sourceType: PF_INTEREST_SOURCE,
      sourceId,
      lines: [
        { accountId: account('pf.interest'), debit: total },
        { accountId: account('pf.payable'), credit: total },
      ],
    });
    await this.db.tx
      .updateTable('pf_transactions')
      .set({ voucher_id: voucher.id })
      .where('company_id', '=', companyId)
      .where('kind', '=', 'interest')
      .where('fiscal_year', '=', dto.fiscalYear)
      .where('voucher_id', 'is', null)
      .execute();
    await this.audit.record({
      action: 'pf.interest_credited',
      entity: 'company',
      entityId: companyId,
      after: {
        fiscalYear: dto.fiscalYear,
        rate: dto.ratePercent,
        members: rows.length,
        total,
        voucher: voucher.number,
      },
    });
    return {
      fiscalYear: dto.fiscalYear,
      ratePercent: dto.ratePercent,
      members: rows.length,
      total,
      voucherNumber: voucher.number,
    };
  }

  // ================================================================ withdrawal

  async withdraw(employeeId: string, dto: PfWithdrawalDto) {
    const employee = await this.payer(employeeId);
    const date = businessDate(dto.date);
    await this.assertNoPending(employeeId);
    const own = (
      await this.balanceAsOf(
        employeeId,
        todayInDhaka(this.clock.now()) > date
          ? todayInDhaka(this.clock.now())
          : date,
      )
    ).employee;
    if (
      Money.of(dto.amount).greaterThan(own) ||
      !Money.of(dto.amount).isPositive()
    )
      throw new BadRequestException({
        message: MSG.PF_TOO_MUCH,
        details: { ownPart: own.toDb() },
      });
    const account = await this.accounts(employee.company_id, ['pf.payable']);
    const money = await this.moneyAccount(
      employee.company_id,
      dto.paidFromAccountId,
    );
    const t = await this.db.tx
      .insertInto('pf_transactions')
      .values({
        company_id: employee.company_id,
        employee_id: employeeId,
        kind: 'withdrawal',
        txn_date: date,
        employee_part: Money.of(dto.amount).negate().toDb(),
        employer_part: '0',
        note: dto.reason,
        state: 'in_approval',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const voucher = await this.vouchers.createLinked({
      companyId: employee.company_id,
      voucherType: 'payment',
      voucherDate: date,
      narration: `PF withdrawal: ${employee.employee_code} ${employee.full_name_en} (${dto.reason})`,
      sourceType: PF_PAYMENT_SOURCE,
      sourceId: t.id,
      lines: [
        {
          accountId: account('pf.payable'),
          debit: Money.of(dto.amount).toDb(),
          narration: employee.employee_code,
        },
        { accountId: money, credit: Money.of(dto.amount).toDb() },
      ],
    });
    await this.db.tx
      .updateTable('pf_transactions')
      .set({ voucher_id: voucher.id })
      .where('id', '=', t.id)
      .execute();
    await this.audit.record({
      action: 'pf.withdrawal',
      entity: 'employee',
      entityId: employeeId,
      after: {
        amount: dto.amount,
        reason: dto.reason,
        voucher: voucher.number,
      },
    });
    return {
      id: t.id,
      voucherNumber: voucher.number,
      approvalRequestId: voucher.approval_request_id,
    };
  }

  // ================================================================ final settlement

  async settlementPreview(employeeId: string, date?: string) {
    const employee = await this.payroll.checkSalaryRead(employeeId);
    const on = businessDate(
      date ?? employee.last_working_day ?? todayInDhaka(this.clock.now()),
    );
    const b = await this.balanceAsOf(employeeId, '9999-12-31');
    const years = completedYears(employee.join_date, on);
    const percent = vestedPercent(years);
    const vested = b.employer.times(percent).dividedBy(100).round();
    const forfeit = b.employer.minus(vested);
    const settled = await this.db.tx
      .selectFrom('pf_transactions')
      .select(['id', 'state', 'txn_date'])
      .where('employee_id', '=', employeeId)
      .where('kind', '=', 'settlement')
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    return {
      employeeId,
      date: on,
      joinDate: employee.join_date,
      status: employee.status,
      yearsOfService: years,
      vestedPercent: Money.of(percent).toDb(),
      ownPart: b.employee.toDb(),
      employerPart: b.employer.toDb(),
      vestedEmployerPart: vested.toDb(),
      forfeited: forfeit.toDb(),
      payable: b.employee.plus(vested).toDb(),
      canSettle: ['notice', 'separated'].includes(employee.status) && !settled,
      settlement: settled
        ? { id: settled.id, state: settled.state, date: settled.txn_date }
        : null,
      rule:
        PF_VESTING.map((v) => `${v.years}+ years: ${v.percent}%`).join(', ') +
        ', less: 0% (placeholder)',
    };
  }

  async settle(employeeId: string, dto: PfSettlementDto) {
    const p = await this.settlementPreview(employeeId, dto.date);
    if (!['notice', 'separated'].includes(p.status))
      throw new ConflictException(MSG.PF_NOT_LEAVING);
    if (p.settlement) throw new ConflictException(MSG.PF_SETTLED);
    await this.assertNoPending(employeeId);
    const total = Money.of(p.ownPart).plus(p.employerPart);
    if (!total.isPositive())
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['The PF balance is nil'] },
      });
    const employee = await this.payer(employeeId);
    const forfeit = Money.of(p.forfeited);
    const account = await this.accounts(employee.company_id, [
      'pf.payable',
      ...(forfeit.isPositive() ? ['pf.forfeit'] : []),
    ]);
    const money = await this.moneyAccount(
      employee.company_id,
      dto.paidFromAccountId,
    );
    const base = {
      company_id: employee.company_id,
      employee_id: employeeId,
      txn_date: p.date,
      state: 'in_approval' as const,
      note: dto.note ?? null,
    };
    const t = await this.db.tx
      .insertInto('pf_transactions')
      .values({
        ...base,
        kind: 'settlement',
        employee_part: Money.of(p.ownPart).negate().toDb(),
        employer_part: Money.of(p.vestedEmployerPart).negate().toDb(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (forfeit.isPositive())
      await this.db.tx
        .insertInto('pf_transactions')
        .values({
          ...base,
          kind: 'forfeit',
          employee_part: '0',
          employer_part: forfeit.negate().toDb(),
        })
        .execute();
    const voucher = await this.vouchers.createLinked({
      companyId: employee.company_id,
      voucherType: 'payment',
      voucherDate: p.date,
      narration: `PF final settlement: ${employee.employee_code} ${employee.full_name_en}, ${p.yearsOfService} years (employer part ${p.vestedPercent}% vested)`,
      sourceType: PF_PAYMENT_SOURCE,
      sourceId: t.id,
      lines: [
        {
          accountId: account('pf.payable'),
          debit: total.toDb(),
          narration: employee.employee_code,
        },
        ...(Money.of(p.payable).isPositive()
          ? [{ accountId: money, credit: p.payable }]
          : []),
        ...(forfeit.isPositive()
          ? [
              {
                accountId: account('pf.forfeit'),
                credit: forfeit.toDb(),
                narration: 'Employer PF not vested',
              },
            ]
          : []),
      ],
    });
    await this.db.tx
      .updateTable('pf_transactions')
      .set({ voucher_id: voucher.id })
      .where('employee_id', '=', employeeId)
      .where('state', '=', 'in_approval')
      .where('kind', 'in', ['settlement', 'forfeit'])
      .execute();
    await this.audit.record({
      action: 'pf.settlement',
      entity: 'employee',
      entityId: employeeId,
      after: { ...p, voucher: voucher.number },
    });
    return {
      ...(await this.settlementPreview(employeeId, dto.date)),
      voucherNumber: voucher.number,
      approvalRequestId: voucher.approval_request_id,
    };
  }

  // ================================================================ internals

  /** PF money goes out like any payment: Accounts prepares the voucher (and reads the member's PF). */
  private async payer(employeeId: string) {
    const employee = await this.payroll.checkSalaryRead(employeeId);
    this.access.assert('ledger.vouchers.prepare', {
      companyId: employee.company_id,
    });
    return employee;
  }

  private async paymentState(v: Voucher, state: 'posted' | 'cancelled') {
    await this.db.tx
      .updateTable('pf_transactions')
      .set({ state })
      .where('voucher_id', '=', v.id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  private async assertNoPending(employeeId: string) {
    const pending = await this.db.tx
      .selectFrom('pf_transactions')
      .select('id')
      .where('employee_id', '=', employeeId)
      .where('state', '=', 'in_approval')
      .executeTakeFirst();
    if (pending) throw new ConflictException(MSG.PF_PENDING);
  }

  /** Members: anyone of the company with a PF opening or a PF contribution. */
  private async members(companyId: string): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('employees as e')
      .select('e.id')
      .where('e.company_id', '=', companyId)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('pf_openings as o')
              .select('o.id')
              .whereRef('o.employee_id', '=', 'e.id'),
          ),
          eb.exists(
            eb
              .selectFrom('payroll_lines as l')
              .select('l.id')
              .whereRef('l.employee_id', '=', 'e.id')
              .where('l.head_code', 'in', ['PF_EMPLOYEE', 'PF_EMPLOYER']),
          ),
        ]),
      )
      .execute();
    return rows.map((r) => r.id);
  }

  private async accounts(companyId: string, keys: string[]) {
    const resolve = await this.setup.resolvePostingAccounts(companyId);
    const fallback: Record<string, string> = {
      'pf.payable': 'payroll.deduction.PF_EMPLOYEE',
      'pf.interest': 'payroll.employer_cost.PF_EMPLOYER',
    };
    const get = (k: string) => resolve(k, fallback[k]);
    const missing = keys.filter((k) => !get(k));
    if (missing.length)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: missing },
      });
    return (k: string) => get(k)!;
  }

  private async moneyAccount(companyId: string, id: string) {
    const a = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'role', 'postable', 'is_active'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (
      !a ||
      a.company_id !== companyId ||
      !a.postable ||
      !a.is_active ||
      !['cash', 'bank'].includes(a.role ?? '')
    )
      throw new BadRequestException(MSG.PAYMENT_ACCOUNT_NOT_MONEY);
    return a.id;
  }
}
