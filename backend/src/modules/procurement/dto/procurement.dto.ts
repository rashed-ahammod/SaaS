/**
 * Request bodies and query strings for procurement (WP17).
 * Money and quantities are strings ("8500", "8500.50"; "12", "500.5"), never JS numbers.
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import {
  IsBusinessDate,
  VersionedDto,
} from '../../../platform/http/common.dto.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: 'must be an amount like 8500 or 8500.50' };
const QTY = /^\d{1,10}(\.\d{1,3})?$/;
const QTY_MSG = { message: 'must be a quantity like 12 or 500.5' };
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

// ---------------------------------------------------------------- settings --

/** PUT /companies/:companyId/procurement-settings */
export class ProcurementSettingsDto {
  /** from this estimated amount, quotations and a comparative statement are needed */
  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  quotationThreshold?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  minQuotations?: number;

  /** from this estimated amount, the Admin approves the requisition too */
  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  adminThreshold?: string;

  /** bill unit price may exceed the PO price by this much */
  @IsOptional()
  @Matches(PERCENT, { message: 'matchTolerancePercent must be like 2 or 2.5' })
  matchTolerancePercent?: string;
}

// ------------------------------------------------------------- requisition --

export class RequisitionLineDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description: string;

  @Matches(QTY, QTY_MSG)
  quantity: string;

  /** pcs, box, ream, kg, litre, month ... */
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit: string;

  @Matches(AMOUNT, AMOUNT_MSG)
  estimatedUnitPrice: string;
}

/**
 * POST /companies/:companyId/purchase-requisitions
 *   { "title": "Chairs for the Chattogram sales office", "justification": "Six new sales officers join in November",
 *     "neededBy": "2026-11-01", "lines": [{ "description": "Office chair, mesh back", "quantity": "6", "unit": "pcs", "estimatedUnitPrice": "8500" }] }
 * An employee raises one for themself; Accounts may raise one for any employee (employeeId).
 */
export class CreateRequisitionDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  justification: string;

  @IsOptional()
  @IsBusinessDate()
  neededBy?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineDto)
  lines: RequisitionLineDto[];
}

/** PATCH /purchase-requisitions/:requisitionId   (drafts only) */
export class UpdateRequisitionDto extends VersionedDto {
  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  justification?: string;

  @IsOptional()
  @IsBusinessDate()
  neededBy?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineDto)
  lines?: RequisitionLineDto[];
}

/** GET /companies/:companyId/purchase-requisitions?state=approved */
export class RequisitionQueryDto {
  @IsOptional()
  @IsIn([
    'draft',
    'in_approval',
    'approved',
    'ordered',
    'rejected',
    'cancelled',
  ])
  state?:
    'draft' | 'in_approval' | 'approved' | 'ordered' | 'rejected' | 'cancelled';
}

export class ReasonDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// --------------------------------------------------------------- quotation --

export class QuotationLineDto {
  @IsUUID()
  requisitionLineId: string;

  @Matches(AMOUNT, AMOUNT_MSG)
  unitPrice: string;

  @IsOptional()
  @Matches(PERCENT, { message: 'vatPercent must be like 15 or 7.5' })
  vatPercent?: string;
}

/**
 * POST /purchase-requisitions/:requisitionId/quotations   (Accounts)
 *   { "vendorId": "<id>", "reference": "OTOBI/Q/2026/311", "quotationDate": "2026-10-08", "validUntil": "2026-10-31",
 *     "deliveryDays": 7, "lines": [{ "requisitionLineId": "<id>", "unitPrice": "8200", "vatPercent": "15" }] }
 * Every requisition line needs a price.
 */
export class QuotationDto {
  @IsUUID()
  vendorId: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  reference: string;

  @IsBusinessDate()
  quotationDate: string;

  @IsOptional()
  @IsBusinessDate()
  validUntil?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  deliveryDays?: number;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines: QuotationLineDto[];
}

/**
 * POST /purchase-requisitions/:requisitionId/comparative-statement   (Accounts)
 *   { "quotationId": "<id>", "reason": "Lowest price; delivery in 7 days" }
 * A reason is required when the chosen quotation is not the lowest.
 */
export class ComparativeStatementDto {
  @IsUUID()
  quotationId: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

// ---------------------------------------------------------- purchase order --

export class PurchaseOrderLineDto {
  @IsUUID()
  requisitionLineId: string;

  /** expense or asset account the bill line posts to */
  @IsUUID()
  accountId: string;
}

/**
 * POST /purchase-requisitions/:requisitionId/purchase-orders   (Accounts)
 *   { "quotationId": "<id>", "orderDate": "2026-10-10", "deliveryDate": "2026-10-17",
 *     "deliverTo": "Chattogram Office, Agrabad", "terms": "Payment 30 days after delivery",
 *     "lines": [{ "requisitionLineId": "<id>", "accountId": "<5410 office equipment>" }] }
 */
export class CreatePurchaseOrderDto {
  @IsUUID()
  quotationId: string;

  @IsBusinessDate()
  orderDate: string;

  @IsOptional()
  @IsBusinessDate()
  deliveryDate?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(300)
  deliverTo?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(1000)
  terms?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];
}

/** GET /companies/:companyId/purchase-orders?state=issued&vendorId= */
export class PurchaseOrderQueryDto {
  @IsOptional()
  @IsIn(['draft', 'issued', 'partially_received', 'received', 'cancelled'])
  state?: 'draft' | 'issued' | 'partially_received' | 'received' | 'cancelled';

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  /** true: orders a bill can still be entered against (issued or received) */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  billable?: boolean;
}

// ----------------------------------------------------------- goods receipt --

export class ReceiptLineDto {
  @IsUUID()
  poLineId: string;

  @Matches(QTY, QTY_MSG)
  quantity: string;
}

/**
 * POST /purchase-orders/:purchaseOrderId/receipts   (Accounts or the Dept Head)
 *   { "receivedDate": "2026-10-16", "note": "4 chairs; 2 more next week", "lines": [{ "poLineId": "<id>", "quantity": "4" }] }
 */
export class GoodsReceiptDto {
  @IsBusinessDate()
  receivedDate: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines: ReceiptLineDto[];
}
