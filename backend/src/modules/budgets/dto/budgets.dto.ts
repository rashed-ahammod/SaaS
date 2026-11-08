/**
 * Request bodies and query strings for budgets (WP18). Money is a string ("250000").
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { VersionedDto } from '../../../platform/http/common.dto.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: 'amount must be like 250000 or 250000.50' };
const FISCAL_YEAR = /^\d{4}-\d{2}$/;
const FISCAL_YEAR_MSG = { message: 'fiscalYear must look like "2026-27"' };

export class BudgetLineDto {
  @IsUUID()
  accountId: string;

  /** for the whole fiscal year */
  @Matches(AMOUNT, AMOUNT_MSG)
  amount: string;
}

/**
 * POST /companies/:companyId/budgets   (Accounts)
 *   { "fiscalYear": "2026-27", "departmentId": "<Sales>", "note": "Approved in the September board meeting",
 *     "lines": [{ "accountId": "<1210 furniture>", "amount": "300000" }, { "accountId": "<5250 travel>", "amount": "480000" }] }
 */
export class CreateBudgetDto {
  @Matches(FISCAL_YEAR, FISCAL_YEAR_MSG)
  fiscalYear: string;

  @IsUUID()
  departmentId: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}

/** PATCH /budgets/:budgetId   (drafts only) */
export class UpdateBudgetDto extends VersionedDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines?: BudgetLineDto[];
}

/**
 * POST /budgets/:budgetId/revisions   (Accounts, or the Dept Head for their department) -> Admin
 *   { "reason": "Two more sales officers approved in October", "lines": [{ "accountId": "<1210>", "amount": "380000" }] }
 * Each line is the new yearly amount of an account (a new account adds a line).
 */
export class BudgetRevisionDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}

/** GET /companies/:companyId/budgets?fiscalYear=2026-27   and   /budget-vs-actual?fiscalYear=2026-27&departmentId= */
export class BudgetQueryDto {
  @IsOptional()
  @Matches(FISCAL_YEAR, FISCAL_YEAR_MSG)
  fiscalYear?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** PUT /companies/:companyId/budget-settings */
export class BudgetSettingsDto {
  /** warn the Dept Head from this share of the budget (80) */
  @IsOptional()
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, {
    message: 'warningPercent must be like 80 or 85.5',
  })
  warningPercent?: string;

  /** spending in a department without a budget needs the Admin (once the company uses budgets) */
  @IsOptional()
  @IsBoolean()
  noBudgetNeedsAdmin?: boolean;
}

export class ReasonDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
