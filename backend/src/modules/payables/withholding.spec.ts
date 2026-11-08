/**
 * Tax-at-source acceptance cases (WP15: "withholding amounts match the rule pack
 * cases"). Every document in test/withholding-cases/*.yaml runs against the
 * rates in the shipped rule pack and must match to the paisa.
 *
 * STATUS: the cases and the rates are ILLUSTRATIVE until the tax adviser signs them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAllDocuments } from 'yaml';
import {
  computeWithholding,
  validateCategories,
  type WithholdingInput,
  type WithholdingRules,
} from './withholding.js';

const CASES_DIR = join(import.meta.dirname, '../../../test/withholding-cases');
const PACK = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../rule-packs/bd-labour-2026.3.json'),
    'utf8',
  ),
);
const value = (key: string) =>
  PACK.values.find((v: { key: string }) => v.key === key).value;
const rules: WithholdingRules = {
  categories: value('tax.tds.vendor_categories'),
  noTinSurchargePercent: value('tax.tds.no_tin_surcharge_percent'),
};

const cases = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .sort()
  .flatMap((file) =>
    parseAllDocuments(readFileSync(join(CASES_DIR, file), 'utf8')).map(
      (d) =>
        ({ file, ...d.toJSON() }) as {
          file: string;
          case: string;
          input: WithholdingInput;
          expected: Record<string, string>;
        },
    ),
  );

describe('tax at source: rule pack cases', () => {
  it('the rule pack categories are usable', () => {
    expect(validateCategories(rules.categories)).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of cases) {
    it(`${c.file}: ${c.case}`, () => {
      expect(computeWithholding(c.input, rules)).toMatchObject(c.expected);
    });
  }

  it('an unknown category is refused', () => {
    expect(() =>
      computeWithholding(
        {
          categoryCode: 'NOPE',
          base: '1',
          vat: '0',
          vendorHasTin: true,
          vendorHasBin: true,
          companyIsVdsEntity: false,
        },
        rules,
      ),
    ).toThrow(/Unknown/);
  });
});
