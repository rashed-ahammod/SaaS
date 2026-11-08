/**
 * The payroll engine must stay a pure library (guide §12.1): no database, Nest,
 * network, file system or clock. Then the same stored input always reproduces
 * the same payslip.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE_DIR = import.meta.dirname;
const ALLOWED = [
  /^\.\/[\w-]+\.js$/,
  /^\.\.\/platform\/money\/money\.js$/,
  /^\.\.\/platform\/dates\/business-date\.js$/,
];

describe('payroll engine purity', () => {
  const files = readdirSync(ENGINE_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
  );

  for (const file of files) {
    it(`${file} imports only pure modules`, () => {
      const source = readFileSync(join(ENGINE_DIR, file), 'utf8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(
        (m) => m[1],
      );
      for (const path of imports)
        expect(
          ALLOWED.some((re) => re.test(path)),
          `${file} imports ${path}`,
        ).toBe(true);
    });

    it(`${file} does not read the clock or randomness`, () => {
      const source = readFileSync(join(ENGINE_DIR, file), 'utf8');
      expect(source).not.toMatch(
        /new Date\(\s*\)|Date\.now\(|Math\.random\(|process\.env/,
      );
    });
  }
});
