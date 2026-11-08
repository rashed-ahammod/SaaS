/**
 * Matching statement lines to ledger lines of the same bank account. Pure: no database.
 *
 *   candidates(line, ledger)   ledger lines with the same signed amount inside the date
 *                              window, best first: a reference found on both sides
 *                              (cheque number, transfer reference, voucher number), then
 *                              the closest date
 *   autoMatch(lines, ledger)   the pairs safe to match without a person: the best candidate
 *                              is unique for the statement line AND the statement line is
 *                              the unique best for that ledger line, and either a reference
 *                              agrees or it is the only line of that amount on both sides
 *   options(line, ledger)      for a person (or the AI) to choose: single lines, and two
 *                              ledger lines that together make the amount (one bank deposit
 *                              for two receipts)
 *
 * Placeholder rules (verify with the pilot's accountant): the bank may show a
 * transaction up to 5 days before the books (recorded late) and up to 30 days after
 * (a cheque presented late).
 */
import { Money } from '../../platform/money/money.js';

export const DAYS_BEFORE = 5;
export const DAYS_AFTER = 30;

export interface BankLine {
  id: string;
  date: string;
  /** deposit +, withdrawal - */
  amount: string;
  description: string;
  reference: string | null;
}

export interface LedgerLine {
  id: string;
  date: string;
  /** debit to the bank +, credit - */
  amount: string;
  voucherNumber: string;
  narration: string;
  /** cheque number / transfer reference of the payment it comes from */
  reference: string | null;
}

export interface Candidate {
  ledgerLineId: string;
  score: number;
  referenceAgrees: boolean;
  days: number;
}

export interface AutoPair {
  statementLineId: string;
  ledgerLineId: string;
  reason: 'reference' | 'only_one';
}

export interface MatchOption {
  ledgerLineIds: string[];
  score: number;
  referenceAgrees: boolean;
}

/** Days from the books' date to the bank's date (positive: the bank is later). */
export function dayGap(ledgerDate: string, bankDate: string): number {
  return Math.round(
    (Date.parse(`${bankDate}T00:00:00Z`) -
      Date.parse(`${ledgerDate}T00:00:00Z`)) /
      86_400_000,
  );
}

export function inWindow(ledgerDate: string, bankDate: string): boolean {
  const gap = dayGap(ledgerDate, bankDate);
  return gap >= -DAYS_BEFORE && gap <= DAYS_AFTER;
}

/** Upper-case letters and digits only: "CHQ# 004-521873" -> "CHQ004521873". */
const squash = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Reference-like tokens: 4+ characters with a digit ("4521873", "PV/2026-27/00012", "FT26294A1B"). */
export function tokens(text: string | null): string[] {
  if (!text) return [];
  // years (2026) are not references
  return [
    ...new Set(
      text
        .split(/[\s,;:()]+/)
        .map(squash)
        .filter(
          (t) => t.length >= 4 && /\d/.test(t) && !/^(19|20)\d\d$/.test(t),
        ),
    ),
  ];
}

export function referenceAgrees(bank: BankLine, ledger: LedgerLine): boolean {
  const bankText = squash(`${bank.description} ${bank.reference ?? ''}`);
  const ledgerText = squash(
    `${ledger.reference ?? ''} ${ledger.voucherNumber} ${ledger.narration}`,
  );
  const fromLedger = tokens(
    `${ledger.reference ?? ''} ${ledger.voucherNumber} ${ledger.narration}`,
  );
  const fromBank = tokens(`${bank.description} ${bank.reference ?? ''}`);
  return (
    fromLedger.some((t) => bankText.includes(t)) ||
    fromBank.some((t) => ledgerText.includes(t))
  );
}

function score(bank: BankLine, ledger: LedgerLine) {
  const days = dayGap(ledger.date, bank.date);
  const agrees = referenceAgrees(bank, ledger);
  return {
    days,
    agrees,
    score: (agrees ? 100 : 0) + Math.max(0, 30 - Math.abs(days)),
  };
}

export function candidates(bank: BankLine, ledger: LedgerLine[]): Candidate[] {
  const amount = Money.of(bank.amount);
  return ledger
    .filter(
      (l) => Money.of(l.amount).equals(amount) && inWindow(l.date, bank.date),
    )
    .map((l) => {
      const s = score(bank, l);
      return {
        ledgerLineId: l.id,
        score: s.score,
        referenceAgrees: s.agrees,
        days: s.days,
      };
    })
    .sort((a, b) => b.score - a.score || Math.abs(a.days) - Math.abs(b.days));
}

export function autoMatch(lines: BankLine[], ledger: LedgerLine[]): AutoPair[] {
  const byBank = new Map(lines.map((b) => [b.id, candidates(b, ledger)]));
  // for each ledger line, the statement lines that could be it
  const byLedger = new Map<
    string,
    Array<{ statementLineId: string; score: number }>
  >();
  for (const [statementLineId, list] of byBank) {
    for (const c of list)
      byLedger.set(c.ledgerLineId, [
        ...(byLedger.get(c.ledgerLineId) ?? []),
        { statementLineId, score: c.score },
      ]);
  }
  const strictBest = <T extends { score: number }>(list: T[]) =>
    list.length && (list.length === 1 || list[0].score > list[1].score)
      ? list[0]
      : null;

  const pairs: Array<AutoPair & { score: number }> = [];
  for (const [statementLineId, list] of byBank) {
    const best = strictBest(list);
    if (!best) continue;
    const rivals = (byLedger.get(best.ledgerLineId) ?? []).sort(
      (a, b) => b.score - a.score,
    );
    const bestBank = strictBest(rivals);
    if (bestBank?.statementLineId !== statementLineId) continue;
    if (best.referenceAgrees)
      pairs.push({
        statementLineId,
        ledgerLineId: best.ledgerLineId,
        reason: 'reference',
        score: best.score,
      });
    else if (list.length === 1 && rivals.length === 1)
      pairs.push({
        statementLineId,
        ledgerLineId: best.ledgerLineId,
        reason: 'only_one',
        score: best.score,
      });
  }
  // strongest first; a line is used once
  const used = new Set<string>();
  return pairs
    .sort((a, b) => b.score - a.score)
    .filter(
      (p) =>
        !used.has(p.statementLineId) &&
        !used.has(p.ledgerLineId) &&
        (used.add(p.statementLineId), used.add(p.ledgerLineId), true),
    )
    .map(({ statementLineId, ledgerLineId, reason }) => ({
      statementLineId,
      ledgerLineId,
      reason,
    }));
}

const MAX_PAIR_SEARCH = 200;

export function options(
  bank: BankLine,
  ledger: LedgerLine[],
  limit = 5,
): MatchOption[] {
  const singles: MatchOption[] = candidates(bank, ledger).map((c) => ({
    ledgerLineIds: [c.ledgerLineId],
    score: c.score,
    referenceAgrees: c.referenceAgrees,
  }));
  // two ledger lines of the same direction that add up to the bank line
  const amount = Money.of(bank.amount);
  const abs = (m: Money) => (m.isNegative() ? m.negate() : m);
  const near = ledger
    .filter(
      (l) =>
        inWindow(l.date, bank.date) &&
        Money.of(l.amount).isNegative() === amount.isNegative() &&
        abs(Money.of(l.amount)).lessThan(abs(amount)),
    )
    .slice(0, MAX_PAIR_SEARCH);
  const pairs: MatchOption[] = [];
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      if (!Money.of(near[i].amount).plus(near[j].amount).equals(amount))
        continue;
      const a = score(bank, near[i]);
      const b = score(bank, near[j]);
      // a combination ranks below an equal single line
      pairs.push({
        ledgerLineIds: [near[i].id, near[j].id],
        score: Math.min(a.score, b.score) - 5,
        referenceAgrees: a.agrees || b.agrees,
      });
    }
  }
  return [...singles, ...pairs]
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}
