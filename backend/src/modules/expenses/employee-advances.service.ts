/**
 * Money the company has given employees ahead (spec §6.6 sub-ledger "employees
 * (advances, loans)"; WP16 acceptance "advances sub-ledger equals its control account").
 *
 *   cash advances    the employee asks (a dealer visit to Chattogram): Dept Head ->
 *                    Accounts (-> Admin from Tk 50,000); Accounts pays it out (payment
 *                    voucher Dr staff advances / Cr cash, to the checker). It comes back by
 *                      - expense claims settled against it (on their approval),
 *                      - a refund of what was not spent (receipt voucher, to the checker),
 *                      - recovery from salary (it becomes a salary advance with installments)
 *   salary advances  (WP6 loans) are now paid out through the books too (POST /loans/:id/payout);
 *                    payroll recovers the installments (payroll journal: Cr staff advances)
 *
 * The sub-ledger, per employee: salary advances paid (or migrated, or turned from a cash
 * advance) less what payroll recovered, plus cash advances paid less what came back.
 * The nightly check compares it with the staff advances account, employee by employee.
 * Migrated advances need one opening posting (POST .../employee-advances/opening-posting).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  ExpenseAdvance,
  Voucher,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { conditionalChain, defaultChain, step } from '../approvals/chains.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerReportsService } from '../ledger/ledger-reports.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  AdvanceQueryDto,
  AdvancesOpeningDto,
  PayEmployeeDto,
  RecoverFromSalaryDto,
  RefundAdvanceDto,
  RequestAdvanceDto,
} from './dto/expenses.dto.js';
import { ADVANCES, ExpensesCommon } from './expenses-common.js';

export const EXPENSE_ADVANCE_REQUEST = 'expense_advance';
export const ADVANCE_PAYOUT_SOURCE = 'expense_advance';
export const ADVANCE_REFUND_SOURCE = 'advance_refund';
export const LOAN_PAYOUT_SOURCE = 'loan_payout';
export const ADVANCES_OPENING_SOURCE = 'advances_opening';

@Injectable()
export class EmployeeAdvancesService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly vouchers: VouchersService,
    private readonly ledgerReports: LedgerReportsService,
    private readonly common: ExpensesCommon,
  ) {}

  onModuleInit() {
    this.handlers.register(
      EXPENSE_ADVANCE_REQUEST,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
        distinctApprovers: true,
      },
      [
        conditionalChain(
          'Cash advance Tk 50,000 or more (default)',
          { minAmount: '50000' },
          step(1, 'dept_head'),
          step(2, 'role:accounts'),
          step(3, 'role:admin'),
        ),
        defaultChain(
          'Cash advance (default)',
          step(1, 'dept_head'),
          step(2, 'role:accounts'),
        ),
      ],
    );
    this.vouchers.registerSource(ADVANCE_PAYOUT_SOURCE, {
      onPosted: (v) => this.advancePaid(v),
      onDropped: (v) => this.advancePayoutDropped(v),
      assertReversible: (v) => this.assertNothingBack(v.source_id!),
      onReversed: (v) => this.advancePayoutReversed(v),
    });
    this.vouchers.registerSource(ADVANCE_REFUND_SOURCE, {
      onPosted: (v) => this.refundPosted(v),
      onDropped: (v) => this.refundDropped(v),
      onReversed: (v) => this.refundDropped(v),
    });
    this.vouchers.registerSource(LOAN_PAYOUT_SOURCE, {
      onPosted: (v) => this.loanPaid(v),
      onDropped: (v) => this.loanPayoutCleared(v),
      assertReversible: (v) => this.assertNotRecovered(v.source_id!),
      onReversed: (v) => this.loanPayoutCleared(v),
    });
    this.ledgerReports.registerCheck((companyId) =>
      this.controlCheck(companyId),
    );
  }

  // ============================================================ the employee

  async request(dto: RequestAdvanceDto) {
    const employee = await this.common.ownEmployee();
    const number = await this.common.nextNumber(
      employee.company_id,
      'expense_advance',
      this.common.today(),
    );
    const advance = await this.db.tx
      .insertInto('expense_advances')
      .values({
        company_id: employee.company_id,
        employee_id: employee.id,
        number,
        purpose: dto.purpose,
        amount: Money.of(dto.amount).toDb(),
        needed_by: dto.neededBy ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const request = await this.approvals.submit({
      requestType: EXPENSE_ADVANCE_REQUEST,
      sourceId: advance.id,
      subjectEmployeeId: employee.id,
      companyId: employee.company_id,
      summary: `Cash advance ${number}: ${employee.full_name_en} (${employee.employee_code}), ${dto.purpose}`,
      amount: advance.amount,
      snapshot: {
        number,
        purpose: dto.purpose,
        amount: advance.amount,
        neededBy: dto.neededBy ?? null,
      },
    });
    await this.db.tx
      .updateTable('expense_advances')
      .set({ approval_request_id: request.id })
      .where('id', '=', advance.id)
      .execute();
    await this.audit.record({
      action: 'expense_advance.requested',
      entity: 'expense_advance',
      entityId: advance.id,
      after: { number, amount: advance.amount, approvalRequestId: request.id },
    });
    return this.get(advance.id);
  }

  async listOwn() {
    const employee = await this.common.ownEmployee();
    const rows = await this.db.tx
      .selectFrom('expense_advances')
      .selectAll()
      .where('employee_id', '=', employee.id)
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
    const back = await this.settledByAdvance(rows.map((r) => r.id));
    return rows.map((a) => toAdvanceResponse(a, back.get(a.id)));
  }

  // ============================================================== Accounts

  async list(companyId: string, query: AdvanceQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('expenses.view', { companyId });
    let q = this.db.tx
      .selectFrom('expense_advances as a')
      .innerJoin('employees as e', 'e.id', 'a.employee_id')
      .selectAll('a')
      .select(['e.employee_code', 'e.full_name_en'])
      .where('a.company_id', '=', companyId);
    if (query.state)
      q = q.where('a.state', '=', query.state as ExpenseAdvance['state']);
    if (query.employeeId) q = q.where('a.employee_id', '=', query.employeeId);
    const rows = await q.orderBy('a.created_at', 'desc').limit(500).execute();
    const back = await this.settledByAdvance(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...toAdvanceResponse(r, back.get(r.id)),
      employeeCode: r.employee_code,
      employeeName: r.full_name_en,
    }));
  }

  async get(id: string) {
    const advance = await this.find(id);
    await this.common.assertCanSee(advance.employee_id, advance.company_id);
    const employee = await this.employeeAccess.find(advance.employee_id);
    const settlements = await this.db.tx
      .selectFrom('advance_settlements as s')
      .leftJoin('expense_claims as c', 'c.id', 's.claim_id')
      .leftJoin('vouchers as v', 'v.id', 's.voucher_id')
      .select([
        's.id',
        's.kind',
        's.amount',
        's.state',
        's.created_at',
        's.loan_id',
        'c.number as claim_number',
        'v.number as voucher_number',
        'v.approval_request_id',
      ])
      .where('s.advance_id', '=', id)
      .orderBy('s.created_at')
      .execute();
    const back = await this.settledByAdvance([id]);
    const payout = advance.voucher_id
      ? await this.vouchers.find(advance.voucher_id)
      : null;
    return {
      ...toAdvanceResponse(advance, back.get(id)),
      employee: {
        id: employee.id,
        code: employee.employee_code,
        name: employee.full_name_en,
      },
      payout: payout
        ? {
            voucherId: payout.id,
            number: payout.number,
            state: payout.state,
            approvalRequestId: payout.approval_request_id,
          }
        : null,
      settlements: settlements.map((s) => ({
        id: s.id,
        kind: s.kind,
        amount: s.amount,
        state: s.state,
        at: s.created_at,
        claimNumber: s.claim_number,
        voucherNumber: s.voucher_number,
        loanId: s.loan_id,
        approvalRequestId: s.approval_request_id,
      })),
    };
  }

  /** Pay an approved cash advance: a payment voucher to the checker. */
  async payout(id: string, dto: PayEmployeeDto) {
    const advance = await this.find(id);
    this.access.assert('expenses.pay', { companyId: advance.company_id });
    if (advance.state !== 'approved' || advance.voucher_id)
      throw new ConflictException(MSG.ADVANCE_WRONG_STATE);
    const voucher = await this.payEmployee(
      advance.company_id,
      advance.employee_id,
      advance.amount,
      dto,
      ADVANCE_PAYOUT_SOURCE,
      advance.id,
      `Cash advance ${advance.number}: ${advance.purpose}`,
    );
    await this.db.tx
      .updateTable('expense_advances')
      .set({ voucher_id: voucher.id })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'expense_advance.payout_created',
      entity: 'expense_advance',
      entityId: id,
      after: { number: advance.number, voucher: voucher.number },
    });
    return this.get(id);
  }

  /** What was not spent comes back in cash or to the bank: a receipt voucher to the checker. */
  async refund(id: string, dto: RefundAdvanceDto) {
    const advance = await this.find(id);
    this.access.assert('expenses.pay', { companyId: advance.company_id });
    if (advance.state !== 'paid')
      throw new ConflictException(MSG.ADVANCE_WRONG_STATE);
    const open = Money.of(advance.amount).minus(await this.backOn(id));
    if (Money.of(dto.amount).greaterThan(open))
      throw new BadRequestException({
        message: MSG.ADVANCE_EXCEEDED,
        details: { available: open.toDb() },
      });
    const account = await this.common.postingAccounts(
      advance.company_id,
      [ADVANCES],
      dto.date,
    );
    const into = await this.common.moneyAccount(
      advance.company_id,
      dto.receivedIntoAccountId,
    );
    const employee = await this.employeeAccess.find(advance.employee_id);

    const settlement = await this.db.tx
      .insertInto('advance_settlements')
      .values({
        advance_id: id,
        kind: 'refund',
        amount: Money.of(dto.amount).toDb(),
        state: 'pending',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const voucher = await this.vouchers.createLinked({
      companyId: advance.company_id,
      voucherType: 'receipt',
      voucherDate: dto.date,
      narration: `Unspent cash advance ${advance.number} returned: ${employee.full_name_en} (${employee.employee_code})`,
      sourceType: ADVANCE_REFUND_SOURCE,
      sourceId: settlement.id,
      lines: [
        {
          accountId: into,
          debit: Money.of(dto.amount).toDb(),
          narration: dto.reference ?? null,
        },
        {
          accountId: account(ADVANCES),
          credit: Money.of(dto.amount).toDb(),
          partyType: 'employee',
          partyId: advance.employee_id,
        },
      ],
    });
    await this.db.tx
      .updateTable('advance_settlements')
      .set({ voucher_id: voucher.id })
      .where('id', '=', settlement.id)
      .execute();
    await this.audit.record({
      action: 'expense_advance.refund_created',
      entity: 'expense_advance',
      entityId: id,
      after: { amount: dto.amount, voucher: voucher.number },
    });
    return this.get(id);
  }

  /** What is still open is recovered from salary: it becomes a salary advance with installments. */
  async recoverFromSalary(id: string, dto: RecoverFromSalaryDto) {
    const advance = await this.find(id);
    this.access.assert('expenses.pay', { companyId: advance.company_id });
    if (advance.state !== 'paid')
      throw new ConflictException(MSG.ADVANCE_WRONG_STATE);
    const open = Money.of(advance.amount).minus(await this.backOn(id));
    if (!open.isPositive())
      throw new ConflictException(MSG.ADVANCE_WRONG_STATE);
    if (Money.of(dto.installment).greaterThan(open))
      throw new BadRequestException({
        message: MSG.ADVANCE_EXCEEDED,
        details: { available: open.toDb() },
      });

    // no new money leaves: the balance moves from the cash advance to a salary advance
    const loan = await this.db.tx
      .insertInto('loans')
      .values({
        company_id: advance.company_id,
        employee_id: advance.employee_id,
        principal: open.toDb(),
        installment: Money.of(dto.installment).toDb(),
        first_period: dto.firstPeriod,
        reason: `Unspent cash advance ${advance.number}`,
        state: 'approved',
        approved_at: new Date(),
        origin: 'advance',
        source_advance_id: advance.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('advance_settlements')
      .values({
        advance_id: id,
        kind: 'payroll',
        loan_id: loan.id,
        amount: open.toDb(),
      })
      .execute();
    await this.db.tx
      .updateTable('expense_advances')
      .set({ state: 'settled' })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'expense_advance.recovered_from_salary',
      entity: 'expense_advance',
      entityId: id,
      after: {
        number: advance.number,
        amount: open.toDb(),
        installment: dto.installment,
        firstPeriod: dto.firstPeriod,
        loanId: loan.id,
      },
    });
    return this.get(id);
  }

  /** Pay out an approved salary advance (WP6 loan) through the books. */
  async payoutLoan(loanId: string, dto: PayEmployeeDto) {
    const loan = await this.db.tx
      .selectFrom('loans')
      .selectAll()
      .where('id', '=', loanId)
      .executeTakeFirst();
    if (!loan) throw new NotFoundException(MSG.LOAN_NOT_FOUND);
    this.access.assert('expenses.pay', { companyId: loan.company_id });
    if (
      loan.origin !== 'request' ||
      loan.state !== 'approved' ||
      loan.payout_voucher_id ||
      loan.paid_at
    )
      throw new ConflictException(MSG.LOAN_WRONG_STATE);
    const voucher = await this.payEmployee(
      loan.company_id,
      loan.employee_id,
      loan.principal,
      dto,
      LOAN_PAYOUT_SOURCE,
      loan.id,
      `Salary advance: ${loan.reason}`,
    );
    await this.db.tx
      .updateTable('loans')
      .set({ payout_voucher_id: voucher.id })
      .where('id', '=', loanId)
      .execute();
    await this.audit.record({
      action: 'loan.payout_created',
      entity: 'employee',
      entityId: loan.employee_id,
      after: { loanId, voucher: voucher.number },
    });
    return {
      loanId,
      voucherId: voucher.id,
      voucherNumber: voucher.number,
      approvalRequestId: voucher.approval_request_id,
      state: 'in_approval',
    };
  }

  // ============================================================ sub-ledger

  /** Per employee: salary advances and cash advances open, the books, and any difference. */
  async balances(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('expenses.view', { companyId });
    const { subLedger, books } = await this.compare(companyId);
    const ids = [...new Set([...subLedger.keys(), ...books.keys()])].filter(
      (id) => id !== '',
    );
    const people = ids.length
      ? await this.db.tx
          .selectFrom('employees')
          .select(['id', 'employee_code', 'full_name_en'])
          .where('id', 'in', ids)
          .execute()
      : [];
    const rows = people
      .map((p) => {
        const s = subLedger.get(p.id) ?? {
          loans: Money.zero(),
          advances: Money.zero(),
        };
        const total = s.loans.plus(s.advances);
        const inBooks = books.get(p.id) ?? Money.zero();
        return {
          employeeId: p.id,
          employeeCode: p.employee_code,
          employeeName: p.full_name_en,
          salaryAdvances: s.loans.toDb(),
          cashAdvances: s.advances.toDb(),
          total: total.toDb(),
          books: inBooks.toDb(),
          difference: inBooks.minus(total).toDb(),
        };
      })
      .filter((r) => r.total !== '0.00' || r.books !== '0.00')
      .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
    return {
      employees: rows,
      total: Money.sum(rows.map((r) => r.total)).toDb(),
      books: Money.sum([...books.values()]).toDb(),
    };
  }

  /**
   * Advances migrated from the old system (WP8) are in the sub-ledger but not yet in the
   * books: one opening journal, Dr staff advances per employee / Cr retained earnings.
   */
  async postOpening(companyId: string, dto: AdvancesOpeningDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('expenses.pay', { companyId });
    const account = await this.common.postingAccounts(
      companyId,
      [ADVANCES, 'ledger.retained_earnings'],
      dto.date,
    );
    const imported = await this.db.tx
      .selectFrom('loans')
      .select(['employee_id', sql<string>`sum(principal)`.as('amount')])
      .where('company_id', '=', companyId)
      .where('origin', '=', 'import')
      .where('state', 'in', ['approved', 'closed'])
      .groupBy('employee_id')
      .execute();
    if (!imported.length) throw new BadRequestException(MSG.VALIDATION_FAILED);
    const total = Money.sum(imported.map((r) => r.amount)).toDb();
    const voucher = await this.vouchers.postAutomatic({
      companyId,
      voucherType: 'journal',
      voucherDate: dto.date,
      narration:
        'Opening balances: salary advances brought from the old system',
      sourceType: ADVANCES_OPENING_SOURCE,
      sourceId: companyId,
      lines: [
        ...imported.map((r) => ({
          accountId: account(ADVANCES),
          debit: Money.of(r.amount).toDb(),
          partyType: 'employee' as const,
          partyId: r.employee_id,
        })),
        { accountId: account('ledger.retained_earnings'), credit: total },
      ],
    });
    await this.audit.record({
      action: 'employee_advances.opening_posted',
      entity: 'company',
      entityId: companyId,
      after: { voucher: voucher.number, total, employees: imported.length },
    });
    return this.vouchers.get(voucher.id);
  }

  /** Nightly: the staff advances account equals the sub-ledger (total and per employee). */
  private async controlCheck(companyId: string) {
    const { subLedger, books } = await this.compare(companyId);
    const problems: Array<{ check: string; detail: string }> = [];
    const sub = Money.sum(
      [...subLedger.values()].map((s) => s.loans.plus(s.advances)),
    );
    const inBooks = Money.sum([...books.values()]);
    if (!sub.equals(inBooks))
      problems.push({
        check: 'advances_control',
        detail: `staff advances account ${inBooks.toDb()} <> advances sub-ledger ${sub.toDb()}`,
      });
    if (books.has('') && !books.get('')!.isZero())
      problems.push({
        check: 'advances_without_employee',
        detail: `staff advances account has ${books.get('')!.toDb()} not linked to an employee`,
      });
    for (const id of new Set([...subLedger.keys(), ...books.keys()])) {
      if (id === '') continue;
      const s = subLedger.get(id);
      const a = s ? s.loans.plus(s.advances) : Money.zero();
      const b = books.get(id) ?? Money.zero();
      if (!a.equals(b))
        problems.push({
          check: 'advances_employee_mismatch',
          detail: `employee ${id}: books ${b.toDb()} <> sub-ledger ${a.toDb()}`,
        });
    }
    return problems;
  }

  private async compare(companyId: string) {
    // salary advances in the books: paid out, migrated, or turned from a cash advance
    const loans = await this.db.tx
      .selectFrom('loans as l')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('loan_recoveries')
            .select(['loan_id', sql<string>`sum(amount)`.as('recovered')])
            .groupBy('loan_id')
            .as('r'),
        (j) => j.onRef('r.loan_id', '=', 'l.id'),
      )
      .select(['l.employee_id', 'l.principal', 'r.recovered'])
      .where('l.company_id', '=', companyId)
      .where('l.state', 'in', ['approved', 'closed'])
      .where((eb) =>
        eb.or([
          eb('l.origin', 'in', ['import', 'advance']),
          eb('l.paid_at', 'is not', null),
        ]),
      )
      .execute();
    const advances = await this.db.tx
      .selectFrom('expense_advances as a')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('advance_settlements')
            .select(['advance_id', sql<string>`sum(amount)`.as('back')])
            .where('state', '=', 'done')
            .groupBy('advance_id')
            .as('s'),
        (j) => j.onRef('s.advance_id', '=', 'a.id'),
      )
      .select(['a.employee_id', 'a.amount', 's.back'])
      .where('a.company_id', '=', companyId)
      .where('a.state', 'in', ['paid', 'settled'])
      .execute();
    const lines = await this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select([
        'l.party_type',
        'l.party_id',
        sql<string>`sum(l.debit - l.credit)`.as('balance'),
      ])
      .where('v.company_id', '=', companyId)
      .where('v.state', '=', 'posted')
      .where('a.role', '=', 'employee_advances')
      .groupBy(['l.party_type', 'l.party_id'])
      .execute();

    const subLedger = new Map<string, { loans: Money; advances: Money }>();
    const at = (id: string) =>
      subLedger.get(id) ??
      (subLedger.set(id, { loans: Money.zero(), advances: Money.zero() }),
      subLedger.get(id)!);
    for (const l of loans)
      at(l.employee_id).loans = at(l.employee_id).loans.plus(
        Money.of(l.principal).minus(l.recovered ?? '0'),
      );
    for (const a of advances)
      at(a.employee_id).advances = at(a.employee_id).advances.plus(
        Money.of(a.amount).minus(a.back ?? '0'),
      );
    for (const [id, s] of subLedger)
      if (s.loans.isZero() && s.advances.isZero()) subLedger.delete(id);
    const books = new Map<string, Money>();
    for (const l of lines) {
      const key = l.party_type === 'employee' && l.party_id ? l.party_id : '';
      books.set(key, (books.get(key) ?? Money.zero()).plus(l.balance));
    }
    for (const [id, b] of books) if (b.isZero()) books.delete(id);
    return { subLedger, books };
  }

  // ========================================================= approval hooks

  private async approved(request: ApprovalRequest) {
    await this.db.tx
      .updateTable('expense_advances')
      .set({ state: 'approved' })
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: 'expense_advance.approved',
      entity: 'expense_advance',
      entityId: request.source_id,
    });
  }

  private async closed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    await this.db.tx
      .updateTable('expense_advances')
      .set({ state: outcome === 'rejected' ? 'rejected' : 'cancelled' })
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: `expense_advance.${outcome}`,
      entity: 'expense_advance',
      entityId: request.source_id,
    });
  }

  private async advancePaid(v: Voucher) {
    await this.db.tx
      .updateTable('expense_advances')
      .set({ state: 'paid', paid_at: new Date() })
      .where('id', '=', v.source_id!)
      .execute();
  }

  private async advancePayoutDropped(v: Voucher) {
    await this.db.tx
      .updateTable('expense_advances')
      .set({ voucher_id: null })
      .where('id', '=', v.source_id!)
      .where('state', '=', 'approved')
      .execute();
  }

  private async advancePayoutReversed(v: Voucher) {
    await this.db.tx
      .updateTable('expense_advances')
      .set({ state: 'approved', voucher_id: null, paid_at: null })
      .where('id', '=', v.source_id!)
      .execute();
  }

  private async assertNothingBack(advanceId: string) {
    if ((await this.backOn(advanceId)).isPositive())
      throw new ConflictException(MSG.ADVANCE_WRONG_STATE);
  }

  private async refundPosted(v: Voucher) {
    const s = await this.db.tx
      .updateTable('advance_settlements')
      .set({ state: 'done' })
      .where('id', '=', v.source_id!)
      .returning('advance_id')
      .executeTakeFirstOrThrow();
    const advance = await this.find(s.advance_id);
    const done = await this.db.tx
      .selectFrom('advance_settlements')
      .select(sql<string>`coalesce(sum(amount), 0)`.as('n'))
      .where('advance_id', '=', advance.id)
      .where('state', '=', 'done')
      .executeTakeFirstOrThrow();
    if (Money.of(done.n).equals(advance.amount))
      await this.db.tx
        .updateTable('expense_advances')
        .set({ state: 'settled' })
        .where('id', '=', advance.id)
        .execute();
  }

  private async refundDropped(v: Voucher) {
    const s = await this.db.tx
      .updateTable('advance_settlements')
      .set({ state: 'cancelled' })
      .where('id', '=', v.source_id!)
      .returning('advance_id')
      .executeTakeFirstOrThrow();
    await this.db.tx
      .updateTable('expense_advances')
      .set({ state: 'paid' })
      .where('id', '=', s.advance_id)
      .where('state', '=', 'settled')
      .execute();
  }

  private async loanPaid(v: Voucher) {
    await this.db.tx
      .updateTable('loans')
      .set({ paid_at: new Date() })
      .where('id', '=', v.source_id!)
      .execute();
  }

  private async loanPayoutCleared(v: Voucher) {
    await this.db.tx
      .updateTable('loans')
      .set({ payout_voucher_id: null, paid_at: null })
      .where('id', '=', v.source_id!)
      .execute();
  }

  private async assertNotRecovered(loanId: string) {
    const r = await this.db.tx
      .selectFrom('loan_recoveries')
      .select('id')
      .where('loan_id', '=', loanId)
      .executeTakeFirst();
    if (r) throw new ConflictException(MSG.LOAN_WRONG_STATE);
  }

  // ================================================================ helpers

  async find(id: string): Promise<ExpenseAdvance> {
    const a = await this.db.tx
      .selectFrom('expense_advances')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!a) throw new NotFoundException(MSG.ADVANCE_NOT_FOUND);
    return a;
  }

  /** Dr staff advances (employee) / Cr cash or bank, to the checker. */
  private async payEmployee(
    companyId: string,
    employeeId: string,
    amount: string,
    dto: PayEmployeeDto,
    sourceType: string,
    sourceId: string,
    narration: string,
  ) {
    const account = await this.common.postingAccounts(
      companyId,
      [ADVANCES],
      dto.paymentDate,
    );
    const from = await this.common.moneyAccount(
      companyId,
      dto.paidFromAccountId,
    );
    const payee = await this.common.payeeLabel(
      employeeId,
      dto.method,
      dto.reference,
    );
    const employee = await this.employeeAccess.find(employeeId);
    return this.vouchers.createLinked({
      companyId,
      voucherType: 'payment',
      voucherDate: dto.paymentDate,
      narration: `${narration} (${employee.full_name_en}, ${employee.employee_code})`,
      sourceType,
      sourceId,
      lines: [
        {
          accountId: account(ADVANCES),
          debit: amount,
          partyType: 'employee',
          partyId: employeeId,
        },
        { accountId: from, credit: amount, narration: payee },
      ],
    });
  }

  /** Settlements counted against an advance (refunds waiting for their voucher too). */
  private async backOn(advanceId: string): Promise<Money> {
    const row = await this.db.tx
      .selectFrom('advance_settlements')
      .select(sql<string>`coalesce(sum(amount), 0)`.as('n'))
      .where('advance_id', '=', advanceId)
      .where('state', 'in', ['pending', 'done'])
      .executeTakeFirstOrThrow();
    return Money.of(row.n);
  }

  private async settledByAdvance(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('advance_settlements')
      .select(['advance_id', sql<string>`sum(amount)`.as('n')])
      .where('advance_id', 'in', ids)
      .where('state', '=', 'done')
      .groupBy('advance_id')
      .execute();
    return new Map(rows.map((r) => [r.advance_id, Money.of(r.n).toDb()]));
  }
}

function toAdvanceResponse(a: ExpenseAdvance, back?: string) {
  const returned = back ?? '0.00';
  return {
    id: a.id,
    companyId: a.company_id,
    employeeId: a.employee_id,
    number: a.number,
    purpose: a.purpose,
    amount: a.amount,
    neededBy: a.needed_by,
    state: a.state,
    settled: returned,
    open: ['paid'].includes(a.state)
      ? Money.of(a.amount).minus(returned).toDb()
      : '0.00',
    approvalRequestId: a.approval_request_id,
    voucherId: a.voucher_id,
    paidAt: a.paid_at,
    createdAt: a.created_at,
    version: a.version,
  };
}
