/** Shapes of the recruitment API (Phase 3 WP29: plan, posts, openings, applicants, offers). */

export type EmploymentType =
  | "permanent"
  | "contract"
  | "probation_only"
  | "intern"
  | "part_time";
export type PositionRequestState =
  | "in_approval"
  | "approved"
  | "rejected"
  | "cancelled"
  | "opened";
export type JobOpeningState = "open" | "on_hold" | "filled" | "closed";
export type PostingChannel =
  | "website"
  | "facebook"
  | "notice_board"
  | "referral"
  | "newspaper"
  | "agency"
  | "other";
export type ApplicantSource =
  | "website"
  | "facebook"
  | "referral"
  | "agency"
  | "walk_in"
  | "newspaper"
  | "other";
export type ApplicationState =
  | "applied"
  | "screened"
  | "shortlisted"
  | "interviewing"
  | "offered"
  | "hired"
  | "rejected"
  | "withdrawn";
export type InterviewKind = "phone" | "in_person" | "online" | "written_test";
export type Recommendation = "hire" | "no_hire" | "hold";
export type OfferState =
  | "draft"
  | "in_approval"
  | "approved"
  | "sent"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "expired";

export const EMPLOYMENT_TYPES: EmploymentType[] = [
  "permanent",
  "contract",
  "probation_only",
  "intern",
  "part_time",
];
export const POSTING_CHANNELS: PostingChannel[] = [
  "facebook",
  "website",
  "notice_board",
  "referral",
  "newspaper",
  "agency",
  "other",
];
export const APPLICANT_SOURCES: ApplicantSource[] = [
  "website",
  "facebook",
  "referral",
  "agency",
  "walk_in",
  "newspaper",
  "other",
];
export const INTERVIEW_KINDS: InterviewKind[] = [
  "in_person",
  "phone",
  "online",
  "written_test",
];
export const RECOMMENDATIONS: Recommendation[] = ["hire", "no_hire", "hold"];

export const APPLICATION_STATE_COLOR = {
  applied: "blue",
  screened: "blue",
  shortlisted: "amber",
  interviewing: "amber",
  offered: "amber",
  hired: "green",
  rejected: "gray",
  withdrawn: "gray",
} as const;

export const OPENING_STATE_COLOR = {
  open: "green",
  on_hold: "amber",
  filled: "blue",
  closed: "gray",
} as const;

export const POSITION_STATE_COLOR = {
  in_approval: "amber",
  approved: "green",
  opened: "blue",
  rejected: "red",
  cancelled: "gray",
} as const;

export const OFFER_STATE_COLOR = {
  draft: "gray",
  in_approval: "amber",
  approved: "blue",
  sent: "amber",
  accepted: "green",
  declined: "red",
  withdrawn: "gray",
  expired: "gray",
} as const;

export interface ManpowerPlan {
  fiscalYear: string;
  plan: {
    id: string;
    state: "draft" | "approved";
    note: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
    version: number;
  } | null;
  lines: Array<{
    id: string;
    departmentId: string;
    departmentName: string;
    designationId: string;
    designationName: string;
    headcount: number;
    filled: number;
    requested: number;
    left: number;
  }>;
}

export interface PositionRequestRow {
  id: string;
  number: string;
  state: PositionRequestState;
  headcount: number;
  employmentType: EmploymentType;
  withinPlan: boolean;
  reason: string;
  departmentId: string;
  departmentName: string;
  designationName: string;
  approvalRequestId: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface PositionRequest extends Omit<PositionRequestRow, "departmentName" | "designationName"> {
  companyId: string;
  designationId: string;
  gradeId: string;
  branchId: string;
  replacementFor: string | null;
  plan: {
    planned: number | null;
    requested: number;
    filled: number;
    left: number | null;
    fiscalYear: string;
    reason: string;
  };
  departmentName: string | null;
  designationName: string | null;
  gradeName: string | null;
  branchName: string | null;
  opening: { id: string; number: string; state: JobOpeningState } | null;
  version: number;
}

export interface OpeningRow {
  id: string;
  number: string;
  title: string;
  openings: number;
  state: JobOpeningState;
  closingOn: string | null;
  departmentName: string;
  designationName: string;
  employmentType: EmploymentType;
  applications: number;
  createdAt: string;
}

export interface Opening {
  id: string;
  number: string;
  companyId: string;
  positionRequestId: string;
  title: string;
  titleBn: string | null;
  description: string;
  requirements: string[];
  openings: number;
  closingOn: string | null;
  state: JobOpeningState;
  closeReason: string | null;
  createdAt: string;
  version: number;
  positionRequest: {
    id: string;
    number: string;
    withinPlan: boolean;
    headcount: number;
    employmentType: EmploymentType;
  };
  departmentName: string | null;
  designationName: string | null;
  gradeName: string | null;
  branchName: string | null;
  postings: Array<{
    id: string;
    channel: PostingChannel;
    postedOn: string;
    reference: string | null;
  }>;
  applications: Array<{
    id: string;
    applicantId: string;
    name: string | null;
    district: string | null;
    state: ApplicationState;
    appliedOn: string;
    screeningScore: number | null;
  }>;
}

export interface Applicant {
  id: string;
  companyId: string;
  name: string | null;
  nameBn: string | null;
  phone: string | null;
  email: string | null;
  district: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  source: ApplicantSource;
  sourceDetail: string | null;
  referredBy: string | null;
  cvFileName: string | null;
  hasCvText: boolean;
  consentAt: string;
  consentVersion: string;
  retentionUntil: string;
  redacted: boolean;
  createdAt: string;
  version: number;
}

export interface Application {
  id: string;
  state: ApplicationState;
  appliedOn: string;
  rejectedReason: string | null;
  hiredEmployeeId: string | null;
  version: number;
  applicant: Applicant;
  opening: {
    id: string;
    number: string;
    title: string;
    requirements: string[];
    state: JobOpeningState;
  };
  events: Array<{
    id: string;
    from: string | null;
    to: string;
    note: string | null;
    byUserId: string | null;
    at: string;
  }>;
  screenings: Array<{
    id: string;
    score: number;
    reasons: string[];
    model: string;
    promptVersion: string;
    at: string;
  }>;
  interviews: Array<{
    id: string;
    roundNo: number;
    kind: InterviewKind;
    scheduledAt: string;
    place: string | null;
    state: string;
    outcome: string | null;
  }>;
  offer: {
    id: string;
    number: string;
    state: OfferState;
    joiningOn: string;
    validUntil: string;
  } | null;
}

export interface Interview {
  id: string;
  applicationId: string;
  roundNo: number;
  kind: InterviewKind;
  scheduledAt: string;
  place: string | null;
  state: string;
  outcome: string | null;
  panelUserIds: string[];
  iAmOnPanel: boolean;
  scorecards: Array<{
    id: string;
    interviewerId: string;
    scores: Record<string, number>;
    overall: number;
    recommendation: Recommendation;
    notes: string | null;
    at: string;
  }>;
  version: number;
}

export interface MyInterviewRow {
  id: string;
  roundNo: number;
  kind: InterviewKind;
  scheduledAt: string;
  place: string | null;
  state: string;
  openingNumber: string;
  openingTitle: string;
  myScorecardGiven: boolean;
}

export interface Offer {
  id: string;
  number: string;
  companyId: string;
  applicationId: string;
  applicantName: string | null;
  branchId: string;
  branchName: string | null;
  departmentId: string;
  departmentName: string | null;
  designationId: string;
  designationName: string | null;
  gradeId: string;
  gradeName: string | null;
  /** null when the viewer may not see salaries */
  grossSalary: string | null;
  outsideGradeRange: boolean;
  approvalRequestId: string | null;
  joiningOn: string;
  probationMonths: number;
  validUntil: string;
  terms: string | null;
  state: OfferState;
  declineReason: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  version: number;
}

export interface Screening {
  id?: string;
  applicationId: string;
  score: number | null;
  reasons: string[];
  /** What was taken out of the CV before the model saw it. */
  removed: string[];
  model: string;
  interactionId: string | null;
  at?: string;
}
