/**
 * Bank statement files (CSV) -> statement lines. Pure: no database.
 *
 *   parseStatement(format, text)   finds the header row (banks put the account details
 *                                  above it), reads each transaction, checks the running
 *                                  balance, and gives each line a key so the same
 *                                  transaction in an overlapping file is recognised
 *
 * The bank layouts below are ILLUSTRATIVE (like the salary bank files of WP7): the
 * column names and date styles must be checked against real statements of the
 * pilot's banks (docs/phase-2-plan.md "The first banks' statement formats").
 *
 *   generic   Date, Description, Reference, Withdrawal, Deposit, Balance     2026-10-05 or 05/10/2026
 *   dbbl      Txn Date, Value Date, Particulars, Cheque No, Debit, Credit, Balance      05/10/2026
 *   brac      Transaction Date, Description, Ref No, Withdrawal (BDT), Deposit (BDT), Balance (BDT)   05-Oct-2026
 *   city      Date, Narration, Chq/Ref No, Debit, Credit, Balance ("1,25,000.00 Cr")   05-10-2026
 *
 * Amounts may carry thousands separators (lakh style too), "BDT"/"Tk", or brackets for
 * a negative balance. A withdrawal comes out negative, a deposit positive.
 */
import { createHash } from 'node:crypto';
import { Money } from '../../platform/money/money.js';
import type { StatementFormat } from '../../platform/db/schema.js';

export const STATEMENT_FORMATS: StatementFormat[] = [
  'generic',
  'dbbl',
  'brac',
  'city',
];

interface Layout {
  date: string[];
  valueDate?: string[];
  description: string[];
  reference?: string[];
  withdrawal: string[];
  deposit: string[];
  balance?: string[];
}

const LAYOUTS: Record<StatementFormat, Layout> = {
  generic: {
    date: ['date'],
    description: ['description'],
    reference: ['reference'],
    withdrawal: ['withdrawal'],
    deposit: ['deposit'],
    balance: ['balance'],
  },
  dbbl: {
    date: ['txn date'],
    valueDate: ['value date'],
    description: ['particulars'],
    reference: ['cheque no'],
    withdrawal: ['debit'],
    deposit: ['credit'],
    balance: ['balance'],
  },
  brac: {
    date: ['transaction date'],
    description: ['description'],
    reference: ['ref no'],
    withdrawal: ['withdrawal (bdt)', 'withdrawal'],
    deposit: ['deposit (bdt)', 'deposit'],
    balance: ['balance (bdt)', 'balance'],
  },
  city: {
    date: ['date'],
    description: ['narration'],
    reference: ['chq/ref no'],
    withdrawal: ['debit'],
    deposit: ['credit'],
    balance: ['balance'],
  },
};

export interface ParsedLine {
  lineNo: number;
  txnDate: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  /** deposit +, withdrawal - */
  amount: string;
  balance: string | null;
  key: string;
}

export interface ParsedStatement {
  lines: ParsedLine[];
  periodFrom: string | null;
  periodTo: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  /** anything wrong: the file is refused as a whole */
  problems: string[];
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

export function parseStatement(
  format: StatementFormat,
  text: string,
): ParsedStatement {
  const layout = LAYOUTS[format];
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const problems: string[] = [];
  const empty = (): ParsedStatement => ({
    lines: [],
    periodFrom: null,
    periodTo: null,
    openingBalance: null,
    closingBalance: null,
    problems,
  });

  // the header row: the first one that has every column the layout needs
  const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
  const find = (header: string[], names?: string[]) =>
    names ? header.findIndex((h) => names.includes(norm(h))) : -1;
  const headerAt = rows.findIndex((r) =>
    [layout.date, layout.description, layout.withdrawal, layout.deposit].every(
      (names) => find(r, names) >= 0,
    ),
  );
  if (headerAt < 0) {
    problems.push(
      `No header row of the ${format} layout (expected columns: ${[layout.date[0], layout.description[0], layout.withdrawal[0], layout.deposit[0]].join(', ')})`,
    );
    return empty();
  }
  const header = rows[headerAt];
  const col = {
    date: find(header, layout.date),
    valueDate: find(header, layout.valueDate),
    description: find(header, layout.description),
    reference: find(header, layout.reference),
    withdrawal: find(header, layout.withdrawal),
    deposit: find(header, layout.deposit),
    balance: find(header, layout.balance),
  };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

  const lines: ParsedLine[] = [];
  const seen = new Map<string, number>();
  let previousBalance: Money | null = null;
  let opening: Money | null = null;
  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    const dateText = cell(r, col.date);
    // blank rows and trailers ("Total", "Closing balance") have no date
    if (!dateText || !/\d/.test(dateText)) continue;
    const txnDate = toIsoDate(dateText);
    if (!txnDate) {
      problems.push(`Row ${rowNo}: "${dateText}" is not a date`);
      continue;
    }
    const valueText = cell(r, col.valueDate);
    const valueDate = valueText ? toIsoDate(valueText) : null;
    const withdrawal = toAmount(cell(r, col.withdrawal));
    const deposit = toAmount(cell(r, col.deposit));
    if (withdrawal === undefined || deposit === undefined) {
      problems.push(`Row ${rowNo}: the amount is not a number`);
      continue;
    }
    const w = withdrawal ?? Money.zero();
    const d = deposit ?? Money.zero();
    if (w.isZero() === d.isZero()) {
      problems.push(`Row ${rowNo}: give either a withdrawal or a deposit`);
      continue;
    }
    if (w.isNegative() || d.isNegative()) {
      problems.push(`Row ${rowNo}: a withdrawal or deposit cannot be negative`);
      continue;
    }
    const amount = d.minus(w);
    const balanceText = cell(r, col.balance);
    const balance = balanceText ? toAmount(balanceText) : null;
    if (balance === undefined) {
      problems.push(`Row ${rowNo}: the balance is not a number`);
      continue;
    }
    // the running balance must add up, line by line
    if (balance) {
      if (previousBalance === null) opening = balance.minus(amount);
      else if (!previousBalance.plus(amount).equals(balance)) {
        problems.push(
          `Row ${rowNo}: balance ${balance.toDb()} does not follow from ${previousBalance.toDb()} and ${amount.toDb()}`,
        );
      }
      previousBalance = balance;
    }
    const description = cell(r, col.description).replace(/\s+/g, ' ');
    const reference = cell(r, col.reference) || null;
    // without a balance, two identical transactions on a day are told apart by their order
    const base = [
      txnDate,
      amount.toDb(),
      balance?.toDb() ?? '',
      description.toLowerCase(),
      (reference ?? '').toLowerCase(),
    ].join('|');
    const occurrence = balance ? 0 : (seen.get(base) ?? 0);
    seen.set(base, occurrence + 1);
    const key = createHash('sha256')
      .update(`${base}|${occurrence}`)
      .digest('hex');
    lines.push({
      lineNo: lines.length + 1,
      txnDate,
      valueDate,
      description,
      reference,
      amount: amount.toDb(),
      balance: balance?.toDb() ?? null,
      key,
    });
  }
  if (!lines.length && !problems.length)
    problems.push('The file has no transactions');
  const dates = lines.map((l) => l.txnDate).sort();
  return {
    lines,
    periodFrom: dates[0] ?? null,
    periodTo: dates.at(-1) ?? null,
    openingBalance: opening?.toDb() ?? null,
    closingBalance: previousBalance?.toDb() ?? null,
    problems,
  };
}

/** RFC 4180 CSV: quoted fields with commas, quotes ("") and line breaks inside. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 2026-10-05, 05/10/2026, 05-10-2026, 05.10.2026, 05-Oct-2026, 05 Oct 2026 (day first, as in Bangladesh). */
export function toIsoDate(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)))
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (
    (match = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/.exec(t))
  ) {
    const month = MONTHS.indexOf(match[2].toLowerCase());
    if (month < 0) return null;
    [d, m, y] = [
      Number(match[1]),
      month + 1,
      Number(match[3].length === 2 ? `20${match[3]}` : match[3]),
    ];
  } else return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) &&
    check.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

/** null = empty cell; undefined = not a number. "1,25,000.50", "Tk 500", "(2,000.00)", "1,250.00 Dr". */
export function toAmount(text: string): Money | null | undefined {
  let t = text.trim();
  if (!t || t === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  const side = /\s*(dr|cr)\.?$/i.exec(t);
  if (side) {
    negative = negative || side[1].toLowerCase() === 'dr';
    t = t.slice(0, side.index);
  }
  t = t
    .replace(/^(bdt|tk\.?|৳)\s*/i, '')
    .replace(/,/g, '')
    .trim();
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const value = Money.of(t);
  return negative ? value.negate() : value;
}
