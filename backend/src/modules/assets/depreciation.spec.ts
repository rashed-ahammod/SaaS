import {
  accumulatedAt,
  addMonths,
  schedule,
  type DepreciableAsset,
} from './depreciation.js';

// a Walton refrigerator for the HO pantry: Tk 1,00,000, 5 years straight line, no residual
const fridge: DepreciableAsset = {
  cost: '100000',
  residualValue: '0',
  inServiceDate: '2026-07-15',
  openingAccumulated: '0',
  openingAsOf: null,
  method: 'straight_line',
  usefulLifeMonths: 60,
  annualRatePercent: null,
};

describe('straight line', () => {
  it('spreads evenly from the in-service month and lands exactly at the end', () => {
    const rows = schedule(fridge, '2040-01');
    expect(rows).toHaveLength(60);
    expect(rows[0]).toEqual({
      period: '2026-07',
      charge: '1666.67',
      accumulated: '1666.67',
      bookValue: '98333.33',
    });
    expect(rows[1].charge).toBe('1666.66'); // cumulative rounding: no drift
    expect(rows[59]).toMatchObject({
      period: '2031-06',
      accumulated: '100000.00',
      bookValue: '0.00',
    });
  });

  it('is the same every time, and stops at the period asked', () => {
    expect(schedule(fridge, '2026-12')).toEqual(
      schedule(fridge, '2040-01').slice(0, 6),
    );
    expect(accumulatedAt(fridge, '2026-09')).toBe('5000.00');
    expect(accumulatedAt(fridge, '2026-06')).toBe('0.00'); // not in service yet
  });

  it('keeps the residual value', () => {
    const rows = schedule({ ...fridge, residualValue: '10000' }, '2040-01');
    expect(rows[59]).toMatchObject({
      accumulated: '90000.00',
      bookValue: '10000.00',
    });
  });

  it('an asset from the old books continues from its opening depreciation', () => {
    // bought July 2024, 24 months already depreciated (40,000) by 30 June 2026: 36 months left
    const old = {
      ...fridge,
      inServiceDate: '2024-07-01',
      openingAccumulated: '40000',
      openingAsOf: '2026-06-30',
    };
    const rows = schedule(old, '2040-01');
    expect(rows).toHaveLength(36);
    expect(rows[0]).toMatchObject({
      period: '2026-07',
      charge: '1666.67',
      accumulated: '41666.67',
    });
    expect(rows[35]).toMatchObject({
      period: '2029-06',
      accumulated: '100000.00',
    });
  });
});

describe('reducing balance', () => {
  // a Toyota Hiace for deliveries: Tk 45,00,000 at 20 % a year, residual Tk 5,00,000
  const van: DepreciableAsset = {
    ...fridge,
    cost: '4500000',
    residualValue: '500000',
    method: 'reducing_balance',
    usefulLifeMonths: null,
    annualRatePercent: '20',
  };

  it('charges the book value x rate / 12 each month', () => {
    const rows = schedule(van, '2026-09');
    expect(rows.map((r) => r.charge)).toEqual([
      '75000.00',
      '73750.00',
      '72520.83',
    ]);
    expect(rows[2].bookValue).toBe('4278729.17');
  });

  it('never goes below the residual value', () => {
    const rows = schedule(van, '2060-12');
    expect(rows[rows.length - 1].bookValue).toBe('500000.00');
    expect(rows.every((r) => Number(r.charge) > 0)).toBe(true);
  });
});

it('months', () => {
  expect(addMonths('2026-12', 1)).toBe('2027-01');
  expect(addMonths('2026-01', -1)).toBe('2025-12');
});
