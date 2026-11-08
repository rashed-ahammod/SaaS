import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';

/** POST /rule-packs/:packId/accept   { "effectiveFrom": "2026-07-01", "note": "Board decision 2026-06-25" } */
export class AcceptRulePackDto {
  @IsBusinessDate()
  effectiveFrom: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** GET /rules?date=2026-05-01 */
export class RulesOnDateQueryDto {
  @IsOptional()
  @IsBusinessDate()
  date?: string;
}
