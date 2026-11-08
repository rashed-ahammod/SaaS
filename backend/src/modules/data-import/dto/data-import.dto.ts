/**
 * Request bodies for the data migration routes.
 */
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const ENTITIES = [
  'employees',
  'salaries',
  'leave_balances',
  'ytd_openings',
  'loans',
  'bank_accounts',
  'customers',
] as const;
const MONTH_START = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const MONTH_START_MSG = {
  message: 'cutOverDate must be the first day of a month, e.g. 2026-10-01',
};

/**
 * POST /companies/:companyId/imports      multipart/form-data:
 *   file         the filled template (.xlsx or .csv)
 *   entity       employees | salaries | leave_balances | ytd_openings | loans | bank_accounts
 *   cutOverDate  go-live date, a month start, e.g. 2026-10-01
 */
export class UploadImportDto {
  @IsIn(ENTITIES)
  entity: (typeof ENTITIES)[number];

  @Matches(MONTH_START, MONTH_START_MSG)
  cutOverDate: string;
}

/** GET /imports/templates/:entity?format=xlsx|csv */
export class TemplateQueryDto {
  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format?: 'xlsx' | 'csv';
}

/** POST /imports/:batchId/rows/:rowNo/skip   and   POST /imports/:batchId/rollback */
export class ImportReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** GET /companies/:companyId/migration/reconciliation?cutOverDate=2026-10-01 */
export class ReconciliationQueryDto {
  @Matches(MONTH_START, MONTH_START_MSG)
  cutOverDate: string;
}

/** POST /companies/:companyId/migration/sign-off   { "cutOverDate": "2026-10-01", "note": "Checked against the September register" } */
export class SignOffDto {
  @Matches(MONTH_START, MONTH_START_MSG)
  cutOverDate: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}
