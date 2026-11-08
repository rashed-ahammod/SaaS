/**
 * Request bodies of opportunities, the pipeline and sales targets (Phase 3 WP24). Amounts are
 * taka as strings ("850000" or "850000.50"); months are "YYYY-MM".
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import type {
  LostReason,
  OpportunityState,
} from '../../../platform/db/schema.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
export const LOST_REASONS: LostReason[] = [
  'price',
  'competitor',
  'no_budget',
  'no_response',
  'timing',
  'product_fit',
  'other',
];

/** POST /companies/:companyId/opportunity-stages   (Admin) { "name": "Sample delivered", "nameBn": "নমুনা পাঠানো হয়েছে", "probability": 40, "sortOrder": 3 } */
export class StageDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  nameBn?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  probability: number;

  @IsInt()
  @Min(1)
  @Max(99)
  sortOrder: number;
}

/** PUT /opportunity-stages/:stageId   (Admin) { version, name, nameBn?, probability, sortOrder, isActive? } */
export class UpdateStageDto extends StageDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** The opportunity part of a qualification, or a new opportunity on its own. */
export class OpportunityFieldsDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @Matches(AMOUNT, { message: 'value must be an amount like 850000' })
  value: string;

  @IsBusinessDate()
  expectedCloseOn: string;

  /** left out: the first stage */
  @IsOptional()
  @IsUUID()
  stageId?: string;

  /** left out: the stage's probability */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;
}

/**
 * POST /companies/:companyId/opportunities
 *   { "customerId": "<Meghna Dealers>", "title": "Rice bran oil 5 L, Eid stock", "value": "850000", "expectedCloseOn": "2026-11-20" }
 */
export class OpportunityDto extends OpportunityFieldsDto {
  @IsUUID()
  customerId: string;

  /** another salesperson (Sales head / Admin); left out: oneself, or the customer's account manager */
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

/** PATCH /opportunities/:opportunityId   { version, title?, value?, probability?, expectedCloseOn? } */
export class UpdateOpportunityDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Matches(AMOUNT, { message: 'value must be an amount like 850000' })
  value?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsBusinessDate()
  expectedCloseOn?: string;
}

/** POST /opportunities/:opportunityId/stage   { version, stageId, probability?, note? } */
export class MoveStageDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsUUID()
  stageId: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /opportunities/:opportunityId/won   { version, closedOn?, value?, note? } */
export class WonDto {
  @IsInt()
  @Min(1)
  version: number;

  /** left out: today */
  @IsOptional()
  @IsBusinessDate()
  closedOn?: string;

  /** the value agreed, if it changed in the end */
  @IsOptional()
  @Matches(AMOUNT, { message: 'value must be an amount like 850000' })
  value?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /opportunities/:opportunityId/lost   { version, reason, note?, closedOn? } */
export class LostDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsIn(LOST_REASONS)
  reason: LostReason;

  @IsOptional()
  @IsBusinessDate()
  closedOn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /opportunities/:opportunityId/reopen   { version, stageId, expectedCloseOn, note } */
export class ReopenDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsUUID()
  stageId: string;

  @IsBusinessDate()
  expectedCloseOn: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}

/** GET /companies/:companyId/opportunities?state=&ownerId=&stageId=&customerId=&q= */
export class OpportunityQueryDto {
  @IsOptional()
  @IsIn(['open', 'won', 'lost'])
  state?: OpportunityState;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** GET /companies/:companyId/pipeline?ownerId=&departmentId= */
export class PipelineQueryDto {
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** GET /companies/:companyId/sales-forecast?from=2026-11&to=2027-01&ownerId=&departmentId= */
export class ForecastQueryDto extends PipelineQueryDto {
  @Matches(MONTH, { message: 'from must be YYYY-MM' })
  from: string;

  @Matches(MONTH, { message: 'to must be YYYY-MM' })
  to: string;
}

/** GET /companies/:companyId/sales-targets?month=2026-11 */
export class TargetQueryDto {
  @Matches(MONTH, { message: 'month must be YYYY-MM' })
  month: string;
}

/** One target: a salesperson's or a department's. */
export class TargetLineDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @Matches(AMOUNT, { message: 'amount must be an amount like 1500000' })
  amount: string;
}

/**
 * PUT /companies/:companyId/sales-targets   (Sales head for the department's people; Admin for anyone and for departments)
 *   { "month": "2026-11", "targets": [{ "userId": "<Rafi>", "amount": "1500000" }, { "departmentId": "<Sales>", "amount": "4000000" }] }
 */
export class SetTargetsDto {
  @Matches(MONTH, { message: 'month must be YYYY-MM' })
  month: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TargetLineDto)
  targets: TargetLineDto[];
}
