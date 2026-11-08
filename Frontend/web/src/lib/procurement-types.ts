/** Shapes of the procurement API (WP17). Money and quantities are strings. */

export type RequisitionState =
  "draft" | "in_approval" | "approved" | "ordered" | "rejected" | "cancelled";
export type OrderState =
  | "draft"
  | "in_approval"
  | "issued"
  | "partially_received"
  | "received"
  | "cancelled";
export type MatchStatus =
  "not_required" | "matched" | "mismatch" | "overridden";

export interface RequisitionSummary {
  id: string;
  companyId: string;
  number: string;
  title: string;
  neededBy: string | null;
  estimatedTotal: string;
  state: RequisitionState;
  csState: "none" | "in_approval" | "approved";
  departmentId: string | null;
  createdAt: string;
  version: number;
  requesterCode?: string;
  requesterName?: string;
  departmentName?: string | null;
  purchaseOrder?: { number: string; state: OrderState } | null;
}

export interface Quotation {
  id: string;
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  reference: string;
  quotationDate: string;
  validUntil: string | null;
  deliveryDays: number | null;
  note: string | null;
  baseTotal: string;
  vatTotal: string;
  total: string;
  state: "active" | "withdrawn";
  lowest: boolean;
  selected: boolean;
  lines: Array<{
    requisitionLineId: string;
    unitPrice: string;
    vatPercent: string;
  }>;
}

export interface Requisition extends RequisitionSummary {
  justification: string;
  requester: { id: string; code: string; name: string };
  departmentName: string | null;
  approvalRequestId: string | null;
  lines: Array<{
    id: string;
    lineNo: number;
    description: string;
    quantity: string;
    unit: string;
    estimatedUnitPrice: string;
  }>;
  quotations: Quotation[];
  comparativeStatement: {
    needed: boolean;
    minQuotations: number;
    state: "none" | "in_approval" | "approved";
    selectedQuotationId: string | null;
    reason: string | null;
    approvalRequestId: string | null;
  };
  purchaseOrder: { id: string; number: string; state: OrderState } | null;
  budget: {
    status: import("./budget-types").BudgetCheck["status"];
    check: import("./budget-types").BudgetCheck;
  } | null;
}

export interface OrderSummary {
  id: string;
  companyId: string;
  number: string;
  requisitionId: string;
  vendorId: string;
  orderDate: string;
  deliveryDate: string | null;
  baseTotal: string;
  vatTotal: string;
  total: string;
  state: OrderState;
  vendorCode?: string;
  vendorName?: string;
  requisitionNumber?: string;
  title?: string;
}

export interface Order extends OrderSummary {
  vendor: {
    id: string;
    code: string;
    name: string;
    tin: string | null;
    bin: string | null;
    address: string | null;
  };
  requisition: { id: string; number: string; title: string };
  departmentName: string | null;
  deliverTo: string | null;
  terms: string | null;
  cancelReason: string | null;
  approvalRequestId: string | null;
  budget: import("./budget-types").BudgetCheck | null;
  lines: Array<{
    id: string;
    lineNo: number;
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    vatPercent: string;
    amount: string;
    accountId: string;
    accountCode: string | null;
    accountName: string | null;
    received: string;
    billed: string;
    toReceive: string;
  }>;
  receipts: Array<{
    id: string;
    number: string;
    receivedDate: string;
    note: string | null;
    state: "active" | "cancelled";
    cancelReason: string | null;
    recordedBy: string | null;
    lines: Array<{ poLineId: string; quantity: string }>;
  }>;
  bills: Array<{
    id: string;
    billNo: string;
    billDate: string;
    state: string;
    total: string;
    netPayable: string;
    paidAmount: string;
    matchStatus: MatchStatus;
  }>;
}

export interface ProcurementSettings {
  quotationThreshold: string;
  minQuotations: number;
  adminThreshold: string;
  matchTolerancePercent: string;
}

export interface MatchDetails {
  status: "matched" | "mismatch";
  tolerancePercent: string;
  lines: Array<{
    poLineId: string;
    description: string;
    orderedQty: string;
    receivedQty: string;
    billedTotalQty: string;
    billQty: string;
    poUnitPrice: string;
    billUnitPrice: string;
    maxUnitPrice: string;
    problems: string[];
  }>;
}

export const REQ_STATE_COLOR: Record<
  RequisitionState,
  "gray" | "amber" | "green" | "blue" | "red"
> = {
  draft: "gray",
  in_approval: "amber",
  approved: "green",
  ordered: "blue",
  rejected: "red",
  cancelled: "gray",
};
export const ORDER_STATE_COLOR: Record<
  OrderState,
  "gray" | "amber" | "green" | "blue" | "red"
> = {
  draft: "gray",
  in_approval: "amber",
  issued: "blue",
  partially_received: "amber",
  received: "green",
  cancelled: "gray",
};
export const MATCH_COLOR: Record<
  MatchStatus,
  "gray" | "amber" | "green" | "blue" | "red"
> = {
  not_required: "gray",
  matched: "green",
  mismatch: "red",
  overridden: "amber",
};
