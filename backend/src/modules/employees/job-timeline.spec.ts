import { businessDate as d } from '../../platform/dates/business-date.js';
import {
  buildTimeline,
  placementOn,
  sameTimeline,
  type TimelineEvent,
} from './job-timeline.js';

const joining: TimelineEvent = {
  id: 'join',
  seq: 1,
  effectiveFrom: d('2026-01-01'),
  changes: {
    branch_id: 'DHK',
    department_id: 'A',
    designation_id: 'EXEC',
    grade_id: 'G1',
    line_manager_id: 'M1',
  },
};

const periods = (events: TimelineEvent[]) =>
  buildTimeline(events).map(
    (s) =>
      `${s.effectiveFrom}..${s.effectiveTo ?? 'open'} ${s.department_id}/${s.grade_id}`,
  );

describe('buildTimeline', () => {
  it('starts with the joining placement, open-ended', () => {
    expect(periods([joining])).toEqual(['2026-01-01..open A/G1']);
  });

  it('a later change closes the previous period and opens a new one', () => {
    const promo: TimelineEvent = {
      id: 'p',
      seq: 2,
      effectiveFrom: d('2026-06-01'),
      changes: { grade_id: 'G2' },
    };
    expect(periods([joining, promo])).toEqual([
      '2026-01-01..2026-06-01 A/G1',
      '2026-06-01..open A/G2',
    ]);
  });

  it('a back-dated transfer recorded after a promotion carries into the promotion period', () => {
    const promo: TimelineEvent = {
      id: 'p',
      seq: 2,
      effectiveFrom: d('2026-06-01'),
      changes: { grade_id: 'G2' },
    };
    const transfer: TimelineEvent = {
      id: 't',
      seq: 3,
      effectiveFrom: d('2026-03-01'),
      changes: { department_id: 'B' },
    };
    expect(periods([joining, promo, transfer])).toEqual([
      '2026-01-01..2026-03-01 A/G1',
      '2026-03-01..2026-06-01 B/G1',
      '2026-06-01..open B/G2',
    ]);
  });

  it('a later transfer is not overridden by an earlier back-dated one', () => {
    const toC: TimelineEvent = {
      id: 'c',
      seq: 2,
      effectiveFrom: d('2026-08-01'),
      changes: { department_id: 'C' },
    };
    const toB: TimelineEvent = {
      id: 'b',
      seq: 3,
      effectiveFrom: d('2026-03-01'),
      changes: { department_id: 'B' },
    };
    expect(periods([joining, toC, toB])).toEqual([
      '2026-01-01..2026-03-01 A/G1',
      '2026-03-01..2026-08-01 B/G1',
      '2026-08-01..open C/G1',
    ]);
  });

  it('two events on the same date combine; the later recording wins on conflicts', () => {
    const a: TimelineEvent = {
      id: 'a',
      seq: 2,
      effectiveFrom: d('2026-05-01'),
      changes: { department_id: 'B', grade_id: 'G2' },
    };
    const b: TimelineEvent = {
      id: 'b',
      seq: 3,
      effectiveFrom: d('2026-05-01'),
      changes: { grade_id: 'G3' },
    };
    const t = buildTimeline([joining, a, b]);
    expect(t).toHaveLength(2);
    expect(t[1]).toMatchObject({
      department_id: 'B',
      grade_id: 'G3',
      sourceEventId: 'b',
    });
  });

  it('a change to the same value adds no period', () => {
    const same: TimelineEvent = {
      id: 's',
      seq: 2,
      effectiveFrom: d('2026-04-01'),
      changes: { department_id: 'A' },
    };
    expect(periods([joining, same])).toEqual(['2026-01-01..open A/G1']);
    expect(
      sameTimeline(buildTimeline([joining]), buildTimeline([joining, same])),
    ).toBe(true);
  });

  it('null clears a manager', () => {
    const clear: TimelineEvent = {
      id: 'x',
      seq: 2,
      effectiveFrom: d('2026-02-01'),
      changes: { line_manager_id: null },
    };
    const t = buildTimeline([joining, clear]);
    expect(t[1].line_manager_id).toBeNull();
  });

  it('refuses a timeline with missing required fields', () => {
    const incomplete: TimelineEvent = {
      id: 'j',
      seq: 1,
      effectiveFrom: d('2026-01-01'),
      changes: { department_id: 'A' },
    };
    expect(() => buildTimeline([incomplete])).toThrow(
      /no branch_id, designation_id, grade_id/,
    );
  });

  it('finds the placement on a date (end date is exclusive)', () => {
    const promo: TimelineEvent = {
      id: 'p',
      seq: 2,
      effectiveFrom: d('2026-06-01'),
      changes: { grade_id: 'G2' },
    };
    const t = buildTimeline([joining, promo]);
    expect(placementOn(t, d('2025-12-31'))).toBeUndefined();
    expect(placementOn(t, d('2026-05-31'))?.grade_id).toBe('G1');
    expect(placementOn(t, d('2026-06-01'))?.grade_id).toBe('G2');
  });
});
