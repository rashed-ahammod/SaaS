/**
 * Request bodies for probation reviews and separations (employee audit 2026-10-21).
 */
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';

export const PROBATION_OUTCOMES = ['confirm', 'extend', 'end'] as const;
export const SEPARATION_KINDS = [
  'resignation',
  'termination',
  'retirement',
  'contract_end',
  'probation_end',
] as const;
export const CLEARANCE_ITEMS = [
  'it',
  'admin_assets',
  'accounts_advances',
  'dept_handover',
] as const;

/** POST /employees/:employeeId/probation-recommendation   { "outcome": "extend", "months": 3, "note": "Needs more time on the dealer accounts" } */
export class ProbationRecommendationDto {
  @IsIn(PROBATION_OUTCOMES)
  outcome: (typeof PROBATION_OUTCOMES)[number];

  /** how many months to extend by (outcome "extend") */
  @ValidateIf((o) => o.outcome === 'extend')
  @IsInt()
  @Min(1)
  @Max(12)
  months?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}

/**
 * POST /employees/:employeeId/probation-decision   (HR)
 *   { "outcome": "confirm", "note": "Confirmed on the Dept Head's recommendation" }
 *   { "outcome": "extend", "months": 3, "note": "..." }
 *   { "outcome": "end", "lastWorkingDay": "2026-10-31", "note": "..." }    -> a separation (end of probation)
 */
export class ProbationDecisionDto extends ProbationRecommendationDto {
  @ValidateIf((o) => o.outcome === 'end')
  @IsBusinessDate()
  lastWorkingDay?: string;
}

/**
 * POST /employees/:employeeId/notice   (HR)
 *   { "kind": "resignation", "noticeDate": "2026-10-01", "lastWorkingDay": "2026-11-30", "reason": "Joining another company" }
 * kind defaults to resignation; noticeDate defaults to today.
 */
export class NoticeDto {
  @IsOptional()
  @IsIn(SEPARATION_KINDS)
  kind?: (typeof SEPARATION_KINDS)[number];

  @IsOptional()
  @IsBusinessDate()
  noticeDate?: string;

  @IsBusinessDate()
  lastWorkingDay: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** POST /separations/:separationId/clearances/:item   { "note": "Laptop and SIM returned" } */
export class ClearanceDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /separations/:separationId/withdraw   { "reason": "He decided to stay after the increment" } */
export class WithdrawSeparationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** GET /companies/:companyId/separations?state=in_notice */
export class SeparationsQueryDto {
  @IsOptional()
  @IsIn(['in_notice', 'separated', 'withdrawn'])
  state?: 'in_notice' | 'separated' | 'withdrawn';
}

/** GET /companies/:companyId/probation-reviews?withinDays=30 */
export class ProbationDueQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(180)
  withinDays?: number;
}

/** GET /employees/:employeeId/experience-certificate.pdf?lang=bn */
export class CertificateQueryDto {
  @IsOptional()
  @IsIn(['bn', 'en'])
  lang?: 'bn' | 'en';
}
