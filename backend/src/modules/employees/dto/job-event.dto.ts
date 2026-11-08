import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';

/** Types that can be recorded through the API ("joining" is created with the employee). */
export const CHANGE_TYPES = [
  'transfer',
  'promotion',
  'redesignation',
  'grade_change',
  'manager_change',
] as const;

/** Allows null (= clear) but validates any other value. */
const NullableUuid = () => ValidateIf((_, v) => v !== null && v !== undefined);

/**
 * POST /employees/:employeeId/job-events
 *
 * Send only the fields that change. effectiveFrom can be in the past
 * (back-dated: the history is recalculated) or in the future (scheduled).
 *
 *   { "type": "transfer", "effectiveFrom": "2026-03-01",
 *     "departmentId": "...", "reason": "Moved to Sales" }
 */
export class CreateJobEventDto {
  @IsIn(CHANGE_TYPES)
  type: (typeof CHANGE_TYPES)[number];

  @IsBusinessDate()
  effectiveFrom: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsUUID()
  gradeId?: string;

  /** null = no line manager from this date. */
  @NullableUuid()
  @IsUUID()
  lineManagerId?: string | null;

  /** null = no functional manager from this date. */
  @NullableUuid()
  @IsUUID()
  functionalManagerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** POST /employees/:employeeId/job-events/:eventId/cancel */
export class CancelJobEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
