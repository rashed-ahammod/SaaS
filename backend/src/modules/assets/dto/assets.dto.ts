/**
 * Request bodies and query strings for assets and stock (WP19).
 * Money and quantities are strings ("85000", "12.5"), never JS numbers.
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
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const upper = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: 'must be an amount like 85000 or 85000.50' };
const QTY = /^\d{1,10}(\.\d{1,3})?$/;
const QTY_MSG = { message: 'must be a quantity like 12 or 12.5' };
const SIGNED_QTY = /^-?\d{1,10}(\.\d{1,3})?$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

export class ReasonDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// ------------------------------------------------------------- asset classes

/**
 * POST /companies/:companyId/asset-classes   (Admin)
 *   { "code": "IT", "name": "Computers and IT equipment", "assetAccountId": "<1230>", "method": "straight_line", "usefulLifeMonths": 36 }
 * Accumulated depreciation and expense accounts default to 1290 and 5280.
 */
export class AssetClassDto {
  @upper()
  @IsString()
  @Matches(/^[A-Z0-9-]{1,12}$/, {
    message: 'code: up to 12 letters, digits or -',
  })
  code: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsUUID()
  assetAccountId: string;

  @IsOptional()
  @IsUUID()
  accumulatedAccountId?: string;

  @IsOptional()
  @IsUUID()
  expenseAccountId?: string;

  @IsIn(['straight_line', 'reducing_balance'])
  method: 'straight_line' | 'reducing_balance';

  @ValidateIf((o) => o.method === 'straight_line')
  @IsInt()
  @Min(1)
  @Max(600)
  usefulLifeMonths?: number;

  @ValidateIf((o) => o.method === 'reducing_balance')
  @Matches(PERCENT, { message: 'annualRatePercent must be like 20 or 12.5' })
  annualRatePercent?: string;

  @IsOptional()
  @Matches(PERCENT, { message: 'residualPercent must be like 5' })
  residualPercent?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// -------------------------------------------------------------------- assets

/**
 * POST /companies/:companyId/assets   (Admin)
 *   { "classId": "<IT>", "name": "HP ProBook 450 G10", "serialNo": "5CD3281XYZ", "inServiceDate": "2026-07-15",
 *     "cost": "98000", "departmentId": "<Sales>", "location": "Gulshan HQ, 3rd floor", "vendorBillId": "<bill>" }
 * Brought from the old books: "openingAccumulated": "40000", "openingAsOf": "2026-06-30".
 */
export class CreateAssetDto {
  @IsUUID()
  classId: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  serialNo?: string;

  @IsBusinessDate()
  inServiceDate: string;

  @Matches(AMOUNT, AMOUNT_MSG)
  cost: string;

  /** left out: the class's residual percent of the cost */
  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  residualValue?: string;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  openingAccumulated?: string;

  @ValidateIf(
    (o) => o.openingAccumulated !== undefined && o.openingAccumulated !== '0',
  )
  @IsBusinessDate()
  openingAsOf?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsUUID()
  vendorBillId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** PATCH /assets/:assetId   name, serial, department, location, note (not the cost) */
export class UpdateAssetDto {
  @IsInt()
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
  @MaxLength(100)
  serialNo?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** GET /companies/:companyId/assets?state=&classId=&departmentId=&q= */
export class AssetQueryDto {
  @IsOptional()
  @IsIn(['in_store', 'assigned', 'disposed'])
  state?: 'in_store' | 'assigned' | 'disposed';

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** POST /assets/:assetId/assign   { "employeeId": "<Rafi>", "assignedOn": "2026-10-20", "expectedReturn": null, "note": "For field sales" } */
export class AssignAssetDto {
  @IsUUID()
  employeeId: string;

  @IsBusinessDate()
  assignedOn: string;

  @IsOptional()
  @IsBusinessDate()
  expectedReturn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /assets/:assetId/return   { "returnedOn": "2026-11-30", "condition": "good", "note": "Charger included" } */
export class ReturnAssetDto {
  @IsBusinessDate()
  returnedOn: string;

  @IsIn(['good', 'damaged', 'lost'])
  condition: 'good' | 'damaged' | 'lost';

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /assets/:assetId/maintenance   { "doneOn": "2026-10-10", "kind": "service", "description": "AC gas refill", "cost": "3500", "nextDue": "2027-04-10" } */
export class MaintenanceDto {
  @IsBusinessDate()
  doneOn: string;

  @IsIn(['service', 'repair', 'inspection'])
  kind: 'service' | 'repair' | 'inspection';

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  cost?: string;

  @IsOptional()
  @IsBusinessDate()
  nextDue?: string;
}

/**
 * POST /assets/:assetId/dispose   (Admin; posts a journal)
 *   { "disposedOn": "2026-10-25", "method": "sale", "proceeds": "15000", "receivedIntoAccountId": "<1110 cash>", "note": "Sold to staff" }
 */
export class DisposeAssetDto {
  @IsBusinessDate()
  disposedOn: string;

  @IsIn(['sale', 'scrap', 'write_off'])
  method: 'sale' | 'scrap' | 'write_off';

  @ValidateIf((o) => o.method === 'sale')
  @Matches(AMOUNT, AMOUNT_MSG)
  proceeds?: string;

  @ValidateIf((o) => o.method === 'sale')
  @IsUUID()
  receivedIntoAccountId?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}

/** POST /companies/:companyId/depreciation-runs   { "period": "2026-10" }   (Accounts) */
export class DepreciationRunDto {
  @Matches(PERIOD, { message: 'period must be a month as YYYY-MM' })
  period: string;
}

// -------------------------------------------------------------------- stock

/** POST /companies/:companyId/stores   { "code": "HO", "name": "Head office store", "branchId": "<DHK>", "keeperEmployeeId": "<id>" } */
export class StoreDto {
  @upper()
  @IsString()
  @Matches(/^[A-Z0-9-]{1,12}$/, {
    message: 'code: up to 12 letters, digits or -',
  })
  code: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  keeperEmployeeId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** POST /companies/:companyId/stock-items   { "code": "A4-80", "name": "A4 paper, 80 gsm", "nameBn": "এ৪ কাগজ", "unit": "ream", "reorderLevel": "20" } */
export class StockItemDto {
  @upper()
  @IsString()
  @Matches(/^[A-Z0-9-]{1,20}$/, {
    message: 'code: up to 20 letters, digits or -',
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

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit: string;

  @IsOptional()
  @Matches(QTY, QTY_MSG)
  reorderLevel?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class MoveLineDto {
  @IsUUID()
  itemId: string;

  /** receipt / opening: positive; adjustment: + or - */
  @Matches(SIGNED_QTY, QTY_MSG)
  quantity: string;
}

/**
 * POST /stores/:storeId/moves   (Accounts / Admin)
 *   { "kind": "receipt", "moveDate": "2026-10-12", "reference": "Karim Traders KT/2026/1301", "lines": [{ "itemId": "<A4>", "quantity": "50" }] }
 *   { "kind": "adjustment", "moveDate": "2026-10-31", "note": "Stock count: 2 reams damaged by water", "lines": [{ "itemId": "<A4>", "quantity": "-2" }] }
 */
export class StockMovesDto {
  @IsIn(['opening', 'receipt', 'adjustment'])
  kind: 'opening' | 'receipt' | 'adjustment';

  @IsBusinessDate()
  moveDate: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ValidateIf((o) => o.kind === 'adjustment')
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => MoveLineDto)
  lines: MoveLineDto[];
}

export class RequestLineDto {
  @IsUUID()
  itemId: string;

  @Matches(QTY, QTY_MSG)
  quantity: string;
}

/** POST /companies/:companyId/stock-requests   (an employee)  { "storeId": "<HO>", "note": "For the sales team", "lines": [...] } -> Dept Head */
export class StockRequestDto {
  @IsUUID()
  storeId: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RequestLineDto)
  lines: RequestLineDto[];
}

export class IssueLineDto {
  @IsUUID()
  itemId: string;

  @Matches(QTY, QTY_MSG)
  quantity: string;
}

/** POST /stock-requests/:requestId/issue   (the store)  { "issueDate": "2026-10-14", "lines": [{ "itemId": "<A4>", "quantity": "3" }] } */
export class IssueStockDto {
  @IsBusinessDate()
  issueDate: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IssueLineDto)
  lines: IssueLineDto[];
}

/** GET /companies/:companyId/stock?storeId=&belowReorder=true */
export class StockQueryDto {
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  belowReorder?: boolean;
}

/** GET /companies/:companyId/stock-requests?state=approved */
export class StockRequestQueryDto {
  @IsOptional()
  @IsIn([
    'in_approval',
    'approved',
    'partially_issued',
    'issued',
    'rejected',
    'cancelled',
  ])
  state?:
    | 'in_approval'
    | 'approved'
    | 'partially_issued'
    | 'issued'
    | 'rejected'
    | 'cancelled';
}

/** GET /stores/:storeId/moves?itemId=&from=&to= */
export class StockMovesQueryDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsBusinessDate()
  from?: string;

  @IsOptional()
  @IsBusinessDate()
  to?: string;
}
