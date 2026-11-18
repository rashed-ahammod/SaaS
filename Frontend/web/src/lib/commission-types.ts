/** Shapes of the commission, sales-assistant and Gate 3 APIs (Phase 3 WP31). */

export type CommissionBasis = "invoiced" | "collected";
export type CommissionRunState = "calculated" | "posted" | "cancelled";

export const COMMISSION_BASES: CommissionBasis[] = ["collected", "invoiced"];

export const RUN_STATE_COLOR = {
  calculated: "amber",
  posted: "green",
  cancelled: "gray",
} as const;

export interface CommissionRule {
  id: string;
  code: string;
  name: string;
  basis: CommissionBasis;
  ratePercent: string;
  minAttainment: string;
  bonusAttainment: string | null;
  bonusRatePercent: string | null;
  clawback: boolean;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  version: number;
}

export interface CommissionRunRow {
  id: string;
  companyId: string;
  period: string;
  ruleId: string;
  rule: Record<string, unknown>;
  state: CommissionRunState;
  total: string;
  postedAt: string | null;
  postedBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  version: number;
}

export interface CommissionRun extends CommissionRunRow {
  lines: Array<{
    id: string;
    userId: string;
    employeeId: string | null;
    name: string | null;
    employeeCode: string | null;
    basisAmount: string;
    targetAmount: string | null;
    attainment: string | null;
    ratePercent: string;
    amount: string;
    detail: {
      basis?: string;
      invoices?: Array<{ number: string; date: string; value: string }>;
      creditNotes?: Array<{ number: string; date: string; value: string }>;
      receipts?: Array<{
        receipt: string;
        invoice: string;
        date: string;
        amount: string;
      }>;
    };
    payrollVariableId: string | null;
  }>;
}

export interface MyCommission {
  months: Array<{
    id: string;
    period: string;
    runState: CommissionRunState;
    basisAmount: string;
    targetAmount: string | null;
    attainment: string | null;
    ratePercent: string;
    amount: string;
    paidThroughPayroll: boolean;
  }>;
}

export interface Gate3Report {
  companyId: string;
  from: string;
  to: string;
  met: number;
  total: number;
  allMet: boolean;
  checks: Array<{
    key: string;
    what: string;
    met: boolean;
    detail: Record<string, unknown>;
  }>;
}

export interface AssistResult {
  ask: "score" | "next_step" | "follow_up" | "quotation_text" | "call_note";
  score: number | null;
  reasons: string[];
  text: string | null;
  model: string;
  interactionId: string | null;
}
