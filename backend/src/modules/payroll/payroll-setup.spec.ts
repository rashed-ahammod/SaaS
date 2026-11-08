import { completedYears, monthPeriod } from './payroll-periods.js';
import {
  BD_DEFAULT_STRUCTURE,
  checkStructure,
} from './payroll-setup.service.js';

const EARNINGS = new Set([
  'BASIC',
  'HOUSE_RENT',
  'MEDICAL',
  'CONVEYANCE',
  'OTHER_ALLOWANCE',
]);

describe('checkStructure', () => {
  it('accepts the Bangladesh standard structure', () => {
    expect(checkStructure(BD_DEFAULT_STRUCTURE.rules, EARNINGS)).toBeNull();
  });

  it('needs BASIC, known heads, and one way per rule', () => {
    expect(
      checkStructure(
        [{ head: 'HOUSE_RENT', of: 'GROSS', percent: '50' }],
        EARNINGS,
      ),
    ).toMatch(/BASIC is required/);
    expect(
      checkStructure([{ head: 'BONUS', of: 'GROSS', percent: '50' }], EARNINGS),
    ).toMatch(/not an active earning head/);
    expect(
      checkStructure(
        [{ head: 'BASIC', of: 'GROSS', percent: '60', fixed: '100' }],
        EARNINGS,
      ),
    ).toMatch(/exactly one/);
  });

  it('refers only to earlier heads; the remainder comes last', () => {
    expect(
      checkStructure(
        [
          { head: 'HOUSE_RENT', of: 'BASIC', percent: '50' },
          { head: 'BASIC', of: 'GROSS', percent: '60' },
        ],
        EARNINGS,
      ),
    ).toMatch(/earlier head/);
    expect(
      checkStructure(
        [
          { head: 'BASIC', of: 'GROSS', percent: '60' },
          { head: 'OTHER_ALLOWANCE', remainder: true },
          { head: 'MEDICAL', fixed: '500' },
        ],
        EARNINGS,
      ),
    ).toMatch(/last rule/);
  });

  it('refuses heads that add up to more than gross', () => {
    const rules = [
      { head: 'BASIC', of: 'GROSS', percent: '80' },
      { head: 'HOUSE_RENT', of: 'BASIC', percent: '50' },
      { head: 'OTHER_ALLOWANCE', remainder: true },
    ];
    expect(checkStructure(rules, EARNINGS)).toMatch(/more than the gross/);
  });
});

describe('pay periods', () => {
  it('a month belongs to the July-June fiscal year', () => {
    expect(monthPeriod('2026-06')).toMatchObject({
      from: '2026-06-01',
      to: '2026-06-30',
      fiscalYear: { label: '2025-26' },
    });
    expect(monthPeriod('2026-07').fiscalYear).toEqual({
      label: '2026-27',
      from: '2026-07-01',
      to: '2027-06-30',
    });
    expect(monthPeriod('2028-02').to).toBe('2028-02-29');
  });

  it('counts completed years of service', () => {
    expect(completedYears('2025-01-01', '2026-11-10')).toBe(1);
    expect(completedYears('2025-11-11', '2026-11-10')).toBe(0);
    expect(completedYears('2025-11-10', '2026-11-10')).toBe(1);
  });
});
