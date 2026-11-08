import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VersionedDto } from '../../../platform/http/common.dto.js';

/** POST /approvals/requests/:id/approve   { comment? } */
export class ApproveDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/** reject / return: a comment is required (spec §5: "Rejected (final, reason required)"). */
export class DecisionWithCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comment: string;
}

export class ChainStepDto {
  /** line_manager | dept_head | role:<system role> | user:<user id> */
  @Matches(
    /^(line_manager|dept_head|role:(admin|system_admin|hr|accounts|dept_head|auditor)|user:[0-9a-f-]{36})$/,
    {
      message:
        'approverRule must be line_manager, dept_head, role:<role> or user:<id>',
    },
  )
  approverRule: string;

  @IsOptional()
  @IsIn(['any', 'all'])
  mode?: 'any' | 'all';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  reminderHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  escalationHours?: number;
}

/**
 * POST /approvals/chains
 * {
 *   "requestType": "bank_account_change",
 *   "name": "Bank change: line manager then HR",
 *   "priority": 10,
 *   "conditions": {},
 *   "steps": [ { "approverRule": "line_manager" }, { "approverRule": "role:hr" } ]
 * }
 */
export class CreateChainDto {
  @Matches(/^[a-z_]+$/)
  requestType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  /** Lower is checked first. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  priority?: number;

  /** { minAmount?, maxAmount?, minDays?, maxDays?, companyIds?, departmentIds?, kinds? } */
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChainStepDto)
  steps: ChainStepDto[];
}

/** Steps cannot be edited (requests in flight keep theirs): create a new chain instead. */
export class UpdateChainDto extends VersionedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * GET /approvals/requests?companyId=&requestType=&state=&open=&overdue=
 * Every request of the company, for approvals.view_all (Admin, Auditor).
 */
export class ListRequestsQueryDto {
  @IsUUID()
  companyId: string;

  @IsOptional()
  @Matches(/^[a-z_]+$/)
  requestType?: string;

  /** The engine's own five states: a request goes from in_approval straight to executed. */
  @IsOptional()
  @IsIn(['in_approval', 'executed', 'rejected', 'returned', 'cancelled'])
  state?: 'in_approval' | 'executed' | 'rejected' | 'returned' | 'cancelled';

  /** Only the ones still waiting for a decision. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  open?: boolean;

  /** Only the ones whose current step has passed its escalation time. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;
}
