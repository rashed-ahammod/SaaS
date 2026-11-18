/**
 * Request bodies of recruitment (Phase 3 WP29). Phone numbers are taken as people write
 * them and stored as +8801711223344 (the same rule as CRM).
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
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
  ApplicantSource,
  ApplicationState,
  EmploymentType,
  InterviewKind,
  InterviewOutcome,
  JobOpeningState,
  PositionRequestState,
  PostingChannel,
  Recommendation,
} from '../../../platform/db/schema.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export const EMPLOYMENT_TYPES: EmploymentType[] = [
  'permanent',
  'contract',
  'probation_only',
  'intern',
  'part_time',
];
export const POSTING_CHANNELS: PostingChannel[] = [
  'website',
  'facebook',
  'notice_board',
  'referral',
  'newspaper',
  'agency',
  'other',
];
export const APPLICANT_SOURCES: ApplicantSource[] = [
  'website',
  'facebook',
  'referral',
  'agency',
  'walk_in',
  'newspaper',
  'other',
];
export const APPLICATION_STATES: ApplicationState[] = [
  'applied',
  'screened',
  'shortlisted',
  'interviewing',
  'offered',
  'hired',
  'rejected',
  'withdrawn',
];
export const POSITION_STATES: PositionRequestState[] = [
  'in_approval',
  'approved',
  'rejected',
  'cancelled',
  'opened',
];
export const OPENING_STATES: JobOpeningState[] = [
  'open',
  'on_hold',
  'filled',
  'closed',
];
export const INTERVIEW_KINDS: InterviewKind[] = [
  'phone',
  'in_person',
  'online',
  'written_test',
];
export const RECOMMENDATIONS: Recommendation[] = ['hire', 'no_hire', 'hold'];
export const INTERVIEW_OUTCOMES: InterviewOutcome[] = [
  'proceed',
  'reject',
  'hold',
];

// ------------------------------------------------------------ manpower plan

export class PlanLineDto {
  @IsUUID()
  departmentId: string;

  @IsUUID()
  designationId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  headcount: number;
}

/** PUT /companies/:companyId/manpower-plan  { fiscalYear?, note?, lines: [...] } */
export class PlanDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  fiscalYear?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PlanLineDto)
  lines: PlanLineDto[];
}

// --------------------------------------------------------- position request

export class PositionRequestDto {
  @IsUUID()
  departmentId: string;

  @IsUUID()
  designationId: string;

  @IsUUID()
  gradeId: string;

  @IsUUID()
  branchId: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: EmploymentType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  headcount: number;

  @IsOptional()
  @IsUUID()
  replacementFor?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}

export class PositionQueryDto {
  @IsOptional()
  @IsIn(POSITION_STATES)
  state?: PositionRequestState;
}

export class CancelDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// ------------------------------------------------------------- job opening

export class OpeningDto {
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

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  /** What the CV is judged against. The AI screening sees exactly these. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  requirements: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  openings?: number;

  @IsOptional()
  @IsBusinessDate()
  closingOn?: string;
}

export class OpeningQueryDto {
  @IsOptional()
  @IsIn(OPENING_STATES)
  state?: JobOpeningState;
}

export class PostingDto {
  @IsIn(POSTING_CHANNELS)
  channel: PostingChannel;

  @IsOptional()
  @IsBusinessDate()
  postedOn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  reference?: string;
}

export class CloseOpeningDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// --------------------------------------------------------------- applicants

export class ApplicantDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullNameEn: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  fullNameBn?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePhone(value) : value,
  )
  @Matches(/^\+880[0-9]{8,10}$/, {
    message: 'must be a Bangladeshi number like 01711-223344',
  })
  phone?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @IsBusinessDate()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: 'male' | 'female' | 'other';

  @IsOptional()
  @IsIn(APPLICANT_SOURCES)
  source?: ApplicantSource;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;

  @IsOptional()
  @IsUUID()
  referredBy?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(50_000)
  cvText?: string;

  /**
   * The applicant agreed that their CV may be kept (spec §11). Without it the CV is not
   * stored at all, so this is not optional in practice.
   */
  @IsBoolean()
  consent: boolean;
}

export class ApplicantQueryDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CvTextDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(50_000)
  cvText?: string;
}

export class ApplyDto {
  @IsUUID()
  applicantId: string;

  @IsOptional()
  @IsBusinessDate()
  appliedOn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class MoveApplicationDto {
  @IsIn(APPLICATION_STATES)
  to: ApplicationState;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// --------------------------------------------------------------- interviews

export class InterviewDto {
  @IsISO8601()
  scheduledAt: string;

  @IsOptional()
  @IsIn(INTERVIEW_KINDS)
  kind?: InterviewKind;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(300)
  place?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  panelUserIds: string[];
}

export class ScorecardDto {
  /** { "Technical knowledge": 4, "Communication": 3 } — each 1 to 5. */
  @IsOptional()
  @IsObject()
  scores?: Record<string, number>;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  overall: number;

  @IsIn(RECOMMENDATIONS)
  recommendation: Recommendation;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class FinishInterviewDto {
  @IsIn(INTERVIEW_OUTCOMES)
  outcome: InterviewOutcome;

  @IsOptional()
  @IsIn(['done', 'no_show'])
  state?: 'done' | 'no_show';

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// ------------------------------------------------------------------- offers

export class OfferDto {
  @IsUUID()
  branchId: string;

  @IsUUID()
  departmentId: string;

  @IsUUID()
  designationId: string;

  @IsUUID()
  gradeId: string;

  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'must be an amount in Taka' })
  grossSalary: string;

  @IsBusinessDate()
  joiningOn: string;

  @IsBusinessDate()
  validUntil: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24)
  probationMonths?: number;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(4000)
  terms?: string;
}

export class DeclineOfferDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class WithdrawOfferDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** 01711-223344, +880 1711 223344, ০১৭১১২২৩৩৪৪ -> +8801711223344 */
function normalizePhone(value: string): string {
  const digits = value
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .replace(/[^\d+]/g, '');
  const bare = digits.replace(/^\+?880/, '').replace(/^0/, '');
  return `+880${bare}`;
}
