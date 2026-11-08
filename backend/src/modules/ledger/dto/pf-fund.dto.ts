/**
 * Request bodies of the PF fund (2026-10-30): interest for a year, a withdrawal, the final
 * settlement. Amounts are taka as strings.
 */
import { IsBusinessDate } from '../../../platform/http/common.dto.js';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** POST /companies/:companyId/pf-interest   { "fiscalYear": "2025-26", "ratePercent": "8.5" } (the rate the PF trustees declared) */
export class PfInterestDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'fiscalYear must look like "2025-26"' })
  fiscalYear: string;

  @Matches(/^\d{1,2}(\.\d{1,3})?$/, {
    message: 'ratePercent must be like 8 or 8.25',
  })
  ratePercent: string;
}

/** POST /employees/:employeeId/pf-withdrawals   { "amount": "30000", "date": "2026-11-05", "paidFromAccountId": "<1130>", "reason": "Daughter's admission, Dhaka University" } */
export class PfWithdrawalDto {
  @Matches(MONEY, { message: 'amount must be like 30000' })
  amount: string;

  @IsBusinessDate()
  date: string;

  @IsUUID()
  paidFromAccountId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** POST /employees/:employeeId/pf-settlement   { "date": "2026-11-30", "paidFromAccountId": "<1130>" } */
export class PfSettlementDto {
  @IsBusinessDate()
  date: string;

  @IsUUID()
  paidFromAccountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** GET /employees/:employeeId/pf-settlement?date= */
export class PfSettlementQueryDto {
  @IsOptional()
  @IsBusinessDate()
  date?: string;
}
