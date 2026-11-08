import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';

export const DOCUMENT_TYPES = [
  'nid',
  'tin_certificate',
  'photo',
  'cv',
  'educational_certificate',
  'experience_letter',
  'contract',
  'other',
] as const;

/**
 * POST /employees/:employeeId/documents   (multipart/form-data)
 *   file      the PDF / JPG / PNG (max 10 MB)
 *   docType   one of DOCUMENT_TYPES
 *   title     optional
 *   expiresOn optional YYYY-MM-DD (e.g. contract end)
 */
export class UploadDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  docType: (typeof DOCUMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsBusinessDate()
  expiresOn?: string;
}

/** POST /employees/:employeeId/documents/:documentId/remove */
export class RemoveDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** GET /companies/:companyId/document-expiries?withinDays=60 */
export class DocumentExpiryQueryDto {
  /** Already expired documents are always included, however small this is. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  withinDays?: number;
}

/** POST /employees/:employeeId/onboarding/:itemCode/complete */
export class CompleteOnboardingItemDto {
  /** e.g. "Not applicable: no TIN yet" */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
