/**
 * Support rules without a database (WP28): the ticket's life, and the working-hours
 * arithmetic the SLA clock is built on.
 */
import { describe, expect, it } from 'vitest';
import { businessDate, weekdayOf } from '../../platform/dates/business-date.js';
import {
  addWorkingHours,
  workingHoursBetween,
} from '../../platform/dates/working-time.js';
import { canMove, DEFAULT_SLA, TICKET_PRIORITIES } from './support-rules.js';

/** Dhaka HQ in the demo data: Friday and Saturday are the weekend. */
const isWorkingDay = (date: ReturnType<typeof businessDate>) =>
  !['FRI', 'SAT'].includes(weekdayOf(date));

describe('ticket life (WP28)', () => {
  it('a new ticket is worked, answered or resolved, but never closed straight away', () => {
    expect(canMove('new', 'open')).toBe(true);
    expect(canMove('new', 'resolved')).toBe(true);
    expect(canMove('new', 'closed')).toBe(false);
  });

  it('only a resolved or closed ticket is reopened', () => {
    expect(canMove('resolved', 'open')).toBe(true);
    expect(canMove('closed', 'open')).toBe(true);
    expect(canMove('open', 'closed')).toBe(false);
  });

  it('a ticket waiting for the customer comes back to open, or is resolved', () => {
    expect(canMove('waiting_customer', 'open')).toBe(true);
    expect(canMove('waiting_customer', 'resolved')).toBe(true);
    expect(canMove('waiting_customer', 'closed')).toBe(false);
  });

  it('every priority has a resolution target no sooner than its first response', () => {
    for (const priority of TICKET_PRIORITIES) {
      const sla = DEFAULT_SLA[priority];
      expect(sla.firstResponseHours).toBeGreaterThan(0);
      expect(sla.resolutionHours).toBeGreaterThanOrEqual(
        sla.firstResponseHours,
      );
    }
  });

  it('a more urgent priority is never given more time', () => {
    const order = ['urgent', 'high', 'normal', 'low'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(DEFAULT_SLA[order[i]].firstResponseHours).toBeGreaterThanOrEqual(
        DEFAULT_SLA[order[i - 1]].firstResponseHours,
      );
      expect(DEFAULT_SLA[order[i]].resolutionHours).toBeGreaterThanOrEqual(
        DEFAULT_SLA[order[i - 1]].resolutionHours,
      );
    }
  });
});

describe('the SLA clock stops on weekends and holidays (spec §5)', () => {
  it('an urgent ticket raised Thursday at 16:00 is due at 10:00 on Sunday', () => {
    // Thursday 2026-11-12 16:00 +06, 2 working hours: 2 hours left on Thursday are
    // 16:00-18:00, so the first response is due the same evening
    const raised = new Date('2026-11-12T16:00:00+06:00');
    expect(weekdayOf(businessDate('2026-11-12'))).toBe('THU');
    expect(addWorkingHours(raised, 2, isWorkingDay).toISOString()).toBe(
      new Date('2026-11-12T18:00:00+06:00').toISOString(),
    );
    // 10 working hours from the same moment: 8 hours run out at Thursday midnight,
    // Friday and Saturday do not count, so the rest runs on Sunday
    expect(addWorkingHours(raised, 10, isWorkingDay).toISOString()).toBe(
      new Date('2026-11-15T02:00:00+06:00').toISOString(),
    );
  });

  it('a ticket raised on the weekend starts counting on Sunday', () => {
    const raised = new Date('2026-11-13T10:00:00+06:00'); // Friday
    expect(addWorkingHours(raised, 4, isWorkingDay).toISOString()).toBe(
      new Date('2026-11-15T04:00:00+06:00').toISOString(),
    );
  });
});

describe('time the customer kept the ticket is given back', () => {
  it('counts only working hours between the two moments', () => {
    const from = new Date('2026-11-12T14:00:00+06:00'); // Thursday
    const to = new Date('2026-11-15T14:00:00+06:00'); // Sunday
    // Thursday 14:00-24:00 = 10 h, Friday and Saturday do not count,
    // Sunday 00:00-14:00 = 14 h
    expect(workingHoursBetween(from, to, isWorkingDay)).toBeCloseTo(24, 6);
  });

  it('is nothing when the wait was entirely on a weekend', () => {
    const from = new Date('2026-11-13T09:00:00+06:00'); // Friday
    const to = new Date('2026-11-14T17:00:00+06:00'); // Saturday
    expect(workingHoursBetween(from, to, isWorkingDay)).toBe(0);
  });

  it('is nothing when nothing was waited', () => {
    const at = new Date('2026-11-12T14:00:00+06:00');
    expect(workingHoursBetween(at, at, isWorkingDay)).toBe(0);
  });

  it('pushing a deadline out by the hours waited keeps the team its full time', () => {
    const raised = new Date('2026-11-12T10:00:00+06:00'); // Thursday
    const due = addWorkingHours(raised, 8, isWorkingDay); // Thursday 18:00
    const askedAt = new Date('2026-11-12T11:00:00+06:00');
    const answeredAt = new Date('2026-11-15T11:00:00+06:00'); // Sunday
    const waited = workingHoursBetween(askedAt, answeredAt, isWorkingDay);
    const newDue = addWorkingHours(due, waited, isWorkingDay);
    // the team had 7 working hours left when it asked, and still has 7 after the answer
    expect(workingHoursBetween(answeredAt, newDue, isWorkingDay)).toBeCloseTo(
      7,
      6,
    );
  });
});
