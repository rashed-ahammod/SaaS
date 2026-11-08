import {
  businessDate as d,
  eachDay,
  weekdayOf,
} from '../../platform/dates/business-date.js';
import {
  countLeaveDays,
  daysByLeaveYear,
  leaveYearOf,
  prorate,
  serviceMonths,
  yearEndSplit,
  type CalendarDay,
} from './leave-rules.js';

/** Dhaka HQ calendar: Friday + Saturday weekend, Victory Day 16 Dec. */
const calendar = (from: string, to: string): CalendarDay[] =>
  eachDay(d(from), d(to)).map((date) => ({
    date,
    working: !['FRI', 'SAT'].includes(weekdayOf(date)) && date !== '2026-12-16',
  }));

describe('leaveYearOf', () => {
  it('calendar year by default; July-June when configured', () => {
    expect(leaveYearOf(d('2026-10-15'))).toEqual({
      label: '2026',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(leaveYearOf(d('2026-10-15'), '07-01')).toEqual({
      label: '2026-27',
      from: '2026-07-01',
      to: '2027-06-30',
    });
    expect(leaveYearOf(d('2027-03-01'), '07-01').label).toBe('2026-27');
  });
});

describe('countLeaveDays', () => {
  const opts = {
    countsNonWorkingDays: false,
    sandwichRule: false,
    halfDay: false,
  };

  it('skips weekends and holidays', () => {
    // Thu 15 Oct - Sun 18 Oct: Thu, Sun
    expect(
      countLeaveDays(calendar('2026-10-15', '2026-10-18'), opts).total,
    ).toBe(2);
    // Tue 15 Dec - Thu 17 Dec with Victory Day on Wednesday: 2
    expect(
      countLeaveDays(calendar('2026-12-15', '2026-12-17'), opts).total,
    ).toBe(2);
  });

  it('sandwich rule counts the weekend between two leave days, not at the edges', () => {
    expect(
      countLeaveDays(calendar('2026-10-15', '2026-10-18'), {
        ...opts,
        sandwichRule: true,
      }).total,
    ).toBe(4);
    // Fri-Sun: the weekend is at the start, not between leave days
    expect(
      countLeaveDays(calendar('2026-10-16', '2026-10-18'), {
        ...opts,
        sandwichRule: true,
      }).total,
    ).toBe(1);
  });

  it('maternity counts calendar days', () => {
    expect(
      countLeaveDays(calendar('2026-11-01', '2027-02-28'), {
        ...opts,
        countsNonWorkingDays: true,
      }).total,
    ).toBe(120);
  });

  it('half day is 0.5 on a working day, nothing on a weekend', () => {
    expect(
      countLeaveDays(calendar('2026-10-15', '2026-10-15'), {
        ...opts,
        halfDay: true,
      }).total,
    ).toBe(0.5);
    expect(
      countLeaveDays(calendar('2026-10-16', '2026-10-16'), {
        ...opts,
        halfDay: true,
      }).total,
    ).toBe(0);
  });
});

describe('daysByLeaveYear', () => {
  it('splits a request across New Year', () => {
    const { counted } = countLeaveDays(calendar('2026-12-28', '2027-01-04'), {
      countsNonWorkingDays: false,
      sandwichRule: false,
      halfDay: false,
    });
    const split = daysByLeaveYear(counted, '01-01');
    expect(split.get('2026')).toEqual({ days: 4, firstDate: '2026-12-28' }); // Mon 28 - Thu 31 Dec
    expect(split.get('2027')).toEqual({ days: 2, firstDate: '2027-01-03' }); // Sun 3, Mon 4 Jan (Fri 1, Sat 2 weekend)
  });
});

describe('prorate', () => {
  const year = leaveYearOf(d('2026-01-01'));
  it('full entitlement when joined before the year; part for joiners; nothing after', () => {
    expect(prorate(10, d('2025-03-01'), year)).toBe(10);
    expect(prorate(10, d('2026-07-01'), year)).toBe(5); // 184 of 365 days -> 5.04 -> 5
    expect(prorate(14, d('2026-10-01'), year)).toBe(3.5); // 92/365 * 14 = 3.53 -> 3.5
    expect(prorate(10, d('2027-01-05'), year)).toBe(0);
  });
});

describe('serviceMonths', () => {
  it('counts completed months', () => {
    expect(serviceMonths(d('2026-04-15'), d('2026-10-14'))).toBe(5);
    expect(serviceMonths(d('2026-04-15'), d('2026-10-15'))).toBe(6);
  });
});

describe('yearEndSplit', () => {
  it('lapse everything, or carry up to the cap and encash / lapse the rest', () => {
    expect(yearEndSplit(4, 'lapse', null, false)).toEqual({
      carry: 0,
      encash: 0,
      lapse: 4,
    });
    expect(yearEndSplit(45.5, 'carry', 40, true)).toEqual({
      carry: 40,
      encash: 5.5,
      lapse: 0,
    });
    expect(yearEndSplit(45.5, 'carry', 40, false)).toEqual({
      carry: 40,
      encash: 0,
      lapse: 5.5,
    });
    expect(yearEndSplit(12, 'carry', 40, true)).toEqual({
      carry: 12,
      encash: 0,
      lapse: 0,
    });
    expect(yearEndSplit(0, 'carry', 40, true)).toEqual({
      carry: 0,
      encash: 0,
      lapse: 0,
    });
  });
});
