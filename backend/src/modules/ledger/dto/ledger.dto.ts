/**
 * Request bodies and queries for the general ledger (Phase 2 WP14).
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  IsBusinessDate,
  VersionedDto,
} from '../../../platform/http/common.dto.js';

const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: 'amount must be like 12500 or 12500.50' };
const ACCOUNT_TYPES = [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
] as const;
const ROLES = [
  'cash',
  'bank',
  'payables',
  'receivables',
  'employee_advances',
  'retained_earnings',
] as const;
const VOUCHER_TYPES = ['payment', 'receipt', 'journal', 'contra'] as const;

// ---------------------------------------------------------------- setup --

/** POST /companies/:companyId/ledger/setup   { "asOf": "2026-10-16" } */
export class SetUpLedgerDto {
  @IsOptional()
  @IsBusinessDate()
  asOf?: string;
}

/** POST /companies/:companyId/accounts */
export class CreateAccountDto {
  @Matches(/^[0-9A-Za-z.-]{1,20}$/)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameEn: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  @IsIn(ACCOUNT_TYPES)
  type: (typeof ACCOUNT_TYPES)[number];

  @IsOptional()
  @IsUUID()
  parentId?: string;

  /** false = a group account that only adds up its children */
  @IsOptional()
  @IsBoolean()
  postable?: boolean;

  @IsOptional()
  @IsIn(ROLES)
  role?: (typeof ROLES)[number];
}

/** PATCH /accounts/:accountId   (code, type and parent never change: postings depend on them) */
export class UpdateAccountDto extends VersionedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(ROLES)
  role?: (typeof ROLES)[number];
}

/** PUT /companies/:companyId/posting-accounts   { "key": "payroll.deduction.TAX", "accountId": "..." } */
export class SetPostingAccountDto {
  @Matches(/^[a-z_]+(\.[A-Za-z0-9_]+)+$/)
  key: string;

  @IsUUID()
  accountId: string;
}

/** POST /companies/:companyId/fiscal-years   { "forDate": "2027-07-01" } */
export class OpenFiscalYearDto {
  @IsBusinessDate()
  forDate: string;
}

// ------------------------------------------------------------- vouchers --

export class VoucherLineDto {
  @IsUUID()
  accountId: string;

  /** cost centre */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn(['employee', 'vendor', 'customer'])
  partyType?: 'employee' | 'vendor' | 'customer';

  @IsOptional()
  @IsUUID()
  partyId?: string;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  debit?: string;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  credit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  narration?: string;
}

/**
 * POST /companies/:companyId/vouchers
 *   { "voucherType": "payment", "voucherDate": "2026-10-16", "narration": "Office rent October, Gulshan-2",
 *     "lines": [{ "accountId": "<5210>", "departmentId": "<HO>", "debit": "85000" }, { "accountId": "<1130>", "credit": "85000" }] }
 */
export class CreateVoucherDto {
  @IsIn(VOUCHER_TYPES)
  voucherType: (typeof VOUCHER_TYPES)[number];

  @IsBusinessDate()
  voucherDate: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  narration: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => VoucherLineDto)
  lines: VoucherLineDto[];

  /** Opening balances from the old system: a journal on the first day of the cut-over month. */
  @IsOptional()
  @IsBoolean()
  isOpening?: boolean;
}

/** PATCH /vouchers/:voucherId   (drafts only) */
export class UpdateVoucherDto extends VersionedDto {
  @IsOptional()
  @IsBusinessDate()
  voucherDate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  narration?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => VoucherLineDto)
  lines?: VoucherLineDto[];
}

export class LedgerReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** POST /vouchers/:voucherId/reverse   { "reason": "Rent booked to the wrong department", "voucherDate": "2026-10-20" } */
export class ReverseVoucherDto extends LedgerReasonDto {
  @IsOptional()
  @IsBusinessDate()
  voucherDate?: string;
}

/** GET /companies/:companyId/vouchers?from=&to=&type=&state= */
export class VoucherQueryDto {
  @IsOptional()
  @IsBusinessDate()
  from?: string;

  @IsOptional()
  @IsBusinessDate()
  to?: string;

  @IsOptional()
  @IsIn(VOUCHER_TYPES)
  type?: (typeof VOUCHER_TYPES)[number];

  @IsOptional()
  @IsIn(['draft', 'in_approval', 'posted', 'cancelled'])
  state?: 'draft' | 'in_approval' | 'posted' | 'cancelled';
}

// -------------------------------------------------------------- reports --

/** ?from=&to= (from defaults to the start of to's fiscal year) */
export class RangeQueryDto {
  @IsOptional()
  @IsBusinessDate()
  from?: string;

  @IsBusinessDate()
  to: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** ?asOf= */
export class AsOfQueryDto {
  @IsBusinessDate()
  asOf: string;
}

/** ?fiscalYearId= */
export class PeriodsQueryDto {
  @IsOptional()
  @IsUUID()
  fiscalYearId?: string;
}
