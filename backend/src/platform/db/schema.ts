/**
 * TypeScript shape of the database tables, used by Kysely for type-checked queries.
 *
 * Keep this file in step with db/migrations. Column names stay snake_case so the
 * code reads the same as the SQL.
 *
 * Type conventions (see pg-types.ts):
 *   NUMERIC   -> string   (convert with Money.of(); never a JS number)
 *   DATE      -> string   'YYYY-MM-DD' business date (Asia/Dhaka calendar)
 *   TIMESTAMPTZ -> Date   (UTC instant)
 *   BIGINT    -> number   (checked to be a safe integer)
 */
import type {
  ColumnType,
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from 'kysely';

/** A column the database fills in (default) but that can be set explicitly. */
type Defaulted<T> = ColumnType<T, T | undefined, T>;
/** JSON column. */
export type Json = unknown;

export interface TenantsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  plan_tier: Defaulted<'core' | 'business' | 'intelligent'>;
  status: Defaulted<'trial' | 'active' | 'suspended' | 'closed'>;
  data_region: Defaulted<string>;
  created_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  email: string;
  phone: string | null;
  password_hash: string;
  mfa_secret: string | null;
  mfa_enabled: Defaulted<boolean>;
  mfa_last_time_step: number | null;
  status: Defaulted<'invited' | 'active' | 'disabled'>;
  preferred_language: Defaulted<'bn' | 'en'>;
  employee_id: string | null;
  failed_login_count: Defaulted<number>;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface AuditLogTable {
  tenant_id: Defaulted<string>;
  seq: number;
  occurred_at: Date;
  actor_user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Json | null;
  after: Json | null;
  ip: string | null;
  device: string | null;
  prev_hash: string;
  hash: string;
}

export interface OutboxEventsTable {
  id: Generated<string>;
  seq: Generated<number>;
  tenant_id: Defaulted<string>;
  type: string;
  entity_id: string | null;
  payload: Json;
  status: Defaulted<'pending' | 'sent' | 'dead'>;
  attempts: Defaulted<number>;
  next_attempt_at: Defaulted<Date>;
  last_error: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  sent_at: Date | null;
}

export interface IdempotencyKeysTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  key: string;
  user_id: string | null;
  endpoint: string;
  request_hash: string;
  response_status: number | null;
  response_body: Json | null;
  created_at: Generated<Date>;
}

// ------------------------------------------------------- organization (0004) --

/** Columns every editable tenant table has. */
interface EditableColumns {
  tenant_id: Defaulted<string>;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface CompaniesTable extends EditableColumns {
  id: Generated<string>;
  legal_name: string;
  short_name: string | null;
  tin: string | null;
  bin: string | null;
  fiscal_year_start: Defaulted<string>;
  base_currency: Defaulted<string>;
  employee_code_prefix: Defaulted<string>;
  next_employee_number: Defaulted<number>;
  probation_months: Defaulted<number>;
  notice_days_resignation: Defaulted<number>;
  notice_days_termination: Defaulted<number>;
  retirement_age: Defaulted<number>;
  attendance_correction_limit: Defaulted<number>;
  late_penalty_enabled: Defaulted<boolean>;
  late_penalty_every: Defaulted<number>;
  is_active: Defaulted<boolean>;
}

export type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

export interface BranchesTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  code: string;
  name: string;
  address: string | null;
  weekend_days: Defaulted<Weekday[]>;
  holiday_calendar_id: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_radius_m: number | null;
  is_active: Defaulted<boolean>;
}

export interface DepartmentsTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  cost_centre_code: string | null;
  head_employee_id: string | null;
  is_active: Defaulted<boolean>;
}

export interface DepartmentPathsTable {
  tenant_id: Defaulted<string>;
  ancestor_id: string;
  descendant_id: string;
  depth: number;
}

export interface DesignationsTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  is_active: Defaulted<boolean>;
}

export interface GradesTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  code: string;
  name: string;
  rank: Defaulted<number>;
  ot_eligible: Defaulted<boolean>;
  salary_min: string | null; // NUMERIC -> use Money.of()
  salary_max: string | null;
  is_active: Defaulted<boolean>;
}

// ---------------------------------------------------------- employees (0005) --

export type EmployeeStatus =
  'draft' | 'probation' | 'active' | 'notice' | 'separated';

export interface EmployeesTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  employee_code: string;
  full_name_en: string;
  full_name_bn: string | null;
  date_of_birth: string | null; // business date
  gender: 'male' | 'female' | 'other' | null;
  nid_encrypted: string | null;
  tin_encrypted: string | null;
  personal_email: string | null;
  phone: string | null;
  present_address: string | null;
  permanent_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  join_date: string;
  probation_end_date: string | null;
  status: Defaulted<EmployeeStatus>;
  festival_group: string | null;
  activated_at: Date | null;
  last_working_day: string | null; // set at resignation / separation (0011)
  confirmed_at: Date | null;
}

export type SeparationKind =
  | 'resignation'
  | 'termination'
  | 'retirement'
  | 'contract_end'
  | 'probation_end';
export type ClearanceItem =
  'it' | 'admin_assets' | 'accounts_advances' | 'dept_handover';
export type ProbationOutcome = 'confirm' | 'extend' | 'end';

export interface ProbationReviewsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  probation_end_date: string;
  reminded_at: Date | null;
  recommendation: ProbationOutcome | null;
  recommend_months: number | null;
  recommend_note: string | null;
  recommended_by: string | null;
  recommended_at: Date | null;
  decision: ProbationOutcome | null;
  decision_months: number | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Generated<Date>;
}

export interface SeparationsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  company_id: string;
  kind: SeparationKind;
  notice_date: string;
  last_working_day: string;
  required_notice_days: number;
  shortfall_days: number;
  reason: string;
  previous_status: 'probation' | 'active';
  state: Defaulted<'in_notice' | 'separated' | 'withdrawn'>;
  withdrawn_reason: string | null;
  separated_at: Date | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface SeparationClearancesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  separation_id: string;
  item: ClearanceItem;
  cleared_by: string | null;
  cleared_at: Date | null;
  note: string | null;
}

export type JobEventType =
  | 'joining'
  | 'transfer'
  | 'promotion'
  | 'redesignation'
  | 'grade_change'
  | 'manager_change';

export interface EmployeeJobEventsTable {
  id: Generated<string>;
  seq: Generated<number>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  effective_from: string;
  event_type: JobEventType;
  changes: Json;
  reason: string | null;
  status: Defaulted<'active' | 'cancelled'>;
  cancelled_reason: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface EmployeeAssignmentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  company_id: string;
  effective_from: string;
  effective_to: string | null;
  branch_id: string;
  department_id: string;
  designation_id: string;
  grade_id: string;
  line_manager_id: string | null;
  functional_manager_id: string | null;
  source_event_id: string;
  created_at: Generated<Date>;
}

export interface EmployeeDocumentsTable extends EditableColumns {
  id: Generated<string>;
  employee_id: string;
  doc_type: string;
  title: string | null;
  file_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  expires_on: string | null;
  status: Defaulted<'active' | 'removed'>;
  removed_reason: string | null;
}

export interface OnboardingChecklistsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  item_code: string;
  required: Defaulted<boolean>;
  sort_order: Defaulted<number>;
  done_at: Date | null;
  done_by: string | null;
  note: string | null;
  created_at: Generated<Date>;
}

// ----------------------------------------------------- access control (0006) --

export type SystemRoleKey =
  | 'admin'
  | 'system_admin'
  | 'hr'
  | 'accounts'
  | 'dept_head'
  | 'employee'
  | 'auditor'
  | 'sales';
export type ScopeType = 'own' | 'department' | 'company' | 'group';
export type FieldGroup = 'salary' | 'bank' | 'identity' | 'complaint';

export interface CustomRolesTable extends EditableColumns {
  id: Generated<string>;
  name_en: string;
  name_bn: string | null;
  based_on: SystemRoleKey;
  description: string | null;
  is_active: Defaulted<boolean>;
}

export interface CustomRolePermissionsTable {
  tenant_id: Defaulted<string>;
  role_id: string;
  permission_key: string;
}

export interface UserRolesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  user_id: string;
  system_role: SystemRoleKey | null;
  custom_role_id: string | null;
  scope_type: ScopeType;
  scope_id: string | null;
  expires_at: Date | null;
  granted_by: Defaulted<string | null>;
  granted_at: Generated<Date>;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export interface FieldGrantsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  user_id: string;
  field_group: FieldGroup;
  granted_by: Defaulted<string | null>;
  granted_at: Generated<Date>;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export interface DelegationsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  from_user_id: string;
  to_user_id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  revoked_at: Date | null;
  revoked_by: string | null;
}

export interface EmployeeBankAccountsTable extends EditableColumns {
  id: Generated<string>;
  employee_id: string;
  kind: 'bank' | 'wallet';
  provider: string;
  details_encrypted: string;
  status: Defaulted<
    'pending' | 'approved' | 'rejected' | 'cancelled' | 'retired'
  >;
  approval_request_id: string | null;
  approved_at: Date | null;
  retired_at: Date | null;
}

// ----------------------------------------------------------- approvals (0007) --

export interface ApprovalChainsTable extends EditableColumns {
  id: Generated<string>;
  request_type: string;
  name: string;
  conditions: Defaulted<Json>;
  priority: Defaulted<number>;
  is_active: Defaulted<boolean>;
}

export interface ApprovalChainStepsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  chain_id: string;
  step_no: number;
  approver_rule: string;
  mode: Defaulted<'any' | 'all'>;
  reminder_hours: Defaulted<number>;
  escalation_hours: Defaulted<number>;
}

export type ApprovalState =
  'in_approval' | 'executed' | 'rejected' | 'returned' | 'cancelled';

export interface ApprovalRequestsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  request_type: string;
  source_id: string;
  requester_user_id: string;
  subject_employee_id: string | null;
  company_id: string;
  chain_id: string | null;
  chain_name: string;
  steps: Json;
  current_step: Defaulted<number>;
  state: Defaulted<ApprovalState>;
  summary: string;
  amount: string | null;
  days: string | null;
  snapshot: Json;
  submitted_at: Generated<Date>;
  approved_at: Date | null;
  completed_at: Date | null;
  version: Generated<number>;
}

export type AssignmentStatus =
  'pending' | 'approved' | 'rejected' | 'returned' | 'superseded' | 'cancelled';

export interface ApprovalStepAssignmentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  request_id: string;
  step_no: number;
  slot: Defaulted<number>;
  approver_user_id: string;
  reason: string;
  status: Defaulted<AssignmentStatus>;
  acted_at: Date | null;
  remind_at: Date;
  escalate_at: Date;
  reminded_at: Date | null;
  escalated_at: Date | null;
  created_at: Generated<Date>;
}

export type ApprovalActionType =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'return'
  | 'cancel'
  | 'remind'
  | 'escalate'
  | 'execute';

export interface ApprovalActionsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  request_id: string;
  step_no: number | null;
  actor_user_id: string | null;
  on_behalf_of_user_id: string | null;
  action: ApprovalActionType;
  comment: string | null;
  ip: string | null;
  device: string | null;
  snapshot: Json;
  created_at: Generated<Date>;
}

// ----------------------------------------------------------- rule pack (0008) --
// Central tables (no tenant_id): read-only for the API, written by scripts/rules.ts.

export type RuleValueType =
  'integer' | 'decimal' | 'money' | 'boolean' | 'text' | 'json';

export interface RulePacksTable {
  id: Generated<string>;
  code: string;
  version: string;
  title: string;
  notes: string | null;
  status: Defaulted<'published' | 'retired'>;
  published_at: Generated<Date>;
  published_by: string;
}

export interface RuleValuesTable {
  id: Generated<string>;
  pack_id: string;
  rule_key: string;
  value_type: RuleValueType;
  value: Json;
  unit: string | null;
  description_en: string;
  description_bn: string | null;
  effective_from: string;
  effective_to: string | null;
  source_url: string | null;
  source_note: string | null;
  status: Defaulted<'verify' | 'verified'>;
  verified_by: string | null;
  verified_at: Date | null;
}

export interface RuleValueHistoryTable {
  id: Generated<string>;
  rule_value_id: string;
  action: 'published' | 'verified' | 'unverified';
  by_name: string;
  source_url: string | null;
  note: string | null;
  at: Generated<Date>;
}

export interface TenantRulePacksTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  pack_id: string;
  effective_from: string;
  accepted_by: Defaulted<string | null>;
  accepted_at: Generated<Date>;
  note: string | null;
}

// ------------------------------------------------- calendar + attendance (0009) --

export interface HolidayCalendarsTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  name: string;
  is_active: Defaulted<boolean>;
}

export type HolidayType = 'public' | 'festival' | 'company';

export interface HolidaysTable extends EditableColumns {
  id: Generated<string>;
  calendar_id: string;
  holiday_date: string;
  name_en: string;
  name_bn: string | null;
  holiday_type: HolidayType;
  is_active: Defaulted<boolean>;
  removed_reason: string | null;
}

export interface ShiftsTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  code: string;
  name: string;
  start_time: string; // 'HH:MM:SS' Dhaka local
  end_time: string;
  grace_minutes: Defaulted<number>;
  half_day_minutes: Defaulted<number>;
  is_default: Defaulted<boolean>;
  is_active: Defaulted<boolean>;
}

export interface ShiftAssignmentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  shift_id: string;
  effective_from: string;
  effective_to: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface ShiftOverridesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  branch_id: string | null;
  name: string;
  from_date: string;
  to_date: string;
  start_time: string;
  end_time: string;
  grace_minutes: number | null;
  half_day_minutes: number | null;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface AttendanceProfilesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  device_user_id: string | null;
  web_punch_allowed: Defaulted<boolean>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface EmployeeDevicesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  device_id: string;
  name: string;
  status: Defaulted<'pending' | 'active' | 'revoked'>;
  approved_by: string | null;
  approved_at: Date | null;
  revoked_reason: string | null;
  created_at: Generated<Date>;
}

export interface AttendanceDevicesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  branch_id: string;
  serial: string;
  brand: string | null;
  last_seen_at: Date | null;
  last_clock_drift_seconds: number | null;
}

export type PunchSource = 'device' | 'mobile' | 'web' | 'correction';

export interface AttendancePunchesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  punched_at: Date;
  source: PunchSource;
  device_ref: Defaulted<string>;
  latitude: number | null;
  longitude: number | null;
  distance_m: number | null;
  raw_ref: Json | null;
  received_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  accuracy_m: number | null;
  ip: string | null;
  user_agent: string | null;
}

/** A refused phone punch (misuse review, migration 0024). */
export interface PunchAttemptsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  attempted_at: Generated<Date>;
  outcome: 'outside_area' | 'weak_gps' | 'unknown_device' | 'no_geofence';
  branch_id: string | null;
  device_ref: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  ip: string | null;
  user_agent: string | null;
}

export type DayStatus =
  | 'present'
  | 'late'
  | 'half_day'
  | 'absent'
  | 'on_leave'
  | 'holiday'
  | 'weekend'
  | 'missing_punch';

export interface AttendanceDaysTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  work_date: string;
  company_id: string;
  branch_id: string | null;
  department_id: string | null;
  shift_id: string | null;
  status: DayStatus;
  first_in: Date | null;
  last_out: Date | null;
  worked_minutes: Defaulted<number>;
  late_minutes: Defaulted<number>;
  ot_minutes: Defaulted<number>;
  ot_approved_minutes: Defaulted<number>;
  holiday_name: string | null;
  locked: Defaulted<boolean>;
  computed_at: Defaulted<Date>;
}

export interface AttendanceAdjustmentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  work_date: string;
  previous: Json;
  corrected: Json;
  reason: string;
  payroll_period: string | null;
  created_at: Generated<Date>;
}

export interface AttendanceLocksTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  period: string;
  locked_at: Generated<Date>;
  locked_by: Defaulted<string | null>;
}

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface AttendanceCorrectionsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  work_date: string;
  requested_in: Date | null;
  requested_out: Date | null;
  reason: string;
  status: Defaulted<RequestStatus>;
  approval_request_id: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface OvertimeRequestsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  work_date: string;
  minutes: number;
  reason: string | null;
  status: Defaulted<RequestStatus>;
  approval_request_id: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface ServiceKeysTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  name: string;
  secret_hash: string;
  permissions: string[];
  company_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  last_used_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

// --------------------------------------------------------------- leave (0010) --

export interface LeavePoliciesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  leave_year_start: Defaulted<string>;
  sandwich_rule: Defaulted<boolean>;
  team_absence_warn_pct: Defaulted<number>;
  max_backdated_days: Defaulted<number>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export type AccrualMethod =
  'annual_grant' | 'monthly' | 'per_worked_days' | 'none';

export interface LeaveEligibility {
  gender?: 'male' | 'female';
  minServiceMonths?: number;
  minServiceRuleKey?: string;
  allowDuringProbation?: boolean;
}

export interface LeaveTypesTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  paid: Defaulted<boolean>;
  accrual_method: AccrualMethod;
  entitlement_days: string | null; // NUMERIC
  entitlement_rule_key: string | null;
  max_days_per_request: string | null;
  max_days_rule_key: string | null;
  counts_non_working_days: Defaulted<boolean>;
  allow_half_day: Defaulted<boolean>;
  document_required_over_days: string | null;
  year_end_action: Defaulted<'lapse' | 'carry'>;
  carry_cap_days: string | null;
  encashable: Defaulted<boolean>;
  eligibility: Defaulted<Json>;
  is_active: Defaulted<boolean>;
}

export type LedgerKind =
  | 'opening'
  | 'accrual'
  | 'taken'
  | 'reversal'
  | 'lapse'
  | 'carry_in'
  | 'encash'
  | 'adjustment';

export interface LeaveLedgerTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  leave_type_id: string;
  entry_date: string;
  kind: LedgerKind;
  days: string; // NUMERIC, signed
  leave_year: string;
  period_key: string | null;
  source_type: string | null;
  source_id: string | null;
  note: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export type LeaveState =
  'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled';

export interface LeaveRequestsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  company_id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  half_day: 'first_half' | 'second_half' | null;
  days_counted: string;
  reason: string | null;
  document_id: string | null;
  state: Defaulted<LeaveState>;
  approval_request_id: string | null;
  decided_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface LeaveEncashmentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  leave_type_id: string;
  leave_year: string;
  days: string;
  status: Defaulted<'pending_payroll' | 'in_payroll' | 'paid'>;
  payroll_period: string | null;
  created_at: Generated<Date>;
}

// ------------------------------------------------------------- payroll (0011) --

export interface PayrollSettingsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  rounding_increment: Defaulted<string>; // NUMERIC '0.01' | '1.00'
  rounding_mode: Defaulted<'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP'>;
  unpaid_day_basis: Defaulted<'calendar' | 'fixed30' | 'fixed26'>;
  ot_hours_basis: Defaulted<number>;
  ot_monthly_limit_hours: Defaulted<number>;
  pf_employee_percent: Defaulted<string>;
  pf_employer_percent: Defaulted<string>;
  gratuity_provision: Defaulted<boolean>;
  net_change_flag_percent: Defaulted<number>;
  encashment_divisor: Defaulted<number>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface SalaryHeadsTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  kind: 'earning' | 'deduction';
  taxable: Defaulted<boolean>;
  sort_order: Defaulted<number>;
  is_active: Defaulted<boolean>;
}

export interface SalaryStructuresTable extends EditableColumns {
  id: Generated<string>;
  company_id: string;
  code: string;
  name: string;
  rules: Json; // StructureRule[]
  is_active: Defaulted<boolean>;
}

export interface EmployeeSalariesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  effective_from: string;
  gross: string;
  structure_id: string;
  reason: string;
  status: Defaulted<'active' | 'cancelled'>;
  cancelled_reason: string | null;
  cancelled_at: Date | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface PfOpeningsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  as_of: string;
  employee_part: string;
  employer_part: string;
  note: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface SalaryTaxChallansTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  period: string;
  challan_no: string;
  challan_date: string;
  amount: string;
  state: Defaulted<'active' | 'cancelled'>;
  cancelled_reason: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface PayrollYtdOpeningsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  fiscal_year: string;
  kind: 'opening' | 'prior_employer';
  taxable_income: string;
  tax_withheld: string;
  pf_employee: Defaulted<string>;
  pf_employer: Defaulted<string>;
  note: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface PayrollVariablesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  period: string;
  head_code: string;
  amount: string;
  note: string | null;
  status: Defaulted<'open' | 'paid' | 'cancelled'>;
  run_id: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export type LoanState =
  'pending' | 'approved' | 'rejected' | 'cancelled' | 'closed';

export interface LoansTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  principal: string;
  installment: string;
  first_period: string;
  reason: string;
  state: Defaulted<LoanState>;
  approval_request_id: string | null;
  approved_at: Date | null;
  closed_at: Date | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
  origin: Defaulted<'request' | 'import' | 'advance'>;
  payout_voucher_id: string | null;
  paid_at: Date | null;
  source_advance_id: string | null;
}

export interface LoanRecoveriesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  loan_id: string;
  run_id: string;
  period: string;
  amount: string;
  created_at: Generated<Date>;
}

export type RunType = 'regular' | 'bonus' | 'final_settlement';
export type RunState =
  | 'draft'
  | 'calculated'
  | 'in_approval'
  | 'verified'
  | 'approved'
  | 'disbursed'
  | 'cancelled';

export interface PayrollRunsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  period: string;
  run_type: RunType;
  state: Defaulted<RunState>;
  bonus_name: string | null;
  bonus_date: string | null;
  employee_id: string | null;
  settlement: Json | null;
  engine_version: string | null;
  input_hash: string | null;
  headcount: Defaulted<number>;
  total_gross: Defaulted<string>;
  total_deductions: Defaulted<string>;
  total_net: Defaulted<string>;
  total_employer_cost: Defaulted<string>;
  total_tax: Defaulted<string>;
  approval_request_id: string | null;
  calculated_at: Date | null;
  calculated_by: string | null;
  approved_at: Date | null;
  disbursed_at: Date | null;
  cancelled_reason: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface PayrollRunEmployeesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  run_id: string;
  employee_id: string;
  input: Json;
  input_hash: string;
  engine_version: string;
  gross: string;
  deductions: string;
  net: string;
  employer_cost: string;
  taxable_income: string;
  tax: string;
  projection: Json;
  created_at: Generated<Date>;
}

export interface PayrollLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  run_id: string;
  employee_id: string;
  line_no: number;
  head_code: string;
  kind: 'earning' | 'deduction' | 'employer_cost';
  amount: string;
  taxable: boolean;
  for_period: string | null;
  explanation: Json;
}

export interface PayrollFlagsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  run_id: string;
  employee_id: string;
  code: string;
  message: string;
  cleared_at: Date | null;
  cleared_by: string | null;
  clear_reason: string | null;
}

// -------------------------------------------------------- disbursement (0012) --

export type PaymentChannel =
  'bank' | 'bkash' | 'nagad' | 'rocket' | 'upay' | 'cash';
export type PaymentStatus =
  'approved' | 'in_file' | 'paid' | 'returned' | 'reissued';

export interface DisbursementFilesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  run_id: string;
  channel: PaymentChannel;
  adapter: string;
  file_key: string;
  file_name: string;
  content_type: string;
  checksum_sha256: string;
  payment_count: number;
  total_amount: string;
  state: Defaulted<'active' | 'settled' | 'cancelled'>;
  cancel_reason: string | null;
  cancel_approval_request_id: string | null;
  cancelled_at: Date | null;
  settled_at: Date | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface PaymentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  run_id: string;
  employee_id: string;
  period: string;
  pay_type: string;
  amount: string;
  channel: PaymentChannel;
  bank_account_id: string | null;
  reference: string;
  status: Defaulted<PaymentStatus>;
  file_id: string | null;
  reissue_of: string | null;
  returned_reason: string | null;
  returned_at: Date | null;
  paid_at: Date | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

// ------------------------------------------------------------ data import (0013) --

export type ImportEntity =
  | 'employees'
  | 'salaries'
  | 'leave_balances'
  | 'ytd_openings'
  | 'loans'
  | 'bank_accounts'
  | 'customers';
export type ImportBatchState =
  'validated' | 'committed' | 'rolled_back' | 'signed_off' | 'discarded';
export type ImportRowStatus =
  'valid' | 'error' | 'skipped' | 'committed' | 'rolled_back';

export interface ImportBatchesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  entity: ImportEntity;
  file_name: string;
  file_sha256: string;
  cut_over_date: string;
  state: Defaulted<ImportBatchState>;
  total_rows: Defaulted<number>;
  valid_rows: Defaulted<number>;
  error_rows: Defaulted<number>;
  skipped_rows: Defaulted<number>;
  committed_at: Date | null;
  committed_by: string | null;
  rolled_back_at: Date | null;
  rolled_back_by: string | null;
  rollback_reason: string | null;
  signoff_id: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface ImportRowsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  batch_id: string;
  row_no: number;
  data: Json;
  status: ImportRowStatus;
  errors: Defaulted<Json>;
  skip_reason: string | null;
  created_record: Json | null;
}

export interface MigrationSignoffsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  cut_over_date: string;
  report: Json;
  report_sha256: string;
  note: string;
  signed_by: Defaulted<string>;
  signed_at: Generated<Date>;
}

// ----------------------------------------------------------- notifications (0014) --

export type NotificationChannel = 'in_app' | 'email' | 'sms';
export type NotificationStatus = 'queued' | 'sending' | 'sent' | 'failed';

export interface NotificationEventsTable {
  tenant_id: Defaulted<string>;
  event_id: string;
  event_type: string;
  messages: Defaulted<number>;
  planned_at: Generated<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  event_id: string;
  event_type: string;
  kind: string;
  recipient_key: string;
  user_id: string | null;
  employee_id: string | null;
  channel: NotificationChannel;
  address: string | null;
  language: 'bn' | 'en';
  subject: string;
  body: string;
  link: string | null;
  attachment: Json | null;
  status: NotificationStatus;
  attempts: Defaulted<number>;
  claimed_at: Date | null;
  sent_at: Date | null;
  provider: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  read_at: Date | null;
  created_at: Generated<Date>;
}

// ---------------------------------------------------------------- AI (WP11)

export type AiFeature =
  | 'assistant'
  | 'payroll_flag_explanation'
  | 'bank_match_suggestion'
  | 'document_reader';

export interface AiSettingsTable {
  tenant_id: Defaulted<string>;
  enabled: Defaulted<boolean>;
  assistant_enabled: Defaulted<boolean>;
  payroll_explain_enabled: Defaulted<boolean>;
  bank_match_enabled: Defaulted<boolean>;
  document_reader_enabled: Defaulted<boolean>;
  monthly_quota: number | null;
  extra_credits: Defaulted<number>;
  updated_by: string | null;
  updated_at: Defaulted<Date>;
}

export interface AiUsageTable {
  tenant_id: Defaulted<string>;
  month: string;
  feature: AiFeature;
  calls: Defaulted<number>;
  input_tokens: Defaulted<number>;
  output_tokens: Defaulted<number>;
}

export interface AiInteractionsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  user_id: string;
  feature: AiFeature;
  provider: string;
  model: string;
  prompt_version: string;
  language: 'bn' | 'en';
  input_ref: string;
  input_text: string;
  output_text: string | null;
  tools_used: Defaulted<Json>;
  sources: Defaulted<Json>;
  status: 'ok' | 'refused' | 'timeout' | 'error';
  error: string | null;
  input_tokens: Defaulted<number>;
  output_tokens: Defaulted<number>;
  latency_ms: Defaulted<number>;
  human_action: 'helpful' | 'not_helpful' | null;
  human_note: string | null;
  acted_at: Date | null;
  created_at: Generated<Date>;
}

export interface AiPolicyDocumentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  title: string;
  language: 'bn' | 'en';
  body: string;
  chunks: Defaulted<number>;
  active: Defaulted<boolean>;
  uploaded_by: string | null;
  created_at: Generated<Date>;
  deactivated_at: Date | null;
}

export interface AiPolicyChunksTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  document_id: string;
  chunk_no: number;
  heading: Defaulted<string>;
  content: string;
  tsv: ColumnType<string, never, never>;
}

export interface AiReleaseGatesTable {
  id: Generated<string>;
  feature: string;
  provider: string;
  model: string;
  prompt_version: string;
  cases: number;
  passed_cases: number;
  pass_rate: string;
  required_rate: string;
  passed: boolean;
  details: Defaulted<Json>;
  run_at: Generated<Date>;
}

// ---------------------------------------------------------------- pilot readiness (WP12)

export type ConsentPurpose =
  'biometric_attendance' | 'location_attendance' | 'selfie_attendance';

export interface EmployeeConsentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  employee_id: string;
  purpose: ConsentPurpose;
  granted: boolean;
  notice_version: string;
  method: 'app' | 'paper';
  document_id: string | null;
  recorded_by: Defaulted<string | null>;
  recorded_at: Generated<Date>;
}

export interface SystemJobRunsTable {
  job: string;
  last_started: Date | null;
  last_finished: Date | null;
  last_ok: Date | null;
  last_error: string | null;
  failures: Defaulted<number>;
  details: Defaulted<Json>;
}

// ---------------------------------------------------------------- Gate 1 parallel payroll (WP12)

export type ParallelOutcome =
  'match' | 'different' | 'missing_in_erp' | 'missing_in_legacy';

export interface ParallelRunComparisonsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  run_id: string;
  period: string;
  run_calculated_at: Date;
  file_name: string;
  file_sha256: string;
  tolerance: Defaulted<string>;
  employees: number;
  matched: number;
  different: number;
  missing_in_erp: number;
  missing_in_legacy: number;
  totals: Json;
  status: Defaulted<'open' | 'accepted'>;
  accepted_by: string | null;
  accepted_at: Date | null;
  acceptance_note: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface ParallelRunLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  comparison_id: string;
  employee_code: string;
  employee_id: string | null;
  outcome: ParallelOutcome;
  legacy: Json | null;
  erp: Json | null;
  differences: Defaulted<Json>;
  explanation: string | null;
  explained_by: string | null;
  explained_at: Date | null;
}

// ---------------------------------------------------------------- general ledger (Phase 2 WP14)

export type AccountType =
  'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type AccountRole =
  | 'cash'
  | 'bank'
  | 'payables'
  | 'receivables'
  | 'employee_advances'
  | 'retained_earnings'
  | 'customer_advances';
export type VoucherType = 'payment' | 'receipt' | 'journal' | 'contra';
export type VoucherState = 'draft' | 'in_approval' | 'posted' | 'cancelled';

export interface FiscalYearsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  starts_on: string;
  ends_on: string;
  created_at: Generated<Date>;
}

export interface AccountingPeriodsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  fiscal_year_id: string;
  period: string;
  starts_on: string;
  ends_on: string;
  state: Defaulted<'open' | 'closed'>;
  closed_by: string | null;
  closed_at: Date | null;
}

export interface AccountsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  type: AccountType;
  parent_id: string | null;
  postable: Defaulted<boolean>;
  role: AccountRole | null;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface PostingAccountsTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  key: string;
  account_id: string;
  updated_at: Defaulted<Date>;
}

export interface VoucherSequencesTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  fiscal_year_id: string;
  voucher_type: VoucherType;
  last_no: Defaulted<number>;
}

export interface VouchersTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  fiscal_year_id: string;
  voucher_type: VoucherType;
  number: string;
  voucher_date: string;
  narration: string;
  state: Defaulted<VoucherState>;
  source_type: string | null;
  source_id: string | null;
  is_opening: Defaulted<boolean>;
  reversal_of: string | null;
  reversed_by: string | null;
  reason: string | null;
  total: Defaulted<string>;
  approval_request_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  posted_at: Date | null;
  version: Generated<number>;
}

export interface VoucherLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  voucher_id: string;
  line_no: number;
  account_id: string;
  department_id: string | null;
  party_type: 'employee' | 'vendor' | 'customer' | null;
  party_id: string | null;
  debit: Defaulted<string>;
  credit: Defaulted<string>;
  narration: string | null;
}

// ------------------------------------------------- payables and tax at source (WP15)

export type TaxType = 'tds' | 'vds' | 'vat';
export type VendorBillState =
  'draft' | 'in_approval' | 'approved' | 'cancelled';
export type VendorPaymentMethod =
  'bank_transfer' | 'cheque' | 'cash' | 'mobile_wallet';

export interface PayablesSettingsTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  vat_withholding_entity: Defaulted<boolean>;
  default_payment_terms_days: Defaulted<number>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface VendorsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name: string;
  name_bn: string | null;
  vendor_type: Defaulted<'company' | 'individual'>;
  tin: string | null;
  bin: string | null;
  trade_licence: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  withholding_category: Defaulted<string>;
  payment_terms_days: number | null;
  is_active: Defaulted<boolean>;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface VendorBankAccountsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  vendor_id: string;
  bank_name: string;
  account_last4: string;
  details_encrypted: string;
  status: Defaulted<
    'pending' | 'approved' | 'retired' | 'rejected' | 'cancelled'
  >;
  approval_request_id: string | null;
  approved_at: Date | null;
  retired_at: Date | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export type MatchStatus =
  'not_required' | 'matched' | 'mismatch' | 'overridden';
export type RequisitionState =
  'draft' | 'in_approval' | 'approved' | 'ordered' | 'rejected' | 'cancelled';
export type PurchaseOrderState =
  | 'draft'
  | 'in_approval'
  | 'issued'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type DepreciationMethod = 'straight_line' | 'reducing_balance';

export interface AssetClassesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name: string;
  asset_account_id: string;
  accumulated_account_id: string;
  expense_account_id: string;
  method: DepreciationMethod;
  useful_life_months: number | null;
  annual_rate_percent: string | null;
  residual_percent: Defaulted<string>;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface AssetsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  class_id: string;
  tag: string;
  name: string;
  serial_no: string | null;
  in_service_date: string;
  cost: string;
  residual_value: Defaulted<string>;
  opening_accumulated: Defaulted<string>;
  opening_as_of: string | null;
  department_id: string | null;
  branch_id: string | null;
  location: string | null;
  vendor_bill_id: string | null;
  state: Defaulted<'in_store' | 'assigned' | 'disposed'>;
  disposed_on: string | null;
  disposal_method: 'sale' | 'scrap' | 'write_off' | null;
  disposal_proceeds: string | null;
  disposal_voucher_id: string | null;
  disposal_note: string | null;
  note: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface AssetAssignmentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  asset_id: string;
  employee_id: string;
  assigned_on: string;
  expected_return: string | null;
  note: string | null;
  acknowledged_at: Date | null;
  acknowledged_ip: string | null;
  returned_on: string | null;
  return_condition: 'good' | 'damaged' | 'lost' | null;
  return_note: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  returned_by: string | null;
}

export interface AssetMaintenanceTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  asset_id: string;
  done_on: string;
  kind: 'service' | 'repair' | 'inspection';
  description: string;
  vendor_id: string | null;
  cost: Defaulted<string>;
  next_due: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface DepreciationRunsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  period: string;
  state: Defaulted<'posted' | 'reversed'>;
  total: Defaulted<string>;
  voucher_id: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface DepreciationLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  run_id: string;
  asset_id: string;
  amount: string;
  accumulated_after: string;
  book_value_after: string;
}

export interface StoresTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name: string;
  branch_id: string | null;
  keeper_employee_id: string | null;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
}

export interface StockItemsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name: string;
  name_bn: string | null;
  unit: string;
  reorder_level: Defaulted<string>;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
}

export interface StockIssueRequestsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  store_id: string;
  requester_id: string;
  department_id: string | null;
  note: string | null;
  state: Defaulted<
    | 'in_approval'
    | 'approved'
    | 'partially_issued'
    | 'issued'
    | 'rejected'
    | 'cancelled'
  >;
  approval_request_id: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface StockIssueRequestLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  request_id: string;
  item_id: string;
  quantity_requested: string;
  quantity_issued: Defaulted<string>;
}

export interface StockMovesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  store_id: string;
  item_id: string;
  move_date: string;
  kind:
    | 'opening'
    | 'receipt'
    | 'issue'
    | 'adjustment'
    | 'sales_issue'
    | 'sales_return';
  quantity: string;
  reference: string | null;
  issue_request_id: string | null;
  note: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  sales_order_id: string | null;
  credit_note_id: string | null;
}

export interface StockBalancesTable {
  tenant_id: Defaulted<string>;
  store_id: string;
  item_id: string;
  quantity: Defaulted<string>;
}

// ---------------------------------------------------------------- CRM: customers and leads (WP23)

export type LeadSource =
  | 'web_form'
  | 'facebook'
  | 'referral'
  | 'call'
  | 'walk_in'
  | 'manual'
  | 'other';
export type LeadState = 'new' | 'contacted' | 'qualified' | 'disqualified';
export type CustomerType =
  'dealer' | 'distributor' | 'retail' | 'corporate' | 'government' | 'export';
export type ActivityKind =
  'call' | 'meeting' | 'note' | 'task' | 'email' | 'sms' | 'enquiry' | 'system';

export interface SalesTerritoriesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name: string;
  districts: Defaulted<string[]>;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface SalesTerritoryMembersTable {
  tenant_id: Defaulted<string>;
  territory_id: string;
  user_id: string;
}

export interface CrmAssignmentCursorsTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  pool: string;
  last_user_id: string;
  updated_at: Defaulted<Date>;
}

export interface CustomersTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  kind: 'company' | 'person';
  name: string;
  name_bn: string | null;
  customer_type: Defaulted<CustomerType>;
  bin: string | null;
  tin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  district: string | null;
  territory_id: string | null;
  account_manager_id: string | null;
  payment_terms_days: Defaulted<number>;
  credit_limit: Defaulted<string>;
  from_lead_id: string | null;
  is_active: Defaulted<boolean>;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface CustomerContactsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  customer_id: string;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  is_primary: Defaulted<boolean>;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
}

export interface LeadsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  email: string | null;
  district: string | null;
  source: LeadSource;
  source_detail: string | null;
  message: string | null;
  external_ref: string | null;
  owner_id: string;
  territory_id: string | null;
  state: Defaulted<LeadState>;
  disqualify_reason: string | null;
  customer_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface CrmContactKeysTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  kind: 'phone' | 'email';
  value: string;
  lead_id: string | null;
  customer_id: string | null;
  contact_id: string | null;
}

export interface CrmActivitiesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  lead_id: string | null;
  customer_id: string | null;
  kind: ActivityKind;
  subject: string;
  body: string | null;
  due_at: Date | null;
  done_at: Date | null;
  owner_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export type Customer = Selectable<CustomersTable>;
export type Lead = Selectable<LeadsTable>;

// ---------------------------------------------------------------- CRM: opportunities, pipeline and targets (WP24)

export type OpportunityState = 'open' | 'won' | 'lost';
export type LostReason =
  | 'price'
  | 'competitor'
  | 'no_budget'
  | 'no_response'
  | 'timing'
  | 'product_fit'
  | 'other';

export interface OpportunityStagesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  name: string;
  name_bn: string | null;
  sort_order: number;
  probability: number;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface OpportunitiesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  title: string;
  customer_id: string;
  lead_id: string | null;
  owner_id: string;
  department_id: string | null;
  stage_id: string;
  state: Defaulted<OpportunityState>;
  value: string;
  probability: number;
  expected_close_on: string;
  closed_on: string | null;
  lost_reason: LostReason | null;
  close_note: string | null;
  change_note: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

/** Written by the database (trigger on opportunities); append-only. */
export interface OpportunityStageHistoryTable {
  id: Generated<string>;
  tenant_id: string;
  opportunity_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  from_state: OpportunityState | null;
  to_state: OpportunityState;
  value: string;
  probability: number;
  note: string | null;
  changed_by: Defaulted<string | null>;
  changed_at: Generated<Date>;
}

export interface SalesTargetsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  month: string;
  user_id: string | null;
  department_id: string | null;
  amount: string;
  set_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export type Opportunity = Selectable<OpportunitiesTable>;
export type OpportunityStage = Selectable<OpportunityStagesTable>;

// ---------------------------------------------------------------- quotations, orders, invoices, collections (WP25-WP27)

export type QuotationState =
  | 'draft'
  | 'in_approval'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'superseded'
  | 'cancelled';
export type SalesOrderState =
  'in_approval' | 'confirmed' | 'delivered' | 'invoiced' | 'cancelled';
export type ReceiptMethod =
  'cash' | 'cheque' | 'bank_transfer' | 'bkash' | 'nagad' | 'other';

export interface ProductsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name: string;
  name_bn: string | null;
  kind: Defaulted<'goods' | 'service'>;
  unit: string;
  vat_item_id: string;
  /** goods kept in a store (2026-10-31) */
  stock_item_id: string | null;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface PriceListsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  name: string;
  fiscal_year_code: string;
  customer_type: CustomerType | null;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface PriceListItemsTable {
  tenant_id: Defaulted<string>;
  price_list_id: string;
  product_id: string;
  unit_price: string;
}

export interface DiscountLimitsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  user_id: string | null;
  product_id: string | null;
  customer_type: CustomerType | null;
  max_percent: string;
  created_at: Generated<Date>;
}

/** The priced lines shared by quotations, orders and invoices. */
interface PricedLine {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  line_no: number;
  product_id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_percent: Defaulted<string>;
  value: string;
  vat_item_id: string;
  rate_class: VatRateClass;
  vat_percent: string;
  sd_percent: string;
  sd_amount: string;
  vat_amount: string;
}

export interface SalesQuotationsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  revision: Defaulted<number>;
  customer_id: string;
  opportunity_id: string | null;
  owner_id: string;
  quote_date: string;
  valid_until: string;
  language: Defaulted<'en' | 'bn'>;
  state: Defaulted<QuotationState>;
  needs_approval: Defaulted<boolean>;
  approval_request_id: string | null;
  subtotal: Defaulted<string>;
  discount_total: Defaulted<string>;
  value: Defaulted<string>;
  sd_total: Defaulted<string>;
  vat_total: Defaulted<string>;
  total: Defaulted<string>;
  terms: string | null;
  reject_reason: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface SalesQuotationLinesTable extends PricedLine {
  quotation_id: string;
  list_price: string | null;
  discount_limit: string;
  gross: string;
}

export interface SalesOrdersTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  customer_id: string;
  quotation_id: string | null;
  owner_id: string;
  order_date: string;
  customer_ref: string | null;
  state: Defaulted<SalesOrderState>;
  credit_check: unknown;
  approval_request_id: string | null;
  delivered_on: string | null;
  store_id: string | null;
  delivery_challan_no: string | null;
  value: string;
  sd_total: string;
  vat_total: string;
  total: string;
  cancel_reason: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface SalesOrderLinesTable extends PricedLine {
  order_id: string;
}

export interface SalesInvoicesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  invoice_no: string;
  order_id: string;
  customer_id: string;
  invoice_date: string;
  due_date: string;
  customer_name: string;
  customer_bin: string | null;
  customer_address: string | null;
  value: string;
  sd_amount: string;
  vat_amount: string;
  total: string;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface SalesInvoiceLinesTable extends PricedLine {
  invoice_id: string;
}

export interface CreditNotesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  invoice_id: string;
  note_date: string;
  reason: string;
  value: string;
  sd_amount: string;
  vat_amount: string;
  total: string;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface CreditNoteLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  credit_note_id: string;
  invoice_line_id: string;
  quantity: string;
  value: string;
  rate_class: VatRateClass;
  sd_amount: string;
  vat_amount: string;
}

export interface CustomerReceiptsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  customer_id: string;
  receipt_date: string;
  method: ReceiptMethod;
  received_into_account_id: string;
  amount: string;
  vds_amount: Defaulted<string>;
  vds_certificate_no: string | null;
  allocated: string;
  on_account: string;
  cheque_no: string | null;
  cheque_bank: string | null;
  reference: string | null;
  state: Defaulted<'in_approval' | 'posted' | 'cancelled' | 'reversed'>;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface CustomerReceiptAllocationsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  receipt_id: string;
  item_id: string;
  amount: string;
}

export interface AdvanceApplicationsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  customer_id: string;
  item_id: string;
  amount: string;
  applied_on: string;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface CollectionRemindersTable {
  tenant_id: Defaulted<string>;
  item_id: string;
  stage: number;
  days_late: number;
  escalated: Defaulted<boolean>;
  sent_at: Generated<Date>;
}

// ---------------------------------------------------------------- PF settlement, resignation from the app (2026-10-30)

export interface PfTransactionsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  kind: 'interest' | 'withdrawal' | 'settlement' | 'forfeit';
  txn_date: string;
  employee_part: string;
  employer_part: string;
  fiscal_year: string | null;
  rate_percent: string | null;
  note: string | null;
  state: Defaulted<'in_approval' | 'posted' | 'cancelled'>;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface ResignationRequestsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  notice_date: string;
  last_working_day: string;
  reason: string;
  state: Defaulted<'in_approval' | 'accepted' | 'rejected' | 'withdrawn'>;
  approval_request_id: string | null;
  separation_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export type PfTransaction = Selectable<PfTransactionsTable>;
export type ResignationRequest = Selectable<ResignationRequestsTable>;

export type Product = Selectable<ProductsTable>;
export type SalesQuotation = Selectable<SalesQuotationsTable>;
export type SalesOrder = Selectable<SalesOrdersTable>;
export type SalesInvoice = Selectable<SalesInvoicesTable>;
export type CustomerReceipt = Selectable<CustomerReceiptsTable>;

// ---------------------------------------------------------------- finance close and Gate 2 (WP22)

export interface OpeningBalanceImportsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  cut_over_date: string;
  file_name: string;
  file_sha256: string;
  rows: unknown;
  total_debit: string;
  total_credit: string;
  state: Defaulted<'in_approval' | 'posted' | 'cancelled'>;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface AccountMapTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  old_code: string;
  old_name: string | null;
  account_id: string;
}

export interface ReceivableItemsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  customer_name: string;
  reference: string;
  invoice_date: string;
  due_date: string;
  amount: string;
  received: Defaulted<string>;
  opening_import_id: string | null;
  created_at: Generated<Date>;
  /** WP26: the customer and the invoice; credit notes lower what is owed */
  customer_id: string | null;
  sales_invoice_id: string | null;
  credited: Defaulted<string>;
}

export interface ReceivableReceiptsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  item_id: string;
  receipt_date: string;
  amount: string;
  received_into_account_id: string;
  reference: string | null;
  state: Defaulted<'in_approval' | 'posted' | 'cancelled' | 'reversed'>;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface OldSystemComparisonsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  as_of: string;
  file_name: string;
  file_sha256: string;
  result: unknown;
  differences: number;
  unmapped: number;
  matched: boolean;
  note: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface MonthCloseItemsTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  period: string;
  key: string;
  done_by: Defaulted<string>;
  done_at: Generated<Date>;
  note: string;
}

export type OpeningBalanceImport = Selectable<OpeningBalanceImportsTable>;
export type ReceivableItem = Selectable<ReceivableItemsTable>;

// ---------------------------------------------------------------- VAT and compliance (WP21)

export type VatRateClass =
  'standard' | 'reduced' | 'truncated' | 'zero' | 'exempt';

export interface VatItemsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  kind: 'goods' | 'service';
  nbr_code: string | null;
  unit: string | null;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface VatItemRatesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  item_id: string;
  fiscal_year_code: string;
  rate_class: VatRateClass;
  vat_percent: string;
  sd_percent: Defaulted<string>;
  created_at: Generated<Date>;
}

export interface VatSalesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  invoice_no: string;
  invoice_date: string;
  customer_name: string;
  customer_bin: string | null;
  customer_address: string | null;
  received_into_account_id: string;
  value: string;
  sd_amount: Defaulted<string>;
  vat_amount: Defaulted<string>;
  vds_by_customer: Defaulted<string>;
  vds_certificate_no: string | null;
  received_amount: string;
  state: Defaulted<'in_approval' | 'posted' | 'cancelled' | 'reversed'>;
  voucher_id: string | null;
  note: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface VatSaleLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  sale_id: string;
  line_no: number;
  item_id: string;
  description: string;
  quantity: string | null;
  value: string;
  rate_class: VatRateClass;
  vat_percent: string;
  sd_percent: Defaulted<string>;
  sd_amount: Defaulted<string>;
  vat_amount: Defaulted<string>;
}

export interface VatReturnsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  period: string;
  figures: unknown;
  output_vat: string;
  input_vat: string;
  net_payable: string;
  carry_forward: string;
  submitted_on: string;
  submission_ref: string | null;
  settlement_voucher_id: string | null;
  challan_id: string | null;
  filed_by: Defaulted<string | null>;
  filed_at: Generated<Date>;
}

export interface ComplianceItemsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  kind: string;
  period: string;
  title: string;
  due_date: string;
  state: Defaulted<'open' | 'done' | 'not_applicable'>;
  done_on: string | null;
  done_by: string | null;
  evidence: string | null;
  note: string | null;
  reminded_7: Defaulted<boolean>;
  reminded_1: Defaulted<boolean>;
  reminded_overdue: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export type VatItem = Selectable<VatItemsTable>;
export type VatSale = Selectable<VatSalesTable>;
export type VatReturn = Selectable<VatReturnsTable>;
export type ComplianceItem = Selectable<ComplianceItemsTable>;

// ---------------------------------------------------------------- bank reconciliation (WP20)

export type StatementFormat = 'generic' | 'dbbl' | 'brac' | 'city';

export interface CompanyBankAccountsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  account_id: string;
  bank_name: string;
  branch: string | null;
  account_name: string;
  account_no: string;
  statement_format: StatementFormat;
  reconcile_from: string;
  opening_bank_balance: string;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Defaulted<number>;
}

export interface BankStatementsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  bank_account_id: string;
  source: 'upload' | 'n8n';
  file_name: string;
  file_sha256: string;
  period_from: string;
  period_to: string;
  opening_balance: string | null;
  closing_balance: string | null;
  lines_imported: number;
  lines_skipped: number;
  imported_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface BankStatementLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  bank_account_id: string;
  statement_id: string;
  line_no: number;
  txn_date: string;
  value_date: string | null;
  description: string;
  reference: string | null;
  amount: string;
  balance: string | null;
  line_key: string;
  created_at: Generated<Date>;
}

export interface BankMatchesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  bank_account_id: string;
  kind: 'auto' | 'manual' | 'suggestion';
  note: string | null;
  matched_by: Defaulted<string | null>;
  matched_at: Generated<Date>;
  undone_by: string | null;
  undone_at: Date | null;
  undo_reason: string | null;
}

export interface BankMatchItemsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  match_id: string;
  bank_account_id: string;
  statement_line_id: string | null;
  voucher_line_id: string | null;
  amount: string;
  active: Defaulted<boolean>;
}

export type CompanyBankAccount = Selectable<CompanyBankAccountsTable>;

export interface BudgetSettingsTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  warning_percent: Defaulted<string>;
  no_budget_needs_admin: Defaulted<boolean>;
  updated_at: Generated<Date>;
}

export interface BudgetsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  fiscal_year_code: string;
  department_id: string;
  state: Defaulted<'draft' | 'in_approval' | 'approved' | 'cancelled'>;
  total: Defaulted<string>;
  note: string | null;
  approval_request_id: string | null;
  approved_at: Date | null;
  cancel_reason: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface BudgetLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  budget_id: string;
  account_id: string;
  amount: string;
}

export interface BudgetRevisionsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  budget_id: string;
  reason: string;
  state: Defaulted<'in_approval' | 'approved' | 'rejected' | 'cancelled'>;
  approval_request_id: string | null;
  decided_at: Date | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface BudgetRevisionLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  revision_id: string;
  account_id: string;
  old_amount: string;
  new_amount: string;
}

export interface BudgetAlertsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  budget_id: string;
  account_id: string | null;
  level: number;
  percent: string;
  created_at: Generated<Date>;
}

export interface ProcurementSettingsTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  quotation_threshold: Defaulted<string>;
  min_quotations: Defaulted<number>;
  admin_threshold: Defaulted<string>;
  match_tolerance_percent: Defaulted<string>;
  updated_at: Generated<Date>;
}

export interface PurchaseRequisitionsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  requester_id: string;
  department_id: string | null;
  title: string;
  justification: string;
  needed_by: string | null;
  estimated_total: Defaulted<string>;
  state: Defaulted<RequisitionState>;
  approval_request_id: string | null;
  selected_quotation_id: string | null;
  selection_reason: string | null;
  cs_state: Defaulted<'none' | 'in_approval' | 'approved'>;
  cs_approval_request_id: string | null;
  cancel_reason: string | null;
  budget_status:
    'within' | 'warning' | 'over' | 'no_budget' | 'not_used' | null;
  budget_snapshot: Json | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface PurchaseRequisitionLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  requisition_id: string;
  line_no: number;
  description: string;
  quantity: string;
  unit: string;
  estimated_unit_price: string;
}

export interface QuotationsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  requisition_id: string;
  vendor_id: string;
  reference: string;
  quotation_date: string;
  valid_until: string | null;
  delivery_days: number | null;
  note: string | null;
  base_total: string;
  vat_total: string;
  state: Defaulted<'active' | 'withdrawn'>;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface QuotationLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  quotation_id: string;
  requisition_line_id: string;
  unit_price: string;
  vat_percent: Defaulted<string>;
}

export interface PurchaseOrdersTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  requisition_id: string;
  quotation_id: string;
  vendor_id: string;
  department_id: string | null;
  order_date: string;
  delivery_date: string | null;
  deliver_to: string | null;
  terms: string | null;
  base_total: string;
  vat_total: string;
  state: Defaulted<PurchaseOrderState>;
  issued_at: Date | null;
  approval_request_id: string | null;
  budget_snapshot: Json | null;
  cancel_reason: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface PurchaseOrderLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  purchase_order_id: string;
  requisition_line_id: string;
  line_no: number;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  vat_percent: Defaulted<string>;
  account_id: string;
}

export interface GoodsReceiptsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  number: string;
  purchase_order_id: string;
  received_date: string;
  note: string | null;
  state: Defaulted<'active' | 'cancelled'>;
  cancel_reason: string | null;
  created_at: Generated<Date>;
  created_by: Defaulted<string | null>;
}

export interface GoodsReceiptLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  receipt_id: string;
  po_line_id: string;
  quantity: string;
}

export interface VendorBillsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  vendor_id: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  narration: string;
  withholding_category: string;
  base_amount: Defaulted<string>;
  vat_amount: Defaulted<string>;
  tds_percent: Defaulted<string>;
  tds_amount: Defaulted<string>;
  vds_percent: Defaulted<string>;
  vds_amount: Defaulted<string>;
  input_vat: Defaulted<string>;
  vat_in_cost: Defaulted<string>;
  net_payable: Defaulted<string>;
  paid_amount: Defaulted<string>;
  rule_pack: string | null;
  state: Defaulted<VendorBillState>;
  voucher_id: string | null;
  approval_request_id: string | null;
  cancel_reason: string | null;
  purchase_order_id: string | null;
  match_status: Defaulted<MatchStatus>;
  match_details: Json | null;
  match_override_reason: string | null;
  match_overridden_by: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
  is_opening: Defaulted<boolean>;
}

export interface VendorBillLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  bill_id: string;
  line_no: number;
  account_id: string;
  department_id: string | null;
  description: string;
  amount: string;
  vat_percent: Defaulted<string>;
  vat_amount: Defaulted<string>;
  po_line_id: string | null;
  quantity: string | null;
  vat_item_id: string | null;
  vat_rate_class: VatRateClass | null;
}

export interface VendorPaymentsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  vendor_id: string;
  payment_date: string;
  method: VendorPaymentMethod;
  reference: string | null;
  paid_from_account_id: string;
  vendor_bank_account_id: string | null;
  amount: string;
  state: Defaulted<'in_approval' | 'paid' | 'cancelled' | 'reversed'>;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface VendorPaymentAllocationsTable {
  tenant_id: Defaulted<string>;
  payment_id: string;
  bill_id: string;
  amount: string;
}

export interface TaxChallansTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  tax_type: TaxType;
  period: string;
  challan_no: string;
  challan_date: string;
  paid_from_account_id: string;
  amount: string;
  state: Defaulted<'in_approval' | 'deposited' | 'cancelled' | 'reversed'>;
  voucher_id: string | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface TaxCertificatesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  vendor_id: string;
  tax_type: TaxType;
  number: string;
  period_from: string;
  period_to: string;
  amount: string;
  issued_by: Defaulted<string | null>;
  issued_at: Generated<Date>;
}

export interface TaxWithholdingsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  vendor_id: string;
  bill_id: string;
  tax_type: TaxType;
  category: string;
  base: string;
  percent: string;
  amount: string;
  deducted_on: string;
  period: string;
  state: Defaulted<'active' | 'void'>;
  challan_id: string | null;
  certificate_id: string | null;
  created_at: Generated<Date>;
}

export interface PayablesSequencesTable {
  tenant_id: Defaulted<string>;
  company_id: string;
  kind: string;
  fiscal_year_code: string;
  last_no: Defaulted<number>;
}

// ------------------------------------------- expense claims and advances (WP16)

export type ExpenseClaimState =
  | 'draft'
  | 'in_approval'
  | 'approved'
  | 'paid'
  | 'settled'
  | 'rejected'
  | 'cancelled';
export type ExpenseAdvanceState =
  'in_approval' | 'approved' | 'paid' | 'settled' | 'rejected' | 'cancelled';

export interface ExpenseCategoriesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  account_id: string;
  receipt_required_above: Defaulted<string>;
  is_active: Defaulted<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface ExpenseAdvancesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  number: string;
  purpose: string;
  amount: string;
  needed_by: string | null;
  state: Defaulted<ExpenseAdvanceState>;
  approval_request_id: string | null;
  voucher_id: string | null;
  paid_at: Date | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface ExpenseClaimsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  employee_id: string;
  number: string;
  title: string;
  advance_id: string | null;
  total: Defaulted<string>;
  advance_applied: Defaulted<string>;
  payable: Defaulted<string>;
  state: Defaulted<ExpenseClaimState>;
  approval_request_id: string | null;
  posting_voucher_id: string | null;
  payment_voucher_id: string | null;
  submitted_at: Date | null;
  paid_at: Date | null;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface ExpenseReceiptsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  company_id: string;
  claim_id: string;
  file_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  status: Defaulted<'active' | 'released'>;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface ExpenseClaimLinesTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  claim_id: string;
  line_no: number;
  expense_date: string;
  category_id: string;
  description: string;
  amount: string;
  receipt_id: string | null;
}

export interface AdvanceSettlementsTable {
  id: Generated<string>;
  tenant_id: Defaulted<string>;
  advance_id: string;
  kind: 'claim' | 'refund' | 'payroll';
  claim_id: string | null;
  loan_id: string | null;
  voucher_id: string | null;
  amount: string;
  state: Defaulted<'pending' | 'done' | 'cancelled'>;
  created_by: Defaulted<string | null>;
  created_at: Generated<Date>;
}

export interface Database {
  tenants: TenantsTable;
  users: UsersTable;
  audit_log: AuditLogTable;
  outbox_events: OutboxEventsTable;
  idempotency_keys: IdempotencyKeysTable;
  companies: CompaniesTable;
  branches: BranchesTable;
  departments: DepartmentsTable;
  department_paths: DepartmentPathsTable;
  designations: DesignationsTable;
  grades: GradesTable;
  employees: EmployeesTable;
  employee_job_events: EmployeeJobEventsTable;
  employee_assignments: EmployeeAssignmentsTable;
  employee_documents: EmployeeDocumentsTable;
  onboarding_checklists: OnboardingChecklistsTable;
  custom_roles: CustomRolesTable;
  custom_role_permissions: CustomRolePermissionsTable;
  user_roles: UserRolesTable;
  field_grants: FieldGrantsTable;
  delegations: DelegationsTable;
  employee_bank_accounts: EmployeeBankAccountsTable;
  approval_chains: ApprovalChainsTable;
  approval_chain_steps: ApprovalChainStepsTable;
  approval_requests: ApprovalRequestsTable;
  approval_step_assignments: ApprovalStepAssignmentsTable;
  approval_actions: ApprovalActionsTable;
  rule_packs: RulePacksTable;
  rule_values: RuleValuesTable;
  rule_value_history: RuleValueHistoryTable;
  tenant_rule_packs: TenantRulePacksTable;
  holiday_calendars: HolidayCalendarsTable;
  holidays: HolidaysTable;
  shifts: ShiftsTable;
  shift_assignments: ShiftAssignmentsTable;
  shift_overrides: ShiftOverridesTable;
  attendance_profiles: AttendanceProfilesTable;
  employee_devices: EmployeeDevicesTable;
  attendance_devices: AttendanceDevicesTable;
  attendance_punches: AttendancePunchesTable;
  attendance_days: AttendanceDaysTable;
  attendance_adjustments: AttendanceAdjustmentsTable;
  attendance_locks: AttendanceLocksTable;
  attendance_corrections: AttendanceCorrectionsTable;
  overtime_requests: OvertimeRequestsTable;
  service_keys: ServiceKeysTable;
  leave_policies: LeavePoliciesTable;
  leave_types: LeaveTypesTable;
  leave_ledger: LeaveLedgerTable;
  leave_requests: LeaveRequestsTable;
  leave_encashments: LeaveEncashmentsTable;
  payroll_settings: PayrollSettingsTable;
  salary_heads: SalaryHeadsTable;
  salary_structures: SalaryStructuresTable;
  employee_salaries: EmployeeSalariesTable;
  payroll_ytd_openings: PayrollYtdOpeningsTable;
  pf_openings: PfOpeningsTable;
  probation_reviews: ProbationReviewsTable;
  separations: SeparationsTable;
  separation_clearances: SeparationClearancesTable;
  salary_tax_challans: SalaryTaxChallansTable;
  procurement_settings: ProcurementSettingsTable;
  budget_settings: BudgetSettingsTable;
  asset_classes: AssetClassesTable;
  assets: AssetsTable;
  asset_assignments: AssetAssignmentsTable;
  asset_maintenance: AssetMaintenanceTable;
  depreciation_runs: DepreciationRunsTable;
  depreciation_lines: DepreciationLinesTable;
  stores: StoresTable;
  stock_items: StockItemsTable;
  stock_issue_requests: StockIssueRequestsTable;
  stock_issue_request_lines: StockIssueRequestLinesTable;
  stock_moves: StockMovesTable;
  stock_balances: StockBalancesTable;
  company_bank_accounts: CompanyBankAccountsTable;
  vat_items: VatItemsTable;
  vat_item_rates: VatItemRatesTable;
  vat_sales: VatSalesTable;
  vat_sale_lines: VatSaleLinesTable;
  vat_returns: VatReturnsTable;
  compliance_items: ComplianceItemsTable;
  opening_balance_imports: OpeningBalanceImportsTable;
  account_map: AccountMapTable;
  receivable_items: ReceivableItemsTable;
  receivable_receipts: ReceivableReceiptsTable;
  old_system_comparisons: OldSystemComparisonsTable;
  month_close_items: MonthCloseItemsTable;
  sales_territories: SalesTerritoriesTable;
  sales_territory_members: SalesTerritoryMembersTable;
  crm_assignment_cursors: CrmAssignmentCursorsTable;
  customers: CustomersTable;
  customer_contacts: CustomerContactsTable;
  leads: LeadsTable;
  crm_contact_keys: CrmContactKeysTable;
  crm_activities: CrmActivitiesTable;
  opportunity_stages: OpportunityStagesTable;
  opportunities: OpportunitiesTable;
  opportunity_stage_history: OpportunityStageHistoryTable;
  sales_targets: SalesTargetsTable;
  products: ProductsTable;
  price_lists: PriceListsTable;
  price_list_items: PriceListItemsTable;
  discount_limits: DiscountLimitsTable;
  sales_quotations: SalesQuotationsTable;
  sales_quotation_lines: SalesQuotationLinesTable;
  sales_orders: SalesOrdersTable;
  sales_order_lines: SalesOrderLinesTable;
  sales_invoices: SalesInvoicesTable;
  sales_invoice_lines: SalesInvoiceLinesTable;
  credit_notes: CreditNotesTable;
  credit_note_lines: CreditNoteLinesTable;
  customer_receipts: CustomerReceiptsTable;
  customer_receipt_allocations: CustomerReceiptAllocationsTable;
  advance_applications: AdvanceApplicationsTable;
  collection_reminders: CollectionRemindersTable;
  pf_transactions: PfTransactionsTable;
  resignation_requests: ResignationRequestsTable;
  bank_statements: BankStatementsTable;
  bank_statement_lines: BankStatementLinesTable;
  bank_matches: BankMatchesTable;
  bank_match_items: BankMatchItemsTable;
  budgets: BudgetsTable;
  budget_lines: BudgetLinesTable;
  budget_revisions: BudgetRevisionsTable;
  budget_revision_lines: BudgetRevisionLinesTable;
  budget_alerts: BudgetAlertsTable;
  purchase_requisitions: PurchaseRequisitionsTable;
  purchase_requisition_lines: PurchaseRequisitionLinesTable;
  quotations: QuotationsTable;
  quotation_lines: QuotationLinesTable;
  purchase_orders: PurchaseOrdersTable;
  purchase_order_lines: PurchaseOrderLinesTable;
  goods_receipts: GoodsReceiptsTable;
  goods_receipt_lines: GoodsReceiptLinesTable;
  payroll_variables: PayrollVariablesTable;
  loans: LoansTable;
  loan_recoveries: LoanRecoveriesTable;
  payroll_runs: PayrollRunsTable;
  payroll_run_employees: PayrollRunEmployeesTable;
  payroll_lines: PayrollLinesTable;
  payroll_flags: PayrollFlagsTable;
  disbursement_files: DisbursementFilesTable;
  payments: PaymentsTable;
  import_batches: ImportBatchesTable;
  import_rows: ImportRowsTable;
  migration_signoffs: MigrationSignoffsTable;
  notification_events: NotificationEventsTable;
  notifications: NotificationsTable;
  ai_settings: AiSettingsTable;
  ai_usage: AiUsageTable;
  ai_interactions: AiInteractionsTable;
  ai_policy_documents: AiPolicyDocumentsTable;
  ai_policy_chunks: AiPolicyChunksTable;
  ai_release_gates: AiReleaseGatesTable;
  employee_consents: EmployeeConsentsTable;
  system_job_runs: SystemJobRunsTable;
  parallel_run_comparisons: ParallelRunComparisonsTable;
  parallel_run_lines: ParallelRunLinesTable;
  fiscal_years: FiscalYearsTable;
  accounting_periods: AccountingPeriodsTable;
  accounts: AccountsTable;
  posting_accounts: PostingAccountsTable;
  voucher_sequences: VoucherSequencesTable;
  vouchers: VouchersTable;
  voucher_lines: VoucherLinesTable;
  payables_settings: PayablesSettingsTable;
  vendors: VendorsTable;
  vendor_bank_accounts: VendorBankAccountsTable;
  vendor_bills: VendorBillsTable;
  vendor_bill_lines: VendorBillLinesTable;
  vendor_payments: VendorPaymentsTable;
  vendor_payment_allocations: VendorPaymentAllocationsTable;
  tax_challans: TaxChallansTable;
  tax_certificates: TaxCertificatesTable;
  tax_withholdings: TaxWithholdingsTable;
  payables_sequences: PayablesSequencesTable;
  expense_categories: ExpenseCategoriesTable;
  expense_advances: ExpenseAdvancesTable;
  expense_claims: ExpenseClaimsTable;
  expense_receipts: ExpenseReceiptsTable;
  expense_claim_lines: ExpenseClaimLinesTable;
  advance_settlements: AdvanceSettlementsTable;
  punch_attempts: PunchAttemptsTable;
}

export type Notification = Selectable<NotificationsTable>;

export type ImportBatch = Selectable<ImportBatchesTable>;
export type ImportRow = Selectable<ImportRowsTable>;

export type DisbursementFile = Selectable<DisbursementFilesTable>;
export type Payment = Selectable<PaymentsTable>;

export type PayrollSettingsRow = Selectable<PayrollSettingsTable>;
export type SalaryHead = Selectable<SalaryHeadsTable>;
export type SalaryStructure = Selectable<SalaryStructuresTable>;
export type EmployeeSalary = Selectable<EmployeeSalariesTable>;
export type Loan = Selectable<LoansTable>;
export type PayrollRun = Selectable<PayrollRunsTable>;
export type PayrollLine = Selectable<PayrollLinesTable>;

export type LeaveType = Selectable<LeaveTypesTable>;
export type LeaveRequest = Selectable<LeaveRequestsTable>;
export type LeavePolicy = Selectable<LeavePoliciesTable>;

export type Holiday = Selectable<HolidaysTable>;
export type Shift = Selectable<ShiftsTable>;
export type AttendanceDay = Selectable<AttendanceDaysTable>;

export type RulePack = Selectable<RulePacksTable>;
export type RuleValue = Selectable<RuleValuesTable>;

export type UserRole = Selectable<UserRolesTable>;
export type CustomRole = Selectable<CustomRolesTable>;
export type Delegation = Selectable<DelegationsTable>;
export type EmployeeBankAccount = Selectable<EmployeeBankAccountsTable>;
export type ApprovalRequest = Selectable<ApprovalRequestsTable>;
export type ApprovalAssignment = Selectable<ApprovalStepAssignmentsTable>;

export type Company = Selectable<CompaniesTable>;
export type Branch = Selectable<BranchesTable>;
export type Department = Selectable<DepartmentsTable>;
export type Designation = Selectable<DesignationsTable>;
export type Grade = Selectable<GradesTable>;
export type Employee = Selectable<EmployeesTable>;
export type Separation = Selectable<SeparationsTable>;
export type PurchaseRequisition = Selectable<PurchaseRequisitionsTable>;
export type Budget = Selectable<BudgetsTable>;
export type Asset = Selectable<AssetsTable>;
export type AssetClass = Selectable<AssetClassesTable>;
export type StockIssueRequest = Selectable<StockIssueRequestsTable>;
export type PurchaseOrder = Selectable<PurchaseOrdersTable>;
export type Quotation = Selectable<QuotationsTable>;
export type ProbationReview = Selectable<ProbationReviewsTable>;
export type EmployeeJobEvent = Selectable<EmployeeJobEventsTable>;
export type EmployeeAssignment = Selectable<EmployeeAssignmentsTable>;
export type EmployeeDocument = Selectable<EmployeeDocumentsTable>;
export type OnboardingItem = Selectable<OnboardingChecklistsTable>;

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type OutboxEvent = Selectable<OutboxEventsTable>;
export type AuditEntryRow = Selectable<AuditLogTable>;

export type Account = Selectable<AccountsTable>;
export type Voucher = Selectable<VouchersTable>;
export type VoucherLine = Selectable<VoucherLinesTable>;
export type Vendor = Selectable<VendorsTable>;
export type VendorBill = Selectable<VendorBillsTable>;
export type VendorPayment = Selectable<VendorPaymentsTable>;
export type TaxChallan = Selectable<TaxChallansTable>;
export type TaxWithholding = Selectable<TaxWithholdingsTable>;
export type ExpenseCategory = Selectable<ExpenseCategoriesTable>;
export type ExpenseAdvance = Selectable<ExpenseAdvancesTable>;
export type ExpenseClaim = Selectable<ExpenseClaimsTable>;
export type FiscalYear = Selectable<FiscalYearsTable>;
