import { amountInWords } from './amount-in-words.js';
import { formatAmount, formatTaka } from './format.js';
import { Money, TAKA_ROUNDING } from './money.js';

describe('Money', () => {
  it('adds decimals exactly (no floating-point error)', () => {
    expect(Money.of('0.1').plus('0.2').equals('0.3')).toBe(true);
    expect(Money.sum(['1000.10', '2000.20', '0.70']).toDb()).toBe('3001.00');
  });

  it('refuses fractional JS numbers and junk strings', () => {
    expect(() => Money.of(0.1)).toThrow(/as strings/);
    expect(() => Money.of('12,000')).toThrow(/not a valid amount/);
    expect(Money.of(500).toDb()).toBe('500.00');
  });

  it('keeps full precision until rounded, then refuses to save unrounded values', () => {
    const daily = Money.of('30000').dividedBy(26); // 1153.846153...
    expect(() => daily.toDb()).toThrow(/round/);
    expect(daily.round().toDb()).toBe('1153.85');
    expect(daily.round(TAKA_ROUNDING).toDb()).toBe('1154.00');
  });

  it('applies rounding modes and increments', () => {
    expect(
      Money.of('2.5').round({ mode: 'HALF_UP', increment: '1' }).toDb(),
    ).toBe('3.00');
    expect(
      Money.of('2.5').round({ mode: 'HALF_EVEN', increment: '1' }).toDb(),
    ).toBe('2.00');
    expect(
      Money.of('101.01').round({ mode: 'UP', increment: '5' }).toDb(),
    ).toBe('105.00');
    expect(
      Money.of('109.99').round({ mode: 'DOWN', increment: '10' }).toDb(),
    ).toBe('100.00');
    expect(
      Money.of('-2.5').round({ mode: 'HALF_UP', increment: '1' }).toDb(),
    ).toBe('-3.00');
  });

  it('computes a salary split (basic 60% of gross, house rent 50% of basic)', () => {
    const gross = Money.of('45000');
    const basic = gross.times('0.60');
    const houseRent = basic.times('0.50');
    expect(basic.toDb()).toBe('27000.00');
    expect(houseRent.toDb()).toBe('13500.00');
    expect(gross.minus(basic).minus(houseRent).toDb()).toBe('4500.00');
  });

  it('allocates so the parts always add up to the whole', () => {
    const parts = Money.of('100').allocate([1, 1, 1]);
    expect(parts.map((p) => p.toDb())).toEqual(['33.34', '33.33', '33.33']);
    expect(Money.sum(parts).equals('100')).toBe(true);

    const negative = Money.of('-10').allocate([1, 2]);
    expect(Money.sum(negative).equals('-10')).toBe(true);
  });

  it('compares and serialises as a string', () => {
    expect(Money.of('5').greaterThan('4.99')).toBe(true);
    expect(Money.of('-1').isNegative()).toBe(true);
    expect(JSON.stringify({ net: Money.of('12.5') })).toBe('{"net":"12.50"}');
  });
});

describe('formatting', () => {
  it('uses lakh/crore grouping', () => {
    expect(formatAmount(Money.of('1234567.5'))).toBe('12,34,567.50');
    expect(formatAmount(Money.of('123456789012.00'))).toBe(
      '1,23,45,67,89,012.00',
    );
    expect(formatAmount(Money.of('-1000'))).toBe('-1,000.00');
  });

  it('uses Bangla digits for bn', () => {
    expect(formatAmount(Money.of('1234567.5'), 'bn')).toBe('১২,৩৪,৫৬৭.৫০');
    expect(formatTaka(Money.of('500'), 'en')).toBe('৳500.00');
  });
});

describe('amountInWords', () => {
  it('writes English with lakh and crore', () => {
    expect(amountInWords(Money.of('1234567.50'))).toBe(
      'Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven Taka and Fifty Paisa Only',
    );
    expect(amountInWords(Money.of('0'))).toBe('Zero Taka Only');
    expect(amountInWords(Money.of('1500000000'))).toBe(
      'One Hundred Fifty Crore Taka Only',
    );
    expect(amountInWords(Money.of('100005'))).toBe('One Lakh Five Taka Only');
  });

  it('writes Bangla', () => {
    expect(amountInWords(Money.of('1234567.50'), 'bn')).toBe(
      'বারো লক্ষ চৌত্রিশ হাজার পাঁচশত সাতষট্টি টাকা পঞ্চাশ পয়সা মাত্র',
    );
    expect(amountInWords(Money.of('25000'), 'bn')).toBe(
      'পঁচিশ হাজার টাকা মাত্র',
    );
  });
});
