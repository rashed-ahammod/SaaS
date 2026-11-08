/**
 * Request bodies and queries for expense claims and employee advances (Phase 2 WP16).
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: 'amount must be like 1200 or 1200.50' };
const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const METHODS = ['cash', 'bank_transfer', 'mobile_wallet'] as const;

// ------------------------------------------------------------ categories --

/** POST /companies/:companyId/expense-categories   { "code": "TRAVEL_LOCAL", "nameEn": "Local conveyance", "accountId": "<5250>", "receiptRequiredAbove": "500" } */
export class CreateCategoryDto {
  @Matches(/^[A-Z0-9_]{2,30}$/, {
    message: 'code must be upper-case letters, digits and _',
  })
  code: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameEn: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  /** expense account it is booked to */
  @IsUUID()
  accountId: string;

  /** a receipt is needed above this amount ("0" = always) */
  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  receiptRequiredAbove?: string;
}

/** PATCH /expense-categories/:categoryId */
export class UpdateCategoryDto extends VersionedDto {
  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameEn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  receiptRequiredAbove?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------- claims --

export class ClaimLineDto {
  @IsBusinessDate()
  expenseDate: string;

  @IsUUID()
  categoryId: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description: string;

  @Matches(AMOUNT, AMOUNT_MSG)
  amount: string;

  /** uploaded first: POST /expense-claims/:claimId/receipts */
  @IsOptional()
  @IsUUID()
  receiptId?: string;
}

/**
 * POST /me/expense-claims
 *   { "title": "Dealer visit, Chattogram (12-14 Oct)", "advanceId": "<optional>",
 *     "lines": [{ "expenseDate": "2026-10-12", "categoryId": "<TRAVEL>", "description": "Green Line bus Dhaka-Chattogram", "amount": "1400" }] }
 */
export class CreateClaimDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  /** settle against this cash advance (own, paid) */
  @IsOptional()
  @IsUUID()
  advanceId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ClaimLineDto)
  lines?: ClaimLineDto[];
}

/** PATCH /expense-claims/:claimId   (drafts only) */
export class UpdateClaimDto extends VersionedDto {
  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  /** null: no longer against an advance */
  @IsOptional()
  @IsUUID()
  advanceId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ClaimLineDto)
  lines?: ClaimLineDto[];
}

/** GET /companies/:companyId/expense-claims?state=&employeeId= */
export class ClaimQueryDto {
  @IsOptional()
  @IsIn([
    'draft',
    'in_approval',
    'approved',
    'paid',
    'settled',
    'rejected',
    'cancelled',
  ])
  state?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

/** POST /expense-claims/:claimId/payment, POST /expense-advances/:advanceId/payout, POST /loans/:loanId/payout */
export class PayEmployeeDto {
  /** bank and wallet go to the employee's approved salary account */
  @IsIn(METHODS)
  method: (typeof METHODS)[number];

  /** cash or bank account of the ledger */
  @IsUUID()
  paidFromAccountId: string;

  @IsBusinessDate()
  paymentDate: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  reference?: string;
}

// -------------------------------------------------------------- advances --

/** POST /me/expense-advances   { "purpose": "Dealer visit, Chattogram: hotel and transport", "amount": "20000", "neededBy": "2026-10-11" } */
export class RequestAdvanceDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  purpose: string;

  @Matches(AMOUNT, AMOUNT_MSG)
  amount: string;

  @IsOptional()
  @IsBusinessDate()
  neededBy?: string;
}

/** GET /companies/:companyId/expense-advances?state= */
export class AdvanceQueryDto {
  @IsOptional()
  @IsIn(['in_approval', 'approved', 'paid', 'settled', 'rejected', 'cancelled'])
  state?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

/** POST /expense-advances/:advanceId/refund   { "amount": "3500", "receivedIntoAccountId": "<1110>", "date": "2026-10-16" } */
export class RefundAdvanceDto {
  @Matches(AMOUNT, AMOUNT_MSG)
  amount: string;

  @IsUUID()
  receivedIntoAccountId: string;

  @IsBusinessDate()
  date: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  reference?: string;
}

/** POST /expense-advances/:advanceId/recover-from-salary   { "installment": "2000", "firstPeriod": "2026-11" } */
export class RecoverFromSalaryDto {
  @Matches(AMOUNT, AMOUNT_MSG)
  installment: string;

  @Matches(PERIOD, { message: 'firstPeriod must look like 2026-11' })
  firstPeriod: string;
}

/** POST /companies/:companyId/employee-advances/opening-posting   { "date": "2026-07-01" } */
export class AdvancesOpeningDto {
  @IsBusinessDate()
  date: string;
}
