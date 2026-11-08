import { levelsReached, position, projected } from './budget-math.js';

// Sales furniture: Tk 3,00,000 for the year
describe('budget position', () => {
  it('used, available and percent; within below the warning', () => {
    expect(position('300000', '120000', '60000', '80')).toEqual({
      budget: '300000.00',
      actual: '120000.00',
      committed: '60000.00',
      used: '180000.00',
      available: '120000.00',
      percent: '60.00',
      status: 'within',
    });
  });

  it('a warning from 80 %, over only above 100 %', () => {
    expect(position('300000', '200000', '40000', '80').status).toBe('warning'); // exactly 80 %
    expect(position('300000', '300000', '0', '80')).toMatchObject({
      percent: '100.00',
      status: 'warning',
      available: '0.00',
    });
    expect(position('300000', '300000', '0.01', '80')).toMatchObject({
      status: 'over',
      available: '-0.01',
    });
  });

  it('a zero budget has no percent; any spending is over', () => {
    expect(position('0', '0', '0', '80')).toMatchObject({
      percent: null,
      status: 'within',
    });
    expect(position('0', '500', '0', '80')).toMatchObject({
      percent: null,
      status: 'over',
    });
  });

  it('projects new spending on top of what is used', () => {
    const now = position('300000', '150000', '50000', '80');
    expect(projected(now, '84410', '80')).toMatchObject({
      used: '284410.00',
      percent: '94.80',
      status: 'warning',
    });
    expect(projected(now, '100000.01', '80').status).toBe('over');
  });

  it('alert levels: 80 at the warning percent, 100 at the full budget', () => {
    expect(levelsReached(position('100000', '79999', '0', '80'), '80')).toEqual(
      [],
    );
    expect(levelsReached(position('100000', '80000', '0', '80'), '80')).toEqual(
      [80],
    );
    expect(
      levelsReached(position('100000', '100000', '0', '80'), '80'),
    ).toEqual([80, 100]);
    expect(levelsReached(position('100000', '70000', '0', '70'), '70')).toEqual(
      [80],
    ); // the warning level is stored as 80
  });
});
