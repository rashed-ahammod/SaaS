/**
 * Salary disbursement (spec §6.4 steps 8-9, guide §13):
 *
 *   1. payroll approved   -> one payment per employee (net > 0), to the salary
 *                            account approved at that moment (no account: cash).
 *                            The unique index makes a second payment for the same
 *                            employee, month and pay type impossible.
 *   2. generate file      -> per channel (bank / bKash / Nagad / ... / cash) with an
 *                            adapter; checksum stored; payments "in_file".
 *                            Step-up 2FA on the route (spec §11).
 *   3. settle             -> the bank paid: payments "paid"; when every payment of
 *                            the run is paid the run is "disbursed" (payroll.disbursed).
 *   4. return file import -> rejected payments "returned"; re-issue creates a NEW
 *                            payment linked to the returned one.
 *   5. regenerate         -> only after the active file is cancelled with a reason
 *                            and a second approval (Admin); its payments are freed.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { sha256Hex } from '../../platform/crypto/canonical-json.js';
import { toBusinessDate } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  DisbursementFile,
  Payment,
  PaymentChannel,
  PayrollRun,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { FileStorage } from '../../platform/storage/file-storage.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { BankAccountsService } from '../bank-accounts/bank-accounts.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { PayrollRunsService } from '../payroll/payroll-runs.service.js';
import {
  ADAPTERS,
  adapterFor,
  channelOf,
  parseReturnFile,
  type FileItem,
} from './adapters.js';
import type {
  DisbursementReasonDto,
  GenerateFileDto,
  ImportReturnsDto,
} from './dto/disbursement.dto.js';

export const DISBURSEMENT_FILE_CANCEL = 'disbursement_file_cancel';

@Injectable()
export class DisbursementService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly storage: FileStorage,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly runs: PayrollRunsService,
    private readonly bank: BankAccountsService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
  ) {}

  private readonly settledListeners: Array<
    (file: DisbursementFile) => Promise<void>
  > = [];

  /** Called inside the settle transaction for every file the bank confirmed. */
  onFileSettled(listener: (file: DisbursementFile) => Promise<void>): void {
    this.settledListeners.push(listener);
  }

  /** The payments of a file that the bank paid, and their total. */
  async paidInFile(fileId: string): Promise<{ count: number; amount: string }> {
    const rows = await this.db.tx
      .selectFrom('payments')
      .select('amount')
      .where('file_id', '=', fileId)
      .where('status', '=', 'paid')
      .execute();
    return {
      count: rows.length,
      amount: Money.sum(rows.map((r) => r.amount)).toDb(),
    };
  }

  onModuleInit() {
    // payments are created inside the payroll approval's transaction
    this.runs.onRunApproved(async (run) => {
      await this.createPayments(run);
    });

    // guide §13 step 3: regenerating needs the active file cancelled with a second approval
    this.handlers.register(
      DISBURSEMENT_FILE_CANCEL,
      {
        onApproved: (r) => this.applyCancel(r),
        onClosed: (r) => this.discardCancel(r),
      },
      [
        defaultChain(
          'Cancel disbursement file (default)',
          step(1, 'role:admin'),
        ),
      ],
    );
  }

  // ================================================================ payments

  /** One payment per employee with a positive net pay. */
  async createPayments(run: PayrollRun): Promise<number> {
    const nets = (await this.runs.netPayOf(run.id)).filter((n) =>
      Money.of(n.net).isPositive(),
    );
    const accounts = await this.bank.salaryAccounts(
      nets.map((n) => n.employee_id),
    );
    for (const n of nets) {
      const account = accounts.get(n.employee_id);
      await this.db.tx
        .insertInto('payments')
        .values({
          company_id: run.company_id,
          run_id: run.id,
          employee_id: n.employee_id,
          period: run.period,
          pay_type: payTypeOf(run),
          amount: n.net,
          channel: channelOf(account),
          bank_account_id: account?.accountId ?? null,
          reference: newReference(run.period),
        })
        .execute();
    }
    await this.audit.record({
      action: 'payments.created',
      entity: 'payroll_run',
      entityId: run.id,
      after: { payments: nets.length },
    });
    // nothing to pay (e.g. every net is zero or negative): the run is done
    if (nets.length === 0) await this.runs.markDisbursed(run.id);
    return nets.length;
  }

  /** Payments of a run with totals per channel and status (needs salary field access). */
  async listPayments(runId: string) {
    const run = await this.runs.findRunById(runId);
    this.assertCanSee(run.company_id);
    const rows = await this.db.tx
      .selectFrom('payments as p')
      .innerJoin('employees as e', 'e.id', 'p.employee_id')
      .select([
        'p.id',
        'p.employee_id',
        'e.employee_code',
        'e.full_name_en',
        'p.pay_type',
        'p.amount',
        'p.channel',
        'p.reference',
        'p.status',
        'p.file_id',
        'p.reissue_of',
        'p.returned_reason',
        'p.paid_at',
      ])
      .where('p.run_id', '=', run.id)
      .orderBy('e.employee_code')
      .orderBy('p.created_at')
      .execute();

    const summary = new Map<
      string,
      { channel: string; status: string; count: number; amount: Money }
    >();
    for (const p of rows) {
      const key = `${p.channel}:${p.status}`;
      const s = summary.get(key) ?? {
        channel: p.channel,
        status: p.status,
        count: 0,
        amount: Money.zero(),
      };
      s.count++;
      s.amount = s.amount.plus(p.amount);
      summary.set(key, s);
    }
    return {
      runId: run.id,
      runState: run.state,
      summary: [...summary.values()].map((s) => ({
        channel: s.channel,
        status: s.status,
        count: s.count,
        amount: s.amount.toDb(),
      })),
      payments: rows.map((p) => ({
        id: p.id,
        employeeId: p.employee_id,
        employeeCode: p.employee_code,
        fullNameEn: p.full_name_en,
        payType: p.pay_type,
        amount: p.amount,
        channel: p.channel,
        reference: p.reference,
        status: p.status,
        fileId: p.file_id,
        reissueOf: p.reissue_of,
        returnedReason: p.returned_reason,
        paidAt: p.paid_at,
      })),
    };
  }

  /**
   * Re-issue a returned payment: a new payment to the employee's salary account
   * approved now (fixed after the return), or cash. The returned one becomes "reissued".
   */
  async reissue(paymentId: string, dto: DisbursementReasonDto) {
    // find the payment, check access and status
    const original = await this.findPayment(paymentId);
    this.access.assert('payroll.disburse', { companyId: original.company_id });
    if (original.status !== 'returned')
      throw new ConflictException(MSG.PAYMENT_NOT_RETURNED);

    // the destination now
    const account = (
      await this.bank.salaryAccounts([original.employee_id])
    ).get(original.employee_id);
    await this.db.tx
      .updateTable('payments')
      .set({ status: 'reissued' })
      .where('id', '=', original.id)
      .execute();
    const payment = await this.db.tx
      .insertInto('payments')
      .values({
        company_id: original.company_id,
        run_id: original.run_id,
        employee_id: original.employee_id,
        period: original.period,
        pay_type: original.pay_type,
        amount: original.amount,
        channel: channelOf(account),
        bank_account_id: account?.accountId ?? null,
        reference: newReference(original.period),
        reissue_of: original.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'payment.reissued',
      entity: 'payroll_run',
      entityId: original.run_id,
      before: {
        paymentId: original.id,
        channel: original.channel,
        reference: original.reference,
      },
      after: {
        paymentId: payment.id,
        channel: payment.channel,
        reference: payment.reference,
        reason: dto.reason,
      },
    });
    return toPaymentResponse(payment);
  }

  // ================================================================ files

  /** Build the file for one channel from the payments waiting for it. */
  async generateFile(runId: string, dto: GenerateFileDto) {
    // find run, check access and state
    const run = await this.runs.findRunById(runId);
    this.access.assert('payroll.disburse', { companyId: run.company_id });
    if (run.state !== 'approved')
      throw new ConflictException(MSG.PAYROLL_NOT_APPROVED);
    const adapter = adapterFor(dto.channel, dto.adapter);
    if (!adapter)
      throw new BadRequestException({
        message: MSG.DISBURSEMENT_ADAPTER_UNKNOWN,
        details: {
          channel: dto.channel,
          formats: ADAPTERS.filter((a) => a.channel === dto.channel).map(
            (a) => a.code,
          ),
        },
      });

    // one active file per run and channel
    const active = await this.db.tx
      .selectFrom('disbursement_files')
      .select('id')
      .where('run_id', '=', run.id)
      .where('channel', '=', dto.channel)
      .where('state', '=', 'active')
      .executeTakeFirst();
    if (active)
      throw new ConflictException({
        message: MSG.DISBURSEMENT_FILE_ACTIVE,
        details: { fileId: active.id },
      });

    // payments waiting for this channel
    const payments = await this.db.tx
      .selectFrom('payments as p')
      .innerJoin('employees as e', 'e.id', 'p.employee_id')
      .select([
        'p.id',
        'p.reference',
        'p.amount',
        'p.bank_account_id',
        'e.employee_code',
        'e.full_name_en',
      ])
      .where('p.run_id', '=', run.id)
      .where('p.channel', '=', dto.channel)
      .where('p.status', '=', 'approved')
      .orderBy('e.employee_code')
      .execute();
    if (payments.length === 0)
      throw new BadRequestException(MSG.DISBURSEMENT_NOTHING_TO_PAY);

    // build the file (account numbers are decrypted only here)
    const details = await this.bank.paymentDetails(
      payments.flatMap((p) => (p.bank_account_id ? [p.bank_account_id] : [])),
    );
    const items: FileItem[] = payments.map((p) => ({
      reference: p.reference,
      amount: p.amount,
      employeeCode: p.employee_code,
      employeeName: p.full_name_en,
      details: p.bank_account_id
        ? (details.get(p.bank_account_id) ?? null)
        : null,
    }));
    const company = await this.org.companyNames(run.company_id);
    const fileDate = toBusinessDate(this.clock.now());
    const text = adapter.build(
      {
        companyName: company.legalName,
        period: run.period,
        payType: payTypeOf(run),
        fileDate,
      },
      items,
    );
    const content = Buffer.from(text, 'utf8');
    const total = Money.sum(payments.map((p) => p.amount));

    // store it, with its checksum
    const tenantId = requestContext.get().tenantId;
    const fileKey = `${tenantId}/disbursement-files/${randomUUID()}`;
    await this.storage.put(fileKey, content);
    const file = await this.db.tx
      .insertInto('disbursement_files')
      .values({
        company_id: run.company_id,
        run_id: run.id,
        channel: dto.channel,
        adapter: adapter.code,
        file_key: fileKey,
        file_name: `${adapter.code}-${run.period}-${payTypeOf(run)
          .replace(/[^a-z0-9]+/gi, '-')
          .toLowerCase()}-${fileDate}.csv`,
        content_type: 'text/csv',
        checksum_sha256: sha256Hex(text),
        payment_count: payments.length,
        total_amount: total.toDb(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .updateTable('payments')
      .set({ status: 'in_file', file_id: file.id })
      .where(
        'id',
        'in',
        payments.map((p) => p.id),
      )
      .execute();

    // audit without account numbers
    await this.audit.record({
      action: 'disbursement_file.generated',
      entity: 'payroll_run',
      entityId: run.id,
      after: {
        fileId: file.id,
        channel: file.channel,
        adapter: file.adapter,
        payments: file.payment_count,
        total: file.total_amount,
        checksum: file.checksum_sha256,
      },
    });
    await this.outbox.add({
      type: 'disbursement.file_generated',
      entityId: file.id,
      payload: {
        fileId: file.id,
        runId: run.id,
        channel: file.channel,
        payments: file.payment_count,
      },
    });
    return toFileResponse(file);
  }

  async listFiles(runId: string) {
    const run = await this.runs.findRunById(runId);
    this.assertCanSee(run.company_id);
    const files = await this.db.tx
      .selectFrom('disbursement_files')
      .selectAll()
      .where('run_id', '=', run.id)
      .orderBy('created_at')
      .execute();
    return files.map(toFileResponse);
  }

  async downloadFile(fileId: string) {
    const file = await this.findFile(fileId);
    this.access.assert('payroll.disburse', { companyId: file.company_id });
    const content = await this.storage.get(file.file_key);
    // the stored file must still be what was generated
    if (sha256Hex(content.toString('utf8')) !== file.checksum_sha256)
      throw new ConflictException(
        'The stored file does not match its checksum',
      );
    await this.audit.record({
      action: 'disbursement_file.downloaded',
      entity: 'payroll_run',
      entityId: file.run_id,
      after: { fileId: file.id },
    });
    return {
      fileName: file.file_name,
      contentType: file.content_type,
      content,
    };
  }

  /** The bank confirmed the transfer: every payment still in the file is paid. */
  async settleFile(fileId: string) {
    // find file, check access and state
    const file = await this.findFile(fileId);
    this.access.assert('payroll.disburse', { companyId: file.company_id });
    if (file.state !== 'active')
      throw new ConflictException(MSG.DISBURSEMENT_FILE_NOT_ACTIVE);
    if (file.cancel_approval_request_id)
      throw new ConflictException(MSG.DISBURSEMENT_CANCEL_PENDING);

    // payments paid, file settled
    const now = this.clock.now();
    const paid = await this.db.tx
      .updateTable('payments')
      .set({ status: 'paid', paid_at: now })
      .where('file_id', '=', file.id)
      .where('status', '=', 'in_file')
      .executeTakeFirst();
    await this.db.tx
      .updateTable('disbursement_files')
      .set({ state: 'settled', settled_at: now })
      .where('id', '=', file.id)
      .execute();
    // e.g. the ledger books the salary payment (Phase 2 WP14), in this transaction
    for (const listener of this.settledListeners)
      await listener(await this.findFile(file.id));
    await this.audit.record({
      action: 'disbursement_file.settled',
      entity: 'payroll_run',
      entityId: file.run_id,
      after: { fileId: file.id, paid: Number(paid.numUpdatedRows) },
    });

    await this.checkRunDisbursed(file.run_id);
    return toFileResponse(await this.findFile(file.id));
  }

  /**
   * The bank / wallet result file. All-or-nothing: an unknown reference or an
   * unreadable line rejects the whole import. Returns can arrive before or after
   * the file is settled.
   */
  async importReturns(fileId: string, dto: ImportReturnsDto) {
    // find file, check access and state
    const file = await this.findFile(fileId);
    this.access.assert('payroll.disburse', { companyId: file.company_id });
    if (file.state === 'cancelled')
      throw new ConflictException(MSG.DISBURSEMENT_FILE_NOT_ACTIVE);

    // read and check every line first
    const { lines, problems } = parseReturnFile(dto.content);
    const payments = await this.db.tx
      .selectFrom('payments')
      .selectAll()
      .where('file_id', '=', file.id)
      .execute();
    const byReference = new Map(payments.map((p) => [p.reference, p]));
    for (const l of lines) {
      const p = byReference.get(l.reference);
      if (!p)
        problems.push(
          `Line ${l.line}: ${l.reference} is not a payment of this file`,
        );
      else if (
        l.outcome === 'returned' &&
        p.status !== 'in_file' &&
        p.status !== 'paid' &&
        p.status !== 'returned'
      )
        problems.push(`Line ${l.line}: ${l.reference} is ${p.status}`);
    }
    if (problems.length)
      throw new BadRequestException({
        message: MSG.DISBURSEMENT_RETURN_FILE_INVALID,
        details: { problems },
      });

    // mark the returned payments
    const now = this.clock.now();
    const returned: string[] = [];
    for (const l of lines.filter((x) => x.outcome === 'returned')) {
      const p = byReference.get(l.reference)!;
      if (p.status === 'returned') continue; // the same return imported twice
      await this.db.tx
        .updateTable('payments')
        .set({
          status: 'returned',
          returned_reason: l.reason,
          returned_at: now,
        })
        .where('id', '=', p.id)
        .execute();
      returned.push(p.reference);
    }
    await this.audit.record({
      action: 'disbursement_file.returns_imported',
      entity: 'payroll_run',
      entityId: file.run_id,
      after: { fileId: file.id, returned },
    });
    if (returned.length) {
      await this.outbox.add({
        type: 'disbursement.payments_returned',
        entityId: file.id,
        payload: { fileId: file.id, runId: file.run_id, references: returned },
      });
    }
    return {
      fileId: file.id,
      lines: lines.length,
      returned: returned.length,
      successful: lines.filter((l) => l.outcome === 'success').length,
      returnedReferences: returned,
    };
  }

  /** Ask to cancel an active file (it goes to an Admin for approval). */
  async cancelFile(fileId: string, dto: DisbursementReasonDto) {
    // find file, check access and state
    const file = await this.findFile(fileId);
    this.access.assert('payroll.disburse', { companyId: file.company_id });
    if (file.state !== 'active')
      throw new ConflictException(MSG.DISBURSEMENT_FILE_NOT_ACTIVE);
    if (file.cancel_approval_request_id)
      throw new ConflictException(MSG.DISBURSEMENT_CANCEL_PENDING);

    // second approval
    const approval = await this.approvals.submit({
      requestType: DISBURSEMENT_FILE_CANCEL,
      sourceId: file.id,
      subjectEmployeeId: null,
      companyId: file.company_id,
      amount: file.total_amount,
      summary: `Cancel ${file.adapter} file of payroll ${file.run_id.slice(0, 8)} (${file.payment_count} payments, ${file.total_amount}): ${dto.reason}`,
      snapshot: {
        fileId: file.id,
        runId: file.run_id,
        channel: file.channel,
        payments: file.payment_count,
        total: file.total_amount,
        checksum: file.checksum_sha256,
        reason: dto.reason,
      },
    });
    await this.db.tx
      .updateTable('disbursement_files')
      .set({
        cancel_reason: dto.reason,
        cancel_approval_request_id: approval.id,
      })
      .where('id', '=', file.id)
      .execute();
    await this.audit.record({
      action: 'disbursement_file.cancel_requested',
      entity: 'payroll_run',
      entityId: file.run_id,
      after: {
        fileId: file.id,
        reason: dto.reason,
        approvalRequestId: approval.id,
      },
    });
    return {
      ...toFileResponse(await this.findFile(file.id)),
      approvalRequestId: approval.id,
    };
  }

  // ================================================================ approval hooks

  private async applyCancel(approval: ApprovalRequest): Promise<void> {
    const file = await this.findFile(approval.source_id);
    await this.db.tx
      .updateTable('disbursement_files')
      .set({ state: 'cancelled', cancelled_at: this.clock.now() })
      .where('id', '=', file.id)
      .execute();
    // its unpaid payments can go into a new file
    const freed = await this.db.tx
      .updateTable('payments')
      .set({ status: 'approved', file_id: null })
      .where('file_id', '=', file.id)
      .where('status', '=', 'in_file')
      .executeTakeFirst();
    await this.audit.record({
      action: 'disbursement_file.cancelled',
      entity: 'payroll_run',
      entityId: file.run_id,
      after: {
        fileId: file.id,
        reason: file.cancel_reason,
        freedPayments: Number(freed.numUpdatedRows),
      },
    });
  }

  private async discardCancel(approval: ApprovalRequest): Promise<void> {
    await this.db.tx
      .updateTable('disbursement_files')
      .set({ cancel_reason: null, cancel_approval_request_id: null })
      .where('id', '=', approval.source_id)
      .where('state', '=', 'active')
      .execute();
  }

  // ================================================================ helpers

  /** Every payment of the run paid (or replaced by a paid re-issue): the run is disbursed. */
  private async checkRunDisbursed(runId: string): Promise<void> {
    const open = await this.db.tx
      .selectFrom('payments')
      .select('id')
      .where('run_id', '=', runId)
      .where('status', 'in', ['approved', 'in_file', 'returned'])
      .executeTakeFirst();
    if (!open) await this.runs.markDisbursed(runId);
  }

  private assertCanSee(companyId: string): void {
    const can = (
      ['payroll.disburse', 'payroll.verify', 'payroll.prepare'] as const
    ).some((p) => this.access.allows(p, { companyId }));
    if (!can || !this.access.canSeeField('salary', { companyId }))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private async findFile(id: string): Promise<DisbursementFile> {
    const file = await this.db.tx
      .selectFrom('disbursement_files')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!file) throw new NotFoundException(MSG.DISBURSEMENT_FILE_NOT_FOUND);
    return file;
  }

  private async findPayment(id: string): Promise<Payment> {
    const payment = await this.db.tx
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!payment) throw new NotFoundException(MSG.PAYMENT_NOT_FOUND);
    return payment;
  }
}

// ------------------------------------------------------------------ helpers

/** salary | final_settlement | bonus:<name> (one payment per employee, month and pay type). */
export function payTypeOf(
  run: Pick<PayrollRun, 'run_type' | 'bonus_name'>,
): string {
  if (run.run_type === 'bonus') return `bonus:${run.bonus_name}`;
  return run.run_type === 'final_settlement' ? 'final_settlement' : 'salary';
}

/** e.g. PAY-2026-09-7F3A91C2 (printed in the bank file, matched in return files). */
function newReference(period: string): string {
  return `PAY-${period}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function toPaymentResponse(p: Payment) {
  return {
    id: p.id,
    runId: p.run_id,
    employeeId: p.employee_id,
    period: p.period,
    payType: p.pay_type,
    amount: p.amount,
    channel: p.channel as PaymentChannel,
    reference: p.reference,
    status: p.status,
    reissueOf: p.reissue_of,
  };
}

function toFileResponse(f: DisbursementFile) {
  return {
    id: f.id,
    runId: f.run_id,
    channel: f.channel,
    adapter: f.adapter,
    fileName: f.file_name,
    payments: f.payment_count,
    total: f.total_amount,
    checksumSha256: f.checksum_sha256,
    state: f.state,
    cancelReason: f.cancel_reason,
    cancelApprovalRequestId: f.cancel_approval_request_id,
    createdAt: f.created_at,
    settledAt: f.settled_at,
    cancelledAt: f.cancelled_at,
  };
}
