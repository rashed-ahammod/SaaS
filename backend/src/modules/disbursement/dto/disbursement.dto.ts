/**
 * Request bodies for the disbursement routes.
 */
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const CHANNELS = ['bank', 'bkash', 'nagad', 'rocket', 'upay', 'cash'] as const;

/**
 * POST /payroll-runs/:runId/disbursement-files     (needs header X-OTP-Code when 2FA is enforced)
 *   { "channel": "bank" }                          default format for the channel (BEFTN CSV)
 *   { "channel": "bkash", "adapter": "bkash-bulk" }
 */
export class GenerateFileDto {
  @IsIn(CHANNELS)
  channel: (typeof CHANNELS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  adapter?: string;
}

/**
 * POST /disbursement-files/:fileId/returns
 * { "content": "REFERENCE,STATUS,REASON\nPAY-2026-09-7F3A91C2,RETURNED,Account closed\n" }
 */
export class ImportReturnsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000_000)
  content: string;
}

/** POST /disbursement-files/:fileId/cancel   and   POST /payments/:paymentId/reissue */
export class DisbursementReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
