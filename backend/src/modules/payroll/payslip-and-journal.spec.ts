import {
  monthName,
  renderPayslipPdf,
  scriptRuns,
  type PayslipDocument,
} from './payslip-pdf.js';
import {
  buildSalaryJournal,
  journalCsv,
  journalTotals,
} from './salary-journal.js';

const slip: PayslipDocument = {
  lang: 'bn',
  companyName: 'মেঘনা ফুডস লিমিটেড',
  period: '2026-09',
  runType: 'regular',
  bonusName: null,
  employee: {
    code: 'MFL-00006',
    name: 'মাহমুদুল হাসান রাফি',
    department: 'Sales Dhaka',
    designation: 'এক্সিকিউটিভ',
  },
  earnings: [
    { label: 'মূল বেতন', amount: '18000.00' },
    { label: 'বাড়ি ভাড়া ভাতা', amount: '9000.00' },
    { label: 'বিনা বেতনের দিন', amount: '-1000.00' },
  ],
  deductions: [{ label: 'অগ্রিম বেতন কর্তন', amount: '2500.00' }],
  employerContributions: [],
  gross: '26000.00',
  totalDeductions: '2500.00',
  net: '23500.00',
  generatedOn: '2026-10-02',
};

describe('payslip PDF', () => {
  it('splits Bangla and Latin runs (digits, commas, codes use the Latin font)', () => {
    expect(scriptRuns('কর্মী কোড: MFL-00006')).toEqual([
      { bangla: true, text: 'কর্মী কোড' },
      { bangla: false, text: ': MFL-00006' },
    ]);
    expect(monthName('2026-09', 'bn')).toBe('সেপ্টেম্বর ২০২৬');
    expect(monthName('2026-09', 'en')).toBe('September 2026');
  });

  it('renders a Bangla payslip, and an English one with a password', async () => {
    const bn = await renderPayslipPdf(slip);
    expect(bn.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bn.toString('latin1')).not.toContain('/Encrypt');

    const en = await renderPayslipPdf(
      {
        ...slip,
        lang: 'en',
        companyName: 'Meghna Foods Ltd',
        employee: { ...slip.employee, name: 'Mahmudul Hasan Rafi' },
      },
      '15081998',
    );
    expect(en.toString('latin1')).toContain('/Encrypt');
  }, 20_000); // Bangla shaping takes a few seconds per document
});

describe('salary journal', () => {
  const lines = [
    {
      employeeId: 'rafi',
      headCode: 'BASIC',
      kind: 'earning' as const,
      amount: '18000.00',
    },
    {
      employeeId: 'rafi',
      headCode: 'HOUSE_RENT',
      kind: 'earning' as const,
      amount: '9000.00',
    },
    {
      employeeId: 'rafi',
      headCode: 'UNPAID_DAYS',
      kind: 'earning' as const,
      amount: '-1000.00',
    },
    {
      employeeId: 'rafi',
      headCode: 'LOAN_RECOVERY',
      kind: 'deduction' as const,
      amount: '2500.00',
    },
    {
      employeeId: 'anwar',
      headCode: 'BASIC',
      kind: 'earning' as const,
      amount: '90000.00',
    },
    {
      employeeId: 'anwar',
      headCode: 'TAX',
      kind: 'deduction' as const,
      amount: '8625.00',
    },
    {
      employeeId: 'anwar',
      headCode: 'PF_EMPLOYER',
      kind: 'employer_cost' as const,
      amount: '9000.00',
    },
  ];
  const nets = new Map([
    ['rafi', '23500.00'],
    ['anwar', '81375.00'],
  ]);
  const cc = (id: string) =>
    id === 'rafi' ? 'CC-210 Sales Dhaka' : 'CC-100 Head Office';
  const name = (code: string) => code.replace(/_/g, ' ').toLowerCase();

  it('debits equal credits, per cost centre', () => {
    const rows = buildSalaryJournal(lines, nets, cc, name);
    expect(journalTotals(rows)).toEqual({
      debit: '126000.00',
      credit: '126000.00',
    });
    expect(rows.filter((r) => r.costCentre === 'CC-210 Sales Dhaka')).toEqual([
      {
        costCentre: 'CC-210 Sales Dhaka',
        account: 'Salary expense - basic',
        debit: '18000.00',
        credit: '0.00',
      },
      {
        costCentre: 'CC-210 Sales Dhaka',
        account: 'Salary expense - house rent',
        debit: '9000.00',
        credit: '0.00',
      },
      {
        costCentre: 'CC-210 Sales Dhaka',
        account: 'Salaries payable',
        debit: '0.00',
        credit: '23500.00',
      },
      {
        costCentre: 'CC-210 Sales Dhaka',
        account: 'Salary expense - unpaid days',
        debit: '0.00',
        credit: '1000.00',
      },
      {
        costCentre: 'CC-210 Sales Dhaka',
        account: 'Staff salary advance',
        debit: '0.00',
        credit: '2500.00',
      },
    ]);
  });

  it('CSV ends with a TOTAL row', () => {
    const text = journalCsv(
      {
        company: 'Meghna Foods Ltd',
        period: '2026-09',
        runType: 'regular',
        runId: 'r1',
      },
      buildSalaryJournal(lines, nets, cc, name),
    );
    expect(text.trim().split('\r\n').at(-1)).toBe(
      'Meghna Foods Ltd,2026-09,regular,r1,TOTAL,,126000.00,126000.00',
    );
  });
});
