import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRulePackFile, type RulePackFile } from './rule-pack-file.js';

const PACKS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../rule-packs',
);
const SHIPPED = ['bd-labour-2026.1.json', 'bd-labour-2026.2.json'];

const base = (): RulePackFile => ({
  code: 'BD-TEST',
  version: '2026.1',
  title: 'Test pack',
  values: [
    {
      key: 'leave.casual.days_per_year',
      type: 'integer',
      value: 10,
      effectiveFrom: '2026-01-01',
      descriptionEn: 'Casual leave',
    },
  ],
});

describe('validateRulePackFile', () => {
  for (const name of SHIPPED) {
    it(`accepts the shipped Bangladesh pack ${name}`, () => {
      const file = JSON.parse(
        readFileSync(path.join(PACKS_DIR, name), 'utf8'),
      ) as RulePackFile;
      expect(validateRulePackFile(file)).toEqual([]);
    });
  }

  it('accepts a minimal valid pack', () => {
    expect(validateRulePackFile(base())).toEqual([]);
  });

  it('refuses overlapping periods for the same key', () => {
    const file = base();
    file.values.push({
      ...file.values[0],
      value: 12,
      effectiveFrom: '2026-06-01',
    });
    expect(validateRulePackFile(file)).toContain(
      'leave.casual.days_per_year: periods overlap',
    );
  });

  it('accepts consecutive periods (end date is exclusive)', () => {
    const file = base();
    file.values[0].effectiveTo = '2026-06-01';
    file.values.push({
      ...file.values[0],
      value: 12,
      effectiveFrom: '2026-06-01',
      effectiveTo: undefined,
    });
    expect(validateRulePackFile(file)).toEqual([]);
  });

  it('refuses money as a JS number and wrong types', () => {
    const file = base();
    file.values.push({
      key: 'tax.min_amount',
      type: 'money',
      value: 5000.5,
      effectiveFrom: '2026-01-01',
      descriptionEn: 'x',
    });
    file.values.push({
      key: 'leave.flag',
      type: 'boolean',
      value: 'yes',
      effectiveFrom: '2026-01-01',
      descriptionEn: 'x',
    });
    const problems = validateRulePackFile(file);
    expect(
      problems.some(
        (p) => p.includes('tax.min_amount') && p.includes('string'),
      ),
    ).toBe(true);
    expect(
      problems.some(
        (p) => p.includes('leave.flag') && p.includes('true or false'),
      ),
    ).toBe(true);
  });

  it('refuses a file that tries to mark values verified', () => {
    const file = base();
    (file.values[0] as unknown as Record<string, unknown>).status = 'verified';
    expect(validateRulePackFile(file).join()).toContain(
      'cannot mark values verified',
    );
  });
});
