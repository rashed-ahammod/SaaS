/**
 * Request bodies for the notification routes.
 */
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * POST /notifications/:id/result   (n8n, event callback token)
 *   { "status": "sent", "provider": "sms-fallback", "providerMessageId": "SSL-889211" }
 *   { "status": "failed", "provider": "sms-primary+sms-fallback", "error": "both gateways refused" }
 */
export class ReportResultDto {
  @IsIn(['sent', 'failed'])
  status: 'sent' | 'failed';

  @IsString()
  @MaxLength(50)
  provider: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  error?: string;
}

/** GET /me/notifications?unread=true */
export class InboxQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;
}

/** GET /notifications/deliveries?status=failed */
export class DeliveriesQueryDto {
  @IsOptional()
  @IsIn(['queued', 'sending', 'sent', 'failed'])
  status?: 'queued' | 'sending' | 'sent' | 'failed';
}
