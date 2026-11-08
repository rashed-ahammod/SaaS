/**
 * Request bodies of VAT and compliance (WP21). Amounts are strings ("125000.50").
 */
import { Transform, Type } from 'class-transformer';
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';
import type { VatRateClass } from '../../../platform/db/schema.js';
import { RATE_CLASSES } from '../mushak.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: 'must be an amount like 85000 or 85000.50' };
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const FY = /^\d{4}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * POST /companies/:companyId/vat-items   (Accounts)
 *   { "code": "S-CONSULT", "nameEn": "Consultancy services", "kind": "service", "nbrCode": "S099.60",
 *     "rate": { "fiscalYear": "2026-27", "rateClass": "standard", "vatPercent": "15" } }
 */
export class VatRateDto {
  @Matches(FY, { message: 'must be a fiscal year like 2026-27' })
  fiscalYear: string;

  @IsIn(RATE_CLASSES)
  rateClass: VatRateClass;

  @Matches(PERCENT, { message: 'must be a percent like 15 or 7.5' })
  vatPercent: string;

  @IsOptional()
  @Matches(PERCENT, { message: 'must be a percent like 10' })
  sdPercent?: string;
}

export class VatItemDto {
  @trim()
  @Matches(/^[0-9A-Za-z.-]{1,20}$/, {
    message: 'must be a short code (letters, digits, dot, dash)',
  })
  code: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nameEn: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsIn(['goods', 'service'])
  kind: 'goods' | 'service';

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(30)
  nbrCode?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ValidateNested()
  @Type(() => VatRateDto)
  rate: VatRateDto;
}

/** PATCH /vat-items/:itemId   { version, nameEn?, nameBn?, nbrCode?, unit?, isActive? } */
export class UpdateVatItemDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nameEn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(30)
  nbrCode?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** POST /companies/:companyId/vat-items/defaults   { "fiscalYear": "2026-27" } ; POST /companies/:companyId/vat-rates/copy { from, to } */
export class FiscalYearDto {
  @Matches(FY, { message: 'must be a fiscal year like 2026-27' })
  fiscalYear: string;
}

export class CopyRatesDto {
  @Matches(FY, { message: 'must be a fiscal year like 2026-27' })
  from: string;

  @Matches(FY, { message: 'must be a fiscal year like 2027-28' })
  to: string;
}

export class SaleLineDto {
  @IsUUID()
  itemId: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description: string;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,3})?$/, {
    message: 'must be a quantity like 12 or 2.5',
  })
  quantity?: string;

  /** before VAT and SD */
  @Matches(AMOUNT, AMOUNT_MSG)
  value: string;
}

/**
 * POST /companies/:companyId/vat-sales   (Accounts) a VAT invoice (Mushak 6.3) and its receipt voucher -> checker
 *   { "invoiceDate": "2026-10-12", "customerName": "Meghna Dealers", "customerBin": "000123456-0101",
 *     "receivedIntoAccountId": "<1130>", "lines": [{ "itemId": "<TRADE-5>", "description": "Rice bran oil, 5 L", "quantity": "200", "value": "150000" }],
 *     "vdsByCustomer": "0" }
 */
export class VatSaleDto {
  @IsBusinessDate()
  invoiceDate: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  customerName: string;

  @IsOptional()
  @trim()
  @Matches(/^[0-9]{9}(-?[0-9]{4})?$/, {
    message: 'must be a BIN like 000123456-0101',
  })
  customerBin?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(300)
  customerAddress?: string;

  @IsUUID()
  receivedIntoAccountId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines: SaleLineDto[];

  /** VAT the customer deducted at source (with its Mushak 6.6 certificate) */
  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  vdsByCustomer?: string;

  @ValidateIf((o) => o.vdsByCustomer && Number(o.vdsByCustomer) > 0)
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  vdsCertificateNo?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** GET /companies/:companyId/vat-sales?period=2026-10 (also purchases) */
export class PeriodQueryDto {
  @IsOptional()
  @Matches(MONTH, { message: 'must be a month like 2026-10' })
  period?: string;
}

/** GET /companies/:companyId/vat-returns/preview?period=2026-10 ; POST /companies/:companyId/vat-returns */
export class VatReturnDto {
  @Matches(MONTH, { message: 'must be a month like 2026-10' })
  period: string;

  /** the day it was submitted on the NBR e-return system */
  @IsOptional()
  @IsBusinessDate()
  submittedOn?: string;

  /** the NBR acknowledgement */
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  submissionRef?: string;
}

/** POST /vat-returns/:returnId/challan   { "challanNo": "A-2026-11-00871", "challanDate": "2026-11-12", "paidFromAccountId": "<1130>" } */
export class VatChallanDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  challanNo: string;

  @IsBusinessDate()
  challanDate: string;

  @IsUUID()
  paidFromAccountId: string;
}

/** GET /companies/:companyId/compliance?from=2026-10-01&to=2026-12-31&state=open */
export class ComplianceQueryDto {
  @IsOptional()
  @IsBusinessDate()
  from?: string;

  @IsOptional()
  @IsBusinessDate()
  to?: string;

  @IsOptional()
  @IsIn(['open', 'done', 'not_applicable'])
  state?: 'open' | 'done' | 'not_applicable';
}

/** POST /companies/:companyId/compliance   { "title": "Fire licence renewal (Fire Service and Civil Defence)", "dueDate": "2026-12-31" } */
export class ComplianceItemDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsBusinessDate()
  dueDate: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /compliance/:itemId/close   { "state": "done", "evidence": "Renewed, licence no. TRAD/DNCC/045812/2026", "doneOn": "2026-09-21" } */
export class CloseComplianceDto {
  @IsIn(['done', 'not_applicable'])
  state: 'done' | 'not_applicable';

  @IsOptional()
  @IsBusinessDate()
  doneOn?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  evidence: string;
}
