/**
 * The eight system roles (spec §4, guide §1: Admin and System Admin are separate; the Sales
 * user is the spec's optional add-on role, Phase 3 WP23).
 * Same for every tenant; they cannot be edited, only copied into a custom role.
 *
 * A role's permissions apply within the SCOPE it is granted with:
 *   HR (company scope), Dept Head (department scope), Employee (own scope) ...
 *
 * `fieldGroups` are the sensitive fields the role can see inside its scope
 * (spec §4 "Salary and bank data": HR full, Accounts view, Admin only by grant).
 * Everyone always sees their own record's sensitive fields.
 *
 * test/integration/... and roles.spec.ts check this against the spec matrix.
 */
import type {
  FieldGroup,
  ScopeType,
  SystemRoleKey,
} from '../../../platform/db/schema.js';
import type { PermissionKey } from './permissions.js';

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  nameEn: string;
  nameBn: string;
  /** Two-factor login is mandatory (spec §11). */
  privileged: boolean;
  /** Scopes this role may be granted with. */
  allowedScopes: ScopeType[];
  /** Must be granted with an end date (e.g. external auditor). */
  timeLimited?: boolean;
  permissions: PermissionKey[];
  fieldGroups: FieldGroup[];
}

const EVERYONE: PermissionKey[] = ['org.view', 'ai.assistant.use'];

export const SYSTEM_ROLES: Record<SystemRoleKey, SystemRoleDefinition> = {
  admin: {
    key: 'admin',
    nameEn: 'Admin',
    nameBn: 'অ্যাডমিন',
    privileged: true,
    allowedScopes: ['company', 'group'],
    permissions: [
      ...EVERYONE,
      'org.structure.manage',
      'users.manage',
      'roles.manage',
      'roles.grant',
      'employee.view',
      'attendance.view',
      'leave.view',
      'payroll.approve',
      'data.import.sign_off',
      'rules.view',
      'rules.accept',
      'approvals.configure',
      'approvals.view_all',
      'audit.view',
      'integrations.manage',
      'ai.manage',
      'ai.policies.manage',
      'ledger.view',
      'payables.view',
      'expenses.view',
      'procurement.view',
      'procurement.override_match',
      'budgets.view',
      'assets.view',
      'assets.manage',
      'stock.view',
      'stock.manage',
      'bank.view',
      'vat.view',
      'compliance.view',
      'compliance.manage',
      'receivables.view',
      'crm.view',
      'crm.assign',
      'crm.manage',
      'sales.catalogue',
    ],
    fieldGroups: ['salary'], // the MD approves payroll and reads per-employee salaries (2026-10-21 decision; bank stays hidden)
  },

  system_admin: {
    key: 'system_admin',
    nameEn: 'System Admin',
    nameBn: 'সিস্টেম অ্যাডমিন',
    privileged: true,
    allowedScopes: ['company', 'group'],
    permissions: [
      ...EVERYONE,
      'org.structure.manage',
      'users.manage',
      'roles.manage',
      'roles.grant',
      'employee.view', // to link logins to employees; sensitive fields stay masked
      'rules.view',
      'approvals.configure',
      'audit.view',
      'integrations.manage',
    ],
    fieldGroups: [],
  },

  hr: {
    key: 'hr',
    nameEn: 'HR',
    nameBn: 'মানবসম্পদ',
    privileged: true,
    allowedScopes: ['company', 'group'],
    permissions: [
      ...EVERYONE,
      'org.jobs.manage',
      'employee.view',
      'employee.manage',
      'employee.documents.view',
      'employee.bank.manage',
      'attendance.view',
      'attendance.manage',
      'leave.view',
      'leave.manage',
      'leave.approve',
      'rules.view',
      'payroll.prepare',
      'assets.view',
      'data.import',
      'ai.policies.manage',
    ],
    fieldGroups: ['salary', 'bank', 'identity'],
  },

  accounts: {
    key: 'accounts',
    nameEn: 'Accounts',
    nameBn: 'হিসাব',
    privileged: true,
    allowedScopes: ['company', 'group'],
    permissions: [
      ...EVERYONE,
      'employee.view',
      'payroll.verify',
      'payroll.disburse',
      'audit.view_finance',
      'rules.view',
      'ledger.view',
      'ledger.vouchers.prepare',
      'ledger.setup',
      'ledger.periods.close',
      'payables.view',
      'payables.manage',
      'payables.tax',
      'expenses.view',
      'expenses.pay',
      'procurement.view',
      'procurement.manage',
      'procurement.receive',
      'budgets.view',
      'budgets.manage',
      'assets.view',
      'assets.depreciate',
      'stock.view',
      'stock.manage',
      'bank.view',
      'bank.reconcile',
      'bank.import',
      'vat.view',
      'vat.manage',
      'compliance.view',
      'compliance.manage',
      'receivables.view',
      'receivables.manage',
      'crm.credit',
      'sales.catalogue',
    ],
    fieldGroups: ['salary', 'bank'], // "V payroll fields"
  },

  dept_head: {
    key: 'dept_head',
    nameEn: 'Department Head',
    nameBn: 'বিভাগীয় প্রধান',
    privileged: false,
    allowedScopes: ['department'],
    permissions: [
      ...EVERYONE,
      'employee.view',
      'employee.lifecycle.review',
      'attendance.view',
      'attendance.correction.approve',
      'leave.view',
      'leave.approve',
      'procurement.view',
      'procurement.receive',
      'budgets.view',
      'budgets.request_change',
      'assets.view',
      'stock.view',
      'crm.view',
      'crm.assign',
    ],
    fieldGroups: [], // "V (dept), no salary"
  },

  employee: {
    key: 'employee',
    nameEn: 'Employee',
    nameBn: 'কর্মী',
    privileged: false,
    allowedScopes: ['own'],
    permissions: [
      ...EVERYONE,
      'employee.view',
      'employee.contact.edit_own',
      'employee.documents.view',
      'employee.bank.request_own',
      'attendance.own',
      'leave.apply_own',
      'payslip.view_own',
      'payroll.loan.request_own',
      'expenses.claim_own',
      'procurement.request_own',
      'assets.own',
      'stock.request_own',
    ],
    fieldGroups: [],
  },

  auditor: {
    key: 'auditor',
    nameEn: 'Auditor (read-only)',
    nameBn: 'নিরীক্ষক (শুধু দেখা)',
    privileged: false,
    allowedScopes: ['company', 'group'],
    timeLimited: true,
    permissions: [
      ...EVERYONE,
      'employee.view',
      'attendance.view',
      'leave.view',
      'audit.view',
      'rules.view',
      'ledger.view',
      'payables.view',
      'expenses.view',
      'procurement.view',
      'budgets.view',
      'assets.view',
      'stock.view',
      'bank.view',
      'vat.view',
      'compliance.view',
      'receivables.view',
      'crm.view',
    ],
    fieldGroups: [],
  },

  // spec §4 optional add-on role: "Sales user (CRM pipeline, own scope)"; also an employee
  sales: {
    key: 'sales',
    nameEn: 'Sales user',
    nameBn: 'বিক্রয় কর্মী',
    privileged: false,
    allowedScopes: ['own'],
    permissions: [...EVERYONE, 'crm.own'],
    fieldGroups: [],
  },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return value in SYSTEM_ROLES;
}
