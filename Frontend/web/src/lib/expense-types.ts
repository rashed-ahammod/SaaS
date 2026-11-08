/** Shapes of the expense claim and advance answers (Phase 2 WP16), shared by the app and the portal. */

export type ClaimState =
  | "draft"
  | "in_approval"
  | "approved"
  | "paid"
  | "settled"
  | "rejected"
  | "cancelled";
export type AdvanceState =
  "in_approval" | "approved" | "paid" | "settled" | "rejected" | "cancelled";

export interface ExpenseCategory {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  receiptRequiredAbove: string;
  isActive: boolean;
  version: number;
}

export interface ClaimSummary {
  id: string;
  companyId: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  number: string;
  title: string;
  advanceId: string | null;
  total: string;
  advanceApplied: string;
  payable: string;
  state: ClaimState;
  approvalRequestId: string | null;
  postingVoucherId: string | null;
  paymentVoucherId: string | null;
  submittedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  version: number;
}

export interface Claim extends ClaimSummary {
  employee: { id: string; code: string; name: string };
  lines: Array<{
    lineNo: number;
    expenseDate: string;
    categoryId: string;
    categoryCode: string;
    categoryName: string;
    description: string;
    amount: string;
    receiptId: string | null;
    receiptNeeded: boolean;
  }>;
  receipts: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    status: string;
  }>;
  postingVoucherNumber: string | null;
  payment: {
    voucherId: string;
    number: string;
    state: string;
    approvalRequestId: string | null;
  } | null;
}

export interface AdvanceSummary {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  number: string;
  purpose: string;
  amount: string;
  neededBy: string | null;
  state: AdvanceState;
  settled: string;
  open: string;
  approvalRequestId: string | null;
  voucherId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface Advance extends AdvanceSummary {
  employee: { id: string; code: string; name: string };
  payout: {
    voucherId: string;
    number: string;
    state: string;
    approvalRequestId: string | null;
  } | null;
  settlements: Array<{
    id: string;
    kind: "claim" | "refund" | "payroll";
    amount: string;
    state: string;
    at: string;
    claimNumber: string | null;
    voucherNumber: string | null;
    approvalRequestId: string | null;
  }>;
}

export interface AdvanceBalances {
  employees: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    salaryAdvances: string;
    cashAdvances: string;
    total: string;
    books: string;
    difference: string;
  }>;
  total: string;
  books: string;
}
