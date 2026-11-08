import { Money } from '../platform/money/money.js';
import { annualTax, monthlyWithholding } from './tax.js';
import type { TaxRules } from './types.js';

// ILLUSTRATIVE placeholder slabs (rule pack BD-LABOUR 2026.2, not verified)
const RULES: TaxRules = {
  exemptionDivisor: 3,
  exemptionCap: '450000',
  minimumTax: '5000',
  slabs: [
    { upTo: '375000', rate: '0' },
    { upTo: '675000', rate: '0.10' },
    { upTo: '1075000', rate: '0.15' },
    { upTo: '1575000', rate: '0.20' },
    { upTo: '3575000', rate: '0.25' },
    { upTo: null, rate: '0.30' },
  ],
};

describe('annualTax', () => {
  it('is zero below the tax-free slab after the one-third exemption', () => {
    const t = annualTax(Money.of('540000'), RULES); // 540,000 - 180,000 = 360,000
    expect(t.taxable.toDb()).toBe('360000.00');
    expect(t.tax.toDb()).toBe('0.00');
  });

  it('applies the minimum tax when a small amount is due', () => {
    const t = annualTax(Money.of('600000'), RULES); // taxable 400,000 -> 2,500 -> minimum 5,000
    expect(t.tax.toDb()).toBe('5000.00');
  });

  it('caps the exemption and walks the slabs', () => {
    const t = annualTax(Money.of('1380000'), RULES); // exemption capped 450,000 -> taxable 930,000
    expect(t.exemption.toDb()).toBe('450000.00');
    expect(t.tax.toDb()).toBe('68250.00'); // 30,000 + 15% of 255,000
  });

  it('reaches the top slab', () => {
    const t = annualTax(Money.of('5000000'), RULES); // taxable 4,550,000
    // 30,000 + 60,000 + 100,000 + 500,000 + 30% of 975,000 = 982,500
    expect(t.tax.toDb()).toBe('982500.00');
  });

  it('treats negative income as zero', () => {
    expect(annualTax(Money.of('-1000'), RULES).tax.toDb()).toBe('0.00');
  });
});

describe('monthlyWithholding', () => {
  it('spreads what is still due over the months left', () => {
    expect(
      monthlyWithholding(Money.of('48750'), Money.of('12187.50'), 9).toDb(),
    ).toBe('4062.50');
  });

  it('withholds nothing when the year is already covered', () => {
    expect(
      monthlyWithholding(Money.of('5000'), Money.of('6000'), 3).toDb(),
    ).toBe('0.00');
  });
});
