/**
 * Request bodies and query strings for the payroll routes.
 * Money is always a string with at most 2 decimals ("45000", "45000.50"), never a JS number.
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';

const upper = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const MONEY_MSG = {
  message: 'must be an amount as a string, e.g. "45000" or "45000.50"',
};
const PERCENT = /^\d{1,2}(\.\d{1,2})?$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERIOD_MSG = { message: 'must be a month as YYYY-MM, e.g. "2026-10"' };

// ----------------------------------------------------------------- settings --

/** PUT /companies/:companyId/payroll-settings */
export class PayrollSettingsDto {
  /** "0.01" to the paisa, "1" to the taka. */
  @IsOptional()
  @IsIn(['0.01', '1'])
  roundingIncrement?: '0.01' | '1';

  @IsOptional()
  @IsIn(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'])
  roundingMode?: 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

  /** Per-day rate for unpaid days: gross / days in the month, / 30, or / 26. */
  @IsOptional()
  @IsIn(['calendar', 'fixed30', 'fixed26'])
  unpaidDayBasis?: 'calendar' | 'fixed30' | 'fixed26';

  /** Hourly OT rate = BASIC / this; 208 = 26 days x 8 hours. */
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(400)
  otHoursBasis?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  otMonthlyLimitHours?: number;

  @IsOptional()
  @Matches(PERCENT)
  pfEmployeePercent?: string;

  @IsOptional()
  @Matches(PERCENT)
  pfEmployerPercent?: string;

  @IsOptional()
  @IsBoolean()
  gratuityProvision?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  netChangeFlagPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(31)
  encashmentDivisor?: number;
}

// -------------------------------------------------------- heads, structures --

/** POST /companies/:companyId/salary-heads   (see also .../salary-heads/defaults) */
export class CreateSalaryHeadDto {
  @upper()
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  @IsIn(['earning', 'deduction'])
  kind: 'earning' | 'deduction';

  /** Earnings only. Default true for earnings. */
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class StructureRuleDto {
  @upper()
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/)
  head: string;

  /** 'GROSS' or an earlier head. */
  @IsOptional()
  @upper()
  @IsString()
  of?: string;

  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/)
  percent?: string;

  @IsOptional()
  @Matches(MONEY, MONEY_MSG)
  fixed?: string;

  @IsOptional()
  @IsBoolean()
  remainder?: boolean;
}

/**
 * POST /companies/:companyId/salary-structures
 * { "code": "STD", "name": "Standard", "rules": [
 *     { "head": "BASIC", "of": "GROSS", "percent": "60" },
 *     { "head": "HOUSE_RENT", "of": "BASIC", "percent": "50" },
 *     { "head": "MEDICAL", "of": "BASIC", "percent": "10" },
 *     { "head": "OTHER_ALLOWANCE", "remainder": true } ] }
 */
export class CreateStructureDto {
  @upper()
  @Matches(/^[A-Z0-9_-]{1,30}$/)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StructureRuleDto)
  rules: StructureRuleDto[];
}

// ----------------------------------------------------------------- salaries --

/** POST /employees/:employeeId/salaries   { "effectiveFrom": "2026-07-01", "gross": "45000", "structureId": "...", "reason": "Annual increment" } */
export class AddSalaryDto {
  @IsBusinessDate()
  effectiveFrom: string;

  @Matches(MONEY, MONEY_MSG)
  gross: string;

  @IsUUID()
  structureId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}

/** POST /salaries/:salaryId/cancel  and other "with a reason" actions */
export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/**
 * PUT /employees/:employeeId/ytd-openings
 * { "fiscalYear": "2026-27", "kind": "prior_employer", "taxableIncome": "300000", "taxWithheld": "12187.50" }
 */
export class YtdOpeningDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'fiscalYear must look like "2026-27"' })
  fiscalYear: string;

  @IsIn(['opening', 'prior_employer'])
  kind: 'opening' | 'prior_employer';

  @Matches(MONEY, MONEY_MSG)
  taxableIncome: string;

  @Matches(MONEY, MONEY_MSG)
  taxWithheld: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// -------------------------------------------------------- variables, loans --

/** POST /companies/:companyId/payroll-variables   { "employeeId": "...", "period": "2026-10", "headCode": "COMMISSION", "amount": "5000", "note": "Q3 sales" } */
export class AddVariableDto {
  @IsUUID()
  employeeId: string;

  @Matches(PERIOD, PERIOD_MSG)
  period: string;

  @upper()
  @IsString()
  headCode: string;

  @Matches(MONEY, MONEY_MSG)
  amount: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** GET /companies/:companyId/payroll-variables?period=2026-10 */
export class PeriodQueryDto {
  @Matches(PERIOD, PERIOD_MSG)
  period: string;
}

/** POST /employees/:employeeId/loans   { "principal": "25000", "installment": "5000", "firstPeriod": "2026-11", "reason": "Medical emergency" } */
export class RequestLoanDto {
  @Matches(MONEY, MONEY_MSG)
  principal: string;

  @Matches(MONEY, MONEY_MSG)
  installment: string;

  @Matches(PERIOD, PERIOD_MSG)
  firstPeriod: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class LoansQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'cancelled', 'closed'])
  state?: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'closed';

  /** true: only advances not paid out yet */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unpaid?: boolean;
}

// --------------------------------------------------------------------- runs --

/**
 * POST /companies/:companyId/payroll-runs
 *   regular:          { "runType": "regular", "period": "2026-10" }
 *   bonus:            { "runType": "bonus", "period": "2026-10", "bonusName": "Durga Puja 2026", "bonusDate": "2026-10-20", "festivalGroup": "puja" }
 *   final settlement: { "runType": "final_settlement", "period": "2026-11", "employeeId": "...", "noticeShortfallDays": 30 }
 */
export class CreateRunDto {
  @IsIn(['regular', 'bonus', 'final_settlement'])
  runType: 'regular' | 'bonus' | 'final_settlement';

  @Matches(PERIOD, PERIOD_MSG)
  period: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  bonusName?: string;

  @IsOptional()
  @IsBusinessDate()
  bonusDate?: string;

  /** Bonus runs: only employees of this festival group (e.g. "eid", "puja"); empty = everyone. */
  @IsOptional()
  @Matches(/^[a-z_]{1,30}$/)
  festivalGroup?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  /** Final settlement: days of notice not served (deducted at gross / 30 per day). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  noticeShortfallDays?: number;
}

/** GET /companies/:companyId/payroll-runs?period=2026-10 */
export class ListRunsQueryDto {
  @IsOptional()
  @Matches(PERIOD, PERIOD_MSG)
  period?: string;
}

/** GET .../payslip PDF ?lang=bn&protect=true */
export class PayslipPdfQueryDto {
  @IsOptional()
  @IsIn(['bn', 'en'])
  lang?: 'bn' | 'en';

  /** Password-protect the PDF (password: date of birth as DDMMYYYY, else the employee code). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  protect?: boolean;
}

// --------------------------------------------- statements (PF, tax certificate) --

const FISCAL_YEAR = /^\d{4}-\d{2}$/;
const FISCAL_YEAR_MSG = { message: 'fiscalYear must look like "2025-26"' };

/** GET .../tax-certificate?fiscalYear=2025-26   and   .../tax-certificate/pdf?fiscalYear=2025-26&lang=bn */
export class TaxCertificateQueryDto {
  @Matches(FISCAL_YEAR, FISCAL_YEAR_MSG)
  fiscalYear: string;

  @IsOptional()
  @IsIn(['bn', 'en'])
  lang?: 'bn' | 'en';
}

/** GET /companies/:companyId/salary-tax-challans?fiscalYear=2025-26 */
export class FiscalYearQueryDto {
  @Matches(FISCAL_YEAR, FISCAL_YEAR_MSG)
  fiscalYear: string;
}

/** PUT /employees/:employeeId/pf-opening   { "asOf": "2026-06-30", "employeePart": "48000", "employerPart": "48000", "note": "From the old payroll" } */
export class PfOpeningDto {
  @IsBusinessDate()
  asOf: string;

  @Matches(MONEY, MONEY_MSG)
  employeePart: string;

  @Matches(MONEY, MONEY_MSG)
  employerPart: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /companies/:companyId/salary-tax-challans   { "period": "2026-09", "challanNo": "TR-2026-0912", "challanDate": "2026-10-12", "amount": "18500" } */
export class SalaryTaxChallanDto {
  @Matches(PERIOD, PERIOD_MSG)
  period: string;

  @upper()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  challanNo: string;

  @IsBusinessDate()
  challanDate: string;

  @Matches(MONEY, MONEY_MSG)
  amount: string;
}
