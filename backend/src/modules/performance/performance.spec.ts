/**
 * Performance rules without a database (WP30): the cycle's phases, one appraisal's steps,
 * the weights that must add up, and the weighted score the manager is shown.
 */
import { describe, expect, it } from 'vitest';
import {
  CYCLE_PHASES,
  canAppraisalMove,
  nextPhase,
  phaseReached,
  reviewDraftSystemPrompt,
  suggestedRating,
  weightedScore,
  weightsValid,
} from './performance-rules.js';

describe('the cycle only moves forward (spec §6.5)', () => {
  it('walks draft -> goals -> self-review -> manager review -> calibration -> proposals -> closed', () => {
    expect(CYCLE_PHASES).toEqual([
      'draft',
      'goals',
      'self_review',
      'manager_review',
      'calibration',
      'proposals',
      'closed',
    ]);
    let state = CYCLE_PHASES[0];
    const walked = [state];
    for (;;) {
      const next = nextPhase(state);
      if (!next) break;
      state = next;
      walked.push(state);
    }
    expect(walked).toEqual(CYCLE_PHASES);
  });

  it('has nowhere to go from closed', () => {
    expect(nextPhase('closed')).toBeNull();
  });

  it('knows which phases a cycle has already passed', () => {
    expect(phaseReached('calibration', 'self_review')).toBe(true);
    expect(phaseReached('goals', 'self_review')).toBe(false);
    // the states do NOT sort alphabetically in phase order, which is the trap this guards:
    // comparing them as text would put calibration before goals
    const asText = [...CYCLE_PHASES].sort();
    expect(asText).not.toEqual(CYCLE_PHASES);
    expect(asText.indexOf('calibration')).toBeLessThan(asText.indexOf('goals'));
    expect(phaseReached('calibration', 'goals')).toBe(true);
  });
});

describe('one appraisal’s steps', () => {
  it('goes goals -> self-review -> manager review -> calibration -> done', () => {
    expect(canAppraisalMove('goals', 'self_review')).toBe(true);
    expect(canAppraisalMove('self_review', 'manager_review')).toBe(true);
    expect(canAppraisalMove('manager_review', 'calibration')).toBe(true);
    expect(canAppraisalMove('calibration', 'done')).toBe(true);
  });

  it('never skips the manager or the calibration, and never goes back', () => {
    expect(canAppraisalMove('self_review', 'calibration')).toBe(false);
    expect(canAppraisalMove('manager_review', 'done')).toBe(false);
    expect(canAppraisalMove('calibration', 'manager_review')).toBe(false);
    expect(canAppraisalMove('done', 'calibration')).toBe(false);
  });
});

describe('goal weights are the whole of the appraisal', () => {
  it('accepts weights that add up to 100', () => {
    expect(weightsValid([{ weight: 40 }, { weight: 30 }, { weight: 30 }])).toBe(
      true,
    );
  });

  it('refuses anything else, including no goals at all', () => {
    expect(weightsValid([{ weight: 40 }, { weight: 30 }])).toBe(false);
    expect(weightsValid([{ weight: 60 }, { weight: 60 }])).toBe(false);
    expect(weightsValid([])).toBe(false);
  });
});

describe('the weighted score the manager is shown', () => {
  it('weights each score by its goal', () => {
    expect(
      weightedScore([
        { weight: 50, score: 4 },
        { weight: 50, score: 2 },
      ]),
    ).toBe(3);
    expect(
      weightedScore([
        { weight: 80, score: 5 },
        { weight: 20, score: 1 },
      ]),
    ).toBe(4.2);
  });

  it('leaves out goals nobody scored rather than counting them as zero', () => {
    expect(
      weightedScore([
        { weight: 50, score: 4 },
        { weight: 50, score: null },
      ]),
    ).toBe(4);
  });

  it('is nothing when nothing was scored', () => {
    expect(weightedScore([{ weight: 100, score: null }])).toBeNull();
    expect(weightedScore([])).toBeNull();
  });

  it('suggests a rating but stays inside 1 to 5', () => {
    expect(suggestedRating(4.2)).toBe(4);
    expect(suggestedRating(3.5)).toBe(4);
    expect(suggestedRating(0.4)).toBe(1);
    expect(suggestedRating(null)).toBeNull();
  });
});

describe('the review-draft prompt', () => {
  const prompt = reviewDraftSystemPrompt('en');

  it('tells the model it has no name and no protected characteristic', () => {
    expect(prompt).toContain('no name');
    expect(prompt.toLowerCase()).toContain('religion');
  });

  it('forbids inventing evidence, and says to admit thin evidence instead', () => {
    expect(prompt.toLowerCase()).toContain('never invent');
    expect(prompt.toLowerCase()).toContain('evidence is thin');
  });

  it('forbids a rating, an increment and a promotion: the manager decides', () => {
    expect(prompt.toLowerCase()).toContain('do not give a rating');
    expect(prompt.toLowerCase()).toContain('increment');
    expect(prompt.toLowerCase()).toContain('the manager decides');
  });
});
