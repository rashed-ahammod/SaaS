/** Shapes of the assets and stock API (WP19). Money and quantities are strings. */

export interface AssetClass {
  id: string;
  code: string;
  name: string;
  assetAccountId: string;
  method: "straight_line" | "reducing_balance";
  usefulLifeMonths: number | null;
  annualRatePercent: string | null;
  residualPercent: string;
  isActive: boolean;
  version: number;
}

export type AssetState = "in_store" | "assigned" | "disposed";

export interface AssetSummary {
  id: string;
  companyId: string;
  classId: string;
  tag: string;
  name: string;
  serialNo: string | null;
  inServiceDate: string;
  cost: string;
  residualValue: string;
  departmentId: string | null;
  location: string | null;
  state: AssetState;
  accumulated: string;
  bookValue: string;
  classCode?: string;
  className?: string;
  departmentName?: string | null;
  holder?: {
    employeeId: string;
    code: string;
    name: string;
    acknowledged: boolean;
  } | null;
  version: number;
}

export interface Asset extends AssetSummary {
  class: AssetClass;
  openingAccumulated: string;
  openingAsOf: string | null;
  disposedOn: string | null;
  disposalMethod: "sale" | "scrap" | "write_off" | null;
  disposalProceeds: string | null;
  disposalNote: string | null;
  disposalVoucherNumber: string | null;
  note: string | null;
  assignments: Array<{
    id: string;
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    assignedOn: string;
    expectedReturn: string | null;
    note: string | null;
    acknowledgedAt: string | null;
    returnedOn: string | null;
    returnCondition: "good" | "damaged" | "lost" | null;
    returnNote: string | null;
  }>;
  maintenance: Array<{
    id: string;
    doneOn: string;
    kind: "service" | "repair" | "inspection";
    description: string;
    vendorName: string | null;
    cost: string;
    nextDue: string | null;
  }>;
  depreciation: Array<{
    period: string;
    amount: string;
    accumulatedAfter: string;
    bookValueAfter: string;
  }>;
}

export interface DepreciationRun {
  id: string;
  period: string;
  state: "posted" | "reversed";
  total: string;
  voucherId: string | null;
  voucherNumber: string | null;
  reversalPending: boolean;
}

export interface MyAsset {
  assignmentId: string;
  tag: string;
  name: string;
  serialNo: string | null;
  className: string;
  assignedOn: string;
  expectedReturn: string | null;
  note: string | null;
  acknowledgedAt: string | null;
  returnedOn: string | null;
}

export interface Store {
  id: string;
  code: string;
  name: string;
  keeperEmployeeId: string | null;
  keeperName: string | null;
  isActive: boolean;
}

export interface StockItem {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  unit: string;
  reorderLevel: string;
  isActive: boolean;
}

export interface StockBalance {
  storeId: string;
  storeCode: string;
  storeName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemNameBn: string | null;
  unit: string;
  quantity: string;
  reorderLevel: string;
  belowReorder: boolean;
}

export type StockRequestState =
  | "in_approval"
  | "approved"
  | "partially_issued"
  | "issued"
  | "rejected"
  | "cancelled";

export interface StockRequest {
  id: string;
  number: string;
  storeId: string;
  storeName?: string;
  requesterId: string;
  requesterCode?: string;
  requesterName?: string;
  departmentName?: string | null;
  note: string | null;
  state: StockRequestState;
  approvalRequestId: string | null;
  createdAt: string;
  lines?: Array<{
    itemId: string;
    itemCode: string;
    itemName: string;
    itemNameBn: string | null;
    unit: string;
    quantityRequested: string;
    quantityIssued: string;
    inStock?: string;
  }>;
}

export const ASSET_STATE_COLOR = {
  in_store: "gray",
  assigned: "blue",
  disposed: "red",
} as const;
export const STOCK_REQUEST_COLOR = {
  in_approval: "amber",
  approved: "blue",
  partially_issued: "amber",
  issued: "green",
  rejected: "red",
  cancelled: "gray",
} as const;
