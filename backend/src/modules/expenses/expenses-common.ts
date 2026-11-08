/**
 * What claims and advances share: document numbers, the books (posting accounts,
 * open month), where money is paid from, and the employee's own salary account
 * (a bank or wallet payment goes only there: no new account on a claim).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { sql } from 'kysely';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  fiscalYearOf,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Employee } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';

export const CLAIMS_PAYABLE = 'expenses.claims_payable';
export const ADVANCES = 'expenses.advances';

@Injectable()
export class ExpensesCommon {
  constructor(
    private readonly db: DatabaseService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly ledger: LedgerSetupService,
    private readonly vouchers: VouchersService,
  ) {}

  today(): string {
    return todayInDhaka(this.clock.now());
  }

  /** The signed-in employee (own claims and advances). */
  async ownEmployee(): Promise<Employee> {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) throw new ForbiddenException(MSG.EMPLOYEE_NOT_FOUND);
    const employee = await this.employeeAccess.find(employeeId);
    this.access.assert(
      'expenses.claim_own',
      await this.employeeAccess.resourceOf(employee),
    );
    return employee;
  }

  /** The owner, or anyone who may see the company's expenses. */
  async assertCanSee(
    employeeId: string,
    companyId: string,
  ): Promise<{ own: boolean }> {
    if (this.access.current().employeeId === employeeId) {
      const employee = await this.employeeAccess.find(employeeId);
      if (
        this.access.allows(
          'expenses.claim_own',
          await this.employeeAccess.resourceOf(employee),
        )
      )
        return { own: true };
    }
    this.access.assert('expenses.view', { companyId });
    return { own: false };
  }

  /** The employee's department today: the cost centre of the expense. */
  async departmentOf(employee: Employee): Promise<string | null> {
    return (
      (await this.employeeAccess.resourceOf(employee)).departmentId ?? null
    );
  }

  /** EC/2026-27/00001 (claims) or EA/... (advances): gapless per company and fiscal year. */
  async nextNumber(
    companyId: string,
    kind: 'expense_claim' | 'expense_advance',
    onDate: string,
  ): Promise<string> {
    const year = await this.db.tx
      .selectFrom('fiscal_years')
      .select('code')
      .where('company_id', '=', companyId)
      .where('starts_on', '<=', onDate)
      .where('ends_on', '>=', onDate)
      .executeTakeFirst();
    const code = year?.code ?? fiscalYearOf(businessDate(onDate));
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind,
        fiscal_year_code: code,
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'kind', 'fiscal_year_code'])
          .doUpdateSet({ last_no: sql`payables_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return `${kind === 'expense_claim' ? 'EC' : 'EA'}/${code}/${String(row.last_no).padStart(5, '0')}`;
  }

  /** The books are ready for a posting on this date; returns the posting accounts. */
  async postingAccounts(companyId: string, keys: string[], date: string) {
    const hasBooks = await this.db.tx
      .selectFrom('accounts')
      .select('id')
      .where('company_id', '=', companyId)
      .limit(1)
      .executeTakeFirst();
    if (!hasBooks) throw new BadRequestException(MSG.LEDGER_NOT_SET_UP);
    const account = await this.ledger.resolvePostingAccounts(companyId);
    const missing = keys.filter((k) => !account(k));
    if (missing.length)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: missing },
      });
    if (!(await this.vouchers.canPostOn(companyId, date)))
      throw new ConflictException(MSG.PERIOD_CLOSED);
    return (key: string) => account(key)!;
  }

  /** A cash or bank account of the company's ledger. */
  async moneyAccount(companyId: string, accountId: string): Promise<string> {
    const a = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'role', 'postable', 'is_active'])
      .where('id', '=', accountId)
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

  /** Bank or wallet: only to the employee's approved salary account; its label for the voucher line. */
  async payeeLabel(
    employeeId: string,
    method: 'cash' | 'bank_transfer' | 'mobile_wallet',
    reference?: string,
  ): Promise<string | null> {
    if (method === 'cash') return reference ?? 'Cash';
    const kind = method === 'bank_transfer' ? 'bank' : 'wallet';
    const account = await this.db.tx
      .selectFrom('employee_bank_accounts')
      .select(['provider'])
      .where('employee_id', '=', employeeId)
      .where('status', '=', 'approved')
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (!account) throw new BadRequestException(MSG.EMPLOYEE_ACCOUNT_REQUIRED);
    return [account.provider, reference].filter(Boolean).join(', ');
  }
}
