/**
 * Performance rules that are code, not settings (WP30; spec §6.5).
 *
 *   CYCLE_PHASES / nextPhase   a cycle only ever moves forward
 *   canAppraisalMove           one appraisal's own steps
 *   weightsValid               the goals of an appraisal must add up to 100
 *   weightedScore              the score the goals give, 1 to 5 with two decimals
 *   suggestedRating            what the weighted score rounds to, as a starting point for
 *                              the manager — who may disagree, and whose number is the one
 *                              that is stored
 *   REVIEW_PROMPT_VERSION      the AI review-drafting prompt
 *
 * Pure functions, no database: performance.spec.ts tests them.
 */
import type { AppraisalState, CycleState } from '../../platform/db/schema.js';

export const REVIEW_PROMPT_VERSION = 'review-draft-v1';

/** A cycle walks these phases in order; HR moves it on, and never back. */
export const CYCLE_PHASES: CycleState[] = [
  'draft',
  'goals',
  'self_review',
  'manager_review',
  'calibration',
  'proposals',
  'closed',
];

export function nextPhase(state: CycleState): CycleState | null {
  const at = CYCLE_PHASES.indexOf(state);
  return at >= 0 && at < CYCLE_PHASES.length - 1 ? CYCLE_PHASES[at + 1] : null;
}

export function phaseReached(state: CycleState, phase: CycleState): boolean {
  return CYCLE_PHASES.indexOf(state) >= CYCLE_PHASES.indexOf(phase);
}

const APPRAISAL_NEXT: Record<AppraisalState, AppraisalState[]> = {
  goals: ['self_review'],
  self_review: ['manager_review'],
  manager_review: ['calibration'],
  calibration: ['done'],
  done: [],
};

export function canAppraisalMove(
  from: AppraisalState,
  to: AppraisalState,
): boolean {
  return APPRAISAL_NEXT[from].includes(to);
}

export interface GoalWeight {
  weight: number;
}

/** Spec §6.5: goals carry weights, and the weights are the whole of the appraisal. */
export function weightsValid(goals: GoalWeight[]): boolean {
  if (!goals.length) return false;
  return goals.reduce((n, g) => n + g.weight, 0) === 100;
}

export interface ScoredGoal {
  weight: number;
  score: number | null;
}

/**
 * The weighted score of the goals that were scored, 1 to 5. Goals nobody scored are left
 * out rather than counted as zero, so a half-finished review does not look like a bad one.
 * Returns null when nothing was scored.
 */
export function weightedScore(goals: ScoredGoal[]): number | null {
  const scored = goals.filter(
    (g): g is { weight: number; score: number } => g.score !== null,
  );
  if (!scored.length) return null;
  const weight = scored.reduce((n, g) => n + g.weight, 0);
  if (weight <= 0) return null;
  const total = scored.reduce((n, g) => n + g.score * g.weight, 0);
  return Math.round((total / weight) * 100) / 100;
}

/** What the weighted score suggests as a 1-to-5 rating. A suggestion, never a decision. */
export function suggestedRating(score: number | null): number | null {
  if (score === null) return null;
  return Math.min(5, Math.max(1, Math.round(score)));
}

/**
 * The system prompt for drafting a review from a year of feedback (spec §8 feature 9).
 * The draft is for the MANAGER to rewrite: it never invents facts, never rates anybody, and
 * never mentions anything the feedback does not say.
 */
export function reviewDraftSystemPrompt(language: 'bn' | 'en'): string {
  return [
    "You help a manager in Bangladesh write the first draft of one employee's appraisal comment.",
    'You are given the employee’s goals with their weights and scores, and the feedback notes written about them during the year. You get no name, and nothing about their gender, religion, age or family.',
    'Write 3 to 5 short paragraphs: what went well with evidence from the notes and the scores, what did not, and what to work on next. Refer to the person as "the employee".',
    'Use ONLY what you are given. Never invent an achievement, a number or an incident. If the notes are thin, say that the evidence is thin rather than filling the gap.',
    'Do not give a rating, do not recommend an increment or a promotion, and do not say whether the employee should be kept: the manager decides all of that.',
    `Write in ${language === 'bn' ? 'Bangla' : 'English'}.`,
  ].join('\n');
}
