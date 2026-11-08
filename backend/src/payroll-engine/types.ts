/**
 * Payroll engine input and output (guide §12.1).
 *
 * The engine is a PURE library: everything it needs arrives in the input (salary
 * history, attendance facts, rule values, year-to-date figures); it reads no
 * database, network or clock. The same input always gives the same lines, which
 * is how a past run is re-calculated and compared (WP6 acceptance).
 *
 * Money is always a decimal string ("45000.00"), never a JS number.
 * Dates are 'YYYY-MM-DD' business dates (Asia/Dhaka).
 */
import type { RoundingRule } from '../platform/money/money.js';

/** Bumped on every change that can change a result; stored on each run. */
export const ENGINE_VERSION = 'payroll-engine/1.0.0';

export type HeadKind = 'earning' | 'deduction' | 'employer_cost';

export interface HeadDef {
  code: string; // BASIC, HOUSE_RENT, TAX ...
  kind: HeadKind;
  taxable: boolean; // counts as taxable income (earnings only)
}

/**
 * How gross salary is split into heads, in order:
 *   { head: 'BASIC', of: 'GROSS', percent: '60' }
 *   { head: 'HOUSE_RENT', of: 'BASIC', percent: '50' }
 *   { head: 'CONVEYANCE', fixed: '2500' }
 *   { head: 'OTHER_ALLOWANCE', remainder: true }        gross minus everything above
 */
export interface StructureRule {
  head: string;
  of?: string; // 'GROSS' or an earlier head
  percent?: string;
  fixed?: string;
  remainder?: boolean;
}

/** A salary that applies from..to (inclusive; to = null: still current). */
export interface SalarySegment {
  from: string;
  to: string | null;
  gross: string;
  structure: StructureRule[];
}

export interface PayrollSettings {
  rounding: RoundingRule;
  /** Per-day rate for unpaid days: gross / days in the month, / 30, or / 26. */
  unpaidDayBasis: 'calendar' | 'fixed30' | 'fixed26';
  /** Hourly overtime rate = monthly BASIC / this (e.g. 208 = 26 days x 8 h). */
  otHoursBasis: number;
  otMonthlyLimitHours: number;
  /** Provident fund as % of earned BASIC; "0" = company has no PF. */
  pfEmployeePercent: string;
  pfEmployerPercent: string;
  gratuityProvision: boolean;
  /** Flag when net pay changes by more than this % against last month. */
  netChangeFlagPercent: number;
  /** Leave encashment per day = gross / this. */
  encashmentDivisor: number;
}

export interface TaxRules {
  /** Cumulative upper limits; the last slab has upTo null. */
  slabs: Array<{ upTo: string | null; rate: string }>;
  /** Salary exemption: the lower of income / divisor (e.g. 3 = one third) and cap. */
  exemptionDivisor: number;
  exemptionCap: string;
  /** Minimum tax when any tax is due. */
  minimumTax: string;
}

export interface Period {
  label: string; // '2026-10'
  from: string;
  to: string;
  fiscalYear: { label: string; from: string; to: string };
}

export interface EmployeeFacts {
  id: string;
  code: string;
  joinDate: string;
  lastWorkingDay: string | null;
  status: string; // draft | probation | active | notice | separated
}

export interface MonthlyInput {
  period: Period;
  employee: EmployeeFacts;
  heads: HeadDef[];
  salary: SalarySegment[];
  /** Absent and leave-without-pay days (no pay). */
  unpaidDates: string[];
  /** Late penalty days (only when the company switched the penalty on). */
  latePenaltyDays: number;
  /** Maternity leave days: salary replaced by maternity pay. */
  maternityDates: string[];
  overtime: { approvedMinutes: number; multiplier: string };
  /** Changes to locked days of earlier months (attendance adjustments). */
  attendanceAdjustments: Array<{
    date: string;
    unpaidDelta: number;
    otMinutesDelta: number;
    reason: string;
  }>;
  /** Arrears for earlier months (back-dated increments), computed by computeArrears(). */
  arrears: Array<{
    forPeriod: string;
    amount: string;
    detail: Record<string, string>;
  }>;
  /** Manual items: bonus, commission, other deduction ... (positive amounts). */
  variables: Array<{ head: string; amount: string; note?: string }>;
  /** Leave encashment days (year end). */
  encashmentDays: string;
  loans: Array<{ loanId: string; installment: string; outstanding: string }>;
  /** This fiscal year before this month: approved runs + opening balance + prior employer. */
  ytd: { taxableIncome: string; taxWithheld: string };
  /** Taxable bonuses still expected this fiscal year (for the projection). */
  expectedFutureBonuses: string;
  previousNet: string | null;
  bankAccount: { hasApproved: boolean; changedInPeriod: boolean };
  missingPunchDays: number;
  rules: {
    tax: TaxRules;
    maternityDivisor: number;
    gratuityDaysPerYear: number;
  };
  settings: PayrollSettings;
  /** Final settlement only. */
  finalSettlement?: { noticeShortfallDays: number; gratuityYears: number };
}

export interface PayLine {
  head: string;
  kind: HeadKind;
  amount: string; // rounded, 2 decimals; may be negative (e.g. UNPAID_DAYS)
  taxable: boolean;
  forPeriod?: string;
  /** Which rule and inputs produced it (guide §12.1 "explanation trace"). */
  explanation: Record<string, unknown>;
}

export interface Flag {
  code:
    | 'NET_CHANGE'
    | 'BANK_ACCOUNT_CHANGED'
    | 'ZERO_TAX_ON_TAXABLE'
    | 'NEGATIVE_NET'
    | 'MISSING_BANK_ACCOUNT'
    | 'NOTICE_PERIOD'
    | 'OT_ABOVE_LIMIT'
    | 'MISSING_PUNCHES';
  message: string;
}

export interface PayResult {
  engineVersion: string;
  lines: PayLine[];
  gross: string; // sum of earnings
  deductions: string;
  net: string;
  employerCost: string;
  taxableIncome: string; // this month
  tax: string;
  projection: {
    annualTaxable: string;
    exemption: string;
    annualTax: string;
    remainingMonths: number;
  };
  flags: Flag[];
}
