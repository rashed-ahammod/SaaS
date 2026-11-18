/** Request bodies of performance (Phase 3 WP30). */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import type {
  CycleKind,
  FeedbackKind,
  KpiMeasure,
  ProposalKind,
} from '../../../platform/db/schema.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export const CYCLE_KINDS: CycleKind[] = ['annual', 'half_yearly'];
export const KPI_MEASURES: KpiMeasure[] = [
  'number',
  'percent',
  'taka',
  'date',
  'judgement',
];
export const FEEDBACK_KINDS: FeedbackKind[] = [
  'note',
  'praise',
  'concern',
  'coaching',
];
export const PROPOSAL_KINDS: ProposalKind[] = [
  'increment',
  'promotion',
  'both',
];

// ------------------------------------------------------------------- cycles

export class CycleDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsIn(CYCLE_KINDS)
  kind: CycleKind;

  @IsBusinessDate()
  periodFrom: string;

  @IsBusinessDate()
  periodTo: string;

  /** The date an approved increment of this cycle starts from, if it is fixed up front. */
  @IsOptional()
  @IsBusinessDate()
  incrementFrom?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// --------------------------------------------------------------------- KPIs

export class KpiDto {
  @trim()
  @Matches(/^[A-Z0-9-]{1,20}$/)
  code: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  titleBn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(KPI_MEASURES)
  measure?: KpiMeasure;

  /** The designation this KPI is for; left out, it applies to the whole company. */
  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  defaultWeight?: number;
}

export class UpdateKpiDto {
  @Type(() => Number)
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
  @trim()
  @IsString()
  @MaxLength(200)
  titleBn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(KPI_MEASURES)
  measure?: KpiMeasure;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  defaultWeight?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// -------------------------------------------------------------------- goals

export class GoalDto {
  @IsOptional()
  @IsUUID()
  kpiId?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(300)
  target?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  weight: number;
}

/** PUT /appraisals/:id/goals — the weights must add up to 100. */
export class GoalsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GoalDto)
  goals: GoalDto[];
}

export class GoalScoreDto {
  @IsUUID()
  goalId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  score: number;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class SelfReviewDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  review: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GoalScoreDto)
  scores?: GoalScoreDto[];
}

export class RateDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  comment: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GoalScoreDto)
  scores?: GoalScoreDto[];
}

export class CalibrateDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

// ----------------------------------------------------------------- feedback

export class FeedbackDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;

  @IsOptional()
  @IsIn(FEEDBACK_KINDS)
  kind?: FeedbackKind;

  /** Whether the employee may read it, not only their manager and HR. */
  @IsOptional()
  @IsBoolean()
  sharedWithEmployee?: boolean;
}

// ---------------------------------------------------------------- proposals

export class ProposalDto {
  @IsIn(PROPOSAL_KINDS)
  kind: ProposalKind;

  @IsOptional()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'must be an amount in Taka' })
  newGross?: string;

  @IsOptional()
  @IsUUID()
  structureId?: string;

  @IsOptional()
  @IsUUID()
  newDesignationId?: string;

  @IsOptional()
  @IsUUID()
  newGradeId?: string;

  /** Left out, the cycle's own increment date is used. */
  @IsOptional()
  @IsBusinessDate()
  effectiveFrom?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  justification: string;
}

export class ReasonDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
