/**
 * Shapes of the ERP API answers the app uses (see backend controllers / services).
 */
export interface Me {
  id: string;
  email: string;
  phone: string | null;
  preferredLanguage: "bn" | "en";
  mfaEnabled: boolean;
  employeeId: string | null;
  roles: string[]; // e.g. ["employee:own", "dept_head:department"]
  /** Permission keys held in at least one scope (which screens to show; the API checks every request). */
  permissions: string[];
}

export interface Profile {
  id: string;
  companyId: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameBn: string | null;
  status: string;
  joinDate: string;
  phone: string | null;
  personalEmail: string | null;
  presentAddress: string | null;
  emergencyContact: { name: string | null; phone: string | null };
  probationEndDate: string | null;
  lastWorkingDay: string | null;
  confirmedAt: string | null;
  currentAssignment: {
    branch: { name?: string };
    department: { name?: string };
    designation: { nameEn?: string; nameBn?: string | null };
    lineManager: { fullNameEn?: string } | null;
  } | null;
  version: number;
}

export type DayStatus =
  | "present"
  | "late"
  | "half_day"
  | "absent"
  | "on_leave"
  | "holiday"
  | "weekend"
  | "missing_punch";

export interface AttendanceDay {
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  otMinutes?: number;
  otApprovedMinutes?: number;
  holidayName: string | null;
  locked?: boolean;
}

export interface AttendanceDays {
  days: AttendanceDay[];
  totals: Record<DayStatus, number>;
}

export interface Device {
  id: string;
  deviceId: string;
  name: string;
  status: "pending" | "active" | "revoked";
}

export interface Balance {
  leaveTypeId: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  usesBalance: boolean;
  balance: number;
  pending: number;
  available: number;
}

export interface LeaveType {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  allowHalfDay: boolean;
  documentRequiredOverDays?: number | null;
  isActive: boolean;
}

export interface LeaveRequest {
  id: string;
  from: string;
  to: string;
  halfDay: "first_half" | "second_half" | null;
  days: number;
  reason: string | null;
  state: "pending" | "approved" | "rejected" | "returned" | "cancelled";
  leaveType: { code: string; nameEn: string; nameBn: string | null };
  leaveTypeId?: string;
  documentId?: string | null;
  decisionComment?: string | null;
}

export interface LeavePreview {
  days: number;
  available: number | null;
  teamWarnings: Array<{
    date: string;
    onLeave: number;
    headcount: number;
    percent: number;
  }>;
}

export interface PayslipSummary {
  runId: string;
  period: string;
  runType: "regular" | "bonus" | "final_settlement";
  bonusName: string | null;
  gross: string;
  deductions: string;
  net: string;
}

export interface PayslipLine {
  head: string;
  amount: string;
  forPeriod?: string;
}

export interface Payslip {
  runId: string;
  period: string;
  runType: PayslipSummary["runType"];
  bonusName: string | null;
  employee: { code: string; fullNameEn: string; fullNameBn: string | null };
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  gross: string;
  totalDeductions: string;
  net: string;
}

export interface InboxItem {
  requestId: string;
  requestType: string;
  summary: string;
  amount: string | null;
  days: string | null;
  step: number;
  submittedAt: string;
  onBehalfOf: string | null;
  escalationAt: string;
  /** The deadline has passed, by the server's clock. */
  overdue?: boolean;
}

export interface ApprovalRequest {
  id: string;
  requestType: string;
  summary: string;
  state: string;
  currentStep: number;
  submittedAt: string;
  snapshot: Record<string, unknown>;
  history: Array<{
    action: string;
    step: number | null;
    comment: string | null;
    at: string;
    actorName?: string | null;
    onBehalfOfName?: string | null;
  }>;
  requesterUserId?: string;
  requesterName?: string | null;
  chainName?: string;
  /** The chain as configured: how many steps there are, and who each one asks. */
  steps?: Array<{
    approverRule: string;
    mode?: "any" | "all";
    reminderHours?: number;
    escalationHours?: number;
  }>;
  approvers?: Array<{
    step: number;
    slot?: number;
    userId: string;
    name?: string | null;
    assignedBecause?: string | null;
    status: string;
    actedAt?: string | null;
    escalationAt?: string | null;
    overdue?: boolean;
  }>;
}

/** GET /approvals/requests — every request of the company (approvals.view_all). */
export interface CompanyApprovalRequest {
  id: string;
  requestType: string;
  summary: string;
  state: string;
  currentStep: number;
  amount: string | null;
  days: number | null;
  submittedAt: string;
  completedAt: string | null;
  requesterName: string | null;
  chainName: string | null;
  escalationAt: string | null;
  overdue: boolean;
}

export interface Inbox {
  unread: number;
  items: Array<{
    id: string;
    kind: string;
    title: string;
    text: string;
    link: string | null;
    createdAt: string;
    read: boolean;
  }>;
}

/** GET /ai/status (WP11): which AI features to show; hidden when not available. */
export interface AiStatus {
  assistant: { available: boolean; reason?: string };
  payrollFlagExplanations: { available: boolean; reason?: string };
}

/** POST /ai/assistant */
export interface AssistantAnswer {
  interactionId: string;
  answer: string;
  refused: boolean;
  sources: Array<{ title: string; heading: string }>;
  toolsUsed: string[];
  language: "bn" | "en";
}

/** GET /me/consents (WP12): consent for biometric, location and selfie attendance data. */
export interface Consent {
  purpose: "biometric_attendance" | "location_attendance" | "selfie_attendance";
  status: "none" | "granted" | "withdrawn";
  since: string | null;
  givenUnder: string | null;
  notice: { version: string; en: string; bn: string };
}
