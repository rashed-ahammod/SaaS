/**
 * Migration templates (guide §17 step 1): one sheet per entity. Row 1 holds the
 * column names below (exactly); each following row is one record. Dates are
 * YYYY-MM-DD (an Excel date cell is also accepted), money is plain digits.
 *
 * Load in this order (later templates refer to employees by employee_code):
 *   1 employees  2 salaries  3 leave_balances  4 ytd_openings  5 loans  6 bank_accounts
 *   7 customers (the CRM customer master; any time after the salespeople have logins)
 */
import type { ImportEntity } from '../../platform/db/schema.js';

export interface TemplateColumn {
  key: string;
  required: boolean;
  description: string;
  example: string;
}

export interface TemplateDef {
  entity: ImportEntity;
  order: number;
  title: string;
  description: string;
  columns: TemplateColumn[];
}

const col = (
  key: string,
  required: boolean,
  description: string,
  example: string,
): TemplateColumn => ({ key, required, description, example });

export const TEMPLATES: TemplateDef[] = [
  {
    entity: 'employees',
    order: 1,
    title: 'Employees',
    description:
      'People employed at cut-over, with their placement. They are created active (onboarding marked done). Line managers may be in the same file.',
    columns: [
      col(
        'employee_code',
        true,
        'Code from the old system (kept), e.g. DTL-00012',
        'DTL-00012',
      ),
      col('full_name_en', true, 'Name in English', 'Mahmudul Hasan Rafi'),
      col('full_name_bn', false, 'Name in Bangla', 'মাহমুদুল হাসান রাফি'),
      col('gender', false, 'male / female / other', 'male'),
      col('date_of_birth', false, 'YYYY-MM-DD', '1998-08-15'),
      col('nid', false, 'National ID: 10, 13 or 17 digits', '1998123456786'),
      col('tin', false, 'e-TIN: 12 digits', '123456789012'),
      col('phone', false, 'Mobile, e.g. 01712345678', '01712345678'),
      col('personal_email', false, 'Personal e-mail', 'rafi.hasan@gmail.com'),
      col(
        'join_date',
        true,
        'YYYY-MM-DD, on or before the cut-over date',
        '2025-01-01',
      ),
      col('branch_code', true, 'Branch code in this system', 'DHK'),
      col(
        'department_code',
        true,
        'Department code in this system',
        'SALES-DHK',
      ),
      col('designation_code', true, 'Designation code in this system', 'EXE'),
      col('grade_code', true, 'Grade code in this system', 'G1'),
      col(
        'line_manager_code',
        false,
        'employee_code of the line manager (in this file or already in the system)',
        'DTL-00004',
      ),
      col(
        'festival_group',
        false,
        'Festival bonus group, e.g. eid / puja',
        'eid',
      ),
      col('status', false, 'active (default) or probation', 'active'),
      col(
        'probation_end_date',
        false,
        'YYYY-MM-DD, needed when status is probation',
        '',
      ),
    ],
  },
  {
    entity: 'salaries',
    order: 2,
    title: 'Salaries',
    description:
      'Gross salary in force at cut-over (one row per employee; earlier history optional, one row per change).',
    columns: [
      col('employee_code', true, 'Employee', 'DTL-00012'),
      col(
        'effective_from',
        true,
        'YYYY-MM-DD, on or after the join date',
        '2026-07-01',
      ),
      col('gross', true, 'Monthly gross in taka', '30000'),
      col(
        'structure_code',
        false,
        'Salary structure code (default STD)',
        'STD',
      ),
      col(
        'reason',
        false,
        'e.g. Annual increment 2026',
        'Annual increment 2026',
      ),
    ],
  },
  {
    entity: 'leave_balances',
    order: 3,
    title: 'Leave balances',
    description:
      'Unused leave on the day before cut-over, per employee and leave type (types with a balance: CL, SL, EL ...).',
    columns: [
      col('employee_code', true, 'Employee', 'DTL-00012'),
      col('leave_type_code', true, 'Leave type code, e.g. EL', 'EL'),
      col('days', true, 'Balance in days (halves allowed)', '12.5'),
    ],
  },
  {
    entity: 'ytd_openings',
    order: 4,
    title: 'Year-to-date salary, tax and PF',
    description:
      'Paid in the old system this fiscal year before cut-over (from the old payroll register).',
    columns: [
      col('employee_code', true, 'Employee', 'DTL-00012'),
      col('fiscal_year', true, 'e.g. 2026-27 (July-June)', '2026-27'),
      col(
        'taxable_income',
        true,
        'Taxable salary paid so far this fiscal year',
        '90000',
      ),
      col(
        'tax_withheld',
        true,
        'Income tax deducted so far this fiscal year',
        '0',
      ),
      col('pf_employee', false, 'Employee PF contribution so far', '0'),
      col('pf_employer', false, 'Employer PF contribution so far', '0'),
    ],
  },
  {
    entity: 'loans',
    order: 5,
    title: 'Outstanding salary advances and loans',
    description:
      'What is still to be recovered at cut-over. Recovery continues from next_period.',
    columns: [
      col('employee_code', true, 'Employee', 'DTL-00015'),
      col('outstanding', true, 'Amount still to recover', '9000'),
      col('installment', true, 'Monthly installment', '3000'),
      col(
        'next_period',
        true,
        'First month to recover in this system, YYYY-MM',
        '2026-10',
      ),
      col(
        'reason',
        false,
        'What it was for',
        'Medical advance (old register no. 45)',
      ),
    ],
  },
  {
    entity: 'bank_accounts',
    order: 6,
    title: 'Salary bank / wallet accounts',
    description:
      'Accounts salaries are paid to (one per employee). Imported accounts are approved; later changes go through approval.',
    columns: [
      col('employee_code', true, 'Employee', 'DTL-00012'),
      col('kind', true, 'bank or wallet', 'bank'),
      col('account_name', true, 'Name on the account', 'Mahmudul Hasan Rafi'),
      col('bank_name', false, 'Bank (kind = bank)', 'Dutch-Bangla Bank PLC'),
      col('branch_name', false, 'Branch (kind = bank)', 'Gulshan'),
      col(
        'routing_number',
        false,
        '9-digit routing number (kind = bank)',
        '090261725',
      ),
      col(
        'account_number',
        false,
        '8-20 digits (kind = bank)',
        '1051100012345',
      ),
      col(
        'wallet_provider',
        false,
        'bkash / nagad / rocket / upay (kind = wallet)',
        '',
      ),
      col('wallet_number', false, '01XXXXXXXXX (kind = wallet)', ''),
    ],
  },
  {
    entity: 'customers',
    order: 7,
    title: 'Customers',
    description:
      'The customer master from the old system. Each gets a new code (C-00001); the old code is kept in the name note. A phone or e-mail may belong to one customer only. The old code stays with the import batch for reference. Credit terms are what Accounts agreed.',
    columns: [
      col('name', true, 'Customer name', 'Meghna Dealers'),
      col('kind', false, 'company or person (default company)', 'company'),
      col(
        'customer_type',
        false,
        'dealer / distributor / retail / corporate / government / export (default retail)',
        'dealer',
      ),
      col('name_bn', false, 'Name in Bangla', 'মেঘনা ডিলার্স'),
      col(
        'old_code',
        false,
        'The code in the old system (kept for reference)',
        'D-0412',
      ),
      col('bin', false, 'VAT BIN, 13 digits', '000234567-0201'),
      col('tin', false, 'TIN, 12 digits', ''),
      col('phone', false, 'Bangladesh phone number', '031-2852211'),
      col('email', false, 'E-mail', 'accounts@meghnadealers.com.bd'),
      col('address', false, 'Address', 'Khatunganj, Chattogram'),
      col('district', false, 'One of the 64 districts', 'Chattogram'),
      col(
        'account_manager_email',
        false,
        'Login e-mail of the salesperson who looks after them',
        'rafi@demo.test',
      ),
      col('credit_limit', false, 'Credit limit in taka (default 0)', '500000'),
      col('payment_terms_days', false, 'Days to pay (default 0)', '30'),
    ],
  },
];

export function templateOf(entity: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.entity === entity);
}
