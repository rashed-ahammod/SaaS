/** Shapes of the performance API (Phase 3 WP30: cycles, appraisals, feedback, proposals). */

export type CycleKind = "annual" | "half_yearly";
export type CycleState =
  | "draft"
  | "goals"
  | "self_review"
  | "manager_review"
  | "calibration"
  | "proposals"
  | "closed";
export type AppraisalState =
  | "goals"
  | "self_review"
  | "manager_review"
  | "calibration"
  | "done";
export type KpiMeasure = "number" | "percent" | "taka" | "date" | "judgement";
export type FeedbackKind = "note" | "praise" | "concern" | "coaching";
export type ProposalKind = "increment" | "promotion" | "both";
export type ProposalState =
  | "in_approval"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "applied";

export const CYCLE_KINDS: CycleKind[] = ["annual", "half_yearly"];
export const KPI_MEASURES: KpiMeasure[] = [
  "number",
  "percent",
  "taka",
  "date",
  "judgement",
];
export const FEEDBACK_KINDS: FeedbackKind[] = [
  "note",
  "praise",
  "concern",
  "coaching",
];
export const PROPOSAL_KINDS: ProposalKind[] = [
  "increment",
  "promotion",
  "both",
];

export const CYCLE_STATE_COLOR = {
  draft: "gray",
  goals: "blue",
  self_review: "blue",
  manager_review: "amber",
  calibration: "amber",
  proposals: "amber",
  closed: "green",
} as const;

export const APPRAISAL_STATE_COLOR = {
  goals: "gray",
  self_review: "blue",
  manager_review: "amber",
  calibration: "amber",
  done: "green",
} as const;

export const PROPOSAL_STATE_COLOR = {
  in_approval: "amber",
  approved: "blue",
  rejected: "red",
  withdrawn: "gray",
  applied: "green",
} as const;

export const FEEDBACK_COLOR = {
  note: "gray",
  praise: "green",
  concern: "red",
  coaching: "blue",
} as const;

export interface Cycle {
  id: string;
  companyId: string;
  name: string;
  kind: CycleKind;
  periodFrom: string;
  periodTo: string;
  state: CycleState;
  incrementFrom: string | null;
  note: string | null;
  createdAt: string;
  version: number;
}

export interface CycleRow extends Cycle {
  appraisals: number;
}

export interface CycleDetail extends Cycle {
  appraisals: Array<{
    id: string;
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    departmentName: string | null;
    managerEmployeeId: string | null;
    state: AppraisalState;
    managerRating: number | null;
    calibratedRating: number | null;
  }>;
}

export interface Goal {
  id: string;
  kpiId: string | null;
  kpiCode: string | null;
  measure: KpiMeasure | null;
  title: string;
  target: string | null;
  weight: number;
  selfScore: number | null;
  selfNote: string | null;
  managerScore: number | null;
  managerNote: string | null;
}

export interface Appraisal {
  id: string;
  cycle: Cycle;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  managerEmployeeId: string | null;
  departmentId: string | null;
  state: AppraisalState;
  goals: Goal[];
  weights: number;
  weightedScore: number | null;
  suggestedRating: number | null;
  selfReview: string | null;
  selfSubmittedAt: string | null;
  managerRating: number | null;
  managerComment: string | null;
  managerSubmittedAt: string | null;
  calibratedRating: number | null;
  calibrationNote: string | null;
  calibratedAt: string | null;
  finalRating: number | null;
  proposal: {
    id: string;
    kind: ProposalKind;
    state: ProposalState;
    effective_from?: string;
    effectiveFrom?: string;
  } | null;
  version: number;
}

export interface TeamAppraisalRow {
  id: string;
  employeeCode: string;
  employeeName: string;
  state: AppraisalState;
  selfReviewDone: boolean;
  managerRating: number | null;
  calibratedRating: number | null;
}

export interface CalibrationView {
  cycle: Cycle;
  departments: Array<{
    departmentId: string | null;
    departmentName: string | null;
    counts: Record<string, number>;
    rated: number;
    calibrated: number;
  }>;
}

export interface Kpi {
  id: string;
  code: string;
  title: string;
  titleBn: string | null;
  description: string | null;
  measure: KpiMeasure;
  designationId: string | null;
  defaultWeight: number;
  isActive: boolean;
  version: number;
}

export interface FeedbackNote {
  id: string;
  body: string;
  kind: FeedbackKind;
  sharedWithEmployee: boolean;
  authorUserId: string | null;
  at: string;
}

export interface ProposalRow {
  id: string;
  kind: ProposalKind;
  state: ProposalState;
  employeeCode: string;
  employeeName: string;
  /** null when the viewer may not see salaries */
  newGross: string | null;
  effectiveFrom: string;
  justification: string;
  appraisalId: string;
  approvalRequestId: string | null;
  appliedAt: string | null;
}

export interface Proposal {
  id: string;
  companyId: string;
  appraisalId: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  kind: ProposalKind;
  newGross: string | null;
  structureId: string | null;
  newDesignationId: string | null;
  newDesignationName: string | null;
  newGradeId: string | null;
  newGradeName: string | null;
  effectiveFrom: string;
  justification: string;
  state: ProposalState;
  approvalRequestId: string | null;
  appliedSalaryId: string | null;
  appliedEventId: string | null;
  appliedAt: string | null;
  createdAt: string;
  version: number;
}

export interface ReviewDraft {
  appraisalId: string;
  draft: string;
  model: string;
  interactionId: string | null;
}
