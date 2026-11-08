/**
 * Builds the payroll engine's input for every employee of a run (guide §12.1:
 * "Input = an employee snapshot + rule values + period variables").
 *
 * Everything the engine uses is collected here, from the module that owns it:
 *   salary history, heads, settings  this module (setup)
 *   unpaid days, OT, late penalty    attendance (the month must be locked)
 *   unpaid / maternity leave         leave
 *   adjustments of locked days       attendance
 *   encashment                       leave (year-end encashments, final settlement balance)
 *   statutory values                 rule pack (tax slabs, maternity divisor, OT rate ...)
 *   year-to-date tax                 approved runs of the fiscal year + openings
 *   arrears                          approved runs' stored inputs re-computed under today's salary history
 *
 * The result is stored with the run, so the run can be reproduced exactly.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  businessDate,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Employee } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import {
  computeArrears,
  type BonusInput,
  type HeadDef,
  type MonthlyInput,
  type Period,
  type SalarySegment,
  type TaxRules,
} from '../../payroll-engine/index.js';
import {
  AttendanceService,
  type PayrollAttendanceFacts,
} from '../attendance/attendance.service.js';
import { BankAccountsService } from '../bank-accounts/bank-accounts.service.js';
import { LeaveLedgerService } from '../leave/leave-ledger.service.js';
import { RulesService } from '../rules/rules.service.js';
import { PayrollSetupService } from './payroll-setup.service.js';
import {
  completedYears,
  datesWithin,
  fiscalYearMonths,
  monthPeriod,
  PAID_STATES,
} from './payroll-periods.js';
import { PayrollVariablesService } from './payroll-variables.service.js';

/** One employee's input, plus the records the approval must mark as paid. */
export interface PreparedEmployee {
  employeeId: string;
  kind: 'monthly' | 'bonus';
  input: MonthlyInput | BonusInput;
  refs: {
    adjustmentIds: string[];
    encashmentIds: string[];
    variableIds: string[];
  };
}

const NO_ATTENDANCE: PayrollAttendanceFacts = {
  absentDates: [],
  onLeaveDates: [],
  otApprovedMinutes: 0,
  lates: 0,
  latePenaltyDays: 0,
  missingPunchDays: 0,
};
const PAYABLE_STATUSES = ['probation', 'active', 'notice'] as const;

@Injectable()
export class PayrollInputService {
  constructor(
    private readonly db: DatabaseService,
    private readonly setup: PayrollSetupService,
    private readonly variables: PayrollVariablesService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveLedgerService,
    private readonly bank: BankAccountsService,
    private readonly rules: RulesService,
  ) {}

  // ================================================================ regular month

  /**
   * Everyone employed in the month, except leavers whose last working day is in
   * or before it (they are paid by their final settlement).
   */
  async buildRegular(
    companyId: string,
    label: string,
  ): Promise<PreparedEmployee[]> {
    const period = monthPeriod(label);

    // attendance must be locked: payroll never reads days that can still change
    const attendance = await this.attendance.payrollFacts(companyId, label);
    if (!attendance.locked)
      throw new BadRequestException(MSG.PAYROLL_ATTENDANCE_NOT_LOCKED);

    const employees = await this.db.tx
      .selectFrom('employees')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('status', 'in', [...PAYABLE_STATUSES])
      .where('join_date', '<=', period.to)
      .where((eb) =>
        eb.or([
          eb('last_working_day', 'is', null),
          eb('last_working_day', '>', period.to),
        ]),
      )
      .orderBy('employee_code')
      .execute();

    const ctx = await this.companyContext(companyId, period, employees);
    const prepared: PreparedEmployee[] = [];
    const missingSalary: string[] = [];
    for (const employee of employees) {
      const salary = await this.setup.salarySegments(employee.id);
      if (salary.length === 0 || salary[0].from > period.to) {
        missingSalary.push(employee.employee_code);
        continue;
      }
      prepared.push(
        await this.monthlyFor(
          employee,
          salary,
          period,
          ctx,
          attendance.employees.get(employee.id) ?? NO_ATTENDANCE,
        ),
      );
    }
    if (missingSalary.length)
      throw new BadRequestException({
        message: MSG.PAYROLL_NO_SALARY,
        details: { employeeCodes: missingSalary },
      });
    return prepared;
  }

  // ================================================================ final settlement

  /**
   * The leaver's last month plus everything due or owed at separation:
   * leave encashment (year-end leftovers + unused encashable balance), gratuity
   * per completed year, notice not served, the whole outstanding advance.
   */
  async buildFinalSettlement(
    employee: Employee,
    label: string,
    noticeShortfallDays: number,
  ): Promise<PreparedEmployee> {
    const period = monthPeriod(label);
    const lastDay = employee.last_working_day;
    if (!lastDay || lastDay < period.from || lastDay > period.to)
      throw new BadRequestException(MSG.PAYROLL_NOT_SEPARATING);

    const salary = await this.setup.salarySegments(employee.id);
    if (salary.length === 0)
      throw new BadRequestException({
        message: MSG.PAYROLL_NO_SALARY,
        details: { employeeCodes: [employee.employee_code] },
      });

    // the last month's attendance (it need not be locked: the employee has left)
    const attendance = await this.attendance.payrollFacts(
      employee.company_id,
      label,
    );
    const ctx = await this.companyContext(employee.company_id, period, [
      employee,
    ]);
    const prepared = await this.monthlyFor(
      employee,
      salary,
      period,
      ctx,
      attendance.employees.get(employee.id) ?? NO_ATTENDANCE,
      { allLoans: true },
    );

    const input = prepared.input as MonthlyInput;
    const unused = await this.leave.encashableBalance(
      employee.id,
      businessDate(lastDay),
    );
    input.encashmentDays = Money.of(input.encashmentDays)
      .plus(unused)
      .toPreciseString();
    input.finalSettlement = {
      noticeShortfallDays,
      gratuityYears: completedYears(employee.join_date, lastDay),
    };
    return prepared;
  }

  // ================================================================ festival bonus

  async buildBonus(
    companyId: string,
    label: string,
    bonusDate: string,
    festivalGroup?: string,
  ): Promise<PreparedEmployee[]> {
    const period = monthPeriod(label);
    const date = businessDate(bonusDate);
    let query = this.db.tx
      .selectFrom('employees')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('status', 'in', [...PAYABLE_STATUSES])
      .where('join_date', '<=', date)
      .orderBy('employee_code');
    if (festivalGroup)
      query = query.where('festival_group', '=', festivalGroup);
    const employees = await query.execute();

    // statutory limits on the bonus date (spec §7: one basic, after one year)
    const minServiceMonths = await this.rules.getInteger(
      'bonus.festival.min_service_months',
      date,
    );
    const capMonthsOfBasic = await this.rules.getDecimal(
      'bonus.festival.cap_months_of_basic',
      date,
    );
    const settings = await this.setup.engineSettings(companyId);
    const tax = await this.taxRules(period);

    const prepared: PreparedEmployee[] = [];
    for (const employee of employees) {
      const salary = await this.setup.salarySegments(employee.id);
      if (salary.length === 0) continue; // nobody to pay: shown as not eligible
      const input: BonusInput = {
        period,
        employee: employeeFacts(employee),
        bonusDate: date,
        salary,
        minServiceMonths,
        capMonthsOfBasic,
        ytd: await this.ytd(employee.id, period),
        otherExpectedBonuses: '0',
        rules: { tax },
        settings,
      };
      prepared.push({
        employeeId: employee.id,
        kind: 'bonus',
        input,
        refs: { adjustmentIds: [], encashmentIds: [], variableIds: [] },
      });
    }
    return prepared;
  }

  // ================================================================ one employee, one month

  private async monthlyFor(
    employee: Employee,
    salary: SalarySegment[],
    period: Period,
    ctx: CompanyContext,
    attendance: PayrollAttendanceFacts,
    options: { allLoans?: boolean } = {},
  ): Promise<PreparedEmployee> {
    const id = employee.id;

    // leave: unpaid days attendance shows "on leave", maternity days (every calendar day)
    const leave = ctx.leave.filter((l) => l.employeeId === id);
    const maternityDates = leave
      .filter((l) => l.kind === 'maternity')
      .flatMap((l) => datesWithin(l.from, l.to, period.from, period.to));
    const unpaidLeave = leave.filter((l) => l.kind === 'unpaid');
    const onUnpaidLeave = attendance.onLeaveDates.filter((d) =>
      unpaidLeave.some((l) => l.from <= d && d <= l.to),
    );
    const unpaidDates = [
      ...new Set([...attendance.absentDates, ...onUnpaidLeave]),
    ]
      .filter((d) => !maternityDates.includes(d as BusinessDate))
      .sort();

    // locked days of earlier months that changed since
    const adjustments = ctx.adjustments.filter(
      (a) => a.employeeId === id && a.date < period.from && a.unpaidDelta !== 0,
    );
    const encashments = ctx.encashments.filter((e) => e.employeeId === id);
    const variables = ctx.variables.filter((v) => v.employee_id === id);
    const loans = options.allLoans
      ? await this.allOutstandingLoans(employee)
      : ctx.loans.filter((l) => l.employeeId === id);

    const input: MonthlyInput = {
      period,
      employee: employeeFacts(employee),
      heads: ctx.heads,
      salary,
      unpaidDates,
      latePenaltyDays: attendance.latePenaltyDays,
      maternityDates,
      overtime: {
        approvedMinutes: attendance.otApprovedMinutes,
        multiplier: ctx.otMultiplier,
      },
      attendanceAdjustments: adjustments.map((a) => ({
        date: a.date,
        unpaidDelta: a.unpaidDelta,
        otMinutesDelta: a.otMinutesDelta,
        reason: a.reason,
      })),
      arrears: await this.arrearsFor(employee, salary, ctx),
      variables: variables.map((v) => ({
        head: v.head_code,
        amount: v.amount,
        ...(v.note ? { note: v.note } : {}),
      })),
      encashmentDays: Money.sum(
        encashments.map((e) => e.days),
      ).toPreciseString(),
      loans: loans.map((l) => ({
        loanId: l.loanId,
        installment: l.installment,
        outstanding: l.outstanding,
      })),
      ytd: await this.ytd(id, period),
      expectedFutureBonuses: '0',
      previousNet: await this.previousNet(id, period.label),
      bankAccount: ctx.bank.get(id) ?? {
        hasApproved: false,
        changedInPeriod: false,
      },
      missingPunchDays: attendance.missingPunchDays,
      rules: {
        tax: ctx.tax,
        maternityDivisor: ctx.maternityDivisor,
        gratuityDaysPerYear: ctx.gratuityDaysPerYear,
      },
      settings: ctx.settings,
    };
    return {
      employeeId: id,
      kind: 'monthly',
      input,
      refs: {
        adjustmentIds: adjustments.map((a) => a.id),
        encashmentIds: encashments.map((e) => e.id),
        variableIds: variables.map((v) => v.id),
      },
    };
  }

  // ================================================================ shared facts

  /** Facts read once per run, for all its employees. */
  private async companyContext(
    companyId: string,
    period: Period,
    employees: Employee[],
  ) {
    const to = businessDate(period.to);
    const heads = await this.db.tx
      .selectFrom('salary_heads')
      .select(['code', 'kind', 'taxable'])
      .where('company_id', '=', companyId)
      .execute();
    return {
      heads: heads.map((h): HeadDef => ({
        code: h.code,
        kind: h.kind,
        taxable: h.taxable,
      })),
      settings: await this.setup.engineSettings(companyId),
      tax: await this.taxRules(period),
      maternityDivisor: await this.rules.getInteger(
        'leave.maternity.daily_pay_divisor',
        to,
      ),
      gratuityDaysPerYear: await this.rules.getInteger(
        'gratuity.wage_days_per_completed_year',
        to,
      ),
      otMultiplier: await this.rules.getDecimal('overtime.rate_multiplier', to),
      leave: await this.leave.payrollLeave(
        companyId,
        businessDate(period.from),
        to,
      ),
      adjustments: await this.attendance.pendingAdjustments(companyId),
      encashments: await this.leave.pendingEncashments(companyId),
      variables: await this.variables.openVariables(companyId, period.label),
      loans: await this.variables.loansForPeriod(companyId, period.label),
      bank: await this.bank.payrollFacts(
        employees.map((e) => e.id),
        dhakaStart(period.from),
        dhakaEnd(period.to),
      ),
    };
  }

  /** Salary income tax rules of the period's fiscal year (rule pack). */
  private async taxRules(period: Period): Promise<TaxRules> {
    const date = businessDate(period.to);
    return {
      slabs: await this.rules.getJson<TaxRules['slabs']>(
        'tax.salary.slabs',
        date,
      ),
      exemptionDivisor: await this.rules.getInteger(
        'tax.salary.exemption_divisor',
        date,
      ),
      exemptionCap: (
        await this.rules.getMoney('tax.salary.exemption_cap', date)
      ).toDb(),
      minimumTax: (
        await this.rules.getMoney('tax.salary.minimum_tax', date)
      ).toDb(),
    };
  }

  /**
   * Taxable income and tax withheld this fiscal year before this run: approved
   * runs (earlier months; bonus and settlement runs of any month) plus openings.
   */
  private async ytd(
    employeeId: string,
    period: Period,
  ): Promise<MonthlyInput['ytd']> {
    const fy = fiscalYearMonths(period);
    const rows = await this.db.tx
      .selectFrom('payroll_run_employees as e')
      .innerJoin('payroll_runs as r', 'r.id', 'e.run_id')
      .select(['e.taxable_income', 'e.tax'])
      .where('e.employee_id', '=', employeeId)
      .where('r.state', 'in', PAID_STATES)
      .where('r.period', '>=', fy.first)
      .where('r.period', '<=', fy.last)
      .where((eb) =>
        eb.or([
          eb('r.period', '<', period.label),
          eb('r.run_type', '<>', 'regular'),
        ]),
      )
      .execute();
    const opening = await this.setup.ytdOpening(
      employeeId,
      period.fiscalYear.label,
    );
    return {
      taxableIncome: opening.taxableIncome
        .plus(Money.sum(rows.map((r) => r.taxable_income)))
        .toDb(),
      taxWithheld: opening.taxWithheld
        .plus(Money.sum(rows.map((r) => r.tax)))
        .toDb(),
    };
  }

  /** Net of the last approved regular month (for the "net changed by more than X%" flag). */
  private async previousNet(
    employeeId: string,
    label: string,
  ): Promise<string | null> {
    const row = await this.db.tx
      .selectFrom('payroll_run_employees as e')
      .innerJoin('payroll_runs as r', 'r.id', 'e.run_id')
      .select('e.net')
      .where('e.employee_id', '=', employeeId)
      .where('r.state', 'in', PAID_STATES)
      .where('r.run_type', '=', 'regular')
      .where('r.period', '<', label)
      .orderBy('r.period', 'desc')
      .executeTakeFirst();
    return row?.net ?? null;
  }

  /**
   * Arrears: every month already paid is re-computed under today's salary
   * history (from the run's stored input); any difference is paid now, labelled
   * with the month it belongs to (spec §6.4 "back-dated increment").
   */
  private async arrearsFor(
    employee: Employee,
    salary: SalarySegment[],
    ctx: CompanyContext,
  ): Promise<MonthlyInput['arrears']> {
    const paidRuns = await this.db.tx
      .selectFrom('payroll_run_employees as e')
      .innerJoin('payroll_runs as r', 'r.id', 'e.run_id')
      .select(['e.run_id', 'e.input', 'r.period'])
      .where('e.employee_id', '=', employee.id)
      .where('r.state', 'in', PAID_STATES)
      .where('r.run_type', 'in', ['regular', 'final_settlement'])
      .orderBy('r.period')
      .execute();
    if (paidRuns.length === 0) return [];

    const lines = await this.db.tx
      .selectFrom('payroll_lines as l')
      .innerJoin('payroll_runs as r', 'r.id', 'l.run_id')
      .select(['l.run_id', 'l.head_code', 'l.amount', 'l.for_period'])
      .where('l.employee_id', '=', employee.id)
      .where('r.state', 'in', PAID_STATES)
      .execute();

    const paidMonths = paidRuns.map((run) => {
      const stored = (run.input as StoredInput).input as MonthlyInput;
      const salaryHeads = new Set([
        ...stored.salary.flatMap((s) => s.structure.map((r) => r.head)),
        'UNPAID_DAYS',
        'MATERNITY_PAY',
      ]);
      const paidThen = lines.filter(
        (l) => l.run_id === run.run_id && salaryHeads.has(l.head_code),
      );
      const arrearsSince = lines.filter(
        (l) => l.head_code === 'ARREAR' && l.for_period === run.period,
      );
      return {
        period: stored.period,
        employment: {
          from:
            stored.employee.joinDate > stored.period.from
              ? stored.employee.joinDate
              : stored.period.from,
          to:
            stored.employee.lastWorkingDay &&
            stored.employee.lastWorkingDay < stored.period.to
              ? stored.employee.lastWorkingDay
              : stored.period.to,
        },
        unpaidDates: stored.unpaidDates,
        latePenaltyDays: stored.latePenaltyDays,
        maternityDates: stored.maternityDates,
        paid: Money.sum(
          [...paidThen, ...arrearsSince].map((l) => l.amount),
        ).toDb(),
      };
    });
    return computeArrears({
      salary,
      paidMonths,
      maternityDivisor: ctx.maternityDivisor,
      settings: ctx.settings,
    });
  }

  private async allOutstandingLoans(employee: Employee) {
    const all = await this.variables.loansForPeriod(
      employee.company_id,
      '9999-12',
    );
    return all.filter((l) => l.employeeId === employee.id);
  }
}

type CompanyContext = Awaited<
  ReturnType<PayrollInputService['companyContext']>
>;

/** What payroll_run_employees.input holds. */
export interface StoredInput {
  kind: 'monthly' | 'bonus';
  input: MonthlyInput | BonusInput;
  refs: PreparedEmployee['refs'];
}

function employeeFacts(e: Employee): MonthlyInput['employee'] {
  return {
    id: e.id,
    code: e.employee_code,
    joinDate: e.join_date,
    lastWorkingDay: e.last_working_day,
    status: e.status,
  };
}

/** Start and end of a business date in Dhaka (UTC+6, no daylight saving). */
function dhakaStart(date: string): Date {
  return new Date(`${date}T00:00:00+06:00`);
}
function dhakaEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999+06:00`);
}
