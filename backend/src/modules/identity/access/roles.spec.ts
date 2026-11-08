/**
 * Permission matrix test (guide §8, §21): each cell of the spec §4 table,
 * written out independently of roles.ts, checked against roles.ts.
 *
 * If the business changes the matrix, change the spec, then this table, then roles.ts.
 */
import type { SystemRoleKey } from '../../../platform/db/schema.js';
import type { PermissionKey } from './permissions.js';
import { SYSTEM_ROLES } from './roles.js';

type Cell = 'yes' | 'no';
type Row = {
  capability: string;
  permission: PermissionKey;
  cells: Partial<Record<SystemRoleKey, Cell>>;
};

// Spec §4 matrix (Phase 1 rows). Roles not mentioned in a row must NOT have the permission.
const MATRIX: Row[] = [
  // Company settings, users, roles: Admin F (and System Admin, guide §1)
  {
    capability: 'Users',
    permission: 'users.manage',
    cells: { admin: 'yes', system_admin: 'yes' },
  },
  {
    capability: 'Roles',
    permission: 'roles.grant',
    cells: { admin: 'yes', system_admin: 'yes' },
  },
  {
    capability: 'Company structure',
    permission: 'org.structure.manage',
    cells: { admin: 'yes', system_admin: 'yes' },
  },
  // Designations, grades: owned by HR (spec §3 master data)
  {
    capability: 'Designations / grades',
    permission: 'org.jobs.manage',
    cells: { hr: 'yes' },
  },
  // Employee profiles: Admin V, HR F, Accounts V, Dept Head V (dept), Employee O
  {
    capability: 'Employee profiles: view',
    permission: 'employee.view',
    cells: {
      admin: 'yes',
      system_admin: 'yes',
      hr: 'yes',
      accounts: 'yes',
      dept_head: 'yes',
      employee: 'yes',
      auditor: 'yes',
    },
  },
  {
    capability: 'Employee profiles: manage',
    permission: 'employee.manage',
    cells: { hr: 'yes' },
  },
  {
    capability: 'Employee: edit own contact',
    permission: 'employee.contact.edit_own',
    cells: { employee: 'yes' },
  },
  // Attendance: Admin V, HR F, Dept Head A (dept), Employee O + request
  {
    capability: 'Attendance: view',
    permission: 'attendance.view',
    cells: { admin: 'yes', hr: 'yes', dept_head: 'yes', auditor: 'yes' },
  },
  {
    capability: 'Attendance: manage',
    permission: 'attendance.manage',
    cells: { hr: 'yes' },
  },
  {
    capability: 'Attendance: approve corrections',
    permission: 'attendance.correction.approve',
    cells: { dept_head: 'yes' },
  },
  {
    capability: 'Attendance: own',
    permission: 'attendance.own',
    cells: { employee: 'yes' },
  },
  // device upload is for machines only (service keys)
  {
    capability: 'Attendance: device upload',
    permission: 'attendance.ingest',
    cells: {},
  },
  // Leave: Admin V, HR F + final A, Dept Head A (dept), Employee O apply
  {
    capability: 'Leave: view',
    permission: 'leave.view',
    cells: { admin: 'yes', hr: 'yes', dept_head: 'yes', auditor: 'yes' },
  },
  {
    capability: 'Leave: manage',
    permission: 'leave.manage',
    cells: { hr: 'yes' },
  },
  {
    capability: 'Leave: approve',
    permission: 'leave.approve',
    cells: { hr: 'yes', dept_head: 'yes' },
  },
  {
    capability: 'Leave: apply',
    permission: 'leave.apply_own',
    cells: { employee: 'yes' },
  },
  // Payroll run: Admin A final, HR P, Accounts A verify + disburse, Employee O payslip
  {
    capability: 'Payroll: prepare',
    permission: 'payroll.prepare',
    cells: { hr: 'yes' },
  },
  {
    capability: 'Payroll: verify',
    permission: 'payroll.verify',
    cells: { accounts: 'yes' },
  },
  {
    capability: 'Payroll: final approval',
    permission: 'payroll.approve',
    cells: { admin: 'yes' },
  },
  {
    capability: 'Payroll: disburse',
    permission: 'payroll.disburse',
    cells: { accounts: 'yes' },
  },
  {
    capability: 'Payslip: own',
    permission: 'payslip.view_own',
    cells: { employee: 'yes' },
  },
  // Data migration (spec §10): HR loads the data, the customer (Admin) signs the reconciliation
  {
    capability: 'Data import',
    permission: 'data.import',
    cells: { hr: 'yes' },
  },
  {
    capability: 'Data import: sign-off',
    permission: 'data.import.sign_off',
    cells: { admin: 'yes' },
  },
  // Audit log: Admin V, Accounts V finance entries
  {
    capability: 'Audit log',
    permission: 'audit.view',
    cells: { admin: 'yes', system_admin: 'yes', auditor: 'yes' },
  },
  {
    capability: 'Audit log: finance',
    permission: 'audit.view_finance',
    cells: { accounts: 'yes' },
  },
  // Rule pack (guide §18): management and compliance readers view; Admin accepts a version
  {
    capability: 'Rule pack: view',
    permission: 'rules.view',
    cells: {
      admin: 'yes',
      system_admin: 'yes',
      hr: 'yes',
      accounts: 'yes',
      auditor: 'yes',
    },
  },
  {
    capability: 'Rule pack: accept version',
    permission: 'rules.accept',
    cells: { admin: 'yes' },
  },
  // n8n relays messages with a per-event token; no human role
  {
    capability: 'Notifications: relay',
    permission: 'notifications.relay',
    cells: {},
  },
  // n8n workflows: Admin F
  {
    capability: 'Integrations',
    permission: 'integrations.manage',
    cells: { admin: 'yes', system_admin: 'yes' },
  },
  // Vouchers, ledger (spec §4): Admin V (+ A above limit via the approval chain), Accounts F (maker-checker); auditor reads
  {
    capability: 'Ledger: view',
    permission: 'ledger.view',
    cells: { admin: 'yes', accounts: 'yes', auditor: 'yes' },
  },
  {
    capability: 'Ledger: prepare vouchers',
    permission: 'ledger.vouchers.prepare',
    cells: { accounts: 'yes' },
  },
  {
    capability: 'Ledger: setup',
    permission: 'ledger.setup',
    cells: { accounts: 'yes' },
  },
  {
    capability: 'Ledger: close period',
    permission: 'ledger.periods.close',
    cells: { accounts: 'yes' },
  },
  // Vendors, bills, payments, VAT / tax at source (spec §4: Accounts F; vendors need maker-checker)
  {
    capability: 'Payables: view',
    permission: 'payables.view',
    cells: { admin: 'yes', accounts: 'yes', auditor: 'yes' },
  },
  {
    capability: 'Payables: vendors, bills, payments',
    permission: 'payables.manage',
    cells: { accounts: 'yes' },
  },
  {
    capability: 'Payables: tax challans, certificates',
    permission: 'payables.tax',
    cells: { accounts: 'yes' },
  },
  // Expense claims (spec §5: Dept Head -> Accounts verify, pay; above threshold -> Admin): approvals are the inbox
  {
    capability: 'Expenses: own claims and advances',
    permission: 'expenses.claim_own',
    cells: { employee: 'yes' },
  },
  {
    capability: 'Expenses: view',
    permission: 'expenses.view',
    cells: { admin: 'yes', accounts: 'yes', auditor: 'yes' },
  },
  {
    capability: 'Expenses: pay',
    permission: 'expenses.pay',
    cells: { accounts: 'yes' },
  },
  // AI (WP11): Admin switches features and watches usage; HR (and Admin) keep the policy texts
  {
    capability: 'AI settings and usage',
    permission: 'ai.manage',
    cells: { admin: 'yes' },
  },
  {
    capability: 'AI policy documents',
    permission: 'ai.policies.manage',
    cells: { admin: 'yes', hr: 'yes' },
  },
  // AI assistant: everyone
  {
    capability: 'AI assistant',
    permission: 'ai.assistant.use',
    cells: {
      admin: 'yes',
      system_admin: 'yes',
      hr: 'yes',
      accounts: 'yes',
      dept_head: 'yes',
      employee: 'yes',
      auditor: 'yes',
      sales: 'yes',
    },
  },
  // CRM pipeline (spec §4): Admin V (company), Dept Head V (dept), Sales users O; Accounts: credit terms (invoices, collections)
  {
    capability: 'CRM: view',
    permission: 'crm.view',
    cells: { admin: 'yes', dept_head: 'yes', auditor: 'yes' },
  },
  {
    capability: 'CRM: own leads and customers',
    permission: 'crm.own',
    cells: { sales: 'yes' },
  },
  {
    capability: 'CRM: hand leads over',
    permission: 'crm.assign',
    cells: { admin: 'yes', dept_head: 'yes' },
  },
  {
    capability: 'CRM: territories, any customer',
    permission: 'crm.manage',
    cells: { admin: 'yes' },
  },
  {
    capability: 'CRM: credit limits and terms',
    permission: 'crm.credit',
    cells: { accounts: 'yes' },
  },
  {
    capability: 'CRM: leads from outside (service key)',
    permission: 'crm.capture',
    cells: {},
  },
  {
    capability: 'Sales: products, price lists, discount limits',
    permission: 'sales.catalogue',
    cells: { admin: 'yes', accounts: 'yes' },
  },
];

const ROLES = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];

describe('permission matrix (spec §4)', () => {
  for (const row of MATRIX) {
    for (const role of ROLES) {
      const expected = row.cells[role] === 'yes';
      it(`${row.capability}: ${role} ${expected ? 'has' : 'does not have'} ${row.permission}`, () => {
        expect(SYSTEM_ROLES[role].permissions.includes(row.permission)).toBe(
          expected,
        );
      });
    }
  }
});

describe('sensitive fields (spec §4 "Salary and bank data")', () => {
  it('HR sees salary, bank and identity; Accounts sees salary and bank', () => {
    expect(SYSTEM_ROLES.hr.fieldGroups.sort()).toEqual([
      'bank',
      'identity',
      'salary',
    ]);
    expect(SYSTEM_ROLES.accounts.fieldGroups.sort()).toEqual([
      'bank',
      'salary',
    ]);
  });

  it('System Admin, Dept Head and Auditor see no sensitive fields without a grant', () => {
    for (const role of ['system_admin', 'dept_head', 'auditor'] as const) {
      expect(SYSTEM_ROLES[role].fieldGroups).toEqual([]);
    }
  });

  it('Admin (the MD who approves payroll) sees salaries, but not bank or identity data (decision 2026-10-21)', () => {
    expect(SYSTEM_ROLES.admin.fieldGroups).toEqual(['salary']);
  });
});

describe('role rules', () => {
  it('two-factor is mandatory for Admin, System Admin, HR and Accounts only', () => {
    const privileged = ROLES.filter((r) => SYSTEM_ROLES[r].privileged).sort();
    expect(privileged).toEqual(['accounts', 'admin', 'hr', 'system_admin']);
  });

  it('Dept Head is granted per department, Employee and Sales user per own record, Auditor time-limited', () => {
    expect(SYSTEM_ROLES.dept_head.allowedScopes).toEqual(['department']);
    expect(SYSTEM_ROLES.employee.allowedScopes).toEqual(['own']);
    expect(SYSTEM_ROLES.sales.allowedScopes).toEqual(['own']);
    expect(SYSTEM_ROLES.auditor.timeLimited).toBe(true);
  });
});
