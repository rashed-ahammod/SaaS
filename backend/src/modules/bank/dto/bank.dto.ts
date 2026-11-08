/**
 * Request bodies of bank reconciliation (WP20). Amounts are strings ("125000.50").
 */
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';
import type { StatementFormat } from '../../../platform/db/schema.js';
import { STATEMENT_FORMATS } from '../statement-formats.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const SIGNED_AMOUNT = /^-?\d{1,13}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: 'must be an amount like 125000 or -2500.50' };

/**
 * POST /companies/:companyId/bank-accounts   (Accounts)
 *   { "accountId": "<1130 Bank - current account>", "bankName": "Dutch-Bangla Bank PLC", "branch": "Tejgaon",
 *     "accountName": "Demo Trading Ltd", "accountNo": "1101100012345", "statementFormat": "dbbl",
 *     "reconcileFrom": "2026-07-01", "openingBankBalance": "850000" }
 */
export class BankAccountDto {
  @IsUUID()
  accountId: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  bankName: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  branch?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  accountName: string;

  @trim()
  @IsString()
  @Matches(/^[0-9A-Za-z-]{4,30}$/, {
    message: 'must be the account number (digits, letters, dashes)',
  })
  accountNo: string;

  @IsIn(STATEMENT_FORMATS)
  statementFormat: StatementFormat;

  /** reconciliation starts on this day */
  @IsBusinessDate()
  reconcileFrom: string;

  /** the bank's balance at the end of the day before reconcileFrom */
  @Matches(SIGNED_AMOUNT, AMOUNT_MSG)
  openingBankBalance: string;
}

/** PATCH /bank-accounts/:bankAccountId   { version, ... }  (start date and opening only before the first statement) */
export class UpdateBankAccountDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  branch?: string;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  accountName?: string;

  @IsOptional()
  @IsIn(STATEMENT_FORMATS)
  statementFormat?: StatementFormat;

  @IsOptional()
  @IsBusinessDate()
  reconcileFrom?: string;

  @IsOptional()
  @Matches(SIGNED_AMOUNT, AMOUNT_MSG)
  openingBankBalance?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * POST /bank-accounts/:bankAccountId/statements/n8n   (n8n, ServiceKey with bank.import)
 *   { "fileName": "DBBL-1101100012345-2026-10-15.csv", "content": "Txn Date,Value Date,Particulars,..." }
 */
export class StatementTextDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fileName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000_000)
  content: string;
}

/** GET /bank-accounts/:bankAccountId/statement-lines?state=unmatched&from=&to=   (also ledger-lines) */
export class LinesQueryDto {
  @IsOptional()
  @IsIn(['unmatched', 'matched', 'all'])
  state?: 'unmatched' | 'matched' | 'all';

  @IsOptional()
  @IsBusinessDate()
  from?: string;

  @IsOptional()
  @IsBusinessDate()
  to?: string;
}

/**
 * POST /bank-accounts/:bankAccountId/matches
 *   { "statementLineIds": ["<deposit 50,000>"], "ledgerLineIds": ["<receipt 30,000>", "<receipt 20,000>"], "note": "One deposit for two dealers" }
 */
export class MatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  statementLineIds: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  ledgerLineIds: string[];

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** accepting a suggestion (rules or AI) rather than choosing by hand */
  @IsOptional()
  @IsBoolean()
  fromSuggestion?: boolean;
}

/** POST /bank-matches/:matchId/undo   { "reason": "Wrong cheque: 4521900 is the Partex one" } */
export class UndoMatchDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/**
 * POST /bank-statement-lines/:lineId/voucher   a draft voucher for a line the books do not have yet
 *   { "accountId": "<5290 Bank charges>", "narration": "DBBL SMS alert charge, October" }
 */
export class RecordLineDto {
  @IsUUID()
  accountId: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  narration: string;
}

/** GET /bank-accounts/:bankAccountId/reconciliation?asOf=2026-10-31 */
export class ReconciliationQueryDto {
  @IsOptional()
  @IsBusinessDate()
  asOf?: string;
}
