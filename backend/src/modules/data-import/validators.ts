/**
 * Row validation for each migration template (guide §17 step 2): missing fields,
 * unknown codes, invalid NID / TIN / dates / amounts, duplicates in the file or
 * in the system. Pure functions: the service loads the lookups into an
 * ImportContext first, so the same rules run at upload and again at commit.
 */
import {
  districtOf,
  normalizeEmail,
  normalizePhone,
} from '../crm/crm-rules.js';
import { businessDate } from '../../platform/dates/business-date.js';
import { Money } from '../../platform/money/money.js';
import type { ImportEntity } from '../../platform/db/schema.js';
import { templateOf } from './templates.js';

export interface RowError {
  column: string;
  message: string;
}

export interface ImportContext {
  cutOverDate: string; // YYYY-MM-01
  branches: Map<string, string>; // code -> id
  departments: Map<string, string>;
  designations: Map<string, string>;
  grades: Map<string, string>;
  /** employees already in the company: code -> facts */
  employees: Map<string, { id: string; joinDate: string }>;
  structures: Map<string, string>;
  /** leave types: code -> id, and whether it keeps a balance */
  leaveTypes: Map<string, { id: string; usesBalance: boolean }>;
  /** "<employeeId>|<date>" of active salaries */
  salaryDates: Set<string>;
  /** "<employeeId>|<fiscalYear>" of opening YTD rows */
  ytdOpenings: Set<string>;
  /** "<employeeId>|<leaveTypeId>" with an opening balance already */
  leaveOpenings: Set<string>;
  /** employees with an approved or pending salary account */
  employeesWithAccount: Set<string>;
  /** employees with an open (pending / approved) loan */
  employeesWithLoan: Set<string>;
  /** CRM: phones and e-mails taken by a lead or customer ("phone|+880..." / "email|...") */
  crmKeys: Set<string>;
  /** CRM: who may be an account manager (Sales users and Admins): login e-mail -> user id */
  accountManagers: Map<string, string>;
}

// ------------------------------------------------------------------ normalized rows

export interface EmployeeRow {
  code: string;
  fullNameEn: string;
  fullNameBn?: string;
  gender?: 'male' | 'female' | 'other';
  dateOfBirth?: string;
  nid?: string;
  tin?: string;
  phone?: string;
  personalEmail?: string;
  joinDate: string;
  branchId: string;
  departmentId: string;
  designationId: string;
  gradeId: string;
  managerCode?: string;
  festivalGroup?: string;
  status: 'active' | 'probation';
  probationEndDate?: string;
}
export interface SalaryRow {
  employeeId: string;
  employeeCode: string;
  effectiveFrom: string;
  gross: string;
  structureId: string;
  reason: string;
}
export interface LeaveBalanceRow {
  employeeId: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  days: number;
}
export interface YtdRow {
  employeeId: string;
  employeeCode: string;
  fiscalYear: string;
  taxableIncome: string;
  taxWithheld: string;
  pfEmployee: string;
  pfEmployer: string;
}
export interface LoanRow {
  employeeId: string;
  employeeCode: string;
  outstanding: string;
  installment: string;
  nextPeriod: string;
  reason: string;
}
export interface BankAccountRow {
  employeeId: string;
  employeeCode: string;
  kind: 'bank' | 'wallet';
  accountName: string;
  bankName?: string;
  branchName?: string;
  routingNumber?: string;
  accountNumber?: string;
  walletProvider?: 'bkash' | 'nagad' | 'rocket' | 'upay';
  walletNumber?: string;
}
export interface CustomerRow {
  name: string;
  kind: 'company' | 'person';
  customerType:
    'dealer' | 'distributor' | 'retail' | 'corporate' | 'government' | 'export';
  nameBn?: string;
  oldCode?: string;
  bin?: string;
  tin?: string;
  phone?: string;
  email?: string;
  address?: string;
  district?: string;
  accountManagerId?: string;
  creditLimit: string;
  paymentTermsDays: number;
}
export type NormalizedRow =
  | EmployeeRow
  | SalaryRow
  | LeaveBalanceRow
  | YtdRow
  | LoanRow
  | BankAccountRow
  | CustomerRow;

export interface RowResult {
  rowNo: number;
  errors: RowError[];
  value?: NormalizedRow;
}

// ------------------------------------------------------------------ file level

/** Header problems that reject the whole file (missing required columns, unknown columns). */
export function checkHeaders(
  entity: ImportEntity,
  headers: string[],
): string[] {
  const t = templateOf(entity)!;
  const known = new Set(t.columns.map((c) => c.key));
  const problems: string[] = [];
  for (const c of t.columns)
    if (c.required && !headers.includes(c.key))
      problems.push(`Missing column "${c.key}"`);
  for (const h of headers)
    if (!known.has(h))
      problems.push(
        `Unknown column "${h}" (download the template for the exact names)`,
      );
  return problems;
}

/** Validate every row of a file (duplicates across rows are checked here). */
export function validateRows(
  entity: ImportEntity,
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
  ctx: ImportContext,
): RowResult[] {
  switch (entity) {
    case 'employees':
      return validateEmployees(rows, ctx);
    case 'salaries':
      return perRow(
        rows,
        ctx,
        salaryRow,
        (v) => `${v.employeeId}|${v.effectiveFrom}`,
        'effective_from',
        'This employee already has a salary from this date in the file',
      );
    case 'leave_balances':
      return perRow(
        rows,
        ctx,
        leaveRow,
        (v) => `${v.employeeId}|${v.leaveTypeId}`,
        'leave_type_code',
        'This employee and leave type appear twice in the file',
      );
    case 'ytd_openings':
      return perRow(
        rows,
        ctx,
        ytdRow,
        (v) => v.employeeId,
        'employee_code',
        'This employee appears twice in the file',
      );
    case 'loans':
      return perRow(
        rows,
        ctx,
        loanRow,
        (v) => v.employeeId,
        'employee_code',
        'One outstanding advance per employee: add them up in one row',
      );
    case 'bank_accounts':
      return perRow(
        rows,
        ctx,
        bankRow,
        (v) => v.employeeId,
        'employee_code',
        'One salary account per employee',
      );
    case 'customers':
      return validateCustomers(rows, ctx);
  }
}

// ------------------------------------------------------------------ customers

/** Each row a customer; a phone or e-mail neither in the system already nor twice in the file. */
function validateCustomers(
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
  ctx: ImportContext,
): RowResult[] {
  const seen = new Map<string, number>();
  return rows.map(({ rowNo, cells: c }) => {
    const e: RowError[] = [];
    const name = required(c, 'name', e);
    const kind =
      optionalOf(c, 'kind', ['company', 'person'] as const, e) ?? 'company';
    const customerType =
      optionalOf(
        c,
        'customer_type',
        [
          'dealer',
          'distributor',
          'retail',
          'corporate',
          'government',
          'export',
        ] as const,
        e,
      ) ?? 'retail';
    let bin = optional(c, 'bin');
    if (bin) {
      const digits = bin.replace(/\D/g, '');
      if (digits.length !== 13)
        e.push({
          column: 'bin',
          message: 'A BIN has 13 digits, like 000234567-0201',
        });
      else bin = `${digits.slice(0, 9)}-${digits.slice(9)}`;
    }
    const tin = optional(c, 'tin');
    if (tin && !/^\d{12}$/.test(tin))
      e.push({ column: 'tin', message: 'A TIN has 12 digits' });
    const rawPhone = optional(c, 'phone');
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !phone)
      e.push({
        column: 'phone',
        message: `Not a Bangladesh phone number: ${rawPhone}`,
      });
    const rawEmail = optional(c, 'email');
    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    if (rawEmail && !email)
      e.push({
        column: 'email',
        message: `Not an e-mail address: ${rawEmail}`,
      });
    const rawDistrict = optional(c, 'district');
    const district = rawDistrict ? districtOf(rawDistrict) : null;
    if (rawDistrict && !district)
      e.push({
        column: 'district',
        message: `Not a district of Bangladesh: ${rawDistrict}`,
      });
    const managerEmail = optional(c, 'account_manager_email')?.toLowerCase();
    const accountManagerId = managerEmail
      ? ctx.accountManagers.get(managerEmail)
      : undefined;
    if (managerEmail && !accountManagerId)
      e.push({
        column: 'account_manager_email',
        message: `Not a Sales user or Admin of this company: ${managerEmail}`,
      });
    const creditLimit = money(c, 'credit_limit', e, { optional: true }) ?? '0';
    const terms = optional(c, 'payment_terms_days');
    if (terms && (!/^\d{1,3}$/.test(terms) || Number(terms) > 365))
      e.push({ column: 'payment_terms_days', message: 'Days from 0 to 365' });
    for (const [kindOf, value, column] of [
      ['phone', phone, 'phone'],
      ['email', email, 'email'],
    ] as const) {
      if (!value) continue;
      const key = `${kindOf}|${value}`;
      if (ctx.crmKeys.has(key))
        e.push({
          column,
          message: `Belongs to a lead or customer in the system already: ${value}`,
        });
      else if (seen.has(key))
        e.push({ column, message: `Also on row ${seen.get(key)}` });
      else seen.set(key, rowNo);
    }
    if (e.length) return { rowNo, errors: e };
    const value: CustomerRow = {
      name: name!,
      kind,
      customerType,
      nameBn: optional(c, 'name_bn'),
      oldCode: optional(c, 'old_code'),
      bin,
      tin,
      phone: phone ?? undefined,
      email: email ?? undefined,
      address: optional(c, 'address'),
      district: district ?? undefined,
      accountManagerId,
      creditLimit,
      paymentTermsDays: terms ? Number(terms) : 0,
    };
    return { rowNo, errors: [], value };
  });
}

type RowValidator<T> = (
  cells: Record<string, string>,
  ctx: ImportContext,
  errors: RowError[],
) => T | undefined;

function perRow<T extends NormalizedRow>(
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
  ctx: ImportContext,
  validate: RowValidator<T>,
  key: (v: T) => string,
  dupColumn: string,
  dupMessage: string,
): RowResult[] {
  const seen = new Map<string, number>();
  return rows.map(({ rowNo, cells }) => {
    const errors: RowError[] = [];
    const value = validate(cells, ctx, errors);
    if (value && errors.length === 0) {
      const k = key(value);
      if (seen.has(k))
        errors.push({
          column: dupColumn,
          message: `${dupMessage} (also row ${seen.get(k)})`,
        });
      else seen.set(k, rowNo);
    }
    return { rowNo, errors, value: errors.length ? undefined : value };
  });
}

// ------------------------------------------------------------------ employees

function validateEmployees(
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
  ctx: ImportContext,
): RowResult[] {
  const codesInFile = new Map<string, number>();
  const nidsInFile = new Map<string, number>();
  const results = rows.map(({ rowNo, cells }) => {
    const errors: RowError[] = [];
    const value = employeeRow(cells, ctx, errors);
    if (value) {
      if (codesInFile.has(value.code))
        errors.push({
          column: 'employee_code',
          message: `Duplicate employee_code (also row ${codesInFile.get(value.code)})`,
        });
      else codesInFile.set(value.code, rowNo);
      if (value.nid) {
        if (nidsInFile.has(value.nid))
          errors.push({
            column: 'nid',
            message: `Same NID as row ${nidsInFile.get(value.nid)}`,
          });
        else nidsInFile.set(value.nid, rowNo);
      }
    }
    return { rowNo, errors, value };
  });

  // line managers: in the system already, or a row of this file; no circles
  const managerOf = new Map(
    results
      .filter((r) => r.value)
      .map((r) => [
        (r.value as EmployeeRow).code,
        (r.value as EmployeeRow).managerCode,
      ]),
  );
  for (const r of results) {
    const v = r.value as EmployeeRow | undefined;
    if (!v?.managerCode) continue;
    if (v.managerCode === v.code)
      r.errors.push({
        column: 'line_manager_code',
        message: 'An employee cannot be their own line manager',
      });
    else if (
      !ctx.employees.has(v.managerCode) &&
      !codesInFile.has(v.managerCode)
    )
      r.errors.push({
        column: 'line_manager_code',
        message: `Unknown employee ${v.managerCode}`,
      });
    else if (reportsToSelf(v.code, managerOf))
      r.errors.push({
        column: 'line_manager_code',
        message: 'Line managers form a circle',
      });
  }
  return results.map((r) => ({
    ...r,
    value: r.errors.length ? undefined : r.value,
  }));
}

function reportsToSelf(
  code: string,
  managerOf: Map<string, string | undefined>,
): boolean {
  const seen = new Set<string>();
  for (let m = managerOf.get(code); m; m = managerOf.get(m)) {
    if (m === code) return true;
    if (seen.has(m)) return false;
    seen.add(m);
  }
  return false;
}

function employeeRow(
  c: Record<string, string>,
  ctx: ImportContext,
  e: RowError[],
): EmployeeRow | undefined {
  const code = required(c, 'employee_code', e);
  if (code && !/^[A-Za-z0-9][A-Za-z0-9-_/]{0,29}$/.test(code))
    e.push({
      column: 'employee_code',
      message: 'Letters, digits, - _ / only (max 30)',
    });
  if (code && ctx.employees.has(code))
    e.push({ column: 'employee_code', message: 'Already in the system' });
  const fullNameEn = required(c, 'full_name_en', e);
  const gender = optionalOf(
    c,
    'gender',
    ['male', 'female', 'other'] as const,
    e,
  );
  const dateOfBirth = optionalDate(c, 'date_of_birth', e);
  const nid = optional(c, 'nid');
  if (nid && !/^(\d{10}|\d{13}|\d{17})$/.test(nid))
    e.push({ column: 'nid', message: 'NID must be 10, 13 or 17 digits' });
  const tin = optional(c, 'tin');
  if (tin && !/^\d{12}$/.test(tin))
    e.push({ column: 'tin', message: 'e-TIN must be 12 digits' });
  const phone = optional(c, 'phone');
  if (phone && !/^\+?[0-9]{8,15}$/.test(phone))
    e.push({
      column: 'phone',
      message: 'Phone must be 8-15 digits, e.g. 01712345678',
    });
  const email = optional(c, 'personal_email')?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    e.push({ column: 'personal_email', message: 'Not an e-mail address' });
  const joinDate = requiredDate(c, 'join_date', e);
  if (joinDate && joinDate >= ctx.cutOverDate)
    e.push({
      column: 'join_date',
      message: `Must be before the cut-over date ${ctx.cutOverDate}; new joiners are added in the system`,
    });
  if (joinDate && dateOfBirth && dateOfBirth >= joinDate)
    e.push({
      column: 'date_of_birth',
      message: 'Must be before the join date',
    });
  const branchId = lookup(c, 'branch_code', ctx.branches, e);
  const departmentId = lookup(c, 'department_code', ctx.departments, e);
  const designationId = lookup(c, 'designation_code', ctx.designations, e);
  const gradeId = lookup(c, 'grade_code', ctx.grades, e);
  const managerCode = optional(c, 'line_manager_code');
  const festivalGroup = optional(c, 'festival_group')?.toLowerCase();
  if (festivalGroup && !/^[a-z_]{1,30}$/.test(festivalGroup))
    e.push({
      column: 'festival_group',
      message: 'Letters and _ only, e.g. eid',
    });
  const status =
    optionalOf(c, 'status', ['active', 'probation'] as const, e) ?? 'active';
  const probationEndDate = optionalDate(c, 'probation_end_date', e);
  if (status === 'probation' && !probationEndDate)
    e.push({
      column: 'probation_end_date',
      message: 'Needed for an employee on probation',
    });
  if (probationEndDate && joinDate && probationEndDate < joinDate)
    e.push({ column: 'probation_end_date', message: 'Before the join date' });
  if (e.length) return undefined;
  return {
    code: code!,
    fullNameEn: fullNameEn!,
    fullNameBn: optional(c, 'full_name_bn'),
    gender,
    dateOfBirth,
    nid,
    tin,
    phone,
    personalEmail: email,
    joinDate: joinDate!,
    branchId: branchId!,
    departmentId: departmentId!,
    designationId: designationId!,
    gradeId: gradeId!,
    managerCode,
    festivalGroup,
    status,
    probationEndDate: status === 'probation' ? probationEndDate : undefined,
  };
}

// ------------------------------------------------------------------ the other templates

const salaryRow: RowValidator<SalaryRow> = (c, ctx, e) => {
  const emp = employee(c, ctx, e);
  const effectiveFrom = requiredDate(c, 'effective_from', e);
  if (emp && effectiveFrom && effectiveFrom < emp.joinDate)
    e.push({
      column: 'effective_from',
      message: `Before the join date ${emp.joinDate}`,
    });
  if (emp && effectiveFrom && ctx.salaryDates.has(`${emp.id}|${effectiveFrom}`))
    e.push({
      column: 'effective_from',
      message: 'A salary from this date exists already',
    });
  const gross = money(c, 'gross', e, { positive: true });
  const structureCode = (optional(c, 'structure_code') ?? 'STD').toUpperCase();
  const structureId = ctx.structures.get(structureCode);
  if (!structureId)
    e.push({
      column: 'structure_code',
      message: `Unknown salary structure ${structureCode}`,
    });
  if (e.length) return undefined;
  return {
    employeeId: emp!.id,
    employeeCode: c.employee_code,
    effectiveFrom: effectiveFrom!,
    gross: gross!,
    structureId: structureId!,
    reason: optional(c, 'reason') ?? 'Salary at go-live (migration)',
  };
};

const leaveRow: RowValidator<LeaveBalanceRow> = (c, ctx, e) => {
  const emp = employee(c, ctx, e);
  const typeCode = required(c, 'leave_type_code', e)?.toUpperCase();
  const type = typeCode ? ctx.leaveTypes.get(typeCode) : undefined;
  if (typeCode && !type)
    e.push({
      column: 'leave_type_code',
      message: `Unknown leave type ${typeCode}`,
    });
  else if (type && !type.usesBalance)
    e.push({
      column: 'leave_type_code',
      message: `${typeCode} has no balance (maternity, leave without pay)`,
    });
  const text = required(c, 'days', e);
  const days = Number(text);
  if (
    text !== undefined &&
    (!/^\d{1,3}(\.\d{1,2})?$/.test(text) || (days * 2) % 1 !== 0 || days > 365)
  )
    e.push({
      column: 'days',
      message: 'Days from 0 to 365, in halves (e.g. 12.5)',
    });
  if (emp && type && ctx.leaveOpenings.has(`${emp.id}|${type.id}`))
    e.push({
      column: 'leave_type_code',
      message: 'This employee has an opening balance for this type already',
    });
  if (e.length) return undefined;
  return {
    employeeId: emp!.id,
    employeeCode: c.employee_code,
    leaveTypeId: type!.id,
    leaveTypeCode: typeCode!,
    days,
  };
};

const ytdRow: RowValidator<YtdRow> = (c, ctx, e) => {
  const emp = employee(c, ctx, e);
  const fiscalYear = required(c, 'fiscal_year', e);
  const expected = fiscalYearOf(ctx.cutOverDate);
  if (fiscalYear && fiscalYear !== expected)
    e.push({
      column: 'fiscal_year',
      message: `Must be ${expected}, the fiscal year of the cut-over date`,
    });
  const taxableIncome = money(c, 'taxable_income', e);
  const taxWithheld = money(c, 'tax_withheld', e);
  const pfEmployee = money(c, 'pf_employee', e, { optional: true }) ?? '0.00';
  const pfEmployer = money(c, 'pf_employer', e, { optional: true }) ?? '0.00';
  if (
    taxableIncome &&
    taxWithheld &&
    Money.of(taxWithheld).greaterThan(taxableIncome)
  )
    e.push({ column: 'tax_withheld', message: 'More than the taxable income' });
  if (emp && fiscalYear && ctx.ytdOpenings.has(`${emp.id}|${fiscalYear}`))
    e.push({
      column: 'employee_code',
      message: 'An opening for this fiscal year exists already',
    });
  if (e.length) return undefined;
  return {
    employeeId: emp!.id,
    employeeCode: c.employee_code,
    fiscalYear: fiscalYear!,
    taxableIncome: taxableIncome!,
    taxWithheld: taxWithheld!,
    pfEmployee,
    pfEmployer,
  };
};

const loanRow: RowValidator<LoanRow> = (c, ctx, e) => {
  const emp = employee(c, ctx, e);
  const outstanding = money(c, 'outstanding', e, { positive: true });
  const installment = money(c, 'installment', e, { positive: true });
  if (
    outstanding &&
    installment &&
    Money.of(installment).greaterThan(outstanding)
  )
    e.push({
      column: 'installment',
      message: 'More than the outstanding amount',
    });
  const nextPeriod = required(c, 'next_period', e);
  if (nextPeriod && !/^\d{4}-(0[1-9]|1[0-2])$/.test(nextPeriod))
    e.push({ column: 'next_period', message: 'A month as YYYY-MM' });
  else if (nextPeriod && nextPeriod < ctx.cutOverDate.slice(0, 7))
    e.push({
      column: 'next_period',
      message: `Before the cut-over month ${ctx.cutOverDate.slice(0, 7)}`,
    });
  if (emp && ctx.employeesWithLoan.has(emp.id))
    e.push({
      column: 'employee_code',
      message: 'This employee has an open advance in the system already',
    });
  if (e.length) return undefined;
  return {
    employeeId: emp!.id,
    employeeCode: c.employee_code,
    outstanding: outstanding!,
    installment: installment!,
    nextPeriod: nextPeriod!,
    reason: optional(c, 'reason') ?? 'Outstanding at go-live (migration)',
  };
};

const bankRow: RowValidator<BankAccountRow> = (c, ctx, e) => {
  const emp = employee(c, ctx, e);
  const kind = optionalOf(c, 'kind', ['bank', 'wallet'] as const, e);
  if (!kind && !e.some((x) => x.column === 'kind'))
    e.push({ column: 'kind', message: 'Required: bank or wallet' });
  const accountName = required(c, 'account_name', e);
  if (emp && ctx.employeesWithAccount.has(emp.id))
    e.push({
      column: 'employee_code',
      message:
        'This employee has a salary account (or a pending change) already',
    });
  let row: Partial<BankAccountRow> = {};
  if (kind === 'bank') {
    const bankName = required(c, 'bank_name', e);
    const branchName = required(c, 'branch_name', e);
    const routingNumber = required(c, 'routing_number', e);
    if (routingNumber && !/^\d{9}$/.test(routingNumber))
      e.push({
        column: 'routing_number',
        message: 'Routing number must be 9 digits',
      });
    const accountNumber = required(c, 'account_number', e);
    if (accountNumber && !/^\d{8,20}$/.test(accountNumber))
      e.push({
        column: 'account_number',
        message: 'Account number must be 8-20 digits',
      });
    row = { bankName, branchName, routingNumber, accountNumber };
  }
  if (kind === 'wallet') {
    const walletProvider = optionalOf(
      c,
      'wallet_provider',
      ['bkash', 'nagad', 'rocket', 'upay'] as const,
      e,
    );
    if (!walletProvider && !e.some((x) => x.column === 'wallet_provider'))
      e.push({
        column: 'wallet_provider',
        message: 'Required for a wallet: bkash, nagad, rocket or upay',
      });
    const walletNumber = required(c, 'wallet_number', e);
    if (walletNumber && !/^01[3-9]\d{8}$/.test(walletNumber))
      e.push({
        column: 'wallet_number',
        message: 'Must look like 01712345678',
      });
    row = { walletProvider, walletNumber };
  }
  if (e.length) return undefined;
  return {
    employeeId: emp!.id,
    employeeCode: c.employee_code,
    kind: kind!,
    accountName: accountName!,
    ...row,
  };
};

// ------------------------------------------------------------------ cell helpers

function optional(c: Record<string, string>, col: string): string | undefined {
  const v = c[col]?.trim();
  return v ? v : undefined;
}

function required(
  c: Record<string, string>,
  col: string,
  e: RowError[],
): string | undefined {
  const v = optional(c, col);
  if (!v) e.push({ column: col, message: 'Required' });
  return v;
}

function optionalOf<T extends string>(
  c: Record<string, string>,
  col: string,
  allowed: readonly T[],
  e: RowError[],
): T | undefined {
  const v = optional(c, col)?.toLowerCase();
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) {
    e.push({ column: col, message: `One of: ${allowed.join(', ')}` });
    return undefined;
  }
  return v as T;
}

function validDate(v: string): boolean {
  try {
    businessDate(v);
    return true;
  } catch {
    return false;
  }
}

function optionalDate(
  c: Record<string, string>,
  col: string,
  e: RowError[],
): string | undefined {
  const v = optional(c, col);
  if (v && !validDate(v)) {
    e.push({ column: col, message: 'A date as YYYY-MM-DD' });
    return undefined;
  }
  return v;
}

function requiredDate(
  c: Record<string, string>,
  col: string,
  e: RowError[],
): string | undefined {
  const v = required(c, col, e);
  if (v && !validDate(v)) {
    e.push({ column: col, message: 'A date as YYYY-MM-DD' });
    return undefined;
  }
  return v;
}

/** "30,000" and "30000.5" are accepted; returned with 2 decimals. */
function money(
  c: Record<string, string>,
  col: string,
  e: RowError[],
  o: { positive?: boolean; optional?: boolean } = {},
): string | undefined {
  const raw = o.optional ? optional(c, col) : required(c, col, e);
  if (raw === undefined) return undefined;
  const v = raw.replace(/,/g, '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) {
    e.push({
      column: col,
      message: 'An amount in taka, e.g. 30000 or 30000.50',
    });
    return undefined;
  }
  const m = Money.of(v);
  if (o.positive && !m.isPositive()) {
    e.push({ column: col, message: 'Must be more than 0' });
    return undefined;
  }
  return m.toDb();
}

function lookup(
  c: Record<string, string>,
  col: string,
  map: Map<string, string>,
  e: RowError[],
): string | undefined {
  const code = required(c, col, e)?.toUpperCase();
  if (!code) return undefined;
  const id = map.get(code);
  if (!id) e.push({ column: col, message: `Unknown code ${code}` });
  return id;
}

function employee(
  c: Record<string, string>,
  ctx: ImportContext,
  e: RowError[],
) {
  const code = required(c, 'employee_code', e);
  if (!code) return undefined;
  const found = ctx.employees.get(code);
  if (!found)
    e.push({
      column: 'employee_code',
      message: `Unknown employee ${code} (import employees first)`,
    });
  return found;
}

/** Bangladesh fiscal year (July-June) of a date: 2026-10-01 -> "2026-27". */
export function fiscalYearOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 7 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}
