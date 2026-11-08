/**
 * Request bodies of finance close and Gate 2 (WP22). Amounts are strings ("125000.50").
 */
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;

/** POST /companies/:companyId/opening-balances   multipart "file" (CSV) + { cutOverDate: "2026-10-01" } */
export class OpeningBalancesDto {
  @IsBusinessDate()
  cutOverDate: string;
}

/** POST /companies/:companyId/old-system-comparisons   multipart "file" (CSV) + { asOf: "2026-10-31", note? } */
export class ComparisonDto {
  @IsBusinessDate()
  asOf: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** PUT /companies/:companyId/account-map   { "oldCode": "INC-SALES", "oldName": "Sales - local", "accountId": "<4100>" } */
export class AccountMapDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  oldCode: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  oldName?: string;

  @IsUUID()
  accountId: string;
}

/** POST /receivable-items/:itemId/receipts   { "receiptDate": "2026-10-20", "amount": "45000", "receivedIntoAccountId": "<1130>", "reference": "NPSB 1020-88412" } */
export class ReceiptDto {
  @IsBusinessDate()
  receiptDate: string;

  @Matches(AMOUNT, { message: 'must be an amount like 45000 or 45000.50' })
  amount: string;

  @IsUUID()
  receivedIntoAccountId: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

/** GET ...?from=2026-10-01&to=2026-10-31 */
export class RangeQueryDto {
  @IsBusinessDate()
  from: string;

  @IsBusinessDate()
  to: string;
}

/** GET /companies/:companyId/receivables?open=true ; GET .../receivables/aging?asOf=&by=customer|manager */
export class ReceivablesQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  open?: 'true' | 'false';

  @IsOptional()
  @IsBusinessDate()
  asOf?: string;

  /** WP27: per customer (default) or per account manager */
  @IsOptional()
  @IsIn(['customer', 'manager'])
  by?: 'customer' | 'manager';
}

/** POST /companies/:companyId/month-close/:period/items/:key   { "note": "Utilities and audit fee accrued: JV/2026-27/00031" } */
export class TickDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}
