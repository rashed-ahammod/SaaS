/**
 * Automatic postings from payroll (spec §6.6 "Auto-postings: payroll ... each
 * links back to its source document"; guide §12.5 "Phase 2 posts the same
 * entries automatically"):
 *
 *   payroll run approved   accrual journal on the last day of the month, per cost centre:
 *                            Dr salary expense (per earning head) / employer costs
 *                            Cr TDS, PF, staff advances (per employee), other deductions,
 *                               employer cost payables, salaries payable (net)
 *   bank file settled      payment voucher: Dr salaries payable / Cr bank, wallet or cash
 *
 * Payroll must never wait for the books: when the company has no ledger yet, a
 * posting account is missing or the month is closed, the posting is skipped and
 * recorded; the nightly checks list it and Accounts posts it later (postPayrollRun /
 * postDisbursementFile). One posting per source (database).
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { DisbursementFile, PayrollRun } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { DisbursementService } from '../disbursement/disbursement.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { PayrollRunsService } from '../payroll/payroll-runs.service.js';
import { LedgerSetupService } from './ledger-setup.service.js';
import {
  mergeLines,
  VouchersService,
  type PostingLine,
} from './vouchers.service.js';

export const PAYROLL_SOURCE = 'payroll_run';
export const SALARY_PAYMENT_SOURCE = 'disbursement_file';

class PostingProblem extends Error {
  constructor(readonly details: Record<string, unknown>) {
    super('posting not possible');
  }
}

@Injectable()
export class LedgerPostingService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly setup: LedgerSetupService,
    private readonly vouchers: VouchersService,
    private readonly payroll: PayrollRunsService,
    private readonly disbursement: DisbursementService,
  ) {}

  onModuleInit() {
    // inside the payroll approval / file settlement transaction; never throws
    this.payroll.onRunApproved((run) =>
      this.quietly(PAYROLL_SOURCE, run.id, () => this.payrollPosting(run)),
    );
    this.disbursement.onFileSettled((file) =>
      this.quietly(SALARY_PAYMENT_SOURCE, file.id, () =>
        this.paymentPosting(file),
      ),
    );
  }

  // ================================================== Accounts, later on

  /** Post an approved run that was skipped (e.g. after setting a posting account). */
  async postPayrollRun(runId: string) {
    const run = await this.payroll.findRunById(runId);
    this.access.assert('ledger.vouchers.prepare', {
      companyId: run.company_id,
    });
    if (run.state !== 'approved' && run.state !== 'disbursed')
      throw new ConflictException(MSG.PAYROLL_RUN_WRONG_STATE);
    const voucher = await this.loudly(() => this.payrollPosting(run));
    return this.vouchers.get(voucher.id);
  }

  /** Post a settled bank file that was skipped. */
  async postDisbursementFile(fileId: string) {
    const file = await this.db.tx
      .selectFrom('disbursement_files')
      .selectAll()
      .where('id', '=', fileId)
      .executeTakeFirst();
    if (!file) throw new NotFoundException(MSG.DISBURSEMENT_FILE_NOT_FOUND);
    this.access.assert('ledger.vouchers.prepare', {
      companyId: file.company_id,
    });
    if (file.state !== 'settled')
      throw new ConflictException(MSG.VOUCHER_WRONG_STATE);
    const voucher = await this.loudly(() => this.paymentPosting(file));
    return this.vouchers.get(voucher.id);
  }

  // ============================================================ postings

  private async payrollPosting(run: PayrollRun) {
    const account = await this.accountsFor(run.company_id);
    const { lines, nets, departmentOf, periodEnd } =
      await this.payroll.journalInputs(run);
    const date = periodEnd;
    await this.assertOpen(run.company_id, date);

    // every line, then merged per account x cost centre (x employee for staff advances)
    const missing = new Set<string>();
    const pick = (key: string, fallback: string) =>
      account(key, fallback) ?? (missing.add(key), '');
    const posting: PostingLine[] = [];
    for (const l of lines) {
      const departmentId = departmentOf.get(l.employee_id) ?? null;
      const amount = Money.of(l.amount);
      // a negative earning (unpaid days) reduces the expense: the sign carries over
      const side = (debit: boolean, value: Money) =>
        value.isNegative()
          ? debit
            ? { credit: value.negate().toDb() }
            : { debit: value.negate().toDb() }
          : debit
            ? { debit: value.toDb() }
            : { credit: value.toDb() };
      if (l.kind === 'earning')
        posting.push({
          accountId: pick(`payroll.earning.${l.head_code}`, 'payroll.earnings'),
          departmentId,
          ...side(true, amount),
        });
      if (l.kind === 'deduction') {
        const advance = l.head_code === 'LOAN_RECOVERY';
        posting.push({
          accountId: pick(
            `payroll.deduction.${l.head_code}`,
            'payroll.deductions',
          ),
          departmentId,
          ...side(false, amount),
          ...(advance
            ? { partyType: 'employee' as const, partyId: l.employee_id }
            : {}),
        });
      }
      if (l.kind === 'employer_cost') {
        posting.push({
          accountId: pick(
            `payroll.employer_cost.${l.head_code}`,
            'payroll.employer_costs',
          ),
          departmentId,
          ...side(true, amount),
        });
        posting.push({
          accountId: pick(
            `payroll.employer_cost_payable.${l.head_code}`,
            'payroll.employer_cost_payables',
          ),
          departmentId,
          ...side(false, amount),
        });
      }
    }
    for (const n of nets) {
      posting.push({
        accountId: pick('payroll.salaries_payable', 'payroll.salaries_payable'),
        departmentId: departmentOf.get(n.employee_id) ?? null,
        credit: n.net,
      });
    }
    if (missing.size)
      throw new PostingProblem({ missingPostingAccounts: [...missing].sort() });

    const label =
      run.run_type === 'bonus'
        ? `Festival bonus ${run.bonus_name ?? ''}`.trim()
        : run.run_type === 'final_settlement'
          ? 'Final settlement'
          : 'Salary';
    return this.vouchers.postAutomatic({
      companyId: run.company_id,
      voucherType: 'journal',
      voucherDate: date,
      narration: `${label} ${run.period}: payroll journal`,
      sourceType: PAYROLL_SOURCE,
      sourceId: run.id,
      lines: mergeLines(posting.filter((p) => p.debit || p.credit)),
    });
  }

  private async paymentPosting(file: DisbursementFile) {
    const account = await this.accountsFor(file.company_id);
    const date = todayInDhaka(this.clock.now());
    await this.assertOpen(file.company_id, date);
    const paid = await this.disbursement.paidInFile(file.id);
    if (!Money.of(paid.amount).isPositive())
      throw new PostingProblem({ nothingPaid: true });

    const moneyKey =
      file.channel === 'bank'
        ? 'payroll.payment.bank'
        : file.channel === 'cash'
          ? 'payroll.payment.cash'
          : 'payroll.payment.wallet';
    const payable = account('payroll.salaries_payable');
    const from = account(`payroll.payment.${file.channel}`, moneyKey);
    if (!payable || !from)
      throw new PostingProblem({
        missingPostingAccounts: [
          !payable && 'payroll.salaries_payable',
          !from && moneyKey,
        ].filter(Boolean),
      });

    return this.vouchers.postAutomatic({
      companyId: file.company_id,
      voucherType: 'payment',
      voucherDate: date,
      narration: `Salary paid: ${file.file_name} (${paid.count} payments, ${file.channel})`,
      sourceType: SALARY_PAYMENT_SOURCE,
      sourceId: file.id,
      lines: [
        { accountId: payable, debit: paid.amount },
        { accountId: from, credit: paid.amount },
      ],
    });
  }

  // ============================================================ helpers

  /** The company's posting accounts; PostingProblem when the ledger is not set up. */
  private async accountsFor(companyId: string) {
    const status = await this.db.tx
      .selectFrom('accounts')
      .select('id')
      .where('company_id', '=', companyId)
      .limit(1)
      .executeTakeFirst();
    if (!status) throw new PostingProblem({ ledgerNotSetUp: true });
    return this.setup.resolvePostingAccounts(companyId);
  }

  private async assertOpen(companyId: string, date: string) {
    if (!(await this.vouchers.canPostOn(companyId, date)))
      throw new PostingProblem({ periodNotOpen: date.slice(0, 7) });
  }

  /**
   * Automatic: a problem is recorded (audit) instead of failing the payroll step.
   * Every check runs before the first write of the posting, so skipping leaves the
   * surrounding transaction intact; a database error is never swallowed.
   */
  private async quietly(
    sourceType: string,
    sourceId: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await work();
    } catch (err) {
      const details =
        err instanceof PostingProblem
          ? err.details
          : err instanceof HttpException
            ? {
                refused:
                  (err.getResponse() as { message?: unknown }).message ??
                  err.message,
              }
            : null;
      if (!details) throw err;
      await this.audit.record({
        action: 'ledger.posting_skipped',
        entity: sourceType,
        entityId: sourceId,
        after: details,
      });
    }
  }

  /** On request: a problem is an error with its details. */
  private async loudly<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (!(err instanceof PostingProblem)) throw err;
      if (err.details.ledgerNotSetUp)
        throw new BadRequestException(MSG.LEDGER_NOT_SET_UP);
      if (err.details.periodNotOpen)
        throw new ConflictException({
          message: MSG.PERIOD_CLOSED,
          details: err.details,
        });
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: err.details,
      });
    }
  }
}
