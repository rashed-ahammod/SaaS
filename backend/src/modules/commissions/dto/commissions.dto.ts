/** Request bodies of commissions, the sales assistant and Gate 3 (Phase 3 WP31). */
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { CommissionBasis } from '../../../platform/db/schema.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export const COMMISSION_BASES: CommissionBasis[] = ['invoiced', 'collected'];
const PERCENT = /^\d{1,3}(\.\d{1,3})?$/;

/** PUT /companies/:companyId/commission-scheme */
export class CommissionRuleDto {
  @trim()
  @Matches(/^[A-Z0-9-]{1,20}$/)
  code: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsIn(COMMISSION_BASES)
  basis?: CommissionBasis;

  @Matches(PERCENT, { message: 'must be a percentage like 2.5' })
  ratePercent: string;

  /** No commission below this much of the month's target (0 = no threshold). */
  @IsOptional()
  @Matches(PERCENT, { message: 'must be a percentage like 80' })
  minAttainment?: string;

  /** The attainment at which the bonus rate starts. */
  @IsOptional()
  @Matches(PERCENT, { message: 'must be a percentage like 120' })
  bonusAttainment?: string;

  @IsOptional()
  @Matches(PERCENT, { message: 'must be a percentage like 3.5' })
  bonusRatePercent?: string;

  @IsOptional()
  @IsBoolean()
  clawback?: boolean;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CalculateRunDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'must be a month like 2026-10' })
  period: string;
}

export class CancelRunDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** POST /leads/:leadId/assist and /customers/:customerId/assist */
export class AssistDto {
  @IsIn(['score', 'next_step', 'follow_up', 'quotation_text', 'call_note'])
  ask: 'score' | 'next_step' | 'follow_up' | 'quotation_text' | 'call_note';

  /** For call_note: what the salesperson typed or dictated after the call. */
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;
}
