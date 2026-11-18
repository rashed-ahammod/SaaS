/**
 * Request bodies for the AI routes (WP11).
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
import type { AiFeature } from '../../../platform/db/schema.js';

/** One earlier turn of the same chat, as shown in the app (text only). */
export class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  text: string;
}

/**
 * POST /ai/assistant
 *   { "question": "আমার নৈমিত্তিক ছুটি কত দিন বাকি আছে?" }
 *   { "question": "And earned leave?", "history": [{ "role": "user", "text": "..." }, { "role": "assistant", "text": "..." }] }
 */
export class AskAssistantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];
}

/** POST /ai/interactions/:id/feedback   { "action": "not_helpful", "note": "Wrong number of days" } */
export class FeedbackDto {
  @IsIn(['helpful', 'not_helpful'])
  action: 'helpful' | 'not_helpful';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /ai/document-reader   multipart "file" (photo or PDF) + { "kind": "bill", "companyId": "<company>" } */
export class DocumentReadDto {
  @IsIn(['bill', 'receipt'])
  kind: 'bill' | 'receipt';

  /** to find the vendor among the company's vendors */
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

/** PUT /ai/settings   { "enabled": true, "assistantEnabled": true, "payrollExplanationsEnabled": false, "bankMatchSuggestionsEnabled": true } */
export class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  assistantEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  payrollExplanationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  bankMatchSuggestionsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  documentReaderEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  cvScreeningEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  reviewDraftEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  salesAssistEnabled?: boolean;
}

/** POST /ai/policy-documents   { "title": "Leave policy 2026", "language": "en", "body": "# Casual leave\n..." } */
export class CreatePolicyDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsIn(['bn', 'en'])
  language: 'bn' | 'en';

  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  body: string;
}

/** GET /ai/usage?month=2026-10 */
export class UsageQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

/** GET /ai/interactions?feature=assistant&status=error&limit=50 */
export class InteractionsQueryDto {
  @IsOptional()
  @IsIn([
    'assistant',
    'payroll_flag_explanation',
    'bank_match_suggestion',
    'document_reader',
  ])
  feature?: AiFeature;

  @IsOptional()
  @IsIn(['ok', 'refused', 'timeout', 'error'])
  status?: 'ok' | 'refused' | 'timeout' | 'error';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
