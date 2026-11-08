/**
 * Salary bank / mobile-wallet accounts (guide §7.3, spec §11).
 *
 * Changing where salary is paid is the classic payroll-fraud path, so:
 *   1. the change needs a step-up 2FA code (route guard);
 *   2. it is stored encrypted as "pending" and goes through the approval engine
 *      (request type "bank_account_change", default chain: HR);
 *   3. only on final approval does it become the salary account; the previous
 *      one is retired (kept for history);
 *   4. the employee is notified through the outbox (n8n sends SMS/email to
 *      the contact already on file).
 * Payroll (WP6) flags runs where an account changed in the period.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { FieldEncryption } from '../../platform/crypto/field-encryption.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  EmployeeBankAccount,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import type { RequestBankAccountDto } from './dto/bank-account.dto.js';

export const BANK_ACCOUNT_CHANGE = 'bank_account_change';

/** What is stored (encrypted) in details_encrypted. */
export interface AccountDetails {
  accountName: string;
  bankName?: string;
  branchName?: string;
  routingNumber?: string;
  accountNumber?: string;
  walletProvider?: string;
  walletNumber?: string;
}

@Injectable()
export class BankAccountsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly encryption: FieldEncryption,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
  ) {}

  /** Plug the request type into the approval engine. */
  onModuleInit() {
    this.handlers.register(
      BANK_ACCOUNT_CHANGE,
      {
        onApproved: (request) => this.applyApprovedChange(request),
        onClosed: (request, outcome) => this.discardChange(request, outcome),
      },
      // spec §3: "Employee changes to bank account need HR approval"
      [defaultChain('Bank account change (default)', step(1, 'role:hr'))],
    );
  }

  /** HR records an account for an employee, or an employee requests their own. */
  async requestChange(employeeId: string, dto: RequestBankAccountDto) {
    // find employee; HR over the employee, or the employee themself
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (
      !this.access.allows('employee.bank.manage', resource) &&
      !this.access.allows('employee.bank.request_own', resource)
    ) {
      throw new ForbiddenException(MSG.FORBIDDEN);
    }

    // only one change waiting at a time
    const pending = await this.db.tx
      .selectFrom('employee_bank_accounts')
      .select('id')
      .where('employee_id', '=', employeeId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (pending) throw new ConflictException(MSG.BANK_ACCOUNT_PENDING_EXISTS);

    // save as pending, encrypted
    const details = detailsFromDto(dto);
    const provider = dto.kind === 'bank' ? dto.bankName! : dto.walletProvider!;
    const account = await this.db.tx
      .insertInto('employee_bank_accounts')
      .values({
        employee_id: employeeId,
        kind: dto.kind,
        provider,
        details_encrypted: this.encryption.encrypt(
          employee.tenant_id,
          JSON.stringify(details),
        ),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // send for approval (snapshot holds only masked values)
    const last4 = (dto.accountNumber ?? dto.walletNumber ?? '').slice(-4);
    const request = await this.approvals.submit({
      requestType: BANK_ACCOUNT_CHANGE,
      sourceId: account.id,
      subjectEmployeeId: employeeId,
      companyId: employee.company_id,
      summary: `Salary account change: ${employee.full_name_en} (${employee.employee_code}) -> ${provider} ****${last4}`,
      snapshot: {
        employeeId,
        employeeCode: employee.employee_code,
        kind: dto.kind,
        provider,
        routingNumber: dto.routingNumber ?? null,
        accountLast4: last4,
        accountName: dto.accountName,
      },
    });
    await this.db.tx
      .updateTable('employee_bank_accounts')
      .set({ approval_request_id: request.id })
      .where('id', '=', account.id)
      .execute();

    await this.audit.record({
      action: 'employee.bank_account_requested',
      entity: 'employee',
      entityId: employeeId,
      after: {
        accountId: account.id,
        kind: dto.kind,
        provider,
        accountLast4: last4,
        approvalRequestId: request.id,
      },
    });
    return {
      account: await this.toResponse(account, resource),
      approvalRequestId: request.id,
    };
  }

  /** Accounts of an employee: full details only for users who may see bank fields. */
  async listAccounts(employeeId: string) {
    const employee = await this.employeeAccess.check(
      'employee.view',
      employeeId,
    );
    const resource = await this.employeeAccess.resourceOf(employee);
    const accounts = await this.db.tx
      .selectFrom('employee_bank_accounts')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('created_at', 'desc')
      .execute();
    return Promise.all(accounts.map((a) => this.toResponse(a, resource)));
  }

  // ------------------------------------------------------------- approval handler

  /** Final approval: the pending account becomes the salary account. */
  private async applyApprovedChange(request: ApprovalRequest): Promise<void> {
    const account = await this.findAccount(request.source_id);
    const now = new Date();

    // retire the old one, then approve the new one (one approved account at a time)
    await this.db.tx
      .updateTable('employee_bank_accounts')
      .set({ status: 'retired', retired_at: now })
      .where('employee_id', '=', account.employee_id)
      .where('status', '=', 'approved')
      .execute();
    await this.db.tx
      .updateTable('employee_bank_accounts')
      .set({ status: 'approved', approved_at: now })
      .where('id', '=', account.id)
      .execute();

    await this.audit.record({
      action: 'employee.bank_account_approved',
      entity: 'employee',
      entityId: account.employee_id,
      after: { accountId: account.id },
    });
    // n8n tells the employee on the contact already on file (spec §11)
    await this.outbox.add({
      type: 'employee.bank_account_changed',
      entityId: account.employee_id,
      payload: {
        employeeId: account.employee_id,
        accountId: account.id,
        approvalRequestId: request.id,
      },
    });
  }

  private async discardChange(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ): Promise<void> {
    await this.db.tx
      .updateTable('employee_bank_accounts')
      .set({ status: outcome === 'cancelled' ? 'cancelled' : 'rejected' })
      .where('id', '=', request.source_id)
      .where('status', '=', 'pending')
      .execute();
  }

  // ------------------------------------------------------------------ helpers

  private async findAccount(id: string): Promise<EmployeeBankAccount> {
    const account = await this.db.tx
      .selectFrom('employee_bank_accounts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!account) throw new BadRequestException(MSG.BANK_ACCOUNT_NOT_FOUND);
    return account;
  }

  private async toResponse(
    a: EmployeeBankAccount,
    resource: Awaited<ReturnType<EmployeeAccess['resourceOf']>>,
  ) {
    const details = JSON.parse(
      this.encryption.decrypt(a.tenant_id, a.details_encrypted),
    ) as AccountDetails;
    const showAll = this.access.canSeeField('bank', resource);
    const number = details.accountNumber ?? details.walletNumber ?? '';
    return {
      id: a.id,
      kind: a.kind,
      provider: a.provider,
      accountName: details.accountName,
      bankName: details.bankName ?? null,
      branchName: details.branchName ?? null,
      routingNumber: details.routingNumber ?? null,
      // the account / wallet number is sensitive: full only with bank-field access
      number: showAll ? number : `**** ${number.slice(-4)}`,
      status: a.status,
      approvalRequestId: a.approval_request_id,
      approvedAt: a.approved_at,
      retiredAt: a.retired_at,
      requestedAt: a.created_at,
      requestedBy: a.created_by,
    };
  }

  /**
   * Data migration: the salary account the old payroll paid to. It starts
   * approved (it was in use); later changes go through the approval as usual.
   */
  async importApprovedAccount(
    employeeId: string,
    details: AccountDetails & { kind: 'bank' | 'wallet' },
  ): Promise<string> {
    const employee = await this.employeeAccess.check(
      'employee.bank.manage',
      employeeId,
    );
    const { kind, ...rest } = details;
    const provider = kind === 'bank' ? rest.bankName! : rest.walletProvider!;
    const account = await this.db.tx
      .insertInto('employee_bank_accounts')
      .values({
        employee_id: employeeId,
        kind,
        provider,
        details_encrypted: this.encryption.encrypt(
          employee.tenant_id,
          JSON.stringify(rest),
        ),
        status: 'approved',
        approved_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const last4 = (rest.accountNumber ?? rest.walletNumber ?? '').slice(-4);
    await this.audit.record({
      action: 'employee.bank_account_imported',
      entity: 'employee',
      entityId: employeeId,
      after: { accountId: account.id, kind, provider, accountLast4: last4 },
    });
    return account.id;
  }

  /** Employees with an approved or pending salary account. */
  async employeesWithAccount(employeeIds: string[]): Promise<Set<string>> {
    if (employeeIds.length === 0) return new Set();
    const rows = await this.db.tx
      .selectFrom('employee_bank_accounts')
      .select('employee_id')
      .where('employee_id', 'in', employeeIds)
      .where('status', 'in', ['approved', 'pending'])
      .execute();
    return new Set(rows.map((r) => r.employee_id));
  }

  /** For disbursement: each employee's approved salary account (none = paid in cash). */
  async salaryAccounts(
    employeeIds: string[],
  ): Promise<
    Map<
      string,
      { accountId: string; kind: 'bank' | 'wallet'; provider: string }
    >
  > {
    const map = new Map<
      string,
      { accountId: string; kind: 'bank' | 'wallet'; provider: string }
    >();
    if (employeeIds.length === 0) return map;
    const rows = await this.db.tx
      .selectFrom('employee_bank_accounts')
      .select(['id', 'employee_id', 'kind', 'provider'])
      .where('employee_id', 'in', employeeIds)
      .where('status', '=', 'approved')
      .execute();
    for (const r of rows)
      map.set(r.employee_id, {
        accountId: r.id,
        kind: r.kind,
        provider: r.provider,
      });
    return map;
  }

  /**
   * Full account details for a disbursement file (decrypted). Only the
   * disbursement service calls this, after its own permission and step-up checks.
   */
  async paymentDetails(
    accountIds: string[],
  ): Promise<Map<string, AccountDetails>> {
    const map = new Map<string, AccountDetails>();
    if (accountIds.length === 0) return map;
    const rows = await this.db.tx
      .selectFrom('employee_bank_accounts')
      .select(['id', 'tenant_id', 'details_encrypted'])
      .where('id', 'in', accountIds)
      .execute();
    for (const r of rows)
      map.set(
        r.id,
        JSON.parse(
          this.encryption.decrypt(r.tenant_id, r.details_encrypted),
        ) as AccountDetails,
      );
    return map;
  }

  /**
   * For payroll flags (spec §6.4): does each employee have an approved salary
   * account, and was one approved between from and to (a change this month)?
   */
  async payrollFacts(
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, { hasApproved: boolean; changedInPeriod: boolean }>> {
    const facts = new Map(
      employeeIds.map((id) => [
        id,
        { hasApproved: false, changedInPeriod: false },
      ]),
    );
    if (employeeIds.length === 0) return facts;
    const rows = await this.db.tx
      .selectFrom('employee_bank_accounts')
      .select(['employee_id', 'status', 'approved_at'])
      .where('employee_id', 'in', employeeIds)
      .where('status', 'in', ['approved', 'retired'])
      .execute();
    for (const r of rows) {
      const f = facts.get(r.employee_id)!;
      if (r.status === 'approved') f.hasApproved = true;
      if (
        r.status === 'approved' &&
        r.approved_at &&
        r.approved_at >= from &&
        r.approved_at <= to
      )
        f.changedInPeriod = true;
    }
    return facts;
  }
}

function detailsFromDto(dto: RequestBankAccountDto): AccountDetails {
  return dto.kind === 'bank'
    ? {
        accountName: dto.accountName,
        bankName: dto.bankName,
        branchName: dto.branchName,
        routingNumber: dto.routingNumber,
        accountNumber: dto.accountNumber,
      }
    : {
        accountName: dto.accountName,
        walletProvider: dto.walletProvider,
        walletNumber: dto.walletNumber,
      };
}
