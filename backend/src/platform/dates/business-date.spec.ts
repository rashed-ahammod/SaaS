import {
  addDays,
  addMonths,
  businessDate,
  daysBetween,
  daysInMonth,
  eachDay,
  fiscalYearOf,
  monthRange,
  toBusinessDate,
  weekdayOf,
} from './business-date.js';

describe('business dates (Asia/Dhaka)', () => {
  it('maps a UTC instant to the Dhaka calendar day', () => {
    // 19:30 UTC on the 13th is 01:30 on the 14th in Dhaka (UTC+6)
    expect(toBusinessDate(new Date('2026-10-13T19:30:00Z'))).toBe('2026-10-14');
    expect(toBusinessDate(new Date('2026-10-13T17:59:59Z'))).toBe('2026-10-13');
  });

  it('rejects impossible dates', () => {
    expect(() => businessDate('2026-02-30')).toThrow();
    expect(() => businessDate('14/10/2026')).toThrow();
    expect(businessDate('2028-02-29')).toBe('2028-02-29');
  });

  it('does date arithmetic without timezone drift', () => {
    const d = businessDate('2026-12-31');
    expect(addDays(d, 1)).toBe('2027-01-01');
    expect(
      daysBetween(businessDate('2026-11-16'), businessDate('2026-11-30')),
    ).toBe(14);
    expect(
      eachDay(businessDate('2026-02-27'), businessDate('2026-03-02')),
    ).toHaveLength(4);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('adds months, capping the day at month end', () => {
    expect(addMonths(businessDate('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonths(businessDate('2026-11-16'), 6)).toBe('2027-05-16');
    expect(addMonths(businessDate('2026-03-15'), -3)).toBe('2025-12-15');
  });

  it('knows weekdays (Friday weekend)', () => {
    expect(weekdayOf(businessDate('2026-10-16'))).toBe('FRI');
  });

  it('labels the July-June fiscal year', () => {
    expect(fiscalYearOf(businessDate('2026-10-14'))).toBe('2026-27');
    expect(fiscalYearOf(businessDate('2027-06-30'))).toBe('2026-27');
    expect(fiscalYearOf(businessDate('2027-07-01'))).toBe('2027-28');
    expect(fiscalYearOf(businessDate('2026-10-14'), '01-01')).toBe('2026');
  });

  it('gives a month its real last day, which "-31" does not', () => {
    expect(monthRange('2026-11')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(monthRange('2026-02')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(monthRange('2028-02')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    }); // leap
    expect(monthRange('2026-12')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });
});
