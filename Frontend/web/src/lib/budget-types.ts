/** Shapes of the budgets API (WP18). Money is a string. */

export type BudgetStatus = "within" | "warning" | "over";

export interface Position {
  budget: string;
  actual: string;
  committed: string;
  used: string;
  available: string;
  percent: string | null;
  status: BudgetStatus;
}

export interface BudgetLine extends Position {
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
}

export interface BudgetSummary {
  id: string;
  companyId: string;
  fiscalYear: string;
  departmentId: string;
  departmentCode?: string;
  departmentName?: string;
  state: "draft" | "in_approval" | "approved" | "cancelled";
  total: string;
  note: string | null;
  approvalRequestId: string | null;
  version: number;
  position: Position | null;
}

export interface Budget extends BudgetSummary {
  warningPercent: string;
  fiscalYearFrom: string;
  fiscalYearTo: string;
  lines: BudgetLine[];
  unbudgeted: BudgetLine[];
  revisions: Array<{
    id: string;
    reason: string;
    state: "in_approval" | "approved" | "rejected" | "cancelled";
    approvalRequestId: string | null;
    createdAt: string;
    lines: Array<{
      accountId: string;
      accountCode: string | null;
      oldAmount: string;
      newAmount: string;
    }>;
  }>;
  canRequestChange: boolean;
}

export interface BudgetReport {
  fiscalYear: string;
  from: string;
  to: string;
  departments: Array<{
    departmentId: string;
    departmentCode: string;
    departmentName: string;
    budgetId: string | null;
    total: Position;
    lines: BudgetLine[];
  }>;
  totals: { budget: string; actual: string; committed: string };
}

export interface BudgetCheck {
  status: "within" | "warning" | "over" | "no_budget" | "not_used";
  needsAdmin: boolean;
  fiscalYear: string;
  lines: Array<{
    accountId: string | null;
    amount: string;
    before: Position | null;
    after: Position | null;
  }>;
}

export const BUDGET_STATUS_COLOR = {
  within: "green",
  warning: "amber",
  over: "red",
  no_budget: "gray",
  not_used: "gray",
} as const;
export const BUDGET_STATE_COLOR = {
  draft: "gray",
  in_approval: "amber",
  approved: "green",
  cancelled: "gray",
} as const;
