/**
 * Payroll master data (spec §6.4 "Setup"):
 *   - company payroll settings (rounding, unpaid-day basis, OT basis, PF ...)
 *   - salary heads and salary structures (Bangladesh defaults available)
 *   - each employee's salary history (salary field access needed to see it)
 *   - tax year-to-date openings (go-live balances, a joiner's previous employer)
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { addDays, businessDate } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { changesOnly } from '../../platform/db/optimistic-lock.js';
import type { Employee, PayrollSettingsRow } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import {
  applyStructure,
  SYSTEM_HEADS,
  type PayrollSettings,
  type SalarySegment,
  type StructureRule,
} from '../../payroll-engine/index.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  AddSalaryDto,
  CreateSalaryHeadDto,
  CreateStructureDto,
  PayrollSettingsDto,
  ReasonDto,
  YtdOpeningDto,
} from './dto/payroll.dto.js';

/** Common Bangladeshi salary heads. */
export const BD_DEFAULT_HEADS: CreateSalaryHeadDto[] = [
  {
    code: 'BASIC',
    nameEn: 'Basic salary',
    nameBn: 'মূল বেতন',
    kind: 'earning',
    sortOrder: 10,
  },
  {
    code: 'HOUSE_RENT',
    nameEn: 'House rent allowance',
    nameBn: 'বাড়ি ভাড়া ভাতা',
    kind: 'earning',
    sortOrder: 20,
  },
  {
    code: 'MEDICAL',
    nameEn: 'Medical allowance',
    nameBn: 'চিকিৎসা ভাতা',
    kind: 'earning',
    sortOrder: 30,
  },
  {
    code: 'CONVEYANCE',
    nameEn: 'Conveyance allowance',
    nameBn: 'যাতায়াত ভাতা',
    kind: 'earning',
    sortOrder: 40,
  },
  {
    code: 'OTHER_ALLOWANCE',
    nameEn: 'Other allowance',
    nameBn: 'অন্যান্য ভাতা',
    kind: 'earning',
    sortOrder: 50,
  },
  {
    code: 'COMMISSION',
    nameEn: 'Sales commission',
    nameBn: 'বিক্রয় কমিশন',
    kind: 'earning',
    sortOrder: 60,
  },
  {
    code: 'OTHER_DEDUCTION',
    nameEn: 'Other deduction',
    nameBn: 'অন্যান্য কর্তন',
    kind: 'deduction',
    taxable: false,
    sortOrder: 200,
  },
];

/** Basic 60% of gross, house rent 50% of basic, medical 10% of basic, the rest other allowance. */
export const BD_DEFAULT_STRUCTURE: CreateStructureDto = {
  code: 'STD',
  name: 'Standard (Basic 60%)',
  rules: [
    { head: 'BASIC', of: 'GROSS', percent: '60' },
    { head: 'HOUSE_RENT', of: 'BASIC', percent: '50' },
    { head: 'MEDICAL', of: 'BASIC', percent: '10' },
    { head: 'OTHER_ALLOWANCE', remainder: true },
  ],
};

@Injectable()
export class PayrollSetupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly employeeAccess: EmployeeAccess,
  ) {}

  // ================================================================ settings

  async getSettings(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payroll.prepare', { companyId });
    return toSettingsResponse(companyId, await this.findSettings(companyId));
  }

  async saveSettings(companyId: string, dto: PayrollSettingsDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payroll.prepare', { companyId });
    const values = changesOnly({
      rounding_increment: dto.roundingIncrement,
      rounding_mode: dto.roundingMode,
      unpaid_day_basis: dto.unpaidDayBasis,
      ot_hours_basis: dto.otHoursBasis,
      ot_monthly_limit_hours: dto.otMonthlyLimitHours,
      pf_employee_percent: dto.pfEmployeePercent,
      pf_employer_percent: dto.pfEmployerPercent,
      gratuity_provision: dto.gratuityProvision,
      net_change_flag_percent: dto.netChangeFlagPercent,
      encashment_divisor: dto.encashmentDivisor,
    });

    // save (insert the first time)
    const existing = await this.findSettings(companyId);
    const saved = existing
      ? values
        ? await this.db.tx
            .updateTable('payroll_settings')
            .set(values)
            .where('id', '=', existing.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : existing
      : await this.db.tx
          .insertInto('payroll_settings')
          .values({ company_id: companyId, ...values })
          .returningAll()
          .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'payroll_settings.saved',
      entity: 'company',
      entityId: companyId,
      after: dto,
    });
    return toSettingsResponse(companyId, saved);
  }

  /** Settings in the engine's shape (defaults when HR has not saved any). */
  async engineSettings(companyId: string): Promise<PayrollSettings> {
    return toSettingsResponse(companyId, await this.findSettings(companyId))
      .engine;
  }

  // ================================================================ heads

  async listHeads(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const rows = await this.db.tx
      .selectFrom('salary_heads')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('sort_order')
      .orderBy('code')
      .execute();
    return {
      heads: rows.map((h) => ({
        id: h.id,
        code: h.code,
        nameEn: h.name_en,
        nameBn: h.name_bn,
        kind: h.kind,
        taxable: h.taxable,
        sortOrder: h.sort_order,
        isActive: h.is_active,
      })),
      // produced by the engine itself; cannot be created or changed
      systemHeads: Object.values(SYSTEM_HEADS).map((h) => ({
        code: h.code,
        kind: h.kind,
        taxable: h.taxable,
      })),
    };
  }

  async createHead(companyId: string, dto: CreateSalaryHeadDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payroll.prepare', { companyId });
    if (SYSTEM_HEADS[dto.code])
      throw new BadRequestException(`${dto.code} is a system head`);
    if (dto.kind === 'deduction' && dto.taxable)
      throw new BadRequestException('Only earnings can be taxable');

    // save (unique code per company: a duplicate is a 409)
    const head = await this.db.tx
      .insertInto('salary_heads')
      .values({
        company_id: companyId,
        code: dto.code,
        name_en: dto.nameEn,
        name_bn: dto.nameBn ?? null,
        kind: dto.kind,
        taxable: dto.kind === 'earning' ? (dto.taxable ?? true) : false,
        sort_order: dto.sortOrder ?? 100,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'salary_head.created',
      entity: 'salary_head',
      entityId: head.id,
      after: dto,
    });
    return head;
  }

  /** Bangladesh default heads and the standard structure (skips what already exists). */
  async createDefaults(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payroll.prepare', { companyId });

    // heads
    const existing = new Set(
      (
        await this.db.tx
          .selectFrom('salary_heads')
          .select('code')
          .where('company_id', '=', companyId)
          .execute()
      ).map((h) => h.code),
    );
    const createdHeads: string[] = [];
    for (const head of BD_DEFAULT_HEADS) {
      if (existing.has(head.code)) continue;
      await this.createHead(companyId, head);
      createdHeads.push(head.code);
    }

    // structure
    const structure = await this.db.tx
      .selectFrom('salary_structures')
      .select('id')
      .where('company_id', '=', companyId)
      .where('code', '=', BD_DEFAULT_STRUCTURE.code)
      .executeTakeFirst();
    const structureId =
      structure?.id ??
      (await this.createStructure(companyId, BD_DEFAULT_STRUCTURE)).id;
    return { createdHeads, structureId, structureCreated: !structure };
  }

  // ================================================================ structures

  async listStructures(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const rows = await this.db.tx
      .selectFrom('salary_structures')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      rules: s.rules,
      isActive: s.is_active,
    }));
  }

  /** A structure is never edited once created: make a new one for a new split. */
  async createStructure(companyId: string, dto: CreateStructureDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payroll.prepare', { companyId });

    // check the rules against the company's heads
    const heads = await this.db.tx
      .selectFrom('salary_heads')
      .select(['code', 'kind'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .execute();
    const rules = dto.rules.map(cleanRule);
    const problem = checkStructure(
      rules,
      new Set(heads.filter((h) => h.kind === 'earning').map((h) => h.code)),
    );
    if (problem)
      throw new BadRequestException({
        message: MSG.PAYROLL_STRUCTURE_INVALID,
        details: { problem },
      });

    // save
    const structure = await this.db.tx
      .insertInto('salary_structures')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name,
        rules: JSON.stringify(rules),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'salary_structure.created',
      entity: 'salary_structure',
      entityId: structure.id,
      after: dto,
    });
    return {
      id: structure.id,
      code: structure.code,
      name: structure.name,
      rules,
    };
  }

  // ================================================================ salaries

  /** Salary history of an employee (needs the salary field group). */
  async listSalaries(employeeId: string) {
    // find employee and check access (HR, Accounts and the approving Admin may read)
    const employee = await this.checkSalaryRead(employeeId);

    // read history, newest first
    const rows = await this.db.tx
      .selectFrom('employee_salaries as s')
      .innerJoin('salary_structures as t', 't.id', 's.structure_id')
      .select([
        's.id',
        's.effective_from',
        's.gross',
        's.reason',
        's.status',
        's.cancelled_reason',
        's.created_at',
        't.code as structure_code',
        't.rules',
      ])
      .where('s.employee_id', '=', employee.id)
      .orderBy('s.effective_from', 'desc')
      .execute();
    const active = rows.filter((r) => r.status === 'active');
    return {
      employeeId,
      current: active[0]
        ? {
            gross: active[0].gross,
            effectiveFrom: active[0].effective_from,
            breakdown: breakdown(
              active[0].gross,
              active[0].rules as StructureRule[],
            ),
          }
        : null,
      history: rows.map((r) => ({
        id: r.id,
        effectiveFrom: r.effective_from,
        gross: r.gross,
        structure: r.structure_code,
        reason: r.reason,
        status: r.status,
        cancelledReason: r.cancelled_reason,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * Add a salary from a date. Dated before an already approved month, the
   * difference is paid as arrears in the next regular run.
   */
  async addSalary(employeeId: string, dto: AddSalaryDto) {
    // find employee and check access
    const employee = await this.checkSalaryAccess(employeeId);
    if (dto.effectiveFrom < employee.join_date)
      throw new BadRequestException(
        'A salary cannot start before the join date',
      );
    const structure = await this.db.tx
      .selectFrom('salary_structures')
      .select(['id', 'is_active'])
      .where('id', '=', dto.structureId)
      .where('company_id', '=', employee.company_id)
      .executeTakeFirst();
    if (!structure?.is_active)
      throw new NotFoundException(MSG.PAYROLL_STRUCTURE_NOT_FOUND);

    // save (one active salary per date: a second one is a 409)
    const salary = await this.db.tx
      .insertInto('employee_salaries')
      .values({
        company_id: employee.company_id,
        employee_id: employee.id,
        effective_from: dto.effectiveFrom,
        gross: Money.of(dto.gross).toDb(),
        structure_id: dto.structureId,
        reason: dto.reason,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'salary.added',
      entity: 'employee',
      entityId: employee.id,
      after: {
        salaryId: salary.id,
        effectiveFrom: dto.effectiveFrom,
        gross: salary.gross,
        reason: dto.reason,
      },
    });
    return this.listSalaries(employeeId);
  }

  async cancelSalary(salaryId: string, dto: ReasonDto) {
    // find the salary and check access
    const salary = await this.db.tx
      .selectFrom('employee_salaries')
      .selectAll()
      .where('id', '=', salaryId)
      .executeTakeFirst();
    if (!salary || salary.status !== 'active')
      throw new NotFoundException(MSG.SALARY_NOT_FOUND);
    await this.checkSalaryAccess(salary.employee_id);

    // cancel (never deleted)
    await this.db.tx
      .updateTable('employee_salaries')
      .set({
        status: 'cancelled',
        cancelled_reason: dto.reason,
        cancelled_at: new Date(),
      })
      .where('id', '=', salaryId)
      .execute();
    await this.audit.record({
      action: 'salary.cancelled',
      entity: 'employee',
      entityId: salary.employee_id,
      before: {
        salaryId,
        gross: salary.gross,
        effectiveFrom: salary.effective_from,
      },
      after: { reason: dto.reason },
    });
    return this.listSalaries(salary.employee_id);
  }

  /** The salary history as engine segments (to = the day before the next salary starts). */
  async salarySegments(employeeId: string): Promise<SalarySegment[]> {
    const rows = await this.db.tx
      .selectFrom('employee_salaries as s')
      .innerJoin('salary_structures as t', 't.id', 's.structure_id')
      .select(['s.effective_from', 's.gross', 't.rules'])
      .where('s.employee_id', '=', employeeId)
      .where('s.status', '=', 'active')
      .orderBy('s.effective_from')
      .execute();
    return rows.map((r, i) => ({
      from: r.effective_from,
      to: rows[i + 1]
        ? addDays(businessDate(rows[i + 1].effective_from), -1)
        : null,
      gross: r.gross,
      structure: r.rules as StructureRule[],
    }));
  }

  // ================================================================ YTD openings

  async listYtdOpenings(employeeId: string) {
    await this.checkSalaryAccess(employeeId);
    const rows = await this.db.tx
      .selectFrom('payroll_ytd_openings')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('fiscal_year', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      fiscalYear: r.fiscal_year,
      kind: r.kind,
      taxableIncome: r.taxable_income,
      taxWithheld: r.tax_withheld,
      note: r.note,
    }));
  }

  /** Save (or replace) one opening per employee, fiscal year and kind. */
  async saveYtdOpening(employeeId: string, dto: YtdOpeningDto) {
    await this.checkSalaryAccess(employeeId);
    const values = {
      taxable_income: Money.of(dto.taxableIncome).toDb(),
      tax_withheld: Money.of(dto.taxWithheld).toDb(),
      note: dto.note ?? null,
    };
    await this.db.tx
      .insertInto('payroll_ytd_openings')
      .values({
        employee_id: employeeId,
        fiscal_year: dto.fiscalYear,
        kind: dto.kind,
        ...values,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'employee_id', 'fiscal_year', 'kind'])
          .doUpdateSet(values),
      )
      .execute();
    await this.audit.record({
      action: 'payroll_ytd_opening.saved',
      entity: 'employee',
      entityId: employeeId,
      after: dto,
    });
    return this.listYtdOpenings(employeeId);
  }

  /** Sum of openings for a fiscal year (used by the tax projection). */
  async ytdOpening(
    employeeId: string,
    fiscalYear: string,
  ): Promise<{ taxableIncome: Money; taxWithheld: Money }> {
    const rows = await this.db.tx
      .selectFrom('payroll_ytd_openings')
      .select(['taxable_income', 'tax_withheld'])
      .where('employee_id', '=', employeeId)
      .where('fiscal_year', '=', fiscalYear)
      .execute();
    return {
      taxableIncome: Money.sum(rows.map((r) => r.taxable_income)),
      taxWithheld: Money.sum(rows.map((r) => r.tax_withheld)),
    };
  }

  // ================================================================ data migration (WP8)

  /** One salary row from the migration (already validated); returns its id. */
  async importSalary(row: {
    employeeId: string;
    effectiveFrom: string;
    gross: string;
    structureId: string;
    reason: string;
  }): Promise<string> {
    const employee = await this.checkSalaryAccess(row.employeeId);
    const saved = await this.db.tx
      .insertInto('employee_salaries')
      .values({
        company_id: employee.company_id,
        employee_id: employee.id,
        effective_from: row.effectiveFrom,
        gross: row.gross,
        structure_id: row.structureId,
        reason: row.reason,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'salary.added',
      entity: 'employee',
      entityId: employee.id,
      after: {
        salaryId: saved.id,
        effectiveFrom: row.effectiveFrom,
        gross: row.gross,
        source: 'data migration',
      },
    });
    return saved.id;
  }

  /** Year-to-date figures from the old payroll register (kind "opening"); returns its id. */
  async importYtdOpening(row: {
    employeeId: string;
    fiscalYear: string;
    taxableIncome: string;
    taxWithheld: string;
    pfEmployee: string;
    pfEmployer: string;
  }): Promise<string> {
    await this.checkSalaryAccess(row.employeeId);
    const saved = await this.db.tx
      .insertInto('payroll_ytd_openings')
      .values({
        employee_id: row.employeeId,
        fiscal_year: row.fiscalYear,
        kind: 'opening',
        taxable_income: row.taxableIncome,
        tax_withheld: row.taxWithheld,
        pf_employee: row.pfEmployee,
        pf_employer: row.pfEmployer,
        note: 'Old payroll register (data migration)',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'payroll_ytd_opening.saved',
      entity: 'employee',
      entityId: row.employeeId,
      after: { fiscalYear: row.fiscalYear, source: 'data migration' },
    });
    return saved.id;
  }

  /** Existing facts the migration must not duplicate. */
  async importFacts(employeeIds: string[]) {
    if (employeeIds.length === 0)
      return { salaryDates: new Set<string>(), ytdOpenings: new Set<string>() };
    const salaries = await this.db.tx
      .selectFrom('employee_salaries')
      .select(['employee_id', 'effective_from'])
      .where('employee_id', 'in', employeeIds)
      .where('status', '=', 'active')
      .execute();
    const ytd = await this.db.tx
      .selectFrom('payroll_ytd_openings')
      .select(['employee_id', 'fiscal_year'])
      .where('employee_id', 'in', employeeIds)
      .where('kind', '=', 'opening')
      .execute();
    return {
      salaryDates: new Set(
        salaries.map((s) => `${s.employee_id}|${s.effective_from}`),
      ),
      ytdOpenings: new Set(ytd.map((y) => `${y.employee_id}|${y.fiscal_year}`)),
    };
  }

  /** Active salary structures of a company by code. */
  async structuresByCode(companyId: string): Promise<Map<string, string>> {
    const rows = await this.db.tx
      .selectFrom('salary_structures')
      .select(['id', 'code'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .execute();
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  /** Gross salary in force on a date, per employee (reconciliation report). */
  async grossOn(
    employeeIds: string[],
    date: string,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (employeeIds.length === 0) return map;
    const rows = await this.db.tx
      .selectFrom('employee_salaries')
      .select(['employee_id', 'gross', 'effective_from'])
      .where('employee_id', 'in', employeeIds)
      .where('status', '=', 'active')
      .where('effective_from', '<=', date)
      .orderBy('effective_from')
      .execute();
    for (const r of rows) map.set(r.employee_id, r.gross); // the latest one wins
    return map;
  }

  /** Totals of the YTD opening figures of a fiscal year (reconciliation report). */
  async ytdOpeningTotals(employeeIds: string[], fiscalYear: string) {
    const rows = employeeIds.length
      ? await this.db.tx
          .selectFrom('payroll_ytd_openings')
          .select([
            'taxable_income',
            'tax_withheld',
            'pf_employee',
            'pf_employer',
          ])
          .where('employee_id', 'in', employeeIds)
          .where('fiscal_year', '=', fiscalYear)
          .where('kind', '=', 'opening')
          .execute()
      : [];
    return {
      employees: rows.length,
      taxableIncome: Money.sum(rows.map((r) => r.taxable_income)).toDb(),
      taxWithheld: Money.sum(rows.map((r) => r.tax_withheld)).toDb(),
      pfEmployee: Money.sum(rows.map((r) => r.pf_employee)).toDb(),
      pfEmployer: Money.sum(rows.map((r) => r.pf_employer)).toDb(),
    };
  }

  // ================================================================ helpers

  /** payroll.prepare on the employee, and the salary field group (spec §4: salary is hidden from Admin unless granted). */
  async checkSalaryAccess(employeeId: string): Promise<Employee> {
    const employee = await this.employeeAccess.check(
      'payroll.prepare',
      employeeId,
    );
    if (
      !this.access.canSeeField(
        'salary',
        await this.employeeAccess.resourceOf(employee),
      )
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    return employee;
  }

  /** Reading salaries: anyone in the payroll chain (prepare, verify, approve) with salary field access. */
  async checkSalaryRead(employeeId: string): Promise<Employee> {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    const inChain = (
      ['payroll.prepare', 'payroll.verify', 'payroll.approve'] as const
    ).some((p) => this.access.allows(p, resource));
    if (!inChain || !this.access.canSeeField('salary', resource))
      throw new ForbiddenException(MSG.FORBIDDEN);
    return employee;
  }

  private async findSettings(companyId: string) {
    return this.db.tx
      .selectFrom('payroll_settings')
      .selectAll()
      .where('company_id', '=', companyId)
      .executeTakeFirst();
  }
}

// ------------------------------------------------------------------ helpers

function cleanRule(rule: StructureRule): StructureRule {
  const out: StructureRule = { head: rule.head };
  if (rule.remainder) out.remainder = true;
  else if (rule.fixed !== undefined) out.fixed = Money.of(rule.fixed).toDb();
  else {
    out.of = rule.of ?? 'GROSS';
    out.percent = rule.percent;
  }
  return out;
}

/** Problems with a structure, or null. Exported for unit tests. */
export function checkStructure(
  rules: StructureRule[],
  earningHeads: Set<string>,
): string | null {
  const seen = new Set<string>();
  for (const [i, rule] of rules.entries()) {
    if (!earningHeads.has(rule.head))
      return `${rule.head} is not an active earning head of the company`;
    if (seen.has(rule.head)) return `${rule.head} appears twice`;
    const ways = [
      rule.remainder,
      rule.fixed !== undefined,
      rule.percent !== undefined,
    ].filter(Boolean).length;
    if (ways !== 1)
      return `${rule.head}: give exactly one of percent, fixed or remainder`;
    if (rule.remainder && i !== rules.length - 1)
      return `${rule.head}: the remainder head must be the last rule`;
    if (
      rule.percent !== undefined &&
      rule.of !== 'GROSS' &&
      !seen.has(rule.of ?? '')
    )
      return `${rule.head}: ${rule.of} must be GROSS or an earlier head`;
    seen.add(rule.head);
  }
  if (!seen.has('BASIC'))
    return 'BASIC is required (overtime, PF and bonus are based on it)';

  // the split must not exceed gross (try a typical salary)
  const parts = applyStructure(Money.of('30000'), rules);
  if ([...parts.values()].some((m) => m.isNegative()))
    return 'The heads add up to more than the gross salary';
  return null;
}

function breakdown(
  gross: string,
  rules: StructureRule[],
): Record<string, string> {
  return Object.fromEntries(
    [...applyStructure(Money.of(gross), rules)].map(([head, amount]) => [
      head,
      amount.round().toDb(),
    ]),
  );
}

function toSettingsResponse(
  companyId: string,
  row: PayrollSettingsRow | undefined,
) {
  const s = {
    roundingIncrement:
      row && Number(row.rounding_increment) >= 1 ? '1' : '0.01',
    roundingMode: row?.rounding_mode ?? 'HALF_UP',
    unpaidDayBasis: row?.unpaid_day_basis ?? 'calendar',
    otHoursBasis: row?.ot_hours_basis ?? 208,
    otMonthlyLimitHours: row?.ot_monthly_limit_hours ?? 60,
    pfEmployeePercent: row ? String(Number(row.pf_employee_percent)) : '0',
    pfEmployerPercent: row ? String(Number(row.pf_employer_percent)) : '0',
    gratuityProvision: row?.gratuity_provision ?? false,
    netChangeFlagPercent: row?.net_change_flag_percent ?? 20,
    encashmentDivisor: row?.encashment_divisor ?? 30,
  } as const;
  const engine: PayrollSettings = {
    rounding: { mode: s.roundingMode, increment: s.roundingIncrement },
    unpaidDayBasis: s.unpaidDayBasis,
    otHoursBasis: s.otHoursBasis,
    otMonthlyLimitHours: s.otMonthlyLimitHours,
    pfEmployeePercent: s.pfEmployeePercent,
    pfEmployerPercent: s.pfEmployerPercent,
    gratuityProvision: s.gratuityProvision,
    netChangeFlagPercent: s.netChangeFlagPercent,
    encashmentDivisor: s.encashmentDivisor,
  };
  return {
    companyId,
    saved: !!row,
    ...s,
    version: row?.version ?? null,
    engine,
  };
}
