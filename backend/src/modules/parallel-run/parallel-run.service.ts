/**
 * Gate 1 (spec §12): each pilot runs two parallel payrolls that match its current
 * payroll before it pays from the ERP.
 *
 *   compare(runId, file)     HR uploads the old system's register for the run's
 *                            month; every employee is compared (compare.ts)
 *   explain(id, code, text)  HR explains each difference (e.g. "old system rounds tax
 *                            to whole taka", "joined on the 20th, old system paid full month")
 *   accept(id, note)         Accounts accepts, once every difference is explained.
 *                            Maker-checker: not the uploader. A run recalculated
 *                            after the upload makes the comparison outdated.
 *   gate(companyId)          accepted, up-to-date comparisons of distinct months;
 *                            two of them = Gate 1 passed
 *
 * Salary figures: only for people who may see the company's payroll amounts
 * (the salary field group), as on the run screen.
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
import { sha256Hex } from '../../platform/crypto/canonical-json.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ParallelRunComparisonsTable,
  PayrollRun,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { readSheet } from '../data-import/spreadsheet.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { Selectable } from 'kysely';
import {
  compareRegister,
  FIGURES,
  parseRegister,
  type ErpEmployee,
} from './compare.js';
import type {
  AcceptComparisonDto,
  CompareDto,
  ExplainDto,
} from './dto/parallel-run.dto.js';

export const MAX_REGISTER_BYTES = 5 * 1024 * 1024;
/** Accepted months needed for Gate 1. */
export const GATE_1_MONTHS = 2;
const COMPARABLE_STATES = [
  'calculated',
  'in_approval',
  'verified',
  'approved',
  'disbursed',
];

type Comparison = Selectable<ParallelRunComparisonsTable>;

@Injectable()
export class ParallelRunService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  /** The register template: the columns, with a Bangladeshi example. */
  template(): string {
    return (
      [
        'employee_code,gross,total_deductions,net,tax,pf_employee',
        'MFL-00007,"85,000.00","6,500.00","78,500.00","1,250.00","5,100.00"',
        'MFL-00012,"52,000.00","2,600.00","49,400.00",0,"3,120.00"',
      ].join('\r\n') + '\r\n'
    );
  }

  // ============================================================== compare

  async compare(
    runId: string,
    file: Express.Multer.File | undefined,
    dto: CompareDto,
  ) {
    // the run: a calculated regular payroll this user may prepare and see the amounts of
    const run = await this.findRun(runId);
    this.access.assert('payroll.prepare', { companyId: run.company_id });
    this.assertSeesAmounts(run.company_id);
    if (
      run.run_type !== 'regular' ||
      !COMPARABLE_STATES.includes(run.state) ||
      !run.calculated_at
    ) {
      throw new ConflictException(MSG.PAYROLL_RUN_WRONG_STATE);
    }

    // read the register
    if (!file)
      throw new BadRequestException({
        message: MSG.PARALLEL_FILE_INVALID,
        details: {
          problems: ['Attach the register as "file" (.xlsx or .csv)'],
        },
      });
    let sheet;
    try {
      sheet = await readSheet(file.buffer, file.originalname);
    } catch {
      throw new BadRequestException({
        message: MSG.PARALLEL_FILE_INVALID,
        details: { problems: ['The file is not a readable Excel / CSV file'] },
      });
    }
    const register = parseRegister(sheet.headers, sheet.rows);
    if (!register.rows.length)
      register.problems.push('The file has no employees');
    if (register.problems.length)
      throw new BadRequestException({
        message: MSG.PARALLEL_FILE_INVALID,
        details: { problems: register.problems.slice(0, 50) },
      });

    // compare with the run
    const result = compareRegister(
      register.rows,
      register.figures,
      await this.erpFigures(run.id),
      dto.tolerance ?? '0.00',
    );

    // save
    const comparison = await this.db.tx
      .insertInto('parallel_run_comparisons')
      .values({
        company_id: run.company_id,
        run_id: run.id,
        period: run.period,
        run_calculated_at: run.calculated_at,
        file_name: file.originalname,
        file_sha256: sha256Hex(file.buffer.toString('base64')),
        tolerance: dto.tolerance ?? '0.00',
        employees: result.summary.employees,
        matched: result.summary.matched,
        different: result.summary.different,
        missing_in_erp: result.summary.missingInErp,
        missing_in_legacy: result.summary.missingInLegacy,
        totals: JSON.stringify(result.summary.totals),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('parallel_run_lines')
      .values(
        result.lines.map((l) => ({
          comparison_id: comparison.id,
          employee_code: l.employeeCode,
          employee_id: l.employeeId,
          outcome: l.outcome,
          legacy: l.legacy ? JSON.stringify(l.legacy) : null,
          erp: l.erp ? JSON.stringify(l.erp) : null,
          differences: JSON.stringify(l.differences),
        })),
      )
      .execute();
    await this.audit.record({
      action: 'parallel_run.compared',
      entity: 'payroll_run',
      entityId: run.id,
      after: {
        comparisonId: comparison.id,
        file: file.originalname,
        ...result.summary,
      },
    });
    return this.get(comparison.id);
  }

  // ================================================================= read

  async get(id: string) {
    const c = await this.findComparison(id);
    this.assertCanView(c.company_id);
    this.assertSeesAmounts(c.company_id);
    const lines = await this.db.tx
      .selectFrom('parallel_run_lines')
      .selectAll()
      .where('comparison_id', '=', c.id)
      .orderBy('employee_code')
      .execute();
    const order = {
      different: 0,
      missing_in_erp: 1,
      missing_in_legacy: 2,
      match: 3,
    };
    return {
      ...(await this.summary(c)),
      lines: lines
        .sort(
          (a, b) =>
            order[a.outcome] - order[b.outcome] ||
            a.employee_code.localeCompare(b.employee_code),
        )
        .map((l) => ({
          employeeCode: l.employee_code,
          employeeId: l.employee_id,
          outcome: l.outcome,
          legacy: l.legacy,
          erp: l.erp,
          differences: l.differences,
          explanation: l.explanation,
          explainedBy: l.explained_by,
          explainedAt: l.explained_at,
        })),
    };
  }

  /** The company's comparisons and where Gate 1 stands. */
  async gate(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertCanView(companyId);
    const rows = await this.db.tx
      .selectFrom('parallel_run_comparisons')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('period', 'desc')
      .orderBy('created_at', 'desc')
      .execute();
    const comparisons = await Promise.all(rows.map((c) => this.summary(c)));
    const months = [
      ...new Set(
        comparisons
          .filter((c) => c.status === 'accepted' && !c.outdated)
          .map((c) => c.period),
      ),
    ].sort();
    return {
      companyId,
      requiredMonths: GATE_1_MONTHS,
      acceptedMonths: months,
      gate1Passed: months.length >= GATE_1_MONTHS,
      comparisons,
    };
  }

  // ======================================================= explain, accept

  async explain(id: string, employeeCode: string, dto: ExplainDto) {
    const c = await this.findComparison(id);
    this.access.assert('payroll.prepare', { companyId: c.company_id });
    if (c.status === 'accepted')
      throw new ConflictException(MSG.PARALLEL_ALREADY_ACCEPTED);
    const line = await this.db.tx
      .updateTable('parallel_run_lines')
      .set({
        explanation: dto.explanation,
        explained_by: requestContext.get().userId ?? null,
        explained_at: this.clock.now(),
      })
      .where('comparison_id', '=', c.id)
      .where('employee_code', '=', employeeCode)
      .where('outcome', '<>', 'match')
      .returning(['employee_code', 'outcome', 'explanation'])
      .executeTakeFirst();
    if (!line) throw new NotFoundException(MSG.NOT_FOUND);
    await this.audit.record({
      action: 'parallel_run.explained',
      entity: 'payroll_run',
      entityId: c.run_id,
      after: {
        comparisonId: c.id,
        employeeCode,
        outcome: line.outcome,
        explanation: dto.explanation,
      },
    });
    return {
      employeeCode: line.employee_code,
      outcome: line.outcome,
      explanation: line.explanation,
    };
  }

  async accept(id: string, dto: AcceptComparisonDto) {
    // Accounts, not the uploader
    const c = await this.findComparison(id);
    this.access.assert('payroll.verify', { companyId: c.company_id });
    if (c.status === 'accepted')
      throw new ConflictException(MSG.PARALLEL_ALREADY_ACCEPTED);
    const userId = requestContext.get().userId!;
    if (c.created_by === userId)
      throw new ForbiddenException(MSG.PARALLEL_SAME_PERSON);

    // still the run as compared, and every difference explained
    if ((await this.summary(c)).outdated)
      throw new ConflictException(MSG.PARALLEL_OUTDATED);
    const unexplained = await this.db.tx
      .selectFrom('parallel_run_lines')
      .select('employee_code')
      .where('comparison_id', '=', c.id)
      .where('outcome', '<>', 'match')
      .where('explanation', 'is', null)
      .execute();
    if (unexplained.length)
      throw new ConflictException({
        message: MSG.PARALLEL_UNEXPLAINED,
        details: { employees: unexplained.map((u) => u.employee_code) },
      });

    // accept
    await this.db.tx
      .updateTable('parallel_run_comparisons')
      .set({
        status: 'accepted',
        accepted_by: userId,
        accepted_at: this.clock.now(),
        acceptance_note: dto.note ?? null,
      })
      .where('id', '=', c.id)
      .execute();
    await this.audit.record({
      action: 'parallel_run.accepted',
      entity: 'payroll_run',
      entityId: c.run_id,
      after: { comparisonId: c.id, period: c.period, note: dto.note },
    });
    return this.gate(c.company_id);
  }

  // ============================================================== helpers

  private async summary(c: Comparison) {
    const run = await this.db.tx
      .selectFrom('payroll_runs')
      .select(['state', 'calculated_at'])
      .where('id', '=', c.run_id)
      .executeTakeFirst();
    const outdated =
      !run ||
      run.state === 'cancelled' ||
      run.calculated_at?.getTime() !== c.run_calculated_at.getTime();
    return {
      id: c.id,
      companyId: c.company_id,
      runId: c.run_id,
      period: c.period,
      fileName: c.file_name,
      tolerance: c.tolerance,
      employees: c.employees,
      matched: c.matched,
      different: c.different,
      missingInErp: c.missing_in_erp,
      missingInLegacy: c.missing_in_legacy,
      totals: c.totals,
      status: c.status,
      outdated,
      createdBy: c.created_by,
      createdAt: c.created_at,
      acceptedBy: c.accepted_by,
      acceptedAt: c.accepted_at,
      acceptanceNote: c.acceptance_note,
    };
  }

  /** Every employee of the run with the figures the register may contain. */
  private async erpFigures(runId: string): Promise<ErpEmployee[]> {
    const rows = await this.db.tx
      .selectFrom('payroll_run_employees as r')
      .innerJoin('employees as e', 'e.id', 'r.employee_id')
      .select([
        'r.employee_id',
        'e.employee_code',
        'r.gross',
        'r.deductions',
        'r.net',
        'r.tax',
      ])
      .where('r.run_id', '=', runId)
      .execute();
    const pf = await this.db.tx
      .selectFrom('payroll_lines')
      .select(['employee_id', (eb) => eb.fn.sum<string>('amount').as('amount')])
      .where('run_id', '=', runId)
      .where('head_code', '=', 'PF_EMPLOYEE')
      .groupBy('employee_id')
      .execute();
    const pfOf = new Map(pf.map((p) => [p.employee_id, p.amount]));
    return rows.map((r) => ({
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      figures: {
        gross: r.gross,
        total_deductions: r.deductions,
        net: r.net,
        tax: r.tax,
        pf_employee: pfOf.get(r.employee_id) ?? '0.00',
      } as Record<(typeof FIGURES)[number], string>,
    }));
  }

  private assertCanView(companyId: string) {
    const can = (
      ['payroll.prepare', 'payroll.verify', 'payroll.approve'] as const
    ).some((p) => this.access.allows(p, { companyId }));
    if (!can) throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private assertSeesAmounts(companyId: string) {
    if (!this.access.canSeeField('salary', { companyId }))
      throw new ForbiddenException(MSG.FORBIDDEN);
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

  private async findComparison(id: string): Promise<Comparison> {
    const c = await this.db.tx
      .selectFrom('parallel_run_comparisons')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!c) throw new NotFoundException(MSG.PARALLEL_COMPARISON_NOT_FOUND);
    return c;
  }
}
