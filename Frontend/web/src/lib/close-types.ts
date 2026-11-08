/** Shapes of the finance close and Gate 2 API (WP22). Money is a string. */

export interface CashFlow {
  from: string;
  to: string;
  openingCash: string;
  sections: Array<{
    activity: "operating" | "investing" | "financing";
    rows: Array<{
      accountId: string;
      code: string;
      name: string;
      inflow: string;
      outflow: string;
      net: string;
    }>;
    net: string;
  }>;
  netChange: string;
  closingCash: string;
  difference: string;
}

export interface DepartmentCost {
  from: string;
  to: string;
  groups: Array<{ id: string; code: string; name: string }>;
  rows: Array<{
    departmentId: string | null;
    code: string | null;
    name: string | null;
    amounts: Record<string, string>;
    total: string;
  }>;
  totals: Record<string, string>;
  total: string;
}

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "over_90";

export interface ReceivablesAging {
  asOf: string;
  buckets: AgingBucket[];
  customers: Array<
    { customer: string } & Record<AgingBucket | "total", string>
  >;
  totals: Record<AgingBucket | "total", string>;
}

export interface ReceivableItem {
  id: string;
  customerName: string;
  reference: string;
  invoiceDate: string;
  dueDate: string;
  amount: string;
  received: string;
  outstanding: string;
  pendingReceipts: string;
  fromOpening: boolean;
  /** WP26: a customer invoice (paid through customer receipts) */
  salesInvoiceId?: string | null;
  customerId?: string | null;
  credited?: string;
}

export interface Checklist {
  period: string;
  from: string;
  to: string;
  state: "open" | "closed";
  ready: boolean;
  items: Array<{
    key: string;
    kind: "auto" | "manual";
    ok: boolean;
    notApplicable?: boolean;
    detail: string | null;
    doneBy?: string | null;
    doneAt?: string | null;
  }>;
}

export interface Gate2Report {
  month: string | null;
  cutOverDate: string | null;
  comparisonId: string | null;
  passed: boolean;
  criteria: Array<{ key: string; ok: boolean; detail: string | null }>;
}

export interface OpeningStatus {
  imports: Array<{
    id: string;
    cutOverDate: string;
    fileName: string;
    totalDebit: string;
    state: "in_approval" | "posted" | "cancelled";
    rows: number;
    voucherId: string | null;
    voucherNumber: string | null;
    createdAt: string;
  }>;
  mappedOldAccounts: number;
}

export interface AccountMapRow {
  oldCode: string;
  oldName: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
}

export interface Comparison {
  id: string;
  asOf: string;
  fileName: string;
  differences: number;
  unmapped: number;
  matched: boolean;
  note: string | null;
  createdAt: string;
  lines?: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    oldCodes: string[];
    oldBalance: string;
    ourBalance: string;
    difference: string;
  }>;
  unmappedAccounts?: Array<{
    oldCode: string;
    oldName: string | null;
    balance: string;
  }>;
}

export interface ReadDocument {
  kind: "bill" | "receipt";
  readable: boolean;
  fields: {
    vendorName: string | null;
    vendorBin: string | null;
    documentNo: string | null;
    date: string | null;
    lines: Array<{
      description: string;
      amount: string;
      vatPercent: string | null;
    }>;
    subtotal: string | null;
    vat: string | null;
    total: string | null;
  } | null;
  warnings: string[];
  vendor: {
    id: string;
    code: string;
    name: string;
    matchedBy: "bin" | "name";
  } | null;
}
