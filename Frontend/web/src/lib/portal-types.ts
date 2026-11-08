/** Shapes of the API answers the HR / Admin portal uses (WP13). */

export interface Placement {
  effectiveFrom: string;
  effectiveTo: string | null;
  branch: { id: string; code?: string; name?: string };
  department: { id: string; code?: string; name?: string };
  designation: {
    id: string;
    code?: string;
    nameEn?: string;
    nameBn?: string | null;
  };
  grade: { id: string; code?: string; name?: string };
  lineManager: {
    id: string;
    employeeCode?: string;
    fullNameEn?: string;
  } | null;
}

export interface EmployeeSummary {
  id: string;
  companyId: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameBn: string | null;
  status: "draft" | "probation" | "active" | "notice" | "separated";
  joinDate: string;
  currentAssignment: Placement | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface RunSummary {
  id: string;
  companyId: string;
  period: string;
  runType: "regular" | "bonus" | "final_settlement";
  state:
    | "draft"
    | "calculated"
    | "in_approval"
    | "verified"
    | "approved"
    | "disbursed"
    | "cancelled";
  bonusName: string | null;
  headcount: number;
  totals: {
    gross: string;
    deductions: string;
    net: string;
    tax: string;
    employerCost: string;
  };
  approvalRequestId: string | null;
  calculatedAt: string | null;
  approvedAt: string | null;
  cancelledReason: string | null;
}

export interface RunFlag {
  id: string;
  employeeId: string;
  employeeCode: string;
  code: string;
  message: string | null;
  cleared: boolean;
  clearReason: string | null;
}

export interface RunDetail extends RunSummary {
  flags: RunFlag[];
  openFlags: number;
  employees:
    | Array<{
        employeeId: string;
        employeeCode: string;
        fullNameEn: string;
        gross: string;
        deductions: string;
        net: string;
        tax: string;
        employerCost: string;
      }>
    | string;
}

export interface Gate1 {
  companyId: string;
  requiredMonths: number;
  acceptedMonths: string[];
  gate1Passed: boolean;
  comparisons: ComparisonSummary[];
}

export interface ComparisonSummary {
  id: string;
  runId: string;
  period: string;
  fileName: string;
  tolerance: string;
  employees: number;
  matched: number;
  different: number;
  missingInErp: number;
  missingInLegacy: number;
  totals: { legacy: Record<string, string>; erp: Record<string, string> };
  status: "open" | "accepted";
  outdated: boolean;
  createdAt: string;
  acceptedAt: string | null;
  acceptanceNote: string | null;
}

export interface ComparisonLine {
  employeeCode: string;
  employeeId: string | null;
  outcome: "match" | "different" | "missing_in_erp" | "missing_in_legacy";
  legacy: Record<string, string> | null;
  erp: Record<string, string> | null;
  differences: Record<string, string>;
  explanation: string | null;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  weekendDays: string[];
  geoFence: { lat: number; lng: number; radiusM: number } | null;
  holidayCalendarId: string | null;
  isActive?: boolean;
  version: number;
}
export interface Department {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  costCentreCode: string | null;
  headEmployeeId: string | null;
  depth?: number;
  isActive?: boolean;
  version: number;
}
export interface Designation {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  isActive?: boolean;
  version: number;
}
export interface Grade {
  id: string;
  code: string;
  name: string;
  rank: number;
  otEligible: boolean;
  salaryMin: string | null;
  salaryMax: string | null;
  isActive?: boolean;
  version: number;
}

/** A data-migration upload (WP8). */
export interface Batch {
  id: string;
  entity: string;
  fileName: string;
  cutOverDate: string;
  state: "validated" | "committed" | "rolled_back" | "signed_off" | "discarded";
  counts: { total: number; valid: number; errors: number; skipped: number };
  createdAt: string;
}

/** The portal home screen in one answer (GET /companies/:id/portal/overview). */
export interface PortalOverview {
  companyId: string;
  setup: {
    steps: Array<{ key: string; done: boolean; count: number; href: string }>;
    done: number;
    total: number;
    complete: boolean;
  };
  attention: Array<{
    key: string;
    count: number;
    tone: "warn" | "info";
    href: string;
  }>;
}
