import { managersFirst } from './data-import.service.js';
import { parseCsv, readSheet, templateXlsx } from './spreadsheet.js';
import { templateOf } from './templates.js';
import {
  checkHeaders,
  fiscalYearOf,
  validateRows,
  type EmployeeRow,
  type ImportContext,
} from './validators.js';

const ctx = (): ImportContext => ({
  cutOverDate: '2026-10-01',
  branches: new Map([['DHK', 'b-dhk']]),
  departments: new Map([
    ['SALES-DHK', 'd-sales'],
    ['HO', 'd-ho'],
  ]),
  designations: new Map([
    ['EXE', 'g-exe'],
    ['MGR', 'g-mgr'],
  ]),
  grades: new Map([
    ['G1', 'gr-1'],
    ['G4', 'gr-4'],
  ]),
  employees: new Map([['DTL-00001', { id: 'e-md', joinDate: '2019-01-01' }]]),
  structures: new Map([['STD', 's-std']]),
  leaveTypes: new Map([
    ['EL', { id: 'lt-el', usesBalance: true }],
    ['ML', { id: 'lt-ml', usesBalance: false }],
  ]),
  salaryDates: new Set(),
  ytdOpenings: new Set(),
  leaveOpenings: new Set(),
  employeesWithAccount: new Set(),
  employeesWithLoan: new Set(),
  crmKeys: new Set(['phone|+8801711223344']),
  accountManagers: new Map([['rafi@demo.test', 'user-rafi']]),
});

const person = (over: Record<string, string> = {}) => ({
  employee_code: 'DTL-00012',
  full_name_en: 'Mahmudul Hasan Rafi',
  join_date: '2025-01-01',
  branch_code: 'DHK',
  department_code: 'SALES-DHK',
  designation_code: 'EXE',
  grade_code: 'G1',
  nid: '1998123456786',
  ...over,
});
const rows = (list: Array<Record<string, string>>) =>
  list.map((cells, i) => ({ rowNo: i + 2, cells }));

describe('employee rows', () => {
  it('a correct row is valid; codes become ids', () => {
    const [r] = validateRows(
      'employees',
      rows([person({ line_manager_code: 'DTL-00001' })]),
      ctx(),
    );
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({
      code: 'DTL-00012',
      branchId: 'b-dhk',
      departmentId: 'd-sales',
      status: 'active',
      managerCode: 'DTL-00001',
    });
  });

  it('reports every problem of a row, by column', () => {
    const [r] = validateRows(
      'employees',
      rows([
        person({
          nid: '12345',
          tin: '99',
          join_date: '2026-10-15',
          department_code: 'XYZ',
          gender: 'm',
        }),
      ]),
      ctx(),
    );
    expect(r.errors.map((e) => e.column).sort()).toEqual([
      'department_code',
      'gender',
      'join_date',
      'nid',
      'tin',
    ]);
  });

  it('duplicates in the file or the system, unknown and circular managers', () => {
    const result = validateRows(
      'employees',
      rows([
        person({ employee_code: 'DTL-00001' }), // already in the system
        person({
          employee_code: 'A1',
          nid: '1111111111',
          line_manager_code: 'B1',
        }),
        person({
          employee_code: 'B1',
          nid: '2222222222',
          line_manager_code: 'A1',
        }), // circle A1 <-> B1
        person({
          employee_code: 'C1',
          nid: '1111111111',
          line_manager_code: 'ZZ',
        }), // same NID as A1, unknown manager
      ]),
      ctx(),
    );
    expect(result[0].errors[0].message).toBe('Already in the system');
    expect(result[1].errors[0].message).toBe('Line managers form a circle');
    expect(result[3].errors.map((e) => e.column).sort()).toEqual([
      'line_manager_code',
      'nid',
    ]);
  });

  it('orders managers before their team', () => {
    const result = validateRows(
      'employees',
      rows([
        person({ employee_code: 'C', nid: '', line_manager_code: 'B' }),
        person({ employee_code: 'B', nid: '', line_manager_code: 'A' }),
        person({ employee_code: 'A', nid: '' }),
      ]),
      ctx(),
    );
    expect(
      managersFirst(result).map((r) => (r.value as EmployeeRow).code),
    ).toEqual(['A', 'B', 'C']);
  });
});

describe('other templates', () => {
  it('salaries: amounts with commas, unknown employee, duplicate date', () => {
    const result = validateRows(
      'salaries',
      rows([
        {
          employee_code: 'DTL-00001',
          effective_from: '2026-07-01',
          gross: '1,80,000',
        },
        {
          employee_code: 'DTL-00001',
          effective_from: '2026-07-01',
          gross: '180000',
        },
        { employee_code: 'NOPE', effective_from: '2026-07-01', gross: '-5' },
      ]),
      ctx(),
    );
    expect(result[0].value).toMatchObject({
      employeeId: 'e-md',
      gross: '180000.00',
      structureId: 's-std',
    });
    expect(result[1].errors[0].message).toMatch(
      /already has a salary from this date in the file/,
    );
    expect(result[2].errors.map((e) => e.column)).toEqual([
      'employee_code',
      'gross',
    ]);
  });

  it('leave balances: halves only, types with a balance only', () => {
    const result = validateRows(
      'leave_balances',
      rows([
        { employee_code: 'DTL-00001', leave_type_code: 'el', days: '12.5' },
        { employee_code: 'DTL-00001', leave_type_code: 'ML', days: '3.3' },
      ]),
      ctx(),
    );
    expect(result[0].value).toMatchObject({ leaveTypeId: 'lt-el', days: 12.5 });
    expect(result[1].errors.map((e) => e.column).sort()).toEqual([
      'days',
      'leave_type_code',
    ]);
  });

  it('YTD must be for the fiscal year of the cut-over; tax not above income', () => {
    expect(fiscalYearOf('2026-10-01')).toBe('2026-27');
    expect(fiscalYearOf('2026-07-01')).toBe('2026-27');
    expect(fiscalYearOf('2026-06-01')).toBe('2025-26');
    const [r] = validateRows(
      'ytd_openings',
      rows([
        {
          employee_code: 'DTL-00001',
          fiscal_year: '2025-26',
          taxable_income: '100',
          tax_withheld: '200',
        },
      ]),
      ctx(),
    );
    expect(r.errors.map((e) => e.column).sort()).toEqual([
      'fiscal_year',
      'tax_withheld',
    ]);
  });

  it('bank accounts: bank needs routing and account numbers, wallet needs provider and number', () => {
    const result = validateRows(
      'bank_accounts',
      rows([
        {
          employee_code: 'DTL-00001',
          kind: 'bank',
          account_name: 'Anisur Rahman',
          bank_name: 'BRAC Bank PLC',
          branch_name: 'Gulshan',
          routing_number: '060261726',
          account_number: '1501201234567',
        },
        {
          employee_code: 'DTL-00001',
          kind: 'wallet',
          account_name: 'Anisur Rahman',
          wallet_provider: 'bkash',
          wallet_number: '01712345678',
        },
      ]),
      ctx(),
    );
    expect(result[0].errors).toEqual([]);
    expect(result[1].errors[0].message).toMatch(
      /One salary account per employee/,
    );
    const [bad] = validateRows(
      'bank_accounts',
      rows([
        {
          employee_code: 'DTL-00001',
          kind: 'wallet',
          account_name: 'X',
          wallet_provider: 'paypal',
          wallet_number: '123',
        },
      ]),
      ctx(),
    );
    expect(bad.errors.map((e) => e.column)).toEqual([
      'wallet_provider',
      'wallet_number',
    ]);
  });

  it('headers: missing required and unknown columns reject the file', () => {
    expect(
      checkHeaders('loans', [
        'employee_code',
        'outstanding',
        'instalment',
        'next_period',
      ]),
    ).toEqual([
      'Missing column "installment"',
      'Unknown column "instalment" (download the template for the exact names)',
    ]);
  });
});

describe('spreadsheets', () => {
  it('CSV with quotes, commas and line breaks inside quotes', () => {
    const grid = parseCsv('a,b\r\n"x, y","line1\nline2"\r\n');
    expect(grid.map((r) => r.map((c) => c.value))).toEqual([
      ['a', 'b'],
      ['x, y', 'line1\nline2'],
    ]);
  });

  it('the Excel template reads back as the example row (codes keep leading zeros)', async () => {
    const t = templateOf('bank_accounts')!;
    const sheet = await readSheet(await templateXlsx(t), 'bank_accounts.xlsx');
    expect(sheet.headers).toEqual(t.columns.map((c) => c.key));
    expect(sheet.rows[0]).toMatchObject({
      rowNo: 2,
      cells: { routing_number: '090261725', account_number: '1051100012345' },
    });
  });
});

describe('customer rows (2026-10-30)', () => {
  const rows = (...cells: Array<Record<string, string>>) =>
    validateRows(
      'customers',
      cells.map((c, i) => ({ rowNo: i + 2, cells: c })),
      ctx(),
    );

  it('normalises phone, BIN and district; finds the account manager by login', () => {
    const [r] = rows({
      name: 'Meghna Dealers',
      customer_type: 'dealer',
      bin: '0002345670201',
      phone: '031-2852211',
      district: 'chittagong',
      account_manager_email: 'Rafi@demo.test',
      credit_limit: '500000',
      payment_terms_days: '30',
    });
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({
      kind: 'company',
      customerType: 'dealer',
      bin: '000234567-0201',
      phone: '+880312852211',
      district: 'Chattogram',
      accountManagerId: 'user-rafi',
      creditLimit: '500000.00',
      paymentTermsDays: 30,
    });
  });

  it('a phone in the system, or twice in the file, is refused; so is an unknown salesperson', () => {
    const r = rows(
      { name: 'Karim Stores', phone: '01711-223344' },
      { name: 'Sylhet Agro', email: 'Accounts@SylhetAgro.com.bd' },
      { name: 'Sylhet Agro (again)', email: 'accounts@sylhetagro.com.bd' },
      {
        name: 'Bogura Traders',
        account_manager_email: 'nobody@demo.test',
        district: 'Gotham',
      },
    );
    expect(r[0].errors.map((e) => e.column)).toEqual(['phone']);
    expect(r[1].errors).toEqual([]);
    expect(r[2].errors).toEqual([
      { column: 'email', message: 'Also on row 3' },
    ]);
    expect(r[3].errors.map((e) => e.column).sort()).toEqual([
      'account_manager_email',
      'district',
    ]);
  });
});
