import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../platform/http/common.dto.js';

/** GET /audit-log?entity=employee&entityId=...&action=employee.&from=2026-10-01&to=2026-11-01&page=1 */
export class AuditLogQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  entity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  /** Prefix match, e.g. "employee." or "approval.approve". */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** GET /integrations/outbox?status=dead */
export class OutboxQueryDto {
  @IsOptional()
  @IsIn(['pending', 'sent', 'dead'])
  status: 'pending' | 'sent' | 'dead' = 'dead';
}
