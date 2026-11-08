/**
 * Payroll runs (guide §12.1, §12.3, §12.4):
 *
 *   create      draft run: regular month, festival bonus, or one leaver's final settlement
 *   calculate   all-or-nothing: inputs are built, the pure engine runs for every
 *               employee, results replace any earlier calculation (state "calculated")
 *   flags       every rule-based flag must be cleared with a reason
 *   submit      maker-checker through the approval engine:
 *               HR prepares -> Accounts verifies -> Admin approves; one person never
 *               approves two steps, and the preparer approves none
 *   approved    results are frozen (database trigger); adjustments, encashments,
 *               manual items and loan installments are marked paid; a leaver is
 *               separated; payroll.approved goes to the outbox
 *   reproduce   re-runs the engine on the stored inputs and compares every line
 *               (WP6 acceptance: a past run reproduces identical lines)
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  toBusinessDate,
} from '../../platform/dates/business-date.js';
import {
  canonicalJson,
  sha256Hex,
} from '../../platform/crypto/canonical-json.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  Employee,
  PayrollRun,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import {
  calculateBonus,
  calculateMonthly,
  ENGINE_VERSION,
  type BonusInput,
  type MonthlyInput,
  type PayResult,
} from '../../payroll-engine/index.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import { LifecycleService } from '../employees/lifecycle.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { UserDirectory } from '../identity/user-directory.service.js';
import { LeaveLedgerService } from '../leave/leave-ledger.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  CreateRunDto,
  ListRunsQueryDto,
  ReasonDto,
} from './dto/payroll.dto.js';
import {
  PayrollInputService,
  type PreparedEmployee,
  type StoredInput,
} from './payroll-input.service.js';
import { monthPeriod, PAID_STATES } from './payroll-periods.js';
import {
  monthName,
  renderPayslipPdf,
  SYSTEM_HEAD_LABELS,
  type PayslipLanguage,
} from './payslip-pdf.js';
import { buildSalaryJournal, journalCsv } from './salary-journal.js';
import { PayrollSetupService } from './payroll-setup.service.js';
import { PayrollVariablesService } from './payroll-variables.service.js';

export const PAYROLL_RUN = 'payroll_run';

/** Called inside the final approval's transaction (disbursement creates the payments). */
export type RunApprovedListener = (run: PayrollRun) => Promise<void>;

@Injectable()
export class PayrollRunsService implements OnModuleInit {
  private readonly approvedListeners: RunApprovedListener[] = [];

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly employees: EmployeesService,
    private readonly lifecycle: LifecycleService,
    private readonly directory: EmployeeDirectory,
    private readonly users: UserDirectory,
    private readonly inputs: PayrollInputService,
    private readonly setup: PayrollSetupService,
    private readonly variables: PayrollVariablesService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveLedgerService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
  ) {}

  onModuleInit() {
    // guide §12.4: Accounts verifies, Admin approves; never the same person twice
    this.handlers.register(
      PAYROLL_RUN,
      {
        onApproved: (r) => this.applyApproval(r),
        onClosed: (r, outcome) => this.applyClosure(r, outcome),
        onStepApproved: (r) => this.markVerified(r),
        distinctApprovers: true,
      },
      [
        defaultChain(
          'Payroll run (default)',
          step(1, 'role:accounts'),
          step(2, 'role:admin'),
        ),
      ],
    );
  }

  /** Disbursement (WP7) plugs in here; it runs in the approval's transaction. */
  onRunApproved(listener: RunApprovedListener): void {
    this.approvedListeners.push(listener);
  }

  // ================================================================ create

  async createRun(companyId: string, dto: CreateRunDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payroll.prepare', { companyId });

    // what each run type needs
    let employeeId: string | null = null;
    let shortfallDays = 0;
    if (dto.runType === 'bonus' && (!dto.bonusName || !dto.bonusDate))
      throw new BadRequestException(
        'A bonus run needs bonusName and bonusDate',
      );
    if (dto.runType === 'final_settlement') {
      if (!dto.employeeId)
        throw new BadRequestException('A final settlement needs employeeId');
      const employee = await this.setup.checkSalaryAccess(dto.employeeId);
      if (employee.company_id !== companyId)
        throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
      if (
        !employee.last_working_day ||
        employee.last_working_day.slice(0, 7) !== dto.period
      )
        throw new BadRequestException(MSG.PAYROLL_NOT_SEPARATING);
      // every clearance done; a resignation without enough notice owes the shortfall
      shortfallDays = (await this.lifecycle.settlementCheck(employee.id))
        .shortfallDays;
      employeeId = employee.id;
    }

    // save as draft (one live run per month / bonus / leaver: a duplicate is a 409)
    const run = await this.db.tx
      .insertInto('payroll_runs')
      .values({
        company_id: companyId,
        period: dto.period,
        run_type: dto.runType,
        bonus_name: dto.runType === 'bonus' ? dto.bonusName! : null,
        bonus_date: dto.runType === 'bonus' ? dto.bonusDate! : null,
        employee_id: employeeId,
        settlement: JSON.stringify(
          dto.runType === 'final_settlement'
            ? { noticeShortfallDays: dto.noticeShortfallDays ?? shortfallDays }
            : dto.runType === 'bonus'
              ? { festivalGroup: dto.festivalGroup ?? null }
              : {},
        ),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'payroll_run.created',
      entity: 'payroll_run',
      entityId: run.id,
      after: dto,
    });
    return this.getRun(run.id);
  }

  // ================================================================ calculate

  /**
   * All-or-nothing (guide §12.1): runs inside the request's transaction, so a
   * failure for any employee leaves the run exactly as it was.
   */
  async calculate(runId: string) {
    // find run, check access and state
    const run = await this.findRun(runId);
    this.access.assert('payroll.prepare', { companyId: run.company_id });
    if (run.state !== 'draft' && run.state !== 'calculated')
      throw new ConflictException(MSG.PAYROLL_RUN_WRONG_STATE);

    // build every employee's input
    const prepared = await this.prepare(run);

    // run the engine
    const results = prepared.map((p) => ({
      prepared: p,
      result: runEngine(p.kind, p.input),
    }));
    const paid = results.filter(
      (r) =>
        !(
          r.prepared.kind === 'bonus' &&
          !(r.result as { eligible?: boolean }).eligible
        ),
    );
    const notEligible = results
      .filter((r) => !paid.includes(r))
      .map((r) => (r.prepared.input as BonusInput).employee.code);

    // replace earlier results
    await this.db.tx
      .deleteFrom('payroll_flags')
      .where('run_id', '=', run.id)
      .execute();
    await this.db.tx
      .deleteFrom('payroll_lines')
      .where('run_id', '=', run.id)
      .execute();
    await this.db.tx
      .deleteFrom('payroll_run_employees')
      .where('run_id', '=', run.id)
      .execute();

    const hashes: string[] = [];
    for (const { prepared: p, result } of paid) {
      const stored: StoredInput = {
        kind: p.kind,
        input: p.input,
        refs: p.refs,
      };
      const inputHash = sha256Hex(canonicalJson(stored));
      hashes.push(inputHash);
      await this.db.tx
        .insertInto('payroll_run_employees')
        .values({
          run_id: run.id,
          employee_id: p.employeeId,
          input: JSON.stringify(stored),
          input_hash: inputHash,
          engine_version: result.engineVersion,
          gross: result.gross,
          deductions: result.deductions,
          net: result.net,
          employer_cost: result.employerCost,
          taxable_income: result.taxableIncome,
          tax: result.tax,
          projection: JSON.stringify(result.projection),
        })
        .execute();
      if (result.lines.length) {
        await this.db.tx
          .insertInto('payroll_lines')
          .values(
            result.lines.map((l, i) => ({
              run_id: run.id,
              employee_id: p.employeeId,
              line_no: i + 1,
              head_code: l.head,
              kind: l.kind,
              amount: l.amount,
              taxable: l.taxable,
              for_period: l.forPeriod ?? null,
              explanation: JSON.stringify(l.explanation),
            })),
          )
          .execute();
      }
      if (result.flags.length) {
        await this.db.tx
          .insertInto('payroll_flags')
          .values(
            result.flags.map((f) => ({
              run_id: run.id,
              employee_id: p.employeeId,
              code: f.code,
              message: f.message,
            })),
          )
          .execute();
      }
    }

    // run totals
    const sum = (pick: (r: PayResult) => string) =>
      Money.sum(paid.map((r) => pick(r.result))).toDb();
    await this.db.tx
      .updateTable('payroll_runs')
      .set({
        state: 'calculated',
        engine_version: ENGINE_VERSION,
        input_hash: sha256Hex(hashes.sort().join('\n')),
        headcount: paid.length,
        total_gross: sum((r) => r.gross),
        total_deductions: sum((r) => r.deductions),
        total_net: sum((r) => r.net),
        total_employer_cost: sum((r) => r.employerCost),
        total_tax: sum((r) => r.tax),
        calculated_at: this.clock.now(),
        calculated_by: requestContext.get().userId ?? null,
      })
      .where('id', '=', run.id)
      .execute();
    await this.audit.record({
      action: 'payroll_run.calculated',
      entity: 'payroll_run',
      entityId: run.id,
      after: { headcount: paid.length, engineVersion: ENGINE_VERSION },
    });
    return { ...(await this.getRun(run.id)), notEligible };
  }

  // ================================================================ flags

  async clearFlag(flagId: string, dto: ReasonDto) {
    // find flag and run
    const flag = await this.db.tx
      .selectFrom('payroll_flags')
      .selectAll()
      .where('id', '=', flagId)
      .executeTakeFirst();
    if (!flag) throw new NotFoundException('Flag not found');
    const run = await this.findRun(flag.run_id);
    this.access.assert('payroll.prepare', { companyId: run.company_id });
    if (run.state !== 'calculated')
      throw new ConflictException(MSG.PAYROLL_RUN_WRONG_STATE);
    if (flag.cleared_at) throw new ConflictException('Flag already cleared');

    // clear with reason
    await this.db.tx
      .updateTable('payroll_flags')
      .set({
        cleared_at: this.clock.now(),
        cleared_by: requestContext.get().userId!,
        clear_reason: dto.reason,
      })
      .where('id', '=', flagId)
      .execute();
    await this.audit.record({
      action: 'payroll_flag.cleared',
      entity: 'payroll_run',
      entityId: run.id,
      after: {
        flagId,
        code: flag.code,
        employeeId: flag.employee_id,
        reason: dto.reason,
      },
    });
    return { id: flagId, code: flag.code, cleared: true, reason: dto.reason };
  }

  // ================================================================ submit / cancel

  async submit(runId: string) {
    // find run, check access and state
    const run = await this.findRun(runId);
    this.access.assert('payroll.prepare', { companyId: run.company_id });
    if (run.state !== 'calculated')
      throw new ConflictException(MSG.PAYROLL_RUN_WRONG_STATE);

    // every flag cleared with a reason (guide §12.3)
    const open = await this.db.tx
      .selectFrom('payroll_flags')
      .select(['id', 'code', 'employee_id'])
      .where('run_id', '=', run.id)
      .where('cleared_at', 'is', null)
      .execute();
    if (open.length)
      throw new BadRequestException({
        message: MSG.PAYROLL_FLAGS_OPEN,
        details: { openFlags: open.length },
      });

    // send for approval
    const approval = await this.approvals.submit({
      requestType: PAYROLL_RUN,
      sourceId: run.id,
      subjectEmployeeId: run.employee_id,
      companyId: run.company_id,
      amount: run.total_net,
      kind: run.run_type,
      summary: `Payroll ${describeRun(run)}: ${run.headcount} employee(s), net ${run.total_net}`,
      snapshot: {
        runId: run.id,
        period: run.period,
        runType: run.run_type,
        headcount: run.headcount,
        totalGross: run.total_gross,
        totalDeductions: run.total_deductions,
        totalNet: run.total_net,
        totalTax: run.total_tax,
        inputHash: run.input_hash,
        engineVersion: run.engine_version,
      },
    });
    await this.db.tx
      .updateTable('payroll_runs')
      .set({ state: 'in_approval', approval_request_id: approval.id })
      .where('id', '=', run.id)
      .execute();
    await this.audit.record({
      action: 'payroll_run.submitted',
      entity: 'payroll_run',
      entityId: run.id,
      after: { approvalRequestId: approval.id },
    });
    return this.getRun(run.id);
  }

  async cancelRun(runId: string, dto: ReasonDto) {
    const run = await this.findRun(runId);
    this.access.assert('payroll.prepare', { companyId: run.company_id });
    // a run waiting for approval is withdrawn through the approval first
    if (run.state !== 'draft' && run.state !== 'calculated')
      throw new ConflictException(MSG.PAYROLL_RUN_WRONG_STATE);

    await this.db.tx
      .updateTable('payroll_runs')
      .set({ state: 'cancelled', cancelled_reason: dto.reason })
      .where('id', '=', run.id)
      .execute();
    await this.audit.record({
      action: 'payroll_run.cancelled',
      entity: 'payroll_run',
      entityId: run.id,
      after: { reason: dto.reason },
    });
    return this.getRun(run.id);
  }

  // ================================================================ read

  async listRuns(companyId: string, query: ListRunsQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.assertCanView(companyId);
    let q = this.db.tx
      .selectFrom('payroll_runs')
      .selectAll()
      .where('company_id', '=', companyId);
    if (query.period) q = q.where('period', '=', query.period);
    const runs = await q
      .orderBy('period', 'desc')
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    return runs.map(toRunSummary);
  }

  /**
   * A run: totals and flags for everyone allowed to see payroll; each
   * employee's amounts only with the salary field group (Admin approves totals).
   */
  async getRun(runId: string) {
    const run = await this.findRun(runId);
    this.assertCanView(run.company_id);
    const seesSalary = this.access.canSeeField('salary', {
      companyId: run.company_id,
    });

    const flags = await this.db.tx
      .selectFrom('payroll_flags as f')
      .innerJoin('employees as e', 'e.id', 'f.employee_id')
      .select([
        'f.id',
        'f.employee_id',
        'e.employee_code',
        'f.code',
        'f.message',
        'f.cleared_at',
        'f.cleared_by',
        'f.clear_reason',
      ])
      .where('f.run_id', '=', run.id)
      .orderBy('e.employee_code')
      .execute();
    const employees = seesSalary
      ? await this.db.tx
          .selectFrom('payroll_run_employees as r')
          .innerJoin('employees as e', 'e.id', 'r.employee_id')
          .select([
            'r.employee_id',
            'e.employee_code',
            'e.full_name_en',
            'r.gross',
            'r.deductions',
            'r.net',
            'r.tax',
            'r.employer_cost',
            'r.input_hash',
          ])
          .where('r.run_id', '=', run.id)
          .orderBy('e.employee_code')
          .execute()
      : null;

    return {
      ...toRunSummary(run),
      flags: flags.map((f) => ({
        id: f.id,
        employeeId: f.employee_id,
        employeeCode: f.employee_code,
        code: f.code,
        message: seesSalary ? f.message : null,
        cleared: !!f.cleared_at,
        clearedBy: f.cleared_by,
        clearReason: f.clear_reason,
      })),
      openFlags: flags.filter((f) => !f.cleared_at).length,
      employees:
        employees?.map((e) => ({
          employeeId: e.employee_id,
          employeeCode: e.employee_code,
          fullNameEn: e.full_name_en,
          gross: e.gross,
          deductions: e.deductions,
          net: e.net,
          tax: e.tax,
          employerCost: e.employer_cost,
          inputHash: e.input_hash,
        })) ?? 'hidden: needs salary field access',
    };
  }

  /**
   * The facts behind one flag, for its AI explanation (WP11): only what a
   * reviewer of this run may see. The flag's message carries amounts, so it is
   * included only with the salary field group (as in getRun).
   */
  async flagFacts(flagId: string) {
    const flag = await this.db.tx
      .selectFrom('payroll_flags')
      .selectAll()
      .where('id', '=', flagId)
      .executeTakeFirst();
    if (!flag) throw new NotFoundException(MSG.PAYROLL_FLAG_NOT_FOUND);
    const run = await this.findRun(flag.run_id);
    this.assertCanView(run.company_id);
    const employee = await this.employeeAccess.find(flag.employee_id);
    const seesSalary = this.access.canSeeField(
      'salary',
      await this.employeeAccess.resourceOf(employee),
    );
    return {
      flagId: flag.id,
      seesSalary,
      flag: {
        code: flag.code,
        message: seesSalary ? flag.message : null,
        cleared: !!flag.cleared_at,
        clearReason: flag.clear_reason,
      },
      run: {
        period: run.period,
        runType: run.run_type,
        bonusName: run.bonus_name,
        state: run.state,
      },
      employee: { code: employee.employee_code, status: employee.status },
    };
  }

  /** One employee's lines in a run, each with its explanation trace. */
  async getRunEmployee(runId: string, employeeId: string) {
    const run = await this.findRun(runId);
    this.assertCanView(run.company_id);
    const employee = await this.employeeAccess.find(employeeId);
    if (
      !this.access.canSeeField(
        'salary',
        await this.employeeAccess.resourceOf(employee),
      )
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    return this.payslip(run, employeeId, true);
  }

  // ================================================================ reproduce

  /**
   * Re-calculates every employee from the stored input and compares with the
   * stored lines. Identical = the payroll can be explained and audited later.
   */
  async reproduce(runId: string) {
    const run = await this.findRun(runId);
    this.assertCanView(run.company_id);
    const rows = await this.db.tx
      .selectFrom('payroll_run_employees')
      .select(['employee_id', 'input', 'input_hash', 'engine_version'])
      .where('run_id', '=', run.id)
      .execute();
    const lines = await this.db.tx
      .selectFrom('payroll_lines')
      .selectAll()
      .where('run_id', '=', run.id)
      .orderBy('line_no')
      .execute();

    const differences: Array<{
      employeeId: string;
      stored: unknown;
      recalculated: unknown;
    }> = [];
    for (const row of rows) {
      const stored = row.input as StoredInput;
      const again = runEngine(stored.kind, stored.input);
      const before = lines
        .filter((l) => l.employee_id === row.employee_id)
        .map((l) => ({
          head: l.head_code,
          kind: l.kind,
          amount: l.amount,
          forPeriod: l.for_period,
        }));
      const after = again.lines.map((l) => ({
        head: l.head,
        kind: l.kind,
        amount: l.amount,
        forPeriod: l.forPeriod ?? null,
      }));
      const hashOk = sha256Hex(canonicalJson(stored)) === row.input_hash;
      if (!hashOk || canonicalJson(before) !== canonicalJson(after))
        differences.push({
          employeeId: row.employee_id,
          stored: before,
          recalculated: after,
        });
    }
    await this.audit.record({
      action: 'payroll_run.reproduced',
      entity: 'payroll_run',
      entityId: run.id,
      after: { employees: rows.length, differences: differences.length },
    });
    return {
      runId: run.id,
      employees: rows.length,
      identical: differences.length === 0,
      engineVersionThen: run.engine_version,
      engineVersionNow: ENGINE_VERSION,
      differences: this.access.canSeeField('salary', {
        companyId: run.company_id,
      })
        ? differences
        : differences.map((d) => ({ employeeId: d.employeeId })),
    };
  }

  // ================================================================ payslips

  /** My payslips: approved runs only. */
  async myPayslips() {
    const employeeId = await this.myEmployeeId();
    const rows = await this.db.tx
      .selectFrom('payroll_run_employees as e')
      .innerJoin('payroll_runs as r', 'r.id', 'e.run_id')
      .select([
        'r.id as run_id',
        'r.period',
        'r.run_type',
        'r.bonus_name',
        'r.approved_at',
        'e.gross',
        'e.deductions',
        'e.net',
      ])
      .where('e.employee_id', '=', employeeId)
      .where('r.state', 'in', PAID_STATES)
      .orderBy('r.period', 'desc')
      .execute();
    return rows.map((r) => ({
      runId: r.run_id,
      period: r.period,
      runType: r.run_type,
      bonusName: r.bonus_name,
      approvedAt: r.approved_at,
      gross: r.gross,
      deductions: r.deductions,
      net: r.net,
    }));
  }

  async myPayslip(runId: string) {
    const employeeId = await this.myEmployeeId();
    const run = await this.findRun(runId);
    if (run.state !== 'approved' && run.state !== 'disbursed')
      throw new NotFoundException(MSG.PAYSLIP_NOT_FOUND);
    return this.payslip(run, employeeId, false);
  }

  /** HR / Accounts: an employee's approved payslips. */
  async employeePayslips(employeeId: string) {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    const canView = (
      ['payroll.prepare', 'payroll.verify', 'payroll.approve'] as const
    ).some((p) => this.access.allows(p, resource));
    if (!canView || !this.access.canSeeField('salary', resource))
      throw new ForbiddenException(MSG.FORBIDDEN);
    const rows = await this.db.tx
      .selectFrom('payroll_run_employees as e')
      .innerJoin('payroll_runs as r', 'r.id', 'e.run_id')
      .select([
        'r.id as run_id',
        'r.period',
        'r.run_type',
        'r.bonus_name',
        'r.approved_at',
        'e.gross',
        'e.deductions',
        'e.net',
        'e.tax',
      ])
      .where('e.employee_id', '=', employeeId)
      .where('r.state', 'in', PAID_STATES)
      .orderBy('r.period', 'desc')
      .execute();
    return rows.map((r) => ({
      runId: r.run_id,
      period: r.period,
      runType: r.run_type,
      bonusName: r.bonus_name,
      approvedAt: r.approved_at,
      gross: r.gross,
      deductions: r.deductions,
      net: r.net,
      tax: r.tax,
    }));
  }

  // ================================================================ payslip PDF, salary journal (WP7)

  /** My payslip as a PDF (Bangla or English), optionally password-protected. */
  async myPayslipPdf(runId: string, lang: PayslipLanguage, protect: boolean) {
    const employeeId = await this.myEmployeeId();
    const run = await this.findRun(runId);
    if (run.state !== 'approved' && run.state !== 'disbursed')
      throw new NotFoundException(MSG.PAYSLIP_NOT_FOUND);
    return this.payslipPdf(run, employeeId, lang, protect);
  }

  /** HR / Accounts: an employee's payslip PDF from any calculated run (salary field access). */
  async employeePayslipPdf(
    runId: string,
    employeeId: string,
    lang: PayslipLanguage,
    protect: boolean,
  ) {
    const run = await this.findRun(runId);
    this.assertCanView(run.company_id);
    const employee = await this.employeeAccess.find(employeeId);
    if (
      !this.access.canSeeField(
        'salary',
        await this.employeeAccess.resourceOf(employee),
      )
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    return this.payslipPdf(run, employeeId, lang, protect);
  }

  /**
   * Payslip delivery (WP10): the password-protected PDF of a paid payslip, for
   * the e-mail to the employee. The caller is the notification relay, not a user.
   */
  async payslipPdfForDelivery(
    runId: string,
    employeeId: string,
    lang: PayslipLanguage,
  ) {
    const run = await this.findRun(runId);
    if (run.state !== 'approved' && run.state !== 'disbursed')
      throw new NotFoundException(MSG.PAYSLIP_NOT_FOUND);
    return this.payslipPdf(run, employeeId, lang, true);
  }

  /**
   * Salary journal CSV per cost centre (guide §12.5). Debits equal credits; the
   * last row shows both totals.
   */
  async salaryJournal(runId: string) {
    // find run and check access and state
    const run = await this.findRun(runId);
    this.assertCanView(run.company_id);
    if (run.state !== 'approved' && run.state !== 'disbursed')
      throw new ConflictException(MSG.PAYROLL_RUN_WRONG_STATE);

    // lines, net pay, and each employee's cost centre at the end of the period
    const { lines, nets, departmentOf } = await this.journalInputs(run);
    const names = await this.org.names({
      departmentIds: [...departmentOf.values()],
    });
    const costCentreOf = (employeeId: string) => {
      const dept = names.departments.get(departmentOf.get(employeeId) ?? '');
      return dept
        ? `${dept.costCentreCode ?? dept.code} ${dept.name}`
        : 'UNASSIGNED';
    };
    const labels = await this.headLabels(run.company_id);
    const headName = (code: string) => labels.get(code)?.en ?? code;

    // build
    const rows = buildSalaryJournal(
      lines.map((l) => ({
        employeeId: l.employee_id,
        headCode: l.head_code,
        kind: l.kind,
        amount: l.amount,
      })),
      new Map(nets.map((n) => [n.employee_id, n.net])),
      costCentreOf,
      headName,
    );
    const company = await this.org.companyNames(run.company_id);
    await this.audit.record({
      action: 'payroll_run.journal_exported',
      entity: 'payroll_run',
      entityId: run.id,
      after: { rows: rows.length },
    });
    return {
      fileName: `salary-journal-${run.period}-${run.run_type}.csv`,
      content: Buffer.from(
        journalCsv(
          {
            company: company.legalName,
            period: run.period,
            runType: run.run_type,
            runId: run.id,
          },
          rows,
        ),
        'utf8',
      ),
    };
  }

  /**
   * What the salary journal is built from: every line, each employee's net pay,
   * and each employee's department (cost centre) at the end of the period.
   * Also used by the ledger's automatic payroll posting (Phase 2 WP14); no
   * access check here, the callers check.
   */
  async journalInputs(run: PayrollRun) {
    const lines = await this.db.tx
      .selectFrom('payroll_lines')
      .select(['employee_id', 'head_code', 'kind', 'amount'])
      .where('run_id', '=', run.id)
      .execute();
    const nets = await this.netPayOf(run.id);
    const periodEnd = businessDate(monthPeriod(run.period).to);
    const departmentOf = new Map<string, string>();
    for (const n of nets) {
      const placement =
        (await this.directory.placementOn(n.employee_id, periodEnd)) ??
        (await this.directory.currentOrFirstPlacement(n.employee_id));
      if (placement) departmentOf.set(n.employee_id, placement.departmentId);
    }
    return { lines, nets, departmentOf, periodEnd };
  }

  private async payslipPdf(
    run: PayrollRun,
    employeeId: string,
    lang: PayslipLanguage,
    protect: boolean,
  ) {
    const slip = await this.payslip(run, employeeId, false);
    const employee = await this.employeeAccess.find(employeeId);

    const title = await this.employeeTitle(
      employee,
      monthPeriod(run.period).to,
      lang,
    );

    // head names in the chosen language
    const labels = await this.headLabels(run.company_id);
    const label = (l: { head: string; forPeriod?: string }) =>
      (labels.get(l.head)?.[lang] ?? l.head) +
      (l.forPeriod ? ` (${monthName(l.forPeriod, lang)})` : '');
    const toLines = (
      list: Array<{ head: string; amount: string; forPeriod?: string }>,
    ) => list.map((l) => ({ label: label(l), amount: l.amount }));

    const company = await this.org.companyNames(run.company_id);
    const content = await renderPayslipPdf(
      {
        lang,
        companyName: company.legalName,
        period: run.period,
        runType: run.run_type,
        bonusName: run.bonus_name,
        employee: {
          code: employee.employee_code,
          name:
            lang === 'bn'
              ? (employee.full_name_bn ?? employee.full_name_en)
              : employee.full_name_en,
          department: title.department,
          designation: title.designation,
        },
        earnings: toLines(slip.earnings),
        deductions: toLines(slip.deductions),
        employerContributions: toLines(slip.employerContributions),
        gross: slip.gross,
        totalDeductions: slip.totalDeductions,
        net: slip.net,
        generatedOn: toBusinessDate(this.clock.now()),
      },
      protect ? payslipPassword(employee) : undefined,
    );
    await this.audit.record({
      action: 'payslip.pdf_downloaded',
      entity: 'payroll_run',
      entityId: run.id,
      after: { employeeId, lang, protected: protect },
    });
    return {
      fileName: `payslip-${employee.employee_code}-${run.period}${run.run_type === 'regular' ? '' : `-${run.run_type}`}-${lang}.pdf`,
      content,
      passwordHint: protect
        ? employee.date_of_birth
          ? 'date of birth as DDMMYYYY'
          : 'employee code'
        : null,
    };
  }

  /** Department and designation on a date (or on the last working day, if earlier). */
  async employeeTitle(
    employee: Employee,
    date: string,
    lang: PayslipLanguage,
  ): Promise<{ department: string | null; designation: string | null }> {
    const asOf =
      employee.last_working_day && employee.last_working_day < date
        ? employee.last_working_day
        : date;
    const placement =
      (await this.directory.placementOn(employee.id, businessDate(asOf))) ??
      (await this.directory.currentOrFirstPlacement(employee.id));
    if (!placement) return { department: null, designation: null };
    const names = await this.org.names({
      departmentIds: [placement.departmentId],
      designationIds: [placement.designationId],
    });
    const designation = names.designations.get(placement.designationId);
    return {
      department: names.departments.get(placement.departmentId)?.name ?? null,
      designation: designation
        ? lang === 'bn'
          ? (designation.nameBn ?? designation.nameEn)
          : designation.nameEn
        : null,
    };
  }

  /** Head code -> names: company heads, then the engine's own heads. */
  async headLabels(
    companyId: string,
  ): Promise<Map<string, { en: string; bn: string }>> {
    const heads = await this.db.tx
      .selectFrom('salary_heads')
      .select(['code', 'name_en', 'name_bn'])
      .where('company_id', '=', companyId)
      .execute();
    const map = new Map(Object.entries(SYSTEM_HEAD_LABELS));
    for (const h of heads)
      map.set(h.code, { en: h.name_en, bn: h.name_bn ?? h.name_en });
    return map;
  }

  // ================================================================ for disbursement (WP7)

  /** Net pay of every employee of an approved run. */
  async netPayOf(runId: string) {
    return this.db.tx
      .selectFrom('payroll_run_employees as r')
      .innerJoin('employees as e', 'e.id', 'r.employee_id')
      .select(['r.employee_id', 'e.employee_code', 'e.full_name_en', 'r.net'])
      .where('r.run_id', '=', runId)
      .orderBy('e.employee_code')
      .execute();
  }

  async findRunById(runId: string): Promise<PayrollRun> {
    return this.findRun(runId);
  }

  /** Every payment of the run is paid: the run is "disbursed" and payslip delivery can start (spec §6.4 step 9). */
  async markDisbursed(runId: string): Promise<void> {
    const run = await this.findRun(runId);
    if (run.state !== 'approved') return;
    await this.db.tx
      .updateTable('payroll_runs')
      .set({ state: 'disbursed', disbursed_at: this.clock.now() })
      .where('id', '=', run.id)
      .execute();
    await this.audit.record({
      action: 'payroll_run.disbursed',
      entity: 'payroll_run',
      entityId: run.id,
      after: { period: run.period },
    });
    await this.outbox.add({
      type: 'payroll.disbursed',
      entityId: run.id,
      payload: {
        runId: run.id,
        companyId: run.company_id,
        period: run.period,
        runType: run.run_type,
        headcount: run.headcount,
      },
    });
  }

  // ================================================================ approval hooks

  private async markVerified(approval: ApprovalRequest): Promise<void> {
    await this.db.tx
      .updateTable('payroll_runs')
      .set({ state: 'verified' })
      .where('id', '=', approval.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  /** Final approval: freeze, and mark everything the run paid. Same transaction as the approval. */
  private async applyApproval(approval: ApprovalRequest): Promise<void> {
    const run = await this.findRun(approval.source_id);
    await this.db.tx
      .updateTable('payroll_runs')
      .set({ state: 'approved', approved_at: this.clock.now() })
      .where('id', '=', run.id)
      .execute();

    // what this run paid
    const rows = await this.db.tx
      .selectFrom('payroll_run_employees')
      .select(['employee_id', 'input'])
      .where('run_id', '=', run.id)
      .execute();
    const refs = rows.map((r) => (r.input as StoredInput).refs);
    await this.attendance.markAdjustmentsPaid(
      refs.flatMap((r) => r.adjustmentIds),
      run.period,
    );
    await this.leave.markEncashmentsPaid(
      refs.flatMap((r) => r.encashmentIds),
      run.period,
    );
    await this.variables.markVariablesPaid(
      refs.flatMap((r) => r.variableIds),
      run.id,
    );

    // loan installments recovered
    const recoveries = await this.db.tx
      .selectFrom('payroll_lines')
      .select(['amount', 'explanation'])
      .where('run_id', '=', run.id)
      .where('head_code', '=', 'LOAN_RECOVERY')
      .execute();
    await this.variables.recordRecoveries(
      run.id,
      run.period,
      recoveries.map((l) => ({
        loanId: (l.explanation as { loanId: string }).loanId,
        amount: l.amount,
      })),
    );

    // a final settlement separates the employee
    if (run.run_type === 'final_settlement' && run.employee_id)
      await this.employees.markSeparated(run.employee_id);

    // payments for the bank / wallet / cash files
    const approved = await this.findRun(run.id);
    for (const listener of this.approvedListeners) await listener(approved);

    await this.audit.record({
      action: 'payroll_run.approved',
      entity: 'payroll_run',
      entityId: run.id,
      after: { approvalRequestId: approval.id },
    });
    // no amounts in the event (outbox rule): consumers read the run through the API
    await this.outbox.add({
      type: 'payroll.approved',
      entityId: run.id,
      payload: {
        runId: run.id,
        companyId: run.company_id,
        period: run.period,
        runType: run.run_type,
        headcount: run.headcount,
      },
    });
  }

  /** Rejected, returned or withdrawn: back to "calculated" so HR can fix and recalculate. */
  private async applyClosure(
    approval: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ): Promise<void> {
    await this.db.tx
      .updateTable('payroll_runs')
      .set({ state: 'calculated', approval_request_id: null })
      .where('id', '=', approval.source_id)
      .where('state', 'in', ['in_approval', 'verified'])
      .execute();
    await this.audit.record({
      action: `payroll_run.${outcome}`,
      entity: 'payroll_run',
      entityId: approval.source_id,
      after: { approvalRequestId: approval.id },
    });
  }

  // ================================================================ helpers

  private async prepare(run: PayrollRun): Promise<PreparedEmployee[]> {
    const settlement = (run.settlement ?? {}) as {
      noticeShortfallDays?: number;
      festivalGroup?: string | null;
    };
    if (run.run_type === 'regular')
      return this.inputs.buildRegular(run.company_id, run.period);
    if (run.run_type === 'bonus')
      return this.inputs.buildBonus(
        run.company_id,
        run.period,
        run.bonus_date!,
        settlement.festivalGroup ?? undefined,
      );
    const employee = await this.employeeAccess.find(run.employee_id!);
    return [
      await this.inputs.buildFinalSettlement(
        employee,
        run.period,
        settlement.noticeShortfallDays ?? 0,
      ),
    ];
  }

  private async payslip(
    run: PayrollRun,
    employeeId: string,
    withExplanation: boolean,
  ) {
    const row = await this.db.tx
      .selectFrom('payroll_run_employees')
      .selectAll()
      .where('run_id', '=', run.id)
      .where('employee_id', '=', employeeId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException(MSG.PAYSLIP_NOT_FOUND);
    const employee = await this.employeeAccess.find(employeeId);
    const lines = await this.db.tx
      .selectFrom('payroll_lines')
      .selectAll()
      .where('run_id', '=', run.id)
      .where('employee_id', '=', employeeId)
      .orderBy('line_no')
      .execute();
    const toLine = (l: (typeof lines)[number]) => ({
      head: l.head_code,
      amount: l.amount,
      ...(l.for_period ? { forPeriod: l.for_period } : {}),
      ...(withExplanation
        ? { taxable: l.taxable, explanation: l.explanation }
        : {}),
    });
    return {
      runId: run.id,
      period: run.period,
      runType: run.run_type,
      bonusName: run.bonus_name,
      state: run.state,
      employee: {
        id: employee.id,
        code: employee.employee_code,
        fullNameEn: employee.full_name_en,
        fullNameBn: employee.full_name_bn,
      },
      earnings: lines.filter((l) => l.kind === 'earning').map(toLine),
      deductions: lines.filter((l) => l.kind === 'deduction').map(toLine),
      employerContributions: lines
        .filter((l) => l.kind === 'employer_cost')
        .map(toLine),
      gross: row.gross,
      totalDeductions: row.deductions,
      net: row.net,
      tax: { thisMonth: row.tax, projection: row.projection },
      ...(withExplanation
        ? { engineVersion: row.engine_version, inputHash: row.input_hash }
        : {}),
    };
  }

  private assertCanView(companyId: string): void {
    const can = (
      ['payroll.prepare', 'payroll.verify', 'payroll.approve'] as const
    ).some((p) => this.access.allows(p, { companyId }));
    if (!can) throw new ForbiddenException(MSG.FORBIDDEN);
  }

  async myEmployeeId(): Promise<string> {
    const employeeId = await this.users.employeeOfUser(
      requestContext.get().userId!,
    );
    if (!employeeId) throw new NotFoundException(MSG.PAYSLIP_NOT_FOUND);
    return employeeId;
  }

  private async findRun(runId: string): Promise<PayrollRun> {
    const run = await this.db.tx
      .selectFrom('payroll_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirst();
    if (!run) throw new NotFoundException(MSG.PAYROLL_RUN_NOT_FOUND);
    return run;
  }
}

// ------------------------------------------------------------------ helpers

function runEngine(
  kind: 'monthly' | 'bonus',
  input: MonthlyInput | BonusInput,
): PayResult & { eligible?: boolean } {
  return kind === 'bonus'
    ? calculateBonus(input as BonusInput)
    : calculateMonthly(input as MonthlyInput);
}

/**
 * Password of a protected payslip: the employee's date of birth as DDMMYYYY
 * (e.g. 15081998), or the employee code when no date of birth is recorded.
 */
function payslipPassword(employee: {
  date_of_birth: string | null;
  employee_code: string;
}): string {
  if (!employee.date_of_birth) return employee.employee_code;
  const [y, m, d] = employee.date_of_birth.split('-');
  return `${d}${m}${y}`;
}

function describeRun(run: PayrollRun): string {
  if (run.run_type === 'bonus') return `${run.bonus_name} (${run.period})`;
  if (run.run_type === 'final_settlement')
    return `final settlement ${run.period}`;
  return run.period;
}

function toRunSummary(r: PayrollRun) {
  return {
    id: r.id,
    companyId: r.company_id,
    period: r.period,
    runType: r.run_type,
    state: r.state,
    bonusName: r.bonus_name,
    bonusDate: r.bonus_date,
    employeeId: r.employee_id,
    settlement: r.settlement,
    headcount: r.headcount,
    totals: {
      gross: r.total_gross,
      deductions: r.total_deductions,
      net: r.total_net,
      tax: r.total_tax,
      employerCost: r.total_employer_cost,
    },
    engineVersion: r.engine_version,
    inputHash: r.input_hash,
    approvalRequestId: r.approval_request_id,
    calculatedAt: r.calculated_at,
    approvedAt: r.approved_at,
    cancelledReason: r.cancelled_reason,
    version: r.version,
  };
}
