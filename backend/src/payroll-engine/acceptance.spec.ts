/**
 * Payroll acceptance cases (guide §12.6, WP6).
 *
 * Every file in test/payroll-cases/*.yaml is one (or more, separated by ---)
 * hand-calculated case. The input is merged over _defaults.yaml, run through the
 * engine, and the lines and net must match to the paisa.
 *
 * STATUS: the cases are ILLUSTRATIVE until the payroll accountant signs them.
 *
 * Shorthand used in the files:
 *   period: "2026-11"           -> the month 2026-11-01..30 in fiscal year 2026-27 (starts 1 July)
 *   salary: [{from, to, gross}] -> the default structure is filled in
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAllDocuments } from 'yaml';
import { daysInMonth } from '../platform/dates/business-date.js';
import { Money } from '../platform/money/money.js';
import {
  calculateBonus,
  calculateMonthly,
  computeArrears,
  type BonusInput,
  type MonthlyInput,
  type PayResult,
  type SalarySegment,
} from './index.js';

const CASES_DIR = join(import.meta.dirname, '../../test/payroll-cases');

type Dict = Record<string, any>;

interface Case {
  file: string;
  case: string;
  status: string;
  kind: 'monthly' | 'bonus' | 'arrears';
  input: Dict;
  expected: Dict;
}

// ------------------------------------------------------------------ loading

function loadYaml(file: string): Dict[] {
  return parseAllDocuments(readFileSync(join(CASES_DIR, file), 'utf8')).map(
    (d) => d.toJSON(),
  );
}

const defaults = loadYaml('_defaults.yaml')[0];
const cases: Case[] = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'))
  .sort()
  .flatMap((file) => loadYaml(file).map((doc) => ({ file, ...doc }) as Case));

/** Objects merge key by key; lists and plain values replace. */
function merge(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const isObject =
      value && typeof value === 'object' && !Array.isArray(value);
    out[key] =
      isObject && base[key] && typeof base[key] === 'object'
        ? merge(base[key], value)
        : value;
  }
  return out;
}

/** "2026-11" -> the calendar month and its fiscal year (July-June). */
function monthPeriod(label: string) {
  const [y, m] = label.split('-').map(Number);
  const fyStart = m >= 7 ? y : y - 1;
  return {
    label,
    from: `${label}-01`,
    to: `${label}-${String(daysInMonth(y, m)).padStart(2, '0')}`,
    fiscalYear: {
      label: `${fyStart}-${String(fyStart + 1).slice(2)}`,
      from: `${fyStart}-07-01`,
      to: `${fyStart + 1}-06-30`,
    },
  };
}

function withStructure(salary: Dict[]): SalarySegment[] {
  return salary.map(
    (s) => ({ structure: defaults.structure, ...s }) as SalarySegment,
  );
}

function monthlyInput(c: Case): MonthlyInput {
  const input = merge(defaults.input, c.input);
  return {
    ...input,
    period: monthPeriod(input.period),
    salary: withStructure(input.salary),
  } as MonthlyInput;
}

function bonusInput(c: Case): BonusInput {
  const input = merge(defaults.input, c.input);
  return {
    ...input,
    period: monthPeriod(input.period),
    salary: withStructure(input.salary),
  } as BonusInput;
}

// ------------------------------------------------------------------ checks

function linesByHead(result: PayResult): Dict {
  const out: Dict = {};
  for (const line of result.lines)
    out[line.head] = Money.of(out[line.head] ?? '0')
      .plus(line.amount)
      .toDb();
  return out;
}

function expectResult(result: PayResult, expected: Dict) {
  // every line, and no line that the case does not expect
  expect(linesByHead(result)).toEqual(expected.lines);
  expect(result.net).toBe(expected.net);
  if (expected.flags)
    expect(result.flags.map((f) => f.code)).toEqual(expected.flags);
  if (expected.employerCost)
    expect(result.employerCost).toBe(expected.employerCost);

  // totals agree with the lines exactly (payslip = bank file = journal)
  const sum = (kind: string) =>
    Money.sum(result.lines.filter((l) => l.kind === kind).map((l) => l.amount));
  expect(sum('earning').minus(sum('deduction')).toDb()).toBe(result.net);
}

// ------------------------------------------------------------------ cases

describe('payroll acceptance cases', () => {
  it('finds the case files', () => {
    expect(cases.length).toBeGreaterThanOrEqual(16);
  });

  for (const c of cases) {
    it(`${c.file}: ${c.case} [${c.status}]`, () => {
      if (c.kind === 'monthly') {
        expectResult(calculateMonthly(monthlyInput(c)), c.expected);
      }

      if (c.kind === 'bonus') {
        const result = calculateBonus(bonusInput(c));
        expect(result.eligible).toBe(c.expected.eligible);
        expectResult(result, c.expected);
      }

      if (c.kind === 'arrears') {
        const input = merge(defaults.input, c.input);
        const arrears = computeArrears({
          salary: withStructure(input.salary),
          paidMonths: input.paidMonths.map((m: Dict) => {
            const period = monthPeriod(m.period);
            return {
              period,
              employment: { from: period.from, to: period.to },
              unpaidDates: [],
              latePenaltyDays: 0,
              maternityDates: [],
              paid: m.paid,
            };
          }),
          maternityDivisor: input.rules.maternityDivisor,
          settings: input.settings,
        });
        expect(
          arrears.map((a) => ({ forPeriod: a.forPeriod, amount: a.amount })),
        ).toEqual(c.expected.arrears);
      }
    });
  }

  it('gives the same result for the same input (reproducible)', () => {
    for (const c of cases.filter((x) => x.kind === 'monthly')) {
      expect(calculateMonthly(monthlyInput(c))).toEqual(
        calculateMonthly(monthlyInput(c)),
      );
    }
  });
});
