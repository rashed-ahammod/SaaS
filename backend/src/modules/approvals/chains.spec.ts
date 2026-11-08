import {
  defaultChain,
  matchesConditions,
  pickChain,
  step,
  type ChainDefinition,
} from './chains.js';

const facts = {
  companyId: 'c1',
  departmentId: 'sales',
  amount: '75000.00',
  days: 5,
};

describe('matchesConditions', () => {
  it('empty conditions match everything', () => {
    expect(matchesConditions({}, facts)).toBe(true);
  });

  it('amount limits (money compared exactly)', () => {
    expect(matchesConditions({ minAmount: '50000' }, facts)).toBe(true);
    expect(matchesConditions({ minAmount: '75000.01' }, facts)).toBe(false);
    expect(matchesConditions({ maxAmount: '75000' }, facts)).toBe(true);
    expect(matchesConditions({ minAmount: '1' }, { companyId: 'c1' })).toBe(
      false,
    ); // no amount
  });

  it('days, company and department', () => {
    expect(matchesConditions({ minDays: 4 }, facts)).toBe(true);
    expect(matchesConditions({ maxDays: 3 }, facts)).toBe(false);
    expect(matchesConditions({ companyIds: ['c2'] }, facts)).toBe(false);
    expect(matchesConditions({ departmentIds: ['sales', 'hr'] }, facts)).toBe(
      true,
    );
    expect(
      matchesConditions({ kinds: ['ML', 'LWP'] }, { ...facts, kind: 'ML' }),
    ).toBe(true);
    expect(
      matchesConditions({ kinds: ['ML', 'LWP'] }, { ...facts, kind: 'CL' }),
    ).toBe(false);
  });
});

describe('pickChain', () => {
  const big: ChainDefinition = {
    id: 'big',
    name: 'Above 50,000',
    conditions: { minAmount: '50000' },
    steps: [],
  };
  const any: ChainDefinition = {
    id: 'any',
    name: 'Everything else',
    conditions: {},
    steps: [],
  };

  const builtIn = defaultChain('HR approves (default)', step(1, 'role:hr'));

  it('takes the first configured chain that matches, in priority order', () => {
    expect(pickChain([big, any], [builtIn], facts)?.id).toBe('big');
    expect(
      pickChain([big, any], [builtIn], { ...facts, amount: '100' })?.id,
    ).toBe('any');
  });

  it('falls back to the built-in default chain', () => {
    expect(pickChain([big], [builtIn], { ...facts, amount: '100' })?.name).toBe(
      'HR approves (default)',
    );
  });

  it('returns nothing when there is no chain at all', () => {
    expect(pickChain([], [], facts)).toBeUndefined();
  });
});
