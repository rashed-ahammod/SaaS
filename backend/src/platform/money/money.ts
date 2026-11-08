/**
 * Money (guide §5 rule 1: money is never a floating-point number).
 *
 * - Backed by decimal.js, so 0.1 + 0.2 is exactly 0.3.
 * - Immutable: every operation returns a new Money.
 * - Arithmetic keeps full precision. Rounding happens only when you call
 *   round(rule), at the points the payroll and accounting rules define.
 * - Stored in PostgreSQL as NUMERIC(18,2); read it with Money.of(row.amount)
 *   and write it with money.toDb().
 *
 *   const basic = Money.of('50000').times('0.60');          // 30000
 *   const perDay = basic.dividedBy(26).round(TAKA_ROUNDING); // 1154 (to the taka)
 */
import { Decimal } from 'decimal.js';

// A private Decimal copy so settings here never affect other code using decimal.js.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof D>;

/** Accepted inputs. Plain JS numbers are accepted only if they are whole numbers. */
export type MoneyInput = string | bigint | number | Money;

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'UP' | 'DOWN';

/**
 * A company's rounding rule (company setting).
 * increment '0.01' = to the paisa, '1' = to the taka, '5' / '10' = to 5 or 10 taka.
 */
export interface RoundingRule {
  mode: RoundingMode;
  increment: '0.01' | '1' | '5' | '10';
}

export const PAISA_ROUNDING: RoundingRule = {
  mode: 'HALF_UP',
  increment: '0.01',
};
export const TAKA_ROUNDING: RoundingRule = { mode: 'HALF_UP', increment: '1' };

const MODES: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  UP: Decimal.ROUND_UP, // away from zero
  DOWN: Decimal.ROUND_DOWN, // towards zero
};

/** Largest value NUMERIC(18,2) can hold. */
const MAX_DB_VALUE = new D('9999999999999999.99');

export class Money {
  private constructor(private readonly value: Dec) {}

  static of(input: MoneyInput): Money {
    if (input instanceof Money) return input;
    if (typeof input === 'number' && !Number.isInteger(input)) {
      throw new TypeError(
        `Money.of(${input}): pass decimal amounts as strings, e.g. Money.of('${input}')`,
      );
    }
    if (typeof input === 'string' && !/^-?\d+(\.\d+)?$/.test(input.trim())) {
      throw new TypeError(`Money.of('${input}'): not a valid amount`);
    }
    return new Money(
      new D(typeof input === 'bigint' ? input.toString() : input),
    );
  }

  static zero(): Money {
    return new Money(new D(0));
  }

  /** Sum of a list of amounts (zero for an empty list). */
  static sum(items: Iterable<MoneyInput>): Money {
    let total = new D(0);
    for (const item of items) total = total.plus(Money.of(item).value);
    return new Money(total);
  }

  plus(other: MoneyInput): Money {
    return new Money(this.value.plus(Money.of(other).value));
  }

  minus(other: MoneyInput): Money {
    return new Money(this.value.minus(Money.of(other).value));
  }

  /** Multiply by a factor such as a percentage ('0.60') or a number of days. */
  times(factor: string | number): Money {
    return new Money(this.value.times(toFactor(factor)));
  }

  /** Divide by a factor, e.g. monthly wage ÷ 26 for a daily rate. Not rounded. */
  dividedBy(divisor: string | number): Money {
    const d = toFactor(divisor);
    if (d.isZero()) throw new RangeError('Money: division by zero');
    return new Money(this.value.dividedBy(d));
  }

  negate(): Money {
    return new Money(this.value.negated());
  }

  /** Round with a company rounding rule. This is the only way precision is reduced. */
  round(rule: RoundingRule = PAISA_ROUNDING): Money {
    const inc = new D(rule.increment);
    const steps = this.value
      .dividedBy(inc)
      .toDecimalPlaces(0, MODES[rule.mode]);
    return new Money(steps.times(inc));
  }

  /**
   * Split this amount by ratios so the parts always add up exactly to the whole
   * (e.g. a salary journal split across cost centres). Leftover paisa go to the
   * first parts.
   */
  allocate(ratios: Array<string | number>): Money[] {
    if (ratios.length === 0) throw new RangeError('Money.allocate: no ratios');
    const r = ratios.map(toFactor);
    const totalRatio = r.reduce((a, b) => a.plus(b), new D(0));
    if (totalRatio.isZero())
      throw new RangeError('Money.allocate: ratios add up to zero');

    const totalPaisa = this.value
      .times(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const parts = r.map((x) =>
      totalPaisa
        .times(x)
        .dividedBy(totalRatio)
        .toDecimalPlaces(0, Decimal.ROUND_DOWN),
    );
    let remainder = totalPaisa.minus(
      parts.reduce((a, b) => a.plus(b), new D(0)),
    );
    const step = remainder.isNegative() ? -1 : 1;
    for (let i = 0; !remainder.isZero(); i = (i + 1) % parts.length) {
      parts[i] = parts[i].plus(step);
      remainder = remainder.minus(step);
    }
    return parts.map((p) => new Money(p.dividedBy(100)));
  }

  isZero(): boolean {
    return this.value.isZero();
  }
  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }
  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }
  equals(other: MoneyInput): boolean {
    return this.value.equals(Money.of(other).value);
  }
  compare(other: MoneyInput): -1 | 0 | 1 {
    return this.value.comparedTo(Money.of(other).value) as -1 | 0 | 1;
  }
  greaterThan(other: MoneyInput): boolean {
    return this.compare(other) > 0;
  }
  lessThan(other: MoneyInput): boolean {
    return this.compare(other) < 0;
  }

  /**
   * Value for a NUMERIC(18,2) column, e.g. "1234.50".
   * Throws if the amount still has more than 2 decimals: round it first, on purpose.
   */
  toDb(): string {
    if (this.value.decimalPlaces() > 2) {
      throw new Error(
        `Money ${this.value.toString()} has more than 2 decimals; call round(rule) before saving`,
      );
    }
    if (this.value.abs().greaterThan(MAX_DB_VALUE))
      throw new RangeError('Money: amount exceeds NUMERIC(18,2)');
    return this.value.toFixed(2);
  }

  /** Plain string with exactly 2 decimals, e.g. "1234.50" (rounds half-up for display only). */
  toString(): string {
    return this.value.toFixed(2, Decimal.ROUND_HALF_UP);
  }

  /** JSON form is the 2-decimal string, never a number. */
  toJSON(): string {
    return this.toString();
  }

  /** Full-precision string, for explanation traces. */
  toPreciseString(): string {
    return this.value.toString();
  }
}

function toFactor(x: string | number): Dec {
  if (typeof x === 'string' && !/^-?\d+(\.\d+)?$/.test(x.trim())) {
    throw new TypeError(`Not a valid number: '${x}'`);
  }
  return new D(x);
}
