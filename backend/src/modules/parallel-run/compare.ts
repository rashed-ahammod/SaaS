/**
 * Comparing the old system's payroll register with the ERP's run (Gate 1). Pure
 * functions: no database.
 *
 * The register is one row per employee: employee_code, gross, net (required) and
 * total_deductions, tax, pf_employee (optional). Only the figures present in the
 * file are compared. Amounts may carry thousands separators (45,250.00 or the
 * lakh style 1,25,000), a "Tk" / "৳" sign, or Bangla digits.
 */
import { Money } from '../../platform/money/money.js';
import type { ParallelOutcome } from '../../platform/db/schema.js';

export const FIGURES = [
  'gross',
  'total_deductions',
  'net',
  'tax',
  'pf_employee',
] as const;
export type Figure = (typeof FIGURES)[number];
export type Figures = Partial<Record<Figure, string>>;

export const REQUIRED_COLUMNS = ['employee_code', 'gross', 'net'];

export interface RegisterRow {
  rowNo: number;
  employeeCode: string;
  figures: Figures;
}

/** "Tk 1,25,000.50" / "৳১,২৫,০০০" -> "125000.50"; null when not an amount. */
export function parseAmount(text: string): string | null {
  const plain = text
    .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    .replace(/tk\.?|bdt|৳|টাকা/gi, '')
    .replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(plain)) return null;
  return Money.of(plain).toDb();
}

export function parseRegister(
  headers: string[],
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
) {
  const problems: string[] = [];
  for (const col of REQUIRED_COLUMNS)
    if (!headers.includes(col)) problems.push(`Missing column "${col}"`);
  const figures = FIGURES.filter((f) => headers.includes(f));
  const out: RegisterRow[] = [];
  const seen = new Map<string, number>();
  for (const { rowNo, cells } of rows) {
    const code = (cells.employee_code ?? '').trim();
    if (!code) {
      problems.push(`Row ${rowNo}: employee_code is empty`);
      continue;
    }
    if (seen.has(code))
      problems.push(
        `Row ${rowNo}: employee ${code} also in row ${seen.get(code)}`,
      );
    seen.set(code, rowNo);
    const values: Figures = {};
    for (const f of figures) {
      const raw = (cells[f] ?? '').trim();
      if (!raw) continue;
      const amount = parseAmount(raw);
      if (amount === null)
        problems.push(`Row ${rowNo}: ${f} "${raw}" is not an amount`);
      else values[f] = amount;
    }
    out.push({ rowNo, employeeCode: code, figures: values });
  }
  return { rows: out, figures, problems };
}

export interface ErpEmployee {
  employeeId: string;
  employeeCode: string;
  figures: Required<Figures>;
}

export interface ComparedLine {
  employeeCode: string;
  employeeId: string | null;
  outcome: ParallelOutcome;
  legacy: Figures | null;
  erp: Figures | null;
  /** figure -> ERP minus legacy, only where it is beyond the tolerance */
  differences: Figures;
}

export function compareRegister(
  register: RegisterRow[],
  figures: Figure[],
  erp: ErpEmployee[],
  tolerance: string,
) {
  const byCode = new Map(erp.map((e) => [e.employeeCode, e]));
  const lines: ComparedLine[] = [];

  for (const row of register) {
    const mine = byCode.get(row.employeeCode);
    if (!mine) {
      lines.push({
        employeeCode: row.employeeCode,
        employeeId: null,
        outcome: 'missing_in_erp',
        legacy: row.figures,
        erp: null,
        differences: {},
      });
      continue;
    }
    byCode.delete(row.employeeCode);
    const erpFigures = Object.fromEntries(
      figures.map((f) => [f, mine.figures[f]]),
    ) as Figures;
    const differences: Figures = {};
    for (const f of figures) {
      const legacy = row.figures[f] ?? '0.00';
      const diff = Money.of(mine.figures[f]).minus(legacy);
      const beyond = diff.isNegative()
        ? diff.negate().greaterThan(tolerance)
        : diff.greaterThan(tolerance);
      if (beyond) differences[f] = diff.toDb();
    }
    lines.push({
      employeeCode: row.employeeCode,
      employeeId: mine.employeeId,
      outcome: Object.keys(differences).length ? 'different' : 'match',
      legacy: row.figures,
      erp: erpFigures,
      differences,
    });
  }
  // in the ERP run but not in the old register
  for (const e of byCode.values()) {
    lines.push({
      employeeCode: e.employeeCode,
      employeeId: e.employeeId,
      outcome: 'missing_in_legacy',
      legacy: null,
      erp: Object.fromEntries(figures.map((f) => [f, e.figures[f]])),
      differences: {},
    });
  }
  lines.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

  const total = (side: 'legacy' | 'erp') =>
    Object.fromEntries(
      figures.map((f) => [
        f,
        Money.sum(lines.map((l) => l[side]?.[f] ?? '0.00')).toDb(),
      ]),
    );
  const count = (o: ParallelOutcome) =>
    lines.filter((l) => l.outcome === o).length;
  return {
    lines,
    summary: {
      employees: lines.length,
      matched: count('match'),
      different: count('different'),
      missingInErp: count('missing_in_erp'),
      missingInLegacy: count('missing_in_legacy'),
      totals: { legacy: total('legacy'), erp: total('erp') },
    },
  };
}
