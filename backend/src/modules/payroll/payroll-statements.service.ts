/**
 * Payroll statements (spec §6.4): the PF ledger of a member with the company
 * match, the annual salary tax certificate, and the salary tax challans that
 * Accounts records when the tax withheld in a month is deposited.
 *
 * Both statements are read from approved payroll lines, so they agree with the
 * payslips to the taka. HR, Accounts and the approving Admin read anyone's (with
 * salary access); an employee reads their own from the app.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  FieldEncryption,
  mask,
} from '../../platform/crypto/field-encryption.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Employee } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  PfOpeningDto,
  ReasonDto,
  SalaryTaxChallanDto,
} from './dto/payroll.dto.js';
import { PAID_STATES } from './payroll-periods.js';
import { PayrollRunsService } from './payroll-runs.service.js';
import { PayrollSetupService } from './payroll-setup.service.js';
import type { PayslipLanguage } from './payslip-pdf.js';
import {
  renderTaxCertificatePdf,
  type TaxCertificate,
} from './tax-certificate-pdf.js';

/** "2025-26" -> July 2025 .. June 2026 */
function fiscalYearRange(fiscalYear: string) {
  const start = Number(fiscalYear.slice(0, 4));
  if (Number(fiscalYear.slice(5)) !== (start + 1) % 100)
    throw new BadRequestException(
      'fiscalYear must be two years in a row, e.g. "2025-26"',
    );
  return {
    first: `${start}-07`,
    last: `${start + 1}-06`,
    from: `${start}-07-01`,
    to: `${start + 1}-06-30`,
  };
}

const fiscalYearOf = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
};

@Injectable()
export class PayrollStatementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly encryption: FieldEncryption,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly setup: PayrollSetupService,
    private readonly runs: PayrollRunsService,
    private readonly org: OrgLookupService,
  ) {}

  // ================================================================ who reads

  /** HR, Accounts or the approving Admin, with salary access. */
  async staffEmployee(employeeId: string): Promise<Employee> {
    return this.setup.checkSalaryRead(employeeId);
  }

  /** The signed-in employee (app). */
  async ownEmployee(): Promise<Employee> {
    return this.employeeAccess.find(await this.runs.myEmployeeId());
  }

  // ================================================================ PF ledger

  /**
   * Opening balance, then the employee part and the company match of every
   * approved run, with the running balance. Runs on or before the opening date
   * are already inside the opening balance. Interest, withdrawals and the final
   * settlement (PfFundService) come in by date once posted.
   */
  async pfLedger(employee: Employee) {
    const opening = await this.db.tx
      .selectFrom('pf_openings')
      .selectAll()
      .where('employee_id', '=', employee.id)
      .executeTakeFirst();
    let q = this.db.tx
      .selectFrom('payroll_lines as l')
      .innerJoin('payroll_runs as r', 'r.id', 'l.run_id')
      .select([
        'r.id as run_id',
        'r.period',
        'r.run_type',
        'r.bonus_name',
        'l.head_code',
        sql<string>`sum(l.amount)`.as('amount'),
      ])
      .where('l.employee_id', '=', employee.id)
      .where('l.head_code', 'in', ['PF_EMPLOYEE', 'PF_EMPLOYER'])
      .where('r.state', 'in', PAID_STATES)
      .groupBy([
        'r.id',
        'r.period',
        'r.run_type',
        'r.bonus_name',
        'l.head_code',
      ]);
    if (opening) q = q.where('r.period', '>', opening.as_of.slice(0, 7));
    const rows = await q.orderBy('r.period').orderBy('r.id').execute();

    // one entry per run
    const byRun = new Map<
      string,
      {
        runId: string;
        period: string;
        runType: string;
        bonusName: string | null;
        employee: Money;
        employer: Money;
      }
    >();
    for (const r of rows) {
      const e = byRun.get(r.run_id) ?? {
        runId: r.run_id,
        period: r.period,
        runType: r.run_type,
        bonusName: r.bonus_name,
        employee: Money.zero(),
        employer: Money.zero(),
      };
      if (r.head_code === 'PF_EMPLOYEE') e.employee = e.employee.plus(r.amount);
      else e.employer = e.employer.plus(r.amount);
      byRun.set(r.run_id, e);
    }

    // interest, withdrawals, the final settlement (posted; 2026-10-30)
    const txns = await this.db.tx
      .selectFrom('pf_transactions')
      .selectAll()
      .where('employee_id', '=', employee.id)
      .where('state', '=', 'posted')
      .orderBy('txn_date')
      .orderBy('created_at')
      .execute();
    type Item = {
      sortKey: string;
      runId: string | null;
      period: string;
      runType: string | null;
      bonusName: string | null;
      kind: string;
      note: string | null;
      employee: Money;
      employer: Money;
    };
    const items: Item[] = [
      ...[...byRun.values()].map((e) => ({
        sortKey: `${e.period}-15`,
        runId: e.runId,
        period: e.period,
        runType: e.runType,
        bonusName: e.bonusName,
        kind: 'contribution',
        note: null,
        employee: e.employee,
        employer: e.employer,
      })),
      ...txns.map((x) => ({
        sortKey: x.txn_date,
        runId: null,
        period: x.txn_date.slice(0, 7),
        runType: null,
        bonusName: null,
        kind: x.kind,
        note: x.note,
        employee: Money.of(x.employee_part),
        employer: Money.of(x.employer_part),
      })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let employeeTotal = Money.of(opening?.employee_part ?? '0');
    let employerTotal = Money.of(opening?.employer_part ?? '0');
    const entries = items.map((e) => {
      employeeTotal = employeeTotal.plus(e.employee);
      employerTotal = employerTotal.plus(e.employer);
      return {
        runId: e.runId,
        period: e.period,
        runType: e.runType,
        bonusName: e.bonusName,
        kind: e.kind,
        date: e.kind === 'contribution' ? null : e.sortKey,
        note: e.note,
        employeePart: e.employee.toDb(),
        employerPart: e.employer.toDb(),
        balance: employeeTotal.plus(employerTotal).toDb(),
      };
    });
    return {
      employeeId: employee.id,
      member: entries.length > 0 || Boolean(opening),
      opening: opening
        ? {
            asOf: opening.as_of,
            employeePart: opening.employee_part,
            employerPart: opening.employer_part,
            note: opening.note,
          }
        : null,
      entries,
      totals: {
        employeePart: employeeTotal.toDb(),
        employerPart: employerTotal.toDb(),
        balance: employeeTotal.plus(employerTotal).toDb(),
      },
    };
  }

  /** HR: the balance brought from the old system (one per member; saving again replaces it). */
  async savePfOpening(employeeId: string, dto: PfOpeningDto) {
    const employee = await this.setup.checkSalaryAccess(employeeId);
    const values = {
      as_of: dto.asOf,
      employee_part: Money.of(dto.employeePart).toDb(),
      employer_part: Money.of(dto.employerPart).toDb(),
      note: dto.note ?? null,
    };
    await this.db.tx
      .insertInto('pf_openings')
      .values({ employee_id: employee.id, ...values })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'employee_id']).doUpdateSet(values),
      )
      .execute();
    await this.audit.record({
      action: 'pf_opening.saved',
      entity: 'employee',
      entityId: employee.id,
      after: dto,
    });
    return this.pfLedger(employee);
  }

  // ================================================================ tax certificate

  /** Fiscal years with paid salary (newest first); a year still running is provisional. */
  async taxYears(employee: Employee) {
    const rows = await this.db.tx
      .selectFrom('payroll_run_employees as e')
      .innerJoin('payroll_runs as r', 'r.id', 'e.run_id')
      .select('r.period')
      .distinct()
      .where('e.employee_id', '=', employee.id)
      .where('r.state', 'in', PAID_STATES)
      .execute();
    const years = [...new Set(rows.map((r) => fiscalYearOf(r.period)))]
      .sort()
      .reverse();
    const today = todayInDhaka(this.clock.now());
    return years.map((fiscalYear) => ({
      fiscalYear,
      final: today > fiscalYearRange(fiscalYear).to,
    }));
  }

  /** Salary, tax withheld and the challans of a fiscal year (income year, July to June). */
  async taxCertificate(
    employee: Employee,
    fiscalYear: string,
    lang: PayslipLanguage = 'en',
  ): Promise<TaxCertificate> {
    const range = fiscalYearRange(fiscalYear);

    // salary paid in the year, month by month
    const paid = await this.db.tx
      .selectFrom('payroll_run_employees as e')
      .innerJoin('payroll_runs as r', 'r.id', 'e.run_id')
      .select([
        'r.id as run_id',
        'r.period',
        'e.gross',
        'e.taxable_income',
        'e.tax',
      ])
      .where('e.employee_id', '=', employee.id)
      .where('r.state', 'in', PAID_STATES)
      .where('r.period', '>=', range.first)
      .where('r.period', '<=', range.last)
      .orderBy('r.period')
      .execute();
    const openings = await this.db.tx
      .selectFrom('payroll_ytd_openings')
      .selectAll()
      .where('employee_id', '=', employee.id)
      .where('fiscal_year', '=', fiscalYear)
      .execute();
    if (!paid.length) throw new NotFoundException(MSG.TAX_CERTIFICATE_EMPTY);

    // income by head (earnings only)
    const lines = await this.db.tx
      .selectFrom('payroll_lines')
      .select(['head_code', 'taxable', sql<string>`sum(amount)`.as('amount')])
      .where('employee_id', '=', employee.id)
      .where('kind', '=', 'earning')
      .where(
        'run_id',
        'in',
        paid.map((p) => p.run_id),
      )
      .groupBy(['head_code', 'taxable'])
      .orderBy('head_code')
      .execute();
    const labels = await this.runs.headLabels(employee.company_id);

    // challans that deposited the salary tax of those months
    const challans = await this.db.tx
      .selectFrom('salary_tax_challans')
      .select(['period', 'challan_no', 'challan_date', 'amount'])
      .where('company_id', '=', employee.company_id)
      .where('state', '=', 'active')
      .where('period', '>=', range.first)
      .where('period', '<=', range.last)
      .orderBy('challan_date')
      .execute();

    const months = new Map<
      string,
      { period: string; gross: Money; taxableIncome: Money; tax: Money }
    >();
    for (const p of paid) {
      const m = months.get(p.period) ?? {
        period: p.period,
        gross: Money.zero(),
        taxableIncome: Money.zero(),
        tax: Money.zero(),
      };
      m.gross = m.gross.plus(p.gross);
      m.taxableIncome = m.taxableIncome.plus(p.taxable_income);
      m.tax = m.tax.plus(p.tax);
      months.set(p.period, m);
    }
    const sum = (key: 'gross' | 'taxableIncome' | 'tax') =>
      [...months.values()].reduce((a, m) => a.plus(m[key]), Money.zero());

    const company = await this.db.tx
      .selectFrom('companies')
      .select(['legal_name', 'tin'])
      .where('id', '=', employee.company_id)
      .executeTakeFirstOrThrow();
    const resource = await this.employeeAccess.resourceOf(employee);
    const own = this.access.current().employeeId === employee.id;
    const tin = employee.tin_encrypted
      ? this.encryption.decrypt(employee.tenant_id, employee.tin_encrypted)
      : null;
    const title = await this.runs.employeeTitle(employee, range.to, lang);
    const prior = openings.find((o) => o.kind === 'prior_employer');
    const opening = openings.find((o) => o.kind === 'opening');
    const today = todayInDhaka(this.clock.now());

    return {
      lang,
      number: `TC-${fiscalYear}-${employee.employee_code}`,
      fiscalYear,
      from: range.from,
      to: range.to,
      final: today > range.to,
      issuedOn: today,
      company: { name: company.legal_name, tin: company.tin },
      employee: {
        id: employee.id,
        code: employee.employee_code,
        name:
          lang === 'bn'
            ? (employee.full_name_bn ?? employee.full_name_en)
            : employee.full_name_en,
        tin:
          tin && (own || this.access.canSeeField('identity', resource))
            ? tin
            : tin
              ? mask(tin)
              : null,
        department: title.department,
        designation: title.designation,
      },
      months: [...months.values()].map((m) => ({
        period: m.period,
        gross: m.gross.toDb(),
        taxableIncome: m.taxableIncome.toDb(),
        tax: m.tax.toDb(),
        challans: challans
          .filter((c) => c.period === m.period)
          .map((c) => ({
            challanNo: c.challan_no,
            challanDate: c.challan_date,
          })),
      })),
      income: lines.map((l) => ({
        head: l.head_code,
        label: labels.get(l.head_code)?.[lang] ?? l.head_code,
        taxable: l.taxable,
        amount: Money.of(l.amount).toDb(),
      })),
      earlier: [
        ...(opening
          ? [
              {
                kind: 'opening' as const,
                taxableIncome: opening.taxable_income,
                taxWithheld: opening.tax_withheld,
              },
            ]
          : []),
        ...(prior
          ? [
              {
                kind: 'prior_employer' as const,
                taxableIncome: prior.taxable_income,
                taxWithheld: prior.tax_withheld,
              },
            ]
          : []),
      ],
      totals: {
        gross: sum('gross').toDb(),
        taxableIncome: sum('taxableIncome').toDb(),
        tax: sum('tax').toDb(),
        taxIncludingEarlier: openings
          .reduce((a, o) => a.plus(o.tax_withheld), sum('tax'))
          .toDb(),
      },
    };
  }

  async taxCertificatePdf(
    employee: Employee,
    fiscalYear: string,
    lang: PayslipLanguage,
  ) {
    const certificate = await this.taxCertificate(employee, fiscalYear, lang);
    await this.audit.record({
      action: 'tax_certificate.printed',
      entity: 'employee',
      entityId: employee.id,
      after: { fiscalYear },
    });
    return {
      fileName: `tax-certificate-${employee.employee_code}-${fiscalYear}.pdf`,
      content: await renderTaxCertificatePdf(certificate),
      passwordHint: null,
    };
  }

  // ================================================================ salary tax challans

  /** Tax withheld from salaries per month of a fiscal year, what was deposited, and the challans. */
  async listChallans(companyId: string, fiscalYear: string) {
    await this.org.assertCompanyExists(companyId);
    const canRead = (
      ['payroll.prepare', 'payroll.verify', 'payables.tax'] as const
    ).some((p) => this.access.allows(p, { companyId }));
    if (!canRead) throw new ForbiddenException(MSG.FORBIDDEN);
    const range = fiscalYearRange(fiscalYear);
    const withheld = await this.db.tx
      .selectFrom('payroll_run_employees as e')
      .innerJoin('payroll_runs as r', 'r.id', 'e.run_id')
      .select(['r.period', sql<string>`sum(e.tax)`.as('tax')])
      .where('r.company_id', '=', companyId)
      .where('r.state', 'in', PAID_STATES)
      .where('r.period', '>=', range.first)
      .where('r.period', '<=', range.last)
      .groupBy('r.period')
      .execute();
    const challans = await this.db.tx
      .selectFrom('salary_tax_challans')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('period', '>=', range.first)
      .where('period', '<=', range.last)
      .orderBy('period')
      .orderBy('challan_date')
      .execute();
    const periods = [
      ...new Set([
        ...withheld.map((w) => w.period),
        ...challans.map((c) => c.period),
      ]),
    ].sort();
    return {
      fiscalYear,
      months: periods.map((period) => {
        const tax = Money.of(
          withheld.find((w) => w.period === period)?.tax ?? '0',
        );
        const deposited = challans
          .filter((c) => c.period === period && c.state === 'active')
          .reduce((a, c) => a.plus(c.amount), Money.zero());
        return {
          period,
          withheld: tax.toDb(),
          deposited: deposited.toDb(),
          due: (tax.minus(deposited).isNegative()
            ? Money.zero()
            : tax.minus(deposited)
          ).toDb(),
        };
      }),
      challans: challans.map((c) => ({
        id: c.id,
        period: c.period,
        challanNo: c.challan_no,
        challanDate: c.challan_date,
        amount: c.amount,
        state: c.state,
        cancelledReason: c.cancelled_reason,
      })),
    };
  }

  /** Accounts: the challan that deposited a month's salary tax. */
  async addChallan(companyId: string, dto: SalaryTaxChallanDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.tax', { companyId });
    const taken = await this.db.tx
      .selectFrom('salary_tax_challans')
      .select('id')
      .where('company_id', '=', companyId)
      .where('challan_no', '=', dto.challanNo)
      .where('state', '=', 'active')
      .executeTakeFirst();
    if (taken) throw new ConflictException(MSG.SALARY_TAX_CHALLAN_DUPLICATE);
    const row = await this.db.tx
      .insertInto('salary_tax_challans')
      .values({
        company_id: companyId,
        period: dto.period,
        challan_no: dto.challanNo,
        challan_date: dto.challanDate,
        amount: Money.of(dto.amount).toDb(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'salary_tax_challan.recorded',
      entity: 'salary_tax_challan',
      entityId: row.id,
      after: dto,
    });
    return {
      id: row.id,
      period: row.period,
      challanNo: row.challan_no,
      challanDate: row.challan_date,
      amount: row.amount,
      state: row.state,
    };
  }

  /** Accounts: a challan entered by mistake. */
  async cancelChallan(challanId: string, dto: ReasonDto) {
    const row = await this.db.tx
      .selectFrom('salary_tax_challans')
      .selectAll()
      .where('id', '=', challanId)
      .executeTakeFirst();
    if (!row || row.state !== 'active')
      throw new NotFoundException(MSG.SALARY_TAX_CHALLAN_NOT_FOUND);
    this.access.assert('payables.tax', { companyId: row.company_id });
    await this.db.tx
      .updateTable('salary_tax_challans')
      .set({ state: 'cancelled', cancelled_reason: dto.reason })
      .where('id', '=', challanId)
      .execute();
    await this.audit.record({
      action: 'salary_tax_challan.cancelled',
      entity: 'salary_tax_challan',
      entityId: challanId,
      after: { reason: dto.reason },
    });
    return { id: challanId, state: 'cancelled' };
  }
}
