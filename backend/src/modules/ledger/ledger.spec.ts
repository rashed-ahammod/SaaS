import { businessDate } from '../../platform/dates/business-date.js';
import { CHART_TEMPLATE, DEFAULT_POSTING_ACCOUNTS } from './chart-template.js';
import { fiscalYearFor, voucherNumber } from './fiscal.js';
import { mergeLines } from './vouchers.service.js';

describe('fiscal years (July-June)', () => {
  it('October 2026 is in 2026-27, with twelve months July to June', () => {
    const y = fiscalYearFor(businessDate('2026-10-16'));
    expect(y).toMatchObject({
      code: '2026-27',
      startsOn: '2026-07-01',
      endsOn: '2027-06-30',
    });
    expect(y.periods.map((p) => p.period)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
    ]);
    expect(y.periods[7]).toMatchObject({
      startsOn: '2027-02-01',
      endsOn: '2027-02-28',
    });
  });

  it('June 2027 is still 2026-27; a calendar-year company has year codes like 2026', () => {
    expect(fiscalYearFor(businessDate('2027-06-30')).code).toBe('2026-27');
    expect(fiscalYearFor(businessDate('2026-10-16'), '01-01')).toMatchObject({
      code: '2026',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    });
  });

  it('voucher numbers', () => {
    expect(voucherNumber('payment', '2026-27', 42)).toBe('PV/2026-27/00042');
    expect(voucherNumber('contra', '2026-27', 1)).toBe('CV/2026-27/00001');
  });
});

describe('merging posting lines', () => {
  it('adds up the same account and cost centre, nets a negative to the other side, drops zero', () => {
    const merged = mergeLines([
      { accountId: 'salary', departmentId: 'sales', debit: '30000.00' },
      { accountId: 'salary', departmentId: 'sales', debit: '25000.00' },
      { accountId: 'salary', departmentId: 'sales', credit: '1000.00' }, // unpaid day
      { accountId: 'salary', departmentId: 'hr', debit: '40000.00' },
      {
        accountId: 'advance',
        departmentId: 'sales',
        partyType: 'employee',
        partyId: 'rafi',
        credit: '2500.00',
      },
      {
        accountId: 'advance',
        departmentId: 'sales',
        partyType: 'employee',
        partyId: 'mitu',
        credit: '1000.00',
      },
      { accountId: 'suspense', debit: '500.00' },
      { accountId: 'suspense', credit: '500.00' },
    ]);
    expect(merged).toEqual([
      {
        accountId: 'salary',
        departmentId: 'sales',
        debit: '54000.00',
        credit: undefined,
      },
      {
        accountId: 'salary',
        departmentId: 'hr',
        debit: '40000.00',
        credit: undefined,
      },
      {
        accountId: 'advance',
        departmentId: 'sales',
        partyType: 'employee',
        partyId: 'rafi',
        debit: undefined,
        credit: '2500.00',
      },
      {
        accountId: 'advance',
        departmentId: 'sales',
        partyType: 'employee',
        partyId: 'mitu',
        debit: undefined,
        credit: '1000.00',
      },
    ]);
  });
});

describe('Bangladesh chart template', () => {
  it('codes are unique, every parent is a group of the same type, every posting key names a postable account', () => {
    const byCode = new Map(CHART_TEMPLATE.map((a) => [a.code, a]));
    expect(byCode.size).toBe(CHART_TEMPLATE.length);
    for (const a of CHART_TEMPLATE) {
      if (!a.parent) continue;
      const parent = byCode.get(a.parent)!;
      expect(parent.group).toBe(true);
      expect(parent.type).toBe(a.type);
    }
    for (const code of Object.values(DEFAULT_POSTING_ACCOUNTS)) {
      expect(byCode.get(code)?.group).not.toBe(true);
    }
  });
});
