import { describe, expect, it } from 'vitest';
import { completedYears, vestedPercent } from './pf-fund.service.js';

describe('PF final settlement: the employer part vested by years of service (placeholder tiers)', () => {
  it('counts completed years to the day', () => {
    expect(completedYears('2021-12-01', '2026-11-30')).toBe(4);
    expect(completedYears('2021-12-01', '2026-12-01')).toBe(5);
    expect(completedYears('2024-02-29', '2027-02-28')).toBe(2);
  });

  it('under 3 years nothing, 3 to 5 half, 5 and more all', () => {
    expect([0, 2, 3, 4, 5, 12].map(vestedPercent)).toEqual([
      '0',
      '0',
      '50',
      '50',
      '100',
      '100',
    ]);
  });
});
