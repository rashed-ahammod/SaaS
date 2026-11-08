import { threeWayMatch, type MatchInputLine } from './three-way-match.js';

// 20 office chairs ordered at Tk 8,500; 15 received so far
const chairs: MatchInputLine = {
  poLineId: 'l1',
  description: 'Office chair, mesh back',
  orderedQty: '20',
  receivedQty: '15',
  billedElsewhereQty: '0',
  billQty: '15',
  poUnitPrice: '8500.00',
  billUnitPrice: '8500.00',
};

describe('three-way match', () => {
  it('matches a bill for what was received at the order price', () => {
    expect(threeWayMatch([chairs], '2')).toMatchObject({
      status: 'matched',
      lines: [{ billedTotalQty: '15', maxUnitPrice: '8670.00', problems: [] }],
    });
  });

  it('refuses billing more than was received, counting the other bills', () => {
    const r = threeWayMatch(
      [{ ...chairs, billedElsewhereQty: '10', billQty: '6' }],
      '2',
    );
    expect(r.status).toBe('mismatch');
    expect(r.lines[0].problems).toEqual(['billed_more_than_received']);
  });

  it('refuses billing more than was ordered', () => {
    const r = threeWayMatch(
      [{ ...chairs, receivedQty: '25', billQty: '21' }],
      '2',
    );
    expect(r.lines[0].problems).toEqual(['billed_more_than_ordered']);
  });

  it('accepts a price within the tolerance and refuses one above it', () => {
    expect(
      threeWayMatch([{ ...chairs, billUnitPrice: '8670.00' }], '2').status,
    ).toBe('matched');
    expect(
      threeWayMatch([{ ...chairs, billUnitPrice: '8670.01' }], '2').lines[0]
        .problems,
    ).toEqual(['price_above_order']);
    expect(
      threeWayMatch([{ ...chairs, billUnitPrice: '8500.01' }], '0').status,
    ).toBe('mismatch');
  });

  it('handles fractional quantities (kg, litres)', () => {
    const diesel = {
      ...chairs,
      orderedQty: '500.5',
      receivedQty: '500.5',
      billQty: '500.5',
      poUnitPrice: '109.00',
      billUnitPrice: '109.00',
    };
    expect(threeWayMatch([diesel], '0').status).toBe('matched');
  });

  it('one bad line makes the whole bill a mismatch', () => {
    const r = threeWayMatch(
      [chairs, { ...chairs, poLineId: 'l2', billQty: '16' }],
      '2',
    );
    expect(r.status).toBe('mismatch');
    expect(r.lines.map((l) => l.problems.length)).toEqual([0, 1]);
  });
});
