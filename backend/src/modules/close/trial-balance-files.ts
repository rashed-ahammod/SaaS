/**
 * Trial balance files from the old system (CSV). Pure: no database.
 *
 *   parseOpening(text)     the opening trial balance at cut-over, one row per balance:
 *                            account_code   our account (the chart) the balance goes to
 *                            old_code, old_name   the old system's account (kept as the map)
 *                            debit, credit  one of them
 *                            party          vendor code (payables), employee code
 *                                           (employee advances) or customer name (receivables)
 *                            reference, date, due_date   the open item: bill / invoice no.
 *                            department_code             cost centre (optional)
 *   parseOldTrialBalance(text)   a later trial balance of the old system: old_code,
 *                          old_name, debit, credit
 *   compare(old, ours, map)      per our account: the old system's balance (through the
 *                          map) against ours; old codes without a mapping
 */
import { Money } from '../../platform/money/money.js';
import { parseCsv, toAmount, toIsoDate } from '../bank/statement-formats.js';

export interface OpeningRow {
  rowNo: number;
  accountCode: string;
  oldCode: string | null;
  oldName: string | null;
  debit: string;
  credit: string;
  party: string | null;
  reference: string | null;
  date: string | null;
  dueDate: string | null;
  departmentCode: string | null;
}

export interface OldRow {
  rowNo: number;
  oldCode: string;
  oldName: string | null;
  /** debit - credit */
  balance: string;
}

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

function table(text: string, required: string[]) {
  const rows = parseCsv(text.replace(/^﻿/, '')).filter((r) =>
    r.some((c) => c.trim() !== ''),
  );
  const headerAt = rows.findIndex((r) =>
    required.every((h) => r.map(norm).includes(h)),
  );
  if (headerAt < 0)
    return {
      problems: [`No header row with the columns ${required.join(', ')}`],
      header: [] as string[],
      body: [] as Array<{ rowNo: number; cells: string[] }>,
    };
  const header = rows[headerAt].map(norm);
  return {
    problems: [] as string[],
    header,
    body: rows
      .slice(headerAt + 1)
      .map((cells, i) => ({ rowNo: headerAt + i + 2, cells })),
  };
}

function amounts(
  rowNo: number,
  debitText: string,
  creditText: string,
  problems: string[],
) {
  const debit = toAmount(debitText);
  const credit = toAmount(creditText);
  if (debit === undefined || credit === undefined) {
    problems.push(`Row ${rowNo}: the amount is not a number`);
    return null;
  }
  const d = debit ?? Money.zero();
  const c = credit ?? Money.zero();
  if (d.isNegative() || c.isNegative()) {
    problems.push(`Row ${rowNo}: debit and credit cannot be negative`);
    return null;
  }
  return { d, c };
}

export function parseOpening(text: string): {
  rows: OpeningRow[];
  totalDebit: string;
  totalCredit: string;
  problems: string[];
} {
  const { problems, header, body } = table(text, [
    'account_code',
    'debit',
    'credit',
  ]);
  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const rows: OpeningRow[] = [];
  for (const { rowNo, cells } of body) {
    const accountCode = col(cells, 'account_code');
    if (!accountCode || /^total/i.test(accountCode)) continue;
    const a = amounts(
      rowNo,
      col(cells, 'debit'),
      col(cells, 'credit'),
      problems,
    );
    if (!a) continue;
    if (a.d.isZero() && a.c.isZero()) continue; // a zero balance carries nothing
    if (a.d.isPositive() && a.c.isPositive()) {
      problems.push(`Row ${rowNo}: give either a debit or a credit`);
      continue;
    }
    const date = col(cells, 'date');
    const due = col(cells, 'due_date');
    const isoDate = date ? toIsoDate(date) : null;
    const isoDue = due ? toIsoDate(due) : null;
    if ((date && !isoDate) || (due && !isoDue)) {
      problems.push(`Row ${rowNo}: the date is not a date`);
      continue;
    }
    rows.push({
      rowNo,
      accountCode,
      oldCode: col(cells, 'old_code') || null,
      oldName: col(cells, 'old_name') || null,
      debit: a.d.toDb(),
      credit: a.c.toDb(),
      party: col(cells, 'party') || null,
      reference: col(cells, 'reference') || null,
      date: isoDate,
      dueDate: isoDue,
      departmentCode: col(cells, 'department_code') || null,
    });
  }
  const totalDebit = Money.sum(rows.map((r) => r.debit));
  const totalCredit = Money.sum(rows.map((r) => r.credit));
  if (!problems.length && !rows.length)
    problems.push('The file has no balances');
  if (!totalDebit.equals(totalCredit))
    problems.push(
      `The trial balance does not balance: debits ${totalDebit.toDb()}, credits ${totalCredit.toDb()}`,
    );
  // one old account goes to one of ours
  const target = new Map<string, string>();
  for (const r of rows.filter((x) => x.oldCode)) {
    const had = target.get(r.oldCode!);
    if (had && had !== r.accountCode)
      problems.push(
        `Row ${r.rowNo}: old account ${r.oldCode} is mapped to both ${had} and ${r.accountCode}`,
      );
    target.set(r.oldCode!, r.accountCode);
  }
  return {
    rows,
    totalDebit: totalDebit.toDb(),
    totalCredit: totalCredit.toDb(),
    problems,
  };
}

export function parseOldTrialBalance(text: string): {
  rows: OldRow[];
  problems: string[];
} {
  const { problems, header, body } = table(text, [
    'old_code',
    'debit',
    'credit',
  ]);
  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const byCode = new Map<string, OldRow>();
  for (const { rowNo, cells } of body) {
    const oldCode = col(cells, 'old_code');
    if (!oldCode || /^total/i.test(oldCode)) continue;
    const a = amounts(
      rowNo,
      col(cells, 'debit'),
      col(cells, 'credit'),
      problems,
    );
    if (!a) continue;
    const prev = byCode.get(oldCode);
    const balance = a.d.minus(a.c).plus(prev?.balance ?? '0');
    byCode.set(oldCode, {
      rowNo,
      oldCode,
      oldName: col(cells, 'old_name') || prev?.oldName || null,
      balance: balance.toDb(),
    });
  }
  const rows = [...byCode.values()];
  const total = Money.sum(rows.map((r) => r.balance));
  if (!total.isZero())
    problems.push(
      `The old trial balance does not balance (debits - credits = ${total.toDb()})`,
    );
  return { rows, problems };
}

export interface ComparisonLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  oldCodes: string[];
  oldBalance: string;
  ourBalance: string;
  difference: string;
}

/** Old balances through the map against ours (debit - credit, as of the same date). */
export function compare(
  old: OldRow[],
  map: Map<string, string>,
  ours: Array<{
    accountId: string;
    code: string;
    name: string;
    balance: string;
  }>,
) {
  const byAccount = new Map<string, { oldCodes: string[]; balance: Money }>();
  const unmapped: OldRow[] = [];
  for (const r of old) {
    const accountId = map.get(r.oldCode);
    if (!accountId) {
      if (!Money.of(r.balance).isZero()) unmapped.push(r);
      continue;
    }
    const e = byAccount.get(accountId) ?? {
      oldCodes: [],
      balance: Money.zero(),
    };
    e.oldCodes.push(r.oldCode);
    e.balance = e.balance.plus(r.balance);
    byAccount.set(accountId, e);
  }
  const lines: ComparisonLine[] = [];
  for (const a of ours) {
    const o = byAccount.get(a.accountId);
    const oldBalance = o?.balance ?? Money.zero();
    if (!o && Money.of(a.balance).isZero()) continue;
    lines.push({
      accountId: a.accountId,
      accountCode: a.code,
      accountName: a.name,
      oldCodes: o?.oldCodes ?? [],
      oldBalance: oldBalance.toDb(),
      ourBalance: Money.of(a.balance).toDb(),
      difference: Money.of(a.balance).minus(oldBalance).toDb(),
    });
  }
  const differences = lines.filter(
    (l) => !Money.of(l.difference).isZero(),
  ).length;
  return {
    lines,
    unmapped,
    differences,
    matched: differences === 0 && unmapped.length === 0,
  };
}
