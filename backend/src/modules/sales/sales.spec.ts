import { describe, expect, it } from 'vitest';
import {
  creditCheck,
  creditLine,
  limitFor,
  priceLine,
  remindersDue,
  totalsOf,
} from './sales-rules.js';

const std = { vatPercent: '15', sdPercent: '0' };

describe('pricing a line (WP25)', () => {
  it('discount on quantity × price, then VAT on the value', () => {
    // 200 cans of rice bran oil 5 L at Tk 1,850, 4% off
    expect(
      priceLine(
        { quantity: '200', unitPrice: '1850', discountPercent: '4' },
        std,
      ),
    ).toEqual({
      gross: '370000.00',
      discount: '14800.00',
      value: '355200.00',
      sdAmount: '0.00',
      vatAmount: '53280.00',
    });
    // SD first, VAT on value + SD (Mushak 6.3)
    expect(
      priceLine(
        { quantity: '10', unitPrice: '100', discountPercent: '0' },
        { vatPercent: '15', sdPercent: '10' },
      ),
    ).toMatchObject({
      value: '1000.00',
      sdAmount: '100.00',
      vatAmount: '165.00',
    });
  });

  it('totals add up from the lines', () => {
    const a = {
      ...priceLine(
        { quantity: '3', unitPrice: '333.33', discountPercent: '2.5' },
        std,
      ),
    };
    const b = {
      ...priceLine(
        { quantity: '1', unitPrice: '1000', discountPercent: '0' },
        std,
      ),
    };
    const t = totalsOf([a, b]);
    expect(t.value).toBe('1974.99');
    expect(t.total).toBe((Number(t.value) + Number(t.vat)).toFixed(2));
    expect(t.discount).toBe('25.00');
  });
});

describe('discount limits (WP25)', () => {
  const limits = [
    { userId: null, productId: null, customerType: null, maxPercent: '3' },
    { userId: null, productId: null, customerType: 'dealer', maxPercent: '7' },
    { userId: 'rafi', productId: null, customerType: null, maxPercent: '5' },
    { userId: 'rafi', productId: 'oil5l', customerType: null, maxPercent: '8' },
  ];
  it('the most specific limit applies', () => {
    expect(
      limitFor(limits, {
        userId: 'rafi',
        productId: 'oil5l',
        customerType: 'retail',
      }),
    ).toBe('8.00');
    expect(
      limitFor(limits, {
        userId: 'rafi',
        productId: 'mustard',
        customerType: 'dealer',
      }),
    ).toBe('5.00');
    expect(
      limitFor(limits, {
        userId: 'mitu',
        productId: 'mustard',
        customerType: 'dealer',
      }),
    ).toBe('7.00');
    expect(
      limitFor(limits, {
        userId: 'mitu',
        productId: 'mustard',
        customerType: 'retail',
      }),
    ).toBe('3.00');
    expect(
      limitFor([], { userId: 'mitu', productId: 'x', customerType: 'retail' }),
    ).toBe('5.00'); // the placeholder default
  });
});

describe('credit check (WP26)', () => {
  it('owed + open orders + this order against the limit', () => {
    expect(
      creditCheck({
        creditLimit: '500000',
        openInvoices: '300000',
        openOrders: '0',
        order: '150000',
      }),
    ).toMatchObject({ over: false, exposure: '450000.00', overBy: '0.00' });
    expect(
      creditCheck({
        creditLimit: '500000',
        openInvoices: '300000',
        openOrders: '100000',
        order: '150000',
      }),
    ).toMatchObject({ over: true, overBy: '50000.00' });
  });
});

describe('collection reminders (WP27)', () => {
  it('a stage goes once; a late run sends only the latest stage reached', () => {
    expect(remindersDue(0, [])).toEqual({
      record: [],
      send: null,
      escalate: false,
    });
    expect(remindersDue(1, [])).toEqual({
      record: [1],
      send: 1,
      escalate: false,
    });
    expect(remindersDue(3, [1])).toEqual({
      record: [],
      send: null,
      escalate: false,
    });
    expect(remindersDue(16, [1])).toEqual({
      record: [7, 15],
      send: 15,
      escalate: true,
    });
    expect(remindersDue(45, [1, 7, 15, 30])).toEqual({
      record: [],
      send: null,
      escalate: false,
    });
  });
});

describe('credit notes (WP26)', () => {
  it('part of a line is its share; all of it is exactly the line', () => {
    const line = {
      quantity: '3',
      value: '1000.00',
      sd_amount: '0.00',
      vat_amount: '150.00',
    };
    expect(creditLine(line, '1')).toEqual({
      value: '333.33',
      sdAmount: '0.00',
      vatAmount: '50.00',
    });
    expect(creditLine(line, '3')).toEqual({
      value: '1000.00',
      sdAmount: '0.00',
      vatAmount: '150.00',
    });
  });
});
