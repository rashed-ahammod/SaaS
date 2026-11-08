import { describe, expect, it } from 'vitest';
import { dueDateOf, dueItems, reminderStage } from './compliance-rules.js';
import { classOf, returnFigures, saleLine } from './mushak.js';

describe('VAT arithmetic', () => {
  it('charges VAT on the value plus supplementary duty, to the paisa', () => {
    expect(saleLine('100000', { vatPercent: '15', sdPercent: '0' })).toEqual({
      sdAmount: '0.00',
      vatAmount: '15000.00',
    });
    expect(saleLine('1234.55', { vatPercent: '15', sdPercent: '10' })).toEqual({
      sdAmount: '123.46',
      vatAmount: '203.70',
    });
    expect(saleLine('5000', { vatPercent: '0', sdPercent: '0' })).toEqual({
      sdAmount: '0.00',
      vatAmount: '0.00',
    });
  });

  it('classes a bill line by its percent when it names no item', () => {
    expect([
      classOf('15'),
      classOf('15.00'),
      classOf('7.5'),
      classOf('0'),
    ]).toEqual(['standard', 'standard', 'reduced', 'exempt']);
  });
});

describe('the monthly return (Mushak 9.1 data)', () => {
  const sales = [
    {
      rateClass: 'standard' as const,
      value: '200000.00',
      sdAmount: '0.00',
      vatAmount: '30000.00',
    },
    {
      rateClass: 'truncated' as const,
      value: '50000.00',
      sdAmount: '0.00',
      vatAmount: '2500.00',
    },
    {
      rateClass: 'zero' as const,
      value: '120000.00',
      sdAmount: '0.00',
      vatAmount: '0.00',
    },
  ];
  const purchases = [
    {
      rateClass: 'standard' as const,
      value: '85000.00',
      vatAmount: '12750.00',
      claimable: true,
    },
    {
      rateClass: 'reduced' as const,
      value: '23000.00',
      vatAmount: '1150.00',
      claimable: true,
    },
    {
      rateClass: 'standard' as const,
      value: '10000.00',
      vatAmount: '1500.00',
      claimable: false,
    }, // supplier without a BIN
  ];

  it("output less input less what customers deposited less last month's credit is to pay", () => {
    const f = returnFigures({
      period: '2026-10',
      sales,
      purchases,
      vdsDeducted: '1912.50',
      vdsDeposited: '0',
      vdsByCustomers: '4500',
      carryForwardIn: '1000',
    });
    expect(f.sales.total).toEqual({
      value: '370000.00',
      sd: '0.00',
      vat: '32500.00',
    });
    expect(f.sales.byClass.zero.value).toBe('120000.00');
    expect(f.purchases.total.vat).toBe('13900.00');
    expect(f.purchases.notClaimable.vat).toBe('1500.00');
    expect(f.netTax).toBe('13100.00'); // 32,500 - 13,900 - 4,500 - 1,000
    expect([f.netPayable, f.carryForwardOut]).toEqual(['13100.00', '0.00']);
    expect(f.vds).toEqual({
      deducted: '1912.50',
      deposited: '0.00',
      stillToDeposit: '1912.50',
    });
  });

  it('more input than output: a credit carried to next month', () => {
    const f = returnFigures({
      period: '2026-11',
      sales: [sales[1]],
      purchases,
      vdsDeducted: '0',
      vdsDeposited: '0',
      vdsByCustomers: '0',
      carryForwardIn: '0',
    });
    expect([f.netTax, f.netPayable, f.carryForwardOut]).toEqual([
      '-11400.00',
      '0.00',
      '11400.00',
    ]);
  });
});

describe('the compliance calendar', () => {
  it('due dates (placeholders)', () => {
    expect(dueDateOf('vat_return', '2026-10')).toBe('2026-11-15');
    expect(dueDateOf('tds_deposit', '2026-12')).toBe('2027-01-14');
    expect(dueDateOf('withholding_return', '2026-27-H1')).toBe('2027-01-31');
    expect(dueDateOf('company_tax_return', '2025-26')).toBe('2027-01-15');
    expect(dueDateOf('trade_licence', '2026-27')).toBe('2026-09-30');
  });

  it('the months around today, the half-years and the fiscal year', () => {
    const items = dueItems('2026-10-30');
    expect(
      items.filter((i) => i.kind === 'vat_return').map((i) => i.period),
    ).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(
      items.filter((i) => i.kind === 'withholding_return').map((i) => i.period),
    ).toEqual(['2025-26-H2', '2026-27-H1']);
    expect(items.find((i) => i.kind === 'company_tax_return')!.period).toBe(
      '2025-26',
    );
  });

  it('one reminder per stage: 7 days, 1 day, overdue', () => {
    const fresh = {
      dueDate: '2026-11-15',
      reminded7: false,
      reminded1: false,
      remindedOverdue: false,
    };
    expect(reminderStage('2026-11-01', fresh)).toBeNull();
    expect(reminderStage('2026-11-08', fresh)).toBe('7');
    expect(
      reminderStage('2026-11-10', { ...fresh, reminded7: true }),
    ).toBeNull();
    expect(reminderStage('2026-11-14', { ...fresh, reminded7: true })).toBe(
      '1',
    );
    expect(
      reminderStage('2026-11-16', {
        ...fresh,
        reminded7: true,
        reminded1: true,
      }),
    ).toBe('overdue');
    expect(
      reminderStage('2026-11-20', {
        ...fresh,
        reminded7: true,
        reminded1: true,
        remindedOverdue: true,
      }),
    ).toBeNull();
  });
});
