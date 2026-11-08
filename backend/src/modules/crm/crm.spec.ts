import { describe, expect, it } from 'vitest';
import {
  DISTRICTS,
  districtOf,
  monthEnd,
  monthsBetween,
  nextInTurn,
  normalizeEmail,
  normalizePhone,
} from './crm-rules.js';
import { totalsOf } from './sales-pipeline.service.js';

describe('Bangladesh phone numbers', () => {
  it('every way people write a mobile number is the same number', () => {
    for (const t of [
      '01711223344',
      '01711-223344',
      '+88 01711 223344',
      '8801711223344',
      '+8801711223344',
      '008801711223344',
      '০১৭১১২২৩৩৪৪',
      '(017) 1122-3344',
    ]) {
      expect(normalizePhone(t)).toBe('+8801711223344');
    }
  });

  it('land lines keep their area code; nonsense is not a number', () => {
    expect(normalizePhone('02-9881234')).toBe('+88029881234');
    expect(normalizePhone('031-2852211')).toBe('+880312852211');
    expect(normalizePhone('01211223344')).toBeNull(); // no such operator prefix
    expect(normalizePhone('call me')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('e-mail and districts', () => {
  it('e-mail is compared trimmed and lower-cased', () => {
    expect(normalizeEmail('  Karim.Stores@Gmail.com ')).toBe(
      'karim.stores@gmail.com',
    );
    expect(normalizeEmail('not-an-email')).toBeNull();
  });

  it('the 64 districts, in English or Bangla, and the old spellings', () => {
    expect(DISTRICTS).toHaveLength(64);
    expect(districtOf('chittagong')).toBe('Chattogram');
    expect(districtOf('সিলেট')).toBe('Sylhet');
    expect(districtOf("cox's bazar")).toBe("Cox's Bazar");
    expect(districtOf('Bogra')).toBe('Bogura');
    expect(districtOf('Kolkata')).toBeNull();
  });
});

describe('round robin', () => {
  it('goes through everyone in turn, then starts again', () => {
    const team = ['u3', 'u1', 'u2'];
    expect(nextInTurn(team, null)).toBe('u1');
    expect(nextInTurn(team, 'u1')).toBe('u2');
    expect(nextInTurn(team, 'u3')).toBe('u1');
    expect(nextInTurn(team, 'gone')).toBe('u1'); // someone who left the team
    expect(nextInTurn([], 'u1')).toBeNull();
  });
});

describe('months for the forecast and targets (WP24)', () => {
  it('knows the end of every month, February in a leap year too', () => {
    expect(monthEnd('2026-11')).toBe('2026-11-30');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
    expect(monthEnd('2027-02')).toBe('2027-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });

  it('lists the months across a year end, and nothing when from is after to', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsBetween('2026-11', '2026-11')).toEqual(['2026-11']);
    expect(monthsBetween('2027-01', '2026-12')).toEqual([]);
  });
});

describe('weighted forecast (WP24)', () => {
  it('is Σ value × probability, rounded to the paisa once on the total', () => {
    // three opportunities whose weighted values each end in half a paisa
    const rows = [
      { value: '1000.01', probability: 50 }, // 500.005
      { value: '1000.01', probability: 50 }, // 500.005
      { value: '333.33', probability: 30 }, //  99.999
    ];
    const t = totalsOf(rows);
    expect(t.count).toBe(3);
    expect(t.value).toBe('2333.35');
    expect(t.weighted).toBe('1100.01'); // 1100.009 -> 1100.01, not 500.01 + 500.01 + 100.00
    expect(totalsOf([])).toEqual({ count: 0, value: '0.00', weighted: '0.00' });
  });
});
