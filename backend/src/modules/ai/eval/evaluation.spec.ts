/**
 * The grader itself. It decides whether a release gate passes, so the one trap it fell into
 * is pinned here: a quantity written plainly in a YAML list (`anyOf: [500, cans]`) arrives as
 * a number, and treating every non-string as a {data: ...} reference made the whole case fail
 * with "Cannot read properties of undefined" instead of matching the text.
 */
import { grade, type EvalCase } from './evaluation.js';

const resolve = (ref: string) => {
  if (ref !== 'balance') throw new Error(`unknown reference ${ref}`);
  return '12,500.00';
};

const base: EvalCase = { id: 'c1', language: 'en' };

describe('grade', () => {
  it('matches a number written plainly in the expectations', () => {
    const c: EvalCase = { ...base, anyOf: [500, 'cans'] };
    expect(
      grade(c, 'We can quote 500 cans delivered to Bogura.', [], resolve),
    ).toEqual([]);
    expect(grade(c, 'We can quote nothing at all.', [], resolve)).toEqual([
      'none of "500", "cans"',
    ]);
  });

  it('resolves a {data} expectation against the value the system holds now', () => {
    const c: EvalCase = { ...base, allOf: [{ data: 'balance' }] };
    expect(grade(c, 'The balance is 12,500.00 taka.', [], resolve)).toEqual([]);
    expect(grade(c, 'The balance is 9,000.00 taka.', [], resolve)).toEqual([
      'missing "12,500.00"',
    ]);
  });

  it('fails an empty answer, and a forbidden phrase whatever its case', () => {
    expect(grade(base, '   ', [], resolve)).toEqual(['empty answer']);
    expect(
      grade(
        { ...base, noneOf: ['i have sent'] },
        'I Have Sent the quotation.',
        [],
        resolve,
      ),
    ).toEqual(['must not contain "i have sent"']);
  });

  it('reads a Bangla numeral in the answer as the number it is', () => {
    expect(
      grade({ ...base, allOf: [500] }, '৫০০ ক্যানের কোটেশন।', [], resolve),
    ).toEqual([]);
  });

  it('fails a case that did not use the tool it was supposed to use', () => {
    expect(
      grade({ ...base, tool: 'leave_balance' }, 'Two days.', [], resolve),
    ).toEqual(['did not use leave_balance (used: none)']);
    expect(
      grade(
        { ...base, tool: 'leave_balance' },
        'Two days.',
        ['leave_balance'],
        resolve,
      ),
    ).toEqual([]);
  });
});
