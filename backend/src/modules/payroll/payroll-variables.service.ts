/**
 * Monthly payroll items (spec §6.4 "Variables"):
 *   - manual items for one month: commission, a one-off allowance, other deduction
 *   - salary advances / loans: requested by HR, approved through the approval
 *     engine (Dept Head, then Accounts), recovered by installments in each run;
 *     at final settlement the whole outstanding amount is recovered
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  Employee,
  Loan,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  AddVariableDto,
  LoansQueryDto,
  ReasonDto,
  RequestLoanDto,
} from './dto/payroll.dto.js';
import { PayrollSetupService } from './payroll-setup.service.js';

export const SALARY_ADVANCE = 'salary_advance';

@Injectable()
export class PayrollVariablesService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly setup: PayrollSetupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly org: OrgLookupService,
  ) {}

  onModuleInit() {
    this.handlers.register(
      SALARY_ADVANCE,
      {
        onApproved: (r) => this.applyLoanApproval(r),
        onClosed: (r, outcome) => this.applyLoanClosure(r, outcome),
      },
      [
        defaultChain(
          'Salary advance (default)',
          step(1, 'dept_head'),
          step(2, 'role:accounts'),
        ),
      ],
    );
  }

  // ================================================================ variables

  async listVariables(companyId: string, period: string) {
    this.access.assert('payroll.prepare', { companyId });
    const rows = await this.db.tx
      .selectFrom('payroll_variables as v')
      .innerJoin('employees as e', 'e.id', 'v.employee_id')
      .select([
        'v.id',
        'v.employee_id',
        'e.employee_code',
        'e.full_name_en',
        'v.period',
        'v.head_code',
        'v.amount',
        'v.note',
        'v.status',
        'v.run_id',
      ])
      .where('v.company_id', '=', companyId)
      .where('v.period', '=', period)
      .orderBy('e.employee_code')
      .execute();
    return rows.map((v) => ({
      id: v.id,
      employeeId: v.employee_id,
      employeeCode: v.employee_code,
      fullNameEn: v.full_name_en,
      period: v.period,
      headCode: v.head_code,
      amount: v.amount,
      note: v.note,
      status: v.status,
      runId: v.run_id,
    }));
  }

  async addVariable(companyId: string, dto: AddVariableDto) {
    // employee of this company, and salary access
    const employee = await this.setup.checkSalaryAccess(dto.employeeId);
    if (employee.company_id !== companyId)
      throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);

    // the head must be a company head (system heads such as TAX are calculated, never entered)
    const head = await this.db.tx
      .selectFrom('salary_heads')
      .select(['code', 'is_active'])
      .where('company_id', '=', companyId)
      .where('code', '=', dto.headCode)
      .executeTakeFirst();
    if (!head?.is_active)
      throw new NotFoundException(MSG.PAYROLL_HEAD_NOT_FOUND);

    // the month must not be paid already
    await this.assertPeriodOpen(companyId, dto.period);

    // save
    const variable = await this.db.tx
      .insertInto('payroll_variables')
      .values({
        company_id: companyId,
        employee_id: employee.id,
        period: dto.period,
        head_code: dto.headCode,
        amount: Money.of(dto.amount).toDb(),
        note: dto.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'payroll_variable.added',
      entity: 'employee',
      entityId: employee.id,
      after: {
        variableId: variable.id,
        period: dto.period,
        head: dto.headCode,
        amount: variable.amount,
      },
    });
    return variable;
  }

  async cancelVariable(variableId: string, dto: ReasonDto) {
    const variable = await this.db.tx
      .selectFrom('payroll_variables')
      .selectAll()
      .where('id', '=', variableId)
      .executeTakeFirst();
    if (!variable || variable.status !== 'open')
      throw new NotFoundException('Open payroll item not found');
    await this.setup.checkSalaryAccess(variable.employee_id);

    await this.db.tx
      .updateTable('payroll_variables')
      .set({ status: 'cancelled' })
      .where('id', '=', variableId)
      .execute();
    await this.audit.record({
      action: 'payroll_variable.cancelled',
      entity: 'employee',
      entityId: variable.employee_id,
      before: { variableId, amount: variable.amount },
      after: { reason: dto.reason },
    });
    return { id: variableId, status: 'cancelled' };
  }

  /** Open items of a month (for the input builder). */
  async openVariables(companyId: string, period: string) {
    return this.db.tx
      .selectFrom('payroll_variables')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .where('status', '=', 'open')
      .execute();
  }

  /** Called inside the payroll approval. */
  async markVariablesPaid(ids: string[], runId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.tx
      .updateTable('payroll_variables')
      .set({ status: 'paid', run_id: runId })
      .where('id', 'in', ids)
      .execute();
  }

  // ================================================================ loans

  async listLoans(employeeId: string) {
    await this.loanAccess(employeeId);
    const loans = await this.db.tx
      .selectFrom('loans')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('created_at', 'desc')
      .execute();
    const recovered = await this.recoveredByLoan(loans.map((l) => l.id));
    return loans.map((l) =>
      toLoanResponse(l, recovered.get(l.id) ?? Money.zero()),
    );
  }

  /**
   * Loans of a company (HR, and Accounts who pay them out), newest first;
   * ?state=approved&unpaid=true lists the advances waiting for their payout.
   */
  async listCompanyLoans(companyId: string, query: LoansQueryDto) {
    await this.org.assertCompanyExists(companyId);
    if (
      !['payroll.prepare', 'expenses.pay'].some((p) =>
        this.access.allows(p as 'payroll.prepare', { companyId }),
      ) ||
      !this.access.canSeeField('salary', { companyId })
    ) {
      throw new ForbiddenException(MSG.FORBIDDEN);
    }
    let q = this.db.tx
      .selectFrom('loans as l')
      .innerJoin('employees as e', 'e.id', 'l.employee_id')
      .selectAll('l')
      .select(['e.employee_code', 'e.full_name_en'])
      .where('l.company_id', '=', companyId);
    if (query.state) q = q.where('l.state', '=', query.state);
    if (query.unpaid)
      q = q.where('l.paid_at', 'is', null).where('l.origin', '=', 'request');
    const loans = await q.orderBy('l.created_at', 'desc').limit(500).execute();
    const recovered = await this.recoveredByLoan(loans.map((l) => l.id));
    return loans.map((l) => ({
      ...toLoanResponse(l, recovered.get(l.id) ?? Money.zero()),
      employeeCode: l.employee_code,
      fullNameEn: l.full_name_en,
    }));
  }

  /**
   * HR records an advance for an employee, or the employee asks for one
   * themselves (from the app); either way it goes for approval.
   */
  async requestLoan(employeeId: string, dto: RequestLoanDto) {
    // check access and amounts
    const employee = await this.loanAccess(employeeId);
    if (Money.of(dto.installment).greaterThan(dto.principal))
      throw new BadRequestException(
        'The installment cannot be more than the amount',
      );

    // save as pending
    const loan = await this.db.tx
      .insertInto('loans')
      .values({
        company_id: employee.company_id,
        employee_id: employee.id,
        principal: Money.of(dto.principal).toDb(),
        installment: Money.of(dto.installment).toDb(),
        first_period: dto.firstPeriod,
        reason: dto.reason,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'loan.requested',
      entity: 'employee',
      entityId: employee.id,
      after: {
        loanId: loan.id,
        principal: loan.principal,
        installment: loan.installment,
        firstPeriod: dto.firstPeriod,
      },
    });

    // send for approval
    const approval = await this.approvals.submit({
      requestType: SALARY_ADVANCE,
      sourceId: loan.id,
      subjectEmployeeId: employee.id,
      companyId: employee.company_id,
      amount: loan.principal,
      summary: `Salary advance: ${employee.full_name_en} (${employee.employee_code}), ${loan.installment} per month from ${dto.firstPeriod}`,
      snapshot: {
        loanId: loan.id,
        employeeId: employee.id,
        principal: loan.principal,
        installment: loan.installment,
        firstPeriod: dto.firstPeriod,
        reason: dto.reason,
      },
    });
    await this.db.tx
      .updateTable('loans')
      .set({ approval_request_id: approval.id })
      .where('id', '=', loan.id)
      .execute();
    return {
      ...toLoanResponse(
        { ...loan, approval_request_id: approval.id },
        Money.zero(),
      ),
      approvalRequestId: approval.id,
    };
  }

  /**
   * Approved loans with something left to recover in a month, and what is left
   * (for the input builder).
   */
  async loansForPeriod(companyId: string, period: string) {
    // a company that keeps its books here recovers only what it paid out (WP16)
    const books = await this.db.tx
      .selectFrom('accounts')
      .select('id')
      .where('company_id', '=', companyId)
      .limit(1)
      .executeTakeFirst();
    let q = this.db.tx
      .selectFrom('loans')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('state', '=', 'approved')
      .where('first_period', '<=', period);
    if (books)
      q = q.where((eb) =>
        eb.or([eb('origin', '<>', 'request'), eb('paid_at', 'is not', null)]),
      );
    const loans = await q.execute();
    const recovered = await this.recoveredByLoan(loans.map((l) => l.id));
    return loans
      .map((l) => ({
        loanId: l.id,
        employeeId: l.employee_id,
        installment: l.installment,
        outstanding: Money.of(l.principal)
          .minus(recovered.get(l.id) ?? Money.zero())
          .toDb(),
      }))
      .filter((l) => Money.of(l.outstanding).isPositive());
  }

  /** Called inside the payroll approval: record what was recovered, close paid-off loans. */
  async recordRecoveries(
    runId: string,
    period: string,
    recoveries: Array<{ loanId: string; amount: string }>,
  ): Promise<void> {
    for (const r of recoveries) {
      await this.db.tx
        .insertInto('loan_recoveries')
        .values({ loan_id: r.loanId, run_id: runId, period, amount: r.amount })
        .execute();
      const loan = await this.db.tx
        .selectFrom('loans')
        .selectAll()
        .where('id', '=', r.loanId)
        .executeTakeFirstOrThrow();
      const recovered =
        (await this.recoveredByLoan([loan.id])).get(loan.id) ?? Money.zero();
      if (!Money.of(loan.principal).greaterThan(recovered)) {
        await this.db.tx
          .updateTable('loans')
          .set({ state: 'closed', closed_at: new Date() })
          .where('id', '=', loan.id)
          .execute();
      }
    }
  }

  /**
   * Data migration: an advance still outstanding in the old system. It was
   * approved there, so it starts approved; principal = what is left to recover.
   */
  async importLoan(row: {
    employeeId: string;
    outstanding: string;
    installment: string;
    nextPeriod: string;
    reason: string;
  }): Promise<string> {
    const employee = await this.setup.checkSalaryAccess(row.employeeId);
    const loan = await this.db.tx
      .insertInto('loans')
      .values({
        company_id: employee.company_id,
        employee_id: employee.id,
        principal: row.outstanding,
        installment: row.installment,
        first_period: row.nextPeriod,
        reason: row.reason,
        state: 'approved',
        approved_at: new Date(),
        origin: 'import',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'loan.imported',
      entity: 'employee',
      entityId: employee.id,
      after: {
        loanId: loan.id,
        outstanding: row.outstanding,
        installment: row.installment,
        firstPeriod: row.nextPeriod,
      },
    });
    return loan.id;
  }

  /** Employees with a pending or approved (not closed) advance. */
  async employeesWithOpenLoan(companyId: string): Promise<Set<string>> {
    const rows = await this.db.tx
      .selectFrom('loans')
      .select('employee_id')
      .where('company_id', '=', companyId)
      .where('state', 'in', ['pending', 'approved'])
      .execute();
    return new Set(rows.map((r) => r.employee_id));
  }

  /** Approved advances still to recover (reconciliation report). */
  async outstandingTotals(
    companyId: string,
  ): Promise<{ loans: number; outstanding: string }> {
    const open = await this.loansForPeriod(companyId, '9999-12');
    return {
      loans: open.length,
      outstanding: Money.sum(open.map((l) => l.outstanding)).toDb(),
    };
  }

  // ================================================================ approval

  private async applyLoanApproval(approval: ApprovalRequest): Promise<void> {
    const loan = await this.findLoan(approval.source_id);
    await this.db.tx
      .updateTable('loans')
      .set({ state: 'approved', approved_at: new Date() })
      .where('id', '=', loan.id)
      .execute();
    await this.outbox.add({
      type: 'loan.approved',
      entityId: loan.id,
      payload: {
        loanId: loan.id,
        employeeId: loan.employee_id,
        firstPeriod: loan.first_period,
      },
    });
  }

  private async applyLoanClosure(
    approval: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ): Promise<void> {
    await this.db.tx
      .updateTable('loans')
      .set({ state: outcome === 'rejected' ? 'rejected' : 'cancelled' })
      .where('id', '=', approval.source_id)
      .where('state', '=', 'pending')
      .execute();
  }

  // ================================================================ helpers

  private async recoveredByLoan(
    loanIds: string[],
  ): Promise<Map<string, Money>> {
    const map = new Map<string, Money>();
    if (loanIds.length === 0) return map;
    const rows = await this.db.tx
      .selectFrom('loan_recoveries')
      .select(['loan_id', 'amount'])
      .where('loan_id', 'in', loanIds)
      .execute();
    for (const r of rows)
      map.set(r.loan_id, (map.get(r.loan_id) ?? Money.zero()).plus(r.amount));
    return map;
  }

  private async findLoan(id: string): Promise<Loan> {
    const loan = await this.db.tx
      .selectFrom('loans')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!loan) throw new NotFoundException(MSG.LOAN_NOT_FOUND);
    return loan;
  }

  private async assertPeriodOpen(
    companyId: string,
    period: string,
  ): Promise<void> {
    const paid = await this.db.tx
      .selectFrom('payroll_runs')
      .select('id')
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .where('run_type', '=', 'regular')
      .where('state', 'in', [
        'in_approval',
        'verified',
        'approved',
        'disbursed',
      ])
      .executeTakeFirst();
    if (paid) throw new BadRequestException(MSG.PAYROLL_PERIOD_PAID);
  }

  /** HR with salary access, or the employee for their own advances. */
  private async loanAccess(employeeId: string): Promise<Employee> {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (
      this.access.allows('payroll.prepare', resource) &&
      this.access.canSeeField('salary', resource)
    )
      return employee;
    this.access.assert('payroll.loan.request_own', resource);
    return employee;
  }
}

function toLoanResponse(l: Loan, recovered: Money) {
  return {
    id: l.id,
    employeeId: l.employee_id,
    principal: l.principal,
    installment: l.installment,
    firstPeriod: l.first_period,
    reason: l.reason,
    state: l.state,
    recovered: recovered.toDb(),
    outstanding:
      l.state === 'approved' || l.state === 'closed'
        ? Money.of(l.principal).minus(recovered).toDb()
        : null,
    approvalRequestId: l.approval_request_id,
    approvedAt: l.approved_at,
    closedAt: l.closed_at,
    origin: l.origin,
    paidAt: l.paid_at,
    payoutVoucherId: l.payout_voucher_id,
  };
}
