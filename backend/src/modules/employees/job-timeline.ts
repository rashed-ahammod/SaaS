/**
 * Builds an employee's assignment timeline from their job events.
 * Pure function: no database, easy to test (job-timeline.spec.ts).
 *
 * Each event says "from DATE, these fields are ...". Fields it does not mention
 * keep their previous value. Example:
 *
 *   events (in any order)                         timeline
 *   2026-01-01 joining   dept=A grade=1           [2026-01-01, 2026-03-01) dept A grade 1
 *   2026-06-01 promotion grade=2                  [2026-03-01, 2026-06-01) dept B grade 1
 *   2026-03-01 transfer  dept=B  (recorded late)  [2026-06-01, open)       dept B grade 2
 *
 * The back-dated transfer (recorded after the promotion) correctly carries into
 * the promotion period: this is why the timeline is rebuilt from all events
 * instead of patching rows (WP1 acceptance: "back-dated transfer shows correct history").
 */
import type { BusinessDate } from '../../platform/dates/business-date.js';

export const PLACEMENT_FIELDS = [
  'branch_id',
  'department_id',
  'designation_id',
  'grade_id',
  'line_manager_id',
  'functional_manager_id',
] as const;
export type PlacementField = (typeof PLACEMENT_FIELDS)[number];

/** Fields every period must have. Managers may be empty (top of the organization). */
export const REQUIRED_FIELDS: PlacementField[] = [
  'branch_id',
  'department_id',
  'designation_id',
  'grade_id',
];

export type Placement = Record<PlacementField, string | null>;
export type PlacementChanges = Partial<Placement>;

export interface TimelineEvent {
  id: string;
  /** Recording order: decides between two events on the same date (later wins). */
  seq: number;
  effectiveFrom: BusinessDate;
  changes: PlacementChanges;
}

export interface TimelineSegment extends Placement {
  effectiveFrom: BusinessDate;
  /** Exclusive end; null = still current. */
  effectiveTo: BusinessDate | null;
  /** The last event that shaped this period. */
  sourceEventId: string;
}

export class TimelineError extends Error {}

const EMPTY: Placement = {
  branch_id: null,
  department_id: null,
  designation_id: null,
  grade_id: null,
  line_manager_id: null,
  functional_manager_id: null,
};

export function buildTimeline(events: TimelineEvent[]): TimelineSegment[] {
  const sorted = [...events].sort((a, b) =>
    a.effectiveFrom === b.effectiveFrom
      ? a.seq - b.seq
      : a.effectiveFrom < b.effectiveFrom
        ? -1
        : 1,
  );

  const segments: TimelineSegment[] = [];
  let state: Placement = { ...EMPTY };

  for (const event of sorted) {
    state = { ...state, ...pickPlacement(event.changes) };
    const last = segments.at(-1);

    if (last && last.effectiveFrom === event.effectiveFrom) {
      // another event on the same date: it updates that period
      Object.assign(last, state, { sourceEventId: event.id });
    } else {
      if (last) last.effectiveTo = event.effectiveFrom;
      segments.push({
        ...state,
        effectiveFrom: event.effectiveFrom,
        effectiveTo: null,
        sourceEventId: event.id,
      });
    }
  }

  const merged = mergeUnchanged(segments);

  for (const segment of merged) {
    const missing = REQUIRED_FIELDS.filter((f) => !segment[f]);
    if (missing.length) {
      throw new TimelineError(
        `From ${segment.effectiveFrom} the employee has no ${missing.join(', ')}`,
      );
    }
  }
  return merged;
}

/** The placement in force on a date, or undefined (before joining). */
export function placementOn(
  timeline: TimelineSegment[],
  date: BusinessDate,
): TimelineSegment | undefined {
  return timeline.find(
    (s) =>
      s.effectiveFrom <= date &&
      (s.effectiveTo === null || date < s.effectiveTo),
  );
}

/** True if two timelines describe the same periods and placements. */
export function sameTimeline(
  a: TimelineSegment[],
  b: TimelineSegment[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) =>
      s.effectiveFrom === b[i].effectiveFrom &&
      s.effectiveTo === b[i].effectiveTo &&
      samePlacement(s, b[i]),
  );
}

function samePlacement(a: Placement, b: Placement): boolean {
  return PLACEMENT_FIELDS.every((f) => a[f] === b[f]);
}

/** A period identical to the one before it is joined to it (a change that changed nothing). */
function mergeUnchanged(segments: TimelineSegment[]): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  for (const s of segments) {
    const prev = out.at(-1);
    if (prev && samePlacement(prev, s)) prev.effectiveTo = s.effectiveTo;
    else out.push({ ...s });
  }
  return out;
}

/** Keep only known placement fields (ignores anything else stored in `changes`). */
function pickPlacement(changes: PlacementChanges): PlacementChanges {
  const out: PlacementChanges = {};
  for (const f of PLACEMENT_FIELDS)
    if (f in changes) out[f] = changes[f] ?? null;
  return out;
}
