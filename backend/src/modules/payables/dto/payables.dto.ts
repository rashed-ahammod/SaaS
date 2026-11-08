/**
 * Request bodies and queries for vendors, bills, payments and tax at source (Phase 2 WP15).
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  IsBusinessDate,
  VersionedDto,
} from '../../../platform/http/common.dto.js';

const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: 'amount must be like 12500 or 12500.50' };
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const CATEGORY = /^[A-Z_]{2,30}$/;
const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const TAX_TYPES = ['tds', 'vds'] as const;
const METHODS = ['bank_transfer', 'cheque', 'cash', 'mobile_wallet'] as const;

// ------------------------------------------------------------- settings --

/** PUT /companies/:companyId/payables-settings   { "vatWithholdingEntity": true, "defaultPaymentTermsDays": 30 } */
export class PayablesSettingsDto {
  @IsBoolean()
  vatWithholdingEntity: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  defaultPaymentTermsDays?: number;
}

// -------------------------------------------------------------- vendors --

/**
 * POST /companies/:companyId/vendors
 *   { "name": "Clean & Care Services Ltd", "nameBn": "ক্লিন অ্যান্ড কেয়ার সার্ভিসেস লিমিটেড", "vendorType": "company",
 *     "tin": "123456789012", "bin": "000123456-0101", "phone": "01711223344", "withholdingCategory": "SERVICE" }
 */
export class CreateVendorDto {
  /** left out: V-0001, V-0002 ... */
  @IsOptional()
  @trim()
  @Matches(/^[A-Za-z0-9-]{1,20}$/, {
    message: 'code may use letters, digits and "-" (up to 20)',
  })
  code?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsOptional()
  @IsIn(['company', 'individual'])
  vendorType?: 'company' | 'individual';

  /** e-TIN: 12 digits */
  @IsOptional()
  @Matches(/^[0-9]{12}$/, { message: 'tin must be 12 digits' })
  tin?: string;

  /** VAT registration number (BIN) */
  @IsOptional()
  @Matches(/^[0-9]{9}(-?[0-9]{4})?$/, {
    message: 'bin must look like 000123456-0101',
  })
  bin?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  tradeLicence?: string;

  @IsOptional()
  @Matches(/^01[3-9][0-9]{8}$/, { message: 'phone must look like 01712345678' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  address?: string;

  /** payment category for tax at source (GET /companies/:id/withholding-categories) */
  @IsOptional()
  @Matches(CATEGORY)
  withholdingCategory?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;
}

/** PATCH /vendors/:vendorId   (send only what changes, plus version) */
export class UpdateVendorDto extends VersionedDto {
  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsOptional()
  @Matches(/^[0-9]{12}$/, { message: 'tin must be 12 digits' })
  tin?: string;

  @IsOptional()
  @Matches(/^[0-9]{9}(-?[0-9]{4})?$/, {
    message: 'bin must look like 000123456-0101',
  })
  bin?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  tradeLicence?: string;

  @IsOptional()
  @Matches(/^01[3-9][0-9]{8}$/, { message: 'phone must look like 01712345678' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Matches(CATEGORY)
  withholdingCategory?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** GET /companies/:companyId/vendors?search=&active= */
export class VendorQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}

/**
 * POST /vendors/:vendorId/bank-accounts       (step-up: X-OTP-Code)
 *   { "bankName": "BRAC Bank PLC", "branchName": "Gulshan", "routingNumber": "060261726",
 *     "accountName": "Clean & Care Services Ltd", "accountNumber": "1501203456789001" }
 */
export class VendorBankAccountDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  bankName: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  branchName: string;

  @Matches(/^[0-9]{9}$/, { message: 'routingNumber must be 9 digits' })
  routingNumber: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  accountName: string;

  @Matches(/^[0-9]{8,20}$/, { message: 'accountNumber must be 8-20 digits' })
  accountNumber: string;
}

// ---------------------------------------------------------------- bills --

export class BillLineDto {
  /** expense or asset account (postable) */
  @IsUUID()
  accountId: string;

  /** cost centre */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description: string;

  /** before VAT */
  @Matches(AMOUNT, AMOUNT_MSG)
  amount: string;

  /** VAT rate on this line, e.g. "15", "7.5", "5", "0" */
  @IsOptional()
  @Matches(PERCENT, { message: 'vatPercent must be like 15 or 7.5' })
  vatPercent?: string;

  /** the VAT item bought (WP21): its rate for the bill's fiscal year replaces vatPercent */
  @IsOptional()
  @IsUUID()
  vatItemId?: string;

  /** a bill against a purchase order: the order line billed, and the quantity (WP17) */
  @IsOptional()
  @IsUUID()
  poLineId?: string;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,3})?$/, {
    message: 'quantity must be like 12 or 500.5',
  })
  quantity?: string;
}

/**
 * POST /companies/:companyId/vendor-bills
 *   { "vendorId": "<id>", "billNo": "CCS/2026/1043", "billDate": "2026-10-05", "narration": "Office cleaning, October 2026",
 *     "lines": [{ "accountId": "<5250>", "departmentId": "<HO>", "description": "Cleaning, 6 staff", "amount": "120000", "vatPercent": "15" }] }
 */
export class CreateBillDto {
  @IsUUID()
  vendorId: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  billNo: string;

  @IsBusinessDate()
  billDate: string;

  /** left out: bill date + the vendor's (or the company's) payment terms */
  @IsOptional()
  @IsBusinessDate()
  dueDate?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  narration: string;

  /** left out: the vendor's category */
  @IsOptional()
  @Matches(CATEGORY)
  withholdingCategory?: string;

  /** the purchase order this bill is for (WP17): every line then names a PO line and a quantity */
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BillLineDto)
  lines: BillLineDto[];
}

/** PATCH /vendor-bills/:billId   (drafts only) */
export class UpdateBillDto extends VersionedDto {
  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  billNo?: string;

  @IsOptional()
  @IsBusinessDate()
  billDate?: string;

  @IsOptional()
  @IsBusinessDate()
  dueDate?: string;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  narration?: string;

  @IsOptional()
  @Matches(CATEGORY)
  withholdingCategory?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BillLineDto)
  lines?: BillLineDto[];
}

/** GET /companies/:companyId/vendor-bills?vendorId=&state=&open=true&from=&to= */
export class BillQueryDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsIn(['draft', 'in_approval', 'approved', 'cancelled'])
  state?: 'draft' | 'in_approval' | 'approved' | 'cancelled';

  /** only approved bills with something left to pay */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  open?: boolean;

  @IsOptional()
  @IsBusinessDate()
  from?: string;

  @IsOptional()
  @IsBusinessDate()
  to?: string;
}

export class PayablesReasonDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// ------------------------------------------------------------- payments --

export class AllocationDto {
  @IsUUID()
  billId: string;

  @Matches(AMOUNT, AMOUNT_MSG)
  amount: string;
}

/**
 * POST /companies/:companyId/vendor-payments
 *   { "vendorId": "<id>", "paymentDate": "2026-10-20", "method": "bank_transfer", "reference": "BEFTN 20261020-118",
 *     "paidFromAccountId": "<1130>", "allocations": [{ "billId": "<id>", "amount": "111000" }] }
 */
export class CreateVendorPaymentDto {
  @IsUUID()
  vendorId: string;

  @IsBusinessDate()
  paymentDate: string;

  @IsIn(METHODS)
  method: (typeof METHODS)[number];

  /** cheque number or transfer reference */
  @ValidateIf((o) => o.method === 'cheque' || o.reference !== undefined)
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  reference?: string;

  /** a cash or bank account of the ledger */
  @IsUUID()
  paidFromAccountId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations: AllocationDto[];
}

/** GET /companies/:companyId/vendor-payments?vendorId=&state= */
export class PaymentQueryDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsIn(['in_approval', 'paid', 'cancelled', 'reversed'])
  state?: 'in_approval' | 'paid' | 'cancelled' | 'reversed';
}

// ---------------------------------------------------------- tax at source --

/** GET /companies/:companyId/tax-withholdings?taxType=&period=&deposited= */
export class WithholdingQueryDto {
  @IsOptional()
  @IsIn(TAX_TYPES)
  taxType?: (typeof TAX_TYPES)[number];

  @IsOptional()
  @Matches(PERIOD, { message: 'period must look like 2026-10' })
  period?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  deposited?: boolean;
}

/**
 * POST /companies/:companyId/tax-challans
 *   { "taxType": "tds", "period": "2026-10", "challanNo": "TR-2026-10-55871", "challanDate": "2026-11-12", "paidFromAccountId": "<1130>" }
 * Deposits every withholding of the month not yet deposited.
 */
export class CreateChallanDto {
  @IsIn(TAX_TYPES)
  taxType: (typeof TAX_TYPES)[number];

  @Matches(PERIOD, { message: 'period must look like 2026-10' })
  period: string;

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

/** POST /vendors/:vendorId/tax-certificates   { "taxType": "tds", "from": "2026-07-01", "to": "2026-12-31" } */
export class CreateCertificateDto {
  @IsIn(TAX_TYPES)
  taxType: (typeof TAX_TYPES)[number];

  @IsBusinessDate()
  from: string;

  @IsBusinessDate()
  to: string;
}

/** GET /companies/:companyId/payables/aging?asOf= */
export class AgingQueryDto {
  @IsBusinessDate()
  asOf: string;
}

/** GET /vendors/:vendorId/statement?from=&to= */
export class StatementQueryDto {
  @IsOptional()
  @IsBusinessDate()
  from?: string;

  @IsBusinessDate()
  to: string;
}

/** GET /companies/:companyId/withholding-categories?date= */
export class CategoriesQueryDto {
  @IsOptional()
  @IsBusinessDate()
  date?: string;
}
