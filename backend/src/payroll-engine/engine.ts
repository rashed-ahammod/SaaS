/**
 * The payroll engine (guide §12). Pure functions:
 *
 *   calculateMonthly(input)   regular month, or final settlement (input.finalSettlement)
 *   calculateBonus(input)     festival bonus
 *   computeArrears(input)     what earlier months would pay under today's salary
 *                             history, minus what was paid (back-dated increments)
 *
 * Order of calculation (guide §12.2):
 *   1-3 salary heads by structure, prorated by paid days; unpaid days; maternity pay
 *   4   attendance adjustments, overtime, arrears, manual items, leave encashment
 *   5   deductions: PF, loans, manual deductions (+ notice shortfall at final settlement)
 *   6   income tax: annual projection for the fiscal year, spread over the months left
 *   7   employer costs: PF employer share, gratuity provision
 *   8   every line rounded with the company rule; net = earnings - deductions
 */
import {
  addMonths,
  businessDate,
  daysInMonth,
} from '../platform/dates/business-date.js';
import { Money, PAISA_ROUNDING } from '../platform/money/money.js';
import {
  dayRate,
  maxDate,
  minDate,
  salaryEarnings,
  segmentOn,
  applyStructure,
} from './earnings.js';
import { buildFlags } from './flags.js';
import { SYSTEM_HEADS } from './heads.js';
import { annualTax, monthlyWithholding } from './tax.js';
import {
  ENGINE_VERSION,
  type HeadDef,
  type MonthlyInput,
  type PayLine,
  type PayResult,
  type PayrollSettings,
  type SalarySegment,
  type TaxRules,
} from './types.js';

// =================================================================== monthly

export function calculateMonthly(input: MonthlyInput): PayResult {
  const s = input.settings;
  const lines: PayLine[] = [];
  const head = (code: string): HeadDef =>
    input.heads.find((h) => h.code === code) ??
    SYSTEM_HEADS[code] ?? { code, kind: 'earning', taxable: true };
  const add = (
    code: string,
    amount: Money,
    explanation: Record<string, unknown>,
    forPeriod?: string,
  ) => {
    const rounded = amount.round(s.rounding);
    if (rounded.isZero()) return;
    const h = head(code);
    lines.push({
      head: code,
      kind: h.kind,
      amount: rounded.toDb(),
      taxable: h.kind === 'earning' && h.taxable,
      explanation,
      ...(forPeriod ? { forPeriod } : {}),
    });
  };
  const amountOf = (code: string) =>
    Money.sum(lines.filter((l) => l.head === code).map((l) => l.amount));

  // employment inside the month
  const employment = {
    from: maxDate(input.period.from, input.employee.joinDate),
    to: minDate(
      input.period.to,
      input.employee.lastWorkingDay ?? input.period.to,
    ),
  };
  const current = segmentOn(input.salary, employment.to) ?? input.salary.at(-1);
  if (!current || employment.from > employment.to) return emptyResult();
  const currentGross = Money.of(current.gross);
  const currentFull = applyStructure(currentGross, current.structure);

  // 1-3. salary heads, unpaid days, maternity pay
  const earned = salaryEarnings({
    period: input.period,
    employment,
    salary: input.salary,
    unpaidDates: input.unpaidDates,
    latePenaltyDays: input.latePenaltyDays,
    maternityDates: input.maternityDates,
    maternityDivisor: input.rules.maternityDivisor,
    settings: s,
  });
  for (const rule of current.structure) {
    const amount = earned.heads.get(rule.head);
    if (amount)
      add(rule.head, amount, {
        rule: describeRule(rule),
        segments: earned.trace,
      });
  }
  for (const [code, amount] of earned.heads)
    if (!current.structure.some((r) => r.head === code))
      add(code, amount, { segments: earned.trace });
  add('MATERNITY_PAY', earned.maternity, {
    rule: `monthly wage / ${input.rules.maternityDivisor} per day`,
    days: input.maternityDates.length,
  });
  add('UNPAID_DAYS', earned.unpaid, {
    rule: `gross / ${s.unpaidDayBasis} per unpaid day`,
    days: input.unpaidDates.length,
    latePenaltyDays: input.latePenaltyDays,
  });

  // 4. adjustments of locked days, overtime, arrears, manual items, encashment
  let adjustment = Money.zero();
  for (const a of input.attendanceAdjustments) {
    const seg = segmentOn(input.salary, a.date);
    if (!seg || a.unpaidDelta === 0) continue;
    adjustment = adjustment.minus(
      dayRate(Money.of(seg.gross), monthOf(a.date), s.unpaidDayBasis).times(
        a.unpaidDelta,
      ),
    );
  }
  add('ATTENDANCE_ADJUSTMENT', adjustment, {
    adjustments: input.attendanceAdjustments,
  });

  const otMinutes =
    input.overtime.approvedMinutes +
    input.attendanceAdjustments.reduce((n, a) => n + a.otMinutesDelta, 0);
  const basicFull = currentFull.get('BASIC') ?? Money.zero();
  const hourly = basicFull.dividedBy(s.otHoursBasis);
  add(
    'OVERTIME',
    hourly.times(otMinutes).dividedBy(60).times(input.overtime.multiplier),
    {
      rule: `BASIC / ${s.otHoursBasis} per hour x ${input.overtime.multiplier}`,
      minutes: otMinutes,
      hourlyRate: hourly.toPreciseString(),
    },
  );

  for (const a of input.arrears)
    add(
      'ARREAR',
      Money.of(a.amount),
      {
        rule: 'salary history changed after this month was paid',
        detail: a.detail,
      },
      a.forPeriod,
    );
  for (const v of input.variables) {
    const kind = head(v.head).kind;
    if (kind === 'earning')
      add(v.head, Money.of(v.amount), {
        source: 'manual',
        note: v.note ?? null,
      });
  }
  if (Money.of(input.encashmentDays).isPositive()) {
    add(
      'LEAVE_ENCASHMENT',
      currentGross.dividedBy(s.encashmentDivisor).times(input.encashmentDays),
      {
        rule: `gross / ${s.encashmentDivisor} per day`,
        days: input.encashmentDays,
      },
    );
  }
  if (input.finalSettlement && input.finalSettlement.gratuityYears > 0) {
    add(
      'GRATUITY',
      basicFull
        .dividedBy(30)
        .times(input.rules.gratuityDaysPerYear)
        .times(input.finalSettlement.gratuityYears),
      {
        rule: `${input.rules.gratuityDaysPerYear} days of BASIC per completed year`,
        years: input.finalSettlement.gratuityYears,
      },
    );
  }

  // 5. deductions
  const basicEarned = amountOf('BASIC');
  add('PF_EMPLOYEE', basicEarned.times(s.pfEmployeePercent).dividedBy(100), {
    rule: `${s.pfEmployeePercent}% of earned BASIC`,
  });
  for (const loan of input.loans) {
    const installment = Money.of(loan.installment);
    const outstanding = Money.of(loan.outstanding);
    const recover =
      input.finalSettlement || outstanding.lessThan(installment)
        ? outstanding
        : installment;
    add('LOAN_RECOVERY', recover, {
      loanId: loan.loanId,
      outstandingBefore: loan.outstanding,
      finalSettlement: !!input.finalSettlement,
    });
  }
  for (const v of input.variables) {
    if (head(v.head).kind === 'deduction')
      add(v.head, Money.of(v.amount), {
        source: 'manual',
        note: v.note ?? null,
      });
  }
  if (input.finalSettlement && input.finalSettlement.noticeShortfallDays > 0) {
    add(
      'NOTICE_SHORTFALL',
      currentGross
        .dividedBy(30)
        .times(input.finalSettlement.noticeShortfallDays),
      {
        rule: 'gross / 30 per day of notice not served',
        days: input.finalSettlement.noticeShortfallDays,
      },
    );
  }

  // 6. income tax
  const monthTaxable = Money.sum(
    lines.filter((l) => l.taxable).map((l) => l.amount),
  );
  const regularMonthly = Money.sum(
    current.structure
      .filter((r) => head(r.head).taxable)
      .map((r) => currentFull.get(r.head) ?? Money.zero()),
  );
  const monthsAfter = monthsLeftAfter(
    input.period,
    input.employee.lastWorkingDay,
  );
  const projected = Money.of(input.ytd.taxableIncome)
    .plus(monthTaxable)
    .plus(regularMonthly.times(monthsAfter))
    .plus(input.expectedFutureBonuses);
  const yearTax = annualTax(projected, input.rules.tax);
  add(
    'TAX',
    monthlyWithholding(
      yearTax.tax,
      Money.of(input.ytd.taxWithheld),
      monthsAfter + 1,
    ),
    {
      rule: '(annual tax - withheld so far) / months left incl. this one',
      projectedAnnualIncome: projected.toPreciseString(),
      exemption: yearTax.exemption.toPreciseString(),
      taxableIncome: yearTax.taxable.toPreciseString(),
      annualTax: yearTax.tax.toPreciseString(),
      bySlab: yearTax.bySlab,
      alreadyWithheld: input.ytd.taxWithheld,
      monthsLeftIncludingThis: monthsAfter + 1,
      notIncluded: 'investment rebate',
    },
  );

  // 7. employer costs
  add('PF_EMPLOYER', basicEarned.times(s.pfEmployerPercent).dividedBy(100), {
    rule: `${s.pfEmployerPercent}% of earned BASIC`,
  });
  if (s.gratuityProvision) {
    add(
      'GRATUITY_PROVISION',
      basicEarned
        .dividedBy(30)
        .times(input.rules.gratuityDaysPerYear)
        .dividedBy(12),
      {
        rule: `${input.rules.gratuityDaysPerYear} days of BASIC per year, monthly`,
      },
    );
  }

  // 8. totals
  const result = totals(lines, monthTaxable, amountOf('TAX'), {
    annualTaxable: to2(yearTax.taxable),
    exemption: to2(yearTax.exemption),
    annualTax: to2(yearTax.tax),
    remainingMonths: monthsAfter + 1,
  });
  return { ...result, flags: buildFlags(input, result) };
}

// =================================================================== bonus

export interface BonusInput {
  period: MonthlyInput['period'];
  employee: MonthlyInput['employee'];
  bonusDate: string;
  salary: SalarySegment[];
  minServiceMonths: number;
  capMonthsOfBasic: string;
  ytd: MonthlyInput['ytd'];
  /** Taxable bonuses expected later this year besides this one. */
  otherExpectedBonuses: string;
  rules: { tax: TaxRules };
  settings: PayrollSettings;
}

/**
 * Festival bonus (spec §6.4): eligible after the minimum service on the bonus
 * date; amount = cap x BASIC on that date. Tax withheld = extra annual tax the
 * bonus causes (with and without it, same projection).
 */
export function calculateBonus(
  input: BonusInput,
): PayResult & { eligible: boolean; serviceMonths: number } {
  const months = completedMonths(input.employee.joinDate, input.bonusDate);
  const seg = segmentOn(input.salary, input.bonusDate);
  if (!seg || months < input.minServiceMonths)
    return { ...emptyResult(), eligible: false, serviceMonths: months };

  const full = applyStructure(Money.of(seg.gross), seg.structure);
  const basic = full.get('BASIC') ?? Money.zero();
  const bonus = basic
    .times(input.capMonthsOfBasic)
    .round(input.settings.rounding);
  const regular = Money.sum([...full.values()]);
  const monthsLeft =
    monthsLeftAfter(input.period, input.employee.lastWorkingDay) + 1;
  const base = Money.of(input.ytd.taxableIncome)
    .plus(regular.times(monthsLeft))
    .plus(input.otherExpectedBonuses);
  const without = annualTax(base, input.rules.tax).tax;
  const withBonus = annualTax(base.plus(bonus), input.rules.tax);
  const tax = withBonus.tax.minus(without).round(input.settings.rounding);

  const lines: PayLine[] = [
    {
      head: 'FESTIVAL_BONUS',
      kind: 'earning',
      amount: bonus.toDb(),
      taxable: true,
      explanation: {
        rule: `${input.capMonthsOfBasic} x BASIC on ${input.bonusDate}`,
        basic: basic.toPreciseString(),
        serviceMonths: months,
      },
    },
  ];
  if (tax.isPositive())
    lines.push({
      head: 'TAX',
      kind: 'deduction',
      amount: tax.toDb(),
      taxable: false,
      explanation: {
        rule: 'annual tax with the bonus - without it',
        withoutBonus: without.toPreciseString(),
        withBonus: withBonus.tax.toPreciseString(),
      },
    });
  const result = totals(lines, bonus, tax, {
    annualTaxable: to2(withBonus.taxable),
    exemption: to2(withBonus.exemption),
    annualTax: to2(withBonus.tax),
    remainingMonths: monthsLeft,
  });
  return { ...result, flags: [], eligible: true, serviceMonths: months };
}

// =================================================================== arrears

export interface ArrearsInput {
  /** Salary history as known today. */
  salary: SalarySegment[];
  /** Months already paid by approved runs, with what their salary lines paid in total. */
  paidMonths: Array<{
    period: { label: string; from: string; to: string };
    employment: { from: string; to: string };
    unpaidDates: string[];
    latePenaltyDays: number;
    maternityDates: string[];
    /** Sum of salary-derived lines paid for the month (structure heads, unpaid, maternity, earlier arrears). */
    paid: string;
  }>;
  maternityDivisor: number;
  settings: PayrollSettings;
}

/** One arrear per month whose pay differs under today's salary history (e.g. a back-dated increment). */
export function computeArrears(input: ArrearsInput): MonthlyInput['arrears'] {
  const arrears: MonthlyInput['arrears'] = [];
  for (const m of input.paidMonths) {
    const now = salaryEarnings({
      ...m,
      salary: input.salary,
      maternityDivisor: input.maternityDivisor,
      settings: input.settings,
    });
    const parts = [...now.heads.values(), now.unpaid, now.maternity].map((x) =>
      x.round(input.settings.rounding),
    );
    const due = Money.sum(parts);
    const diff = due.minus(m.paid);
    if (!diff.isZero())
      arrears.push({
        forPeriod: m.period.label,
        amount: diff.toDb(),
        detail: { dueNow: due.toDb(), paid: Money.of(m.paid).toDb() },
      });
  }
  return arrears;
}

// =================================================================== helpers

function totals(
  lines: PayLine[],
  taxable: Money,
  tax: Money,
  projection: PayResult['projection'],
): Omit<PayResult, 'flags'> {
  const sumOf = (kind: string) =>
    Money.sum(lines.filter((l) => l.kind === kind).map((l) => l.amount));
  const gross = sumOf('earning');
  const deductions = sumOf('deduction');
  return {
    engineVersion: ENGINE_VERSION,
    lines,
    gross: gross.toDb(),
    deductions: deductions.toDb(),
    net: gross.minus(deductions).toDb(),
    employerCost: sumOf('employer_cost').toDb(),
    taxableIncome: taxable.toDb(),
    tax: tax.toDb(),
    projection,
  };
}

function emptyResult(): PayResult {
  return {
    engineVersion: ENGINE_VERSION,
    lines: [],
    gross: '0.00',
    deductions: '0.00',
    net: '0.00',
    employerCost: '0.00',
    taxableIncome: '0.00',
    tax: '0.00',
    projection: {
      annualTaxable: '0.00',
      exemption: '0.00',
      annualTax: '0.00',
      remainingMonths: 0,
    },
    flags: [],
  };
}

/** Months of the fiscal year after this one in which the employee is still employed. */
export function monthsLeftAfter(
  period: MonthlyInput['period'],
  lastWorkingDay: string | null,
): number {
  let months = 0;
  for (
    let start = addMonths(businessDate(period.from), 1);
    start <= period.fiscalYear.to;
    start = addMonths(start, 1)
  ) {
    if (lastWorkingDay && start > lastWorkingDay) break;
    months++;
  }
  return months;
}

function completedMonths(from: string, to: string): number {
  let months = 0;
  while (addMonths(businessDate(from), months + 1) <= to) months++;
  return months;
}

function monthOf(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  return {
    from: `${date.slice(0, 7)}-01`,
    to: `${date.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`,
  };
}

function describeRule(
  rule: MonthlyInput['salary'][number]['structure'][number],
): string {
  if (rule.remainder) return 'remainder of gross';
  if (rule.fixed !== undefined) return `fixed ${rule.fixed}`;
  return `${rule.percent}% of ${rule.of ?? 'GROSS'}`;
}

/** A projection value with 2 decimals (projections keep full precision until shown). */
function to2(m: Money): string {
  return m.round(PAISA_ROUNDING).toDb();
}
