/**
 * Request bodies and query strings for the leave routes.
 * Days are numbers with at most 2 decimals (0.5 = half day).
 */
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  IsBusinessDate,
  VersionedDto,
} from '../../../platform/http/common.dto.js';

const upper = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
const RULE_KEY = /^[a-z_]+(\.[a-z_0-9]+)+$/;
const DAYS = { maxDecimalPlaces: 2 };

// ------------------------------------------------------------------- policy --

/** PUT /companies/:companyId/leave-policy */
export class LeavePolicyDto {
  /** "01-01" calendar year (default) or e.g. "07-01" for July-June. */
  @IsOptional()
  @Matches(/^(0[1-9]|1[0-2])-01$/)
  leaveYearStart?: string;

  @IsOptional()
  @IsBoolean()
  sandwichRule?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  teamAbsenceWarnPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  maxBackdatedDays?: number;
}

// -------------------------------------------------------------------- types --

/** POST /companies/:companyId/leave-types (see also .../leave-types/defaults) */
export class CreateLeaveTypeDto {
  @upper()
  @Matches(/^[A-Z0-9]{1,10}$/)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  @IsIn(['annual_grant', 'monthly', 'per_worked_days', 'none'])
  accrualMethod: 'annual_grant' | 'monthly' | 'per_worked_days' | 'none';

  /** Days per year (or, for per_worked_days, worked days per leave day). Or use entitlementRuleKey. */
  @IsOptional()
  @IsNumber(DAYS)
  @Min(0)
  @Max(366)
  entitlementDays?: number;

  /** A rule pack key, e.g. "leave.casual.days_per_year" (statutory values come from the rule pack). */
  @IsOptional()
  @Matches(RULE_KEY)
  entitlementRuleKey?: string;

  @IsOptional()
  @IsNumber(DAYS)
  @Min(0.5)
  @Max(366)
  maxDaysPerRequest?: number;

  @IsOptional()
  @Matches(RULE_KEY)
  maxDaysRuleKey?: string;

  @IsOptional()
  @IsBoolean()
  countsNonWorkingDays?: boolean;

  @IsOptional()
  @IsBoolean()
  allowHalfDay?: boolean;

  @IsOptional()
  @IsNumber(DAYS)
  @Min(0)
  @Max(366)
  documentRequiredOverDays?: number;

  @IsOptional()
  @IsIn(['lapse', 'carry'])
  yearEndAction?: 'lapse' | 'carry';

  @IsOptional()
  @IsNumber(DAYS)
  @Min(0)
  @Max(366)
  carryCapDays?: number;

  @IsOptional()
  @IsBoolean()
  encashable?: boolean;

  /** { gender?: "female"|"male", minServiceMonths?, minServiceRuleKey?, allowDuringProbation? } */
  @IsOptional()
  @IsObject()
  eligibility?: Record<string, unknown>;
}

export class UpdateLeaveTypeDto extends VersionedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  @IsOptional()
  @IsBoolean()
  allowHalfDay?: boolean;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(DAYS)
  @Min(0)
  @Max(366)
  documentRequiredOverDays?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber(DAYS)
  @Min(0)
  @Max(366)
  carryCapDays?: number | null;

  @IsOptional()
  @IsBoolean()
  encashable?: boolean;

  @IsOptional()
  @IsObject()
  eligibility?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ----------------------------------------------------------------- requests --

/**
 * POST /employees/:employeeId/leave-requests          (also .../leave-requests/preview)
 *   { "leaveTypeId": "...", "fromDate": "2026-10-20", "toDate": "2026-10-22", "reason": "Family wedding in Sylhet" }
 *   half day: { ..., "fromDate": "2026-10-20", "toDate": "2026-10-20", "halfDay": "first_half" }
 */
export class ApplyLeaveDto {
  @IsUUID()
  leaveTypeId: string;

  @IsBusinessDate()
  fromDate: string;

  @IsBusinessDate()
  toDate: string;

  @IsOptional()
  @IsIn(['first_half', 'second_half'])
  halfDay?: 'first_half' | 'second_half';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** An uploaded employee document (POST /employees/:id/documents), e.g. medical certificate. */
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

/** POST /leave/requests/:requestId/cancel */
export class CancelLeaveDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// ------------------------------------------------------------------- ledger --

/** POST /employees/:employeeId/leave-ledger — HR: opening balance at go-live, or a manual adjustment. */
export class LedgerEntryDto {
  @IsUUID()
  leaveTypeId: string;

  @IsIn(['opening', 'adjustment'])
  kind: 'opening' | 'adjustment';

  /** Positive adds to the balance, negative uses it. */
  @Type(() => Number)
  @IsNumber(DAYS)
  @Min(-366)
  @Max(366)
  days: number;

  @IsBusinessDate()
  entryDate: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}

export class AsOfQueryDto {
  @IsOptional()
  @IsBusinessDate()
  asOf?: string;
}

export class LedgerQueryDto {
  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;
}

/** GET /leave/team-calendar?departmentId=&from=&to= */
/**
 * GET /leave/team-calendar?departmentId=&from=&to=   one department
 *                         ?companyId=&from=&to=      everyone the caller may see
 *
 * A Dept Head asks about their department; HR asking "who is off next week" should
 * not have to click through every department in turn, so either narrowing works.
 */
export class TeamCalendarQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsBusinessDate()
  from: string;

  @IsBusinessDate()
  to: string;
}

/** POST /leave/accruals/run  { companyId, asOf? }   and   POST /leave/year-end  { companyId, leaveYear } */
export class RunAccrualsDto {
  @IsUUID()
  companyId: string;

  @IsOptional()
  @IsBusinessDate()
  asOf?: string;
}

export class YearEndDto {
  @IsUUID()
  companyId: string;

  /** e.g. "2026" (calendar year) or "2026-27" */
  @Matches(/^[0-9]{4}(-[0-9]{2})?$/)
  leaveYear: string;
}

export class CompanyQueryDto {
  @IsUUID()
  companyId: string;
}
