/**
 * Request bodies of products, price lists, quotations, orders, invoices and receipts
 * (Phase 3 WP25-WP27). Amounts are taka as strings ("1850" or "1850.50"); quantities may have
 * three decimals ("12.500" kg).
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
  ValidateNested,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';
import type {
  CustomerType,
  ReceiptMethod,
} from '../../../platform/db/schema.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const QUANTITY = /^\d{1,10}(\.\d{1,3})?$/;
const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;
const CUSTOMER_TYPES: CustomerType[] = [
  'dealer',
  'distributor',
  'retail',
  'corporate',
  'government',
  'export',
];
export const RECEIPT_METHODS: ReceiptMethod[] = [
  'cash',
  'cheque',
  'bank_transfer',
  'bkash',
  'nagad',
  'other',
];

/** POST /companies/:companyId/products   { "code": "RBO-5L", "name": "Rice bran oil 5 L can", "unit": "can", "vatItemId": "<GOODS-STD>" } */
export class ProductDto {
  @trim()
  @Matches(/^[A-Z0-9-]{1,30}$/, {
    message: 'code: capital letters, digits and dashes',
  })
  code: string;

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
  @IsIn(['goods', 'service'])
  kind?: 'goods' | 'service';

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit: string;

  @IsUUID()
  vatItemId: string;

  /** goods kept in a store: the stock item (same unit); delivery takes it out of the store */
  @IsOptional()
  @IsUUID()
  stockItemId?: string;
}

/** PATCH /products/:productId */
export class UpdateProductDto {
  @IsInt()
  @Min(1)
  version: number;

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
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsUUID()
  vatItemId?: string;

  /** null: no longer kept in a store */
  @IsOptional()
  @IsUUID()
  stockItemId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PriceDto {
  @IsUUID()
  productId: string;

  @Matches(AMOUNT, { message: 'unitPrice must be an amount like 1850' })
  unitPrice: string;
}

/**
 * POST /companies/:companyId/price-lists   (replaces the active list of the same year and customer type)
 *   { "name": "Dealer prices 2026-27", "fiscalYear": "2026-27", "customerType": "dealer", "prices": [{ "productId": "...", "unitPrice": "1780" }] }
 */
export class PriceListDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Matches(/^\d{4}-\d{2}$/, { message: 'fiscalYear must look like "2026-27"' })
  fiscalYear: string;

  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  customerType?: CustomerType;

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PriceDto)
  prices: PriceDto[];
}

/** PUT /companies/:companyId/discount-limits   the whole set: [{ userId?, productId?, customerType?, maxPercent }] */
export class DiscountLimitDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  customerType?: CustomerType;

  @Matches(PERCENT, {
    message: 'maxPercent must be a percentage like 5 or 7.5',
  })
  maxPercent: string;
}

export class DiscountLimitsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DiscountLimitDto)
  limits: DiscountLimitDto[];
}

export class QuoteLineDto {
  @IsUUID()
  productId: string;

  @Matches(QUANTITY, { message: 'quantity must be like 200 or 12.5' })
  quantity: string;

  /** left out: the price list's price for the customer's type */
  @IsOptional()
  @Matches(AMOUNT, { message: 'unitPrice must be an amount like 1850' })
  unitPrice?: string;

  @IsOptional()
  @Matches(PERCENT, { message: 'discountPercent must be a percentage like 4' })
  discountPercent?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/**
 * POST /companies/:companyId/quotations
 *   { "customerId": "...", "opportunityId": "...", "validUntil": "2026-11-30", "language": "bn",
 *     "lines": [{ "productId": "...", "quantity": "200", "discountPercent": "4" }] }
 */
export class QuotationDto {
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  /** left out: today */
  @IsOptional()
  @IsBusinessDate()
  quoteDate?: string;

  @IsBusinessDate()
  validUntil: string;

  @IsOptional()
  @IsIn(['en', 'bn'])
  language?: 'en' | 'bn';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines: QuoteLineDto[];
}

/** POST /quotations/:quotationId/revise   a new version: { validUntil, lines, terms? } (the old one is superseded) */
export class ReviseQuotationDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsBusinessDate()
  validUntil: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  terms?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines: QuoteLineDto[];
}

/** POST /quotations/:quotationId/(submit|send|reject|cancel)   { version, reason? } */
export class QuotationStepDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** POST /quotations/:quotationId/accept   the customer said yes: it becomes an order { version, orderDate?, customerRef? } */
export class AcceptQuotationDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsBusinessDate()
  orderDate?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  customerRef?: string;
}

/** GET /companies/:companyId/quotations?state=&customerId=&q= */
export class QuotationQueryDto {
  @IsOptional()
  @IsIn([
    'draft',
    'in_approval',
    'approved',
    'sent',
    'accepted',
    'rejected',
    'expired',
    'superseded',
    'cancelled',
    'open',
  ])
  state?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** GET /companies/:companyId/sales-orders?state=&customerId= */
export class OrderQueryDto {
  @IsOptional()
  @IsIn(['in_approval', 'confirmed', 'delivered', 'invoiced', 'cancelled'])
  state?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}

/** POST /sales-orders/:orderId/deliver   { version, deliveredOn?, challanNo } */
export class DeliverDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsBusinessDate()
  deliveredOn?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  challanNo: string;

  /** the store the goods leave from (needed when a line's product is kept in a store) */
  @IsOptional()
  @IsUUID()
  storeId?: string;
}

/** POST /sales-orders/:orderId/cancel   { version, reason } */
export class CancelOrderDto {
  @IsInt()
  @Min(1)
  version: number;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** POST /sales-orders/:orderId/invoice   (Accounts) { invoiceDate? } */
export class InvoiceDto {
  @IsOptional()
  @IsBusinessDate()
  invoiceDate?: string;
}

/** GET /companies/:companyId/sales-invoices?customerId=&open=true */
export class InvoiceQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  open?: string;
}

export class CreditNoteLineDto {
  @IsUUID()
  invoiceLineId: string;

  @Matches(QUANTITY, { message: 'quantity must be like 10 or 2.5' })
  quantity: string;
}

/** POST /sales-invoices/:invoiceId/credit-notes   (Accounts) { noteDate?, reason, lines: [{ invoiceLineId, quantity }] } */
export class CreditNoteDto {
  @IsOptional()
  @IsBusinessDate()
  noteDate?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineDto)
  lines: CreditNoteLineDto[];

  /** the goods came back: into the store the order was delivered from */
  @IsOptional()
  @IsBoolean()
  returnToStock?: boolean;
}

export class AllocationDto {
  @IsUUID()
  itemId: string;

  @Matches(AMOUNT, { message: 'amount must be an amount like 50000' })
  amount: string;
}

/**
 * POST /companies/:companyId/customer-receipts   (Accounts; the voucher goes to the checker)
 *   { "customerId": "...", "receiptDate": "2026-11-05", "method": "cheque", "chequeNo": "CA-4471209", "chequeBank": "Islami Bank, Khatunganj",
 *     "receivedIntoAccountId": "<1130>", "amount": "300000", "vdsAmount": "0", "allocations": [{ "itemId": "...", "amount": "300000" }] }
 */
export class CustomerReceiptDto {
  @IsUUID()
  customerId: string;

  @IsBusinessDate()
  receiptDate: string;

  @IsIn(RECEIPT_METHODS)
  method: ReceiptMethod;

  @IsUUID()
  receivedIntoAccountId: string;

  @Matches(AMOUNT, { message: 'amount must be an amount like 300000' })
  amount: string;

  @IsOptional()
  @Matches(AMOUNT, { message: 'vdsAmount must be an amount' })
  vdsAmount?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  vdsCertificateNo?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(40)
  chequeNo?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  chequeBank?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations: AllocationDto[];
}

/** POST /customers/:customerId/apply-advance   (Accounts) { itemId, amount, appliedOn? } */
export class ApplyAdvanceDto extends AllocationDto {
  @IsOptional()
  @IsBusinessDate()
  appliedOn?: string;
}

/** GET /customers/:customerId/statement?from=&to= */
export class StatementQueryDto {
  @IsBusinessDate()
  from: string;

  @IsBusinessDate()
  to: string;
}

/** GET /companies/:companyId/customer-receipts?customerId= */
export class ReceiptQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

/** GET /quotations/:quotationId.pdf?lang=bn ; GET /sales-invoices/:invoiceId.pdf?lang=bn */
export class PdfQueryDto {
  @IsOptional()
  @IsIn(['en', 'bn'])
  lang?: 'en' | 'bn';
}
