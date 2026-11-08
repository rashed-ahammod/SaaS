/** Shapes of the bank reconciliation API (WP20). Money is a string; deposits +, withdrawals -. */

export type StatementFormat = "generic" | "dbbl" | "brac" | "city";

export interface BankAccount {
  id: string;
  companyId: string;
  accountId: string;
  accountCode: string;
  accountNameEn: string;
  bankName: string;
  branch: string | null;
  accountName: string;
  accountNo: string;
  statementFormat: StatementFormat;
  reconcileFrom: string;
  openingBankBalance: string;
  isActive: boolean;
  version: number;
  ledgerBalance: string;
  lastStatementDate?: string | null;
  unmatchedStatementLines?: number;
  statements?: number;
}

export interface BankStatement {
  id: string;
  source: "upload" | "n8n";
  fileName: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: string | null;
  closingBalance: string | null;
  linesImported: number;
  linesSkipped: number;
  importedAt: string;
}

export interface StatementLine {
  id: string;
  date: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  amount: string;
  balance: string | null;
  matchId: string | null;
}

export interface LedgerLine {
  id: string;
  voucherId: string;
  voucherType: string;
  voucherNumber: string;
  date: string;
  narration: string;
  reference: string | null;
  amount: string;
  matchId: string | null;
}

export interface MatchOption {
  ledgerLineIds: string[];
  score: number;
  referenceAgrees: boolean;
  lines: LedgerLine[];
}

export interface BankMatch {
  id: string;
  kind: "auto" | "manual" | "suggestion";
  note: string | null;
  matchedAt: string;
  undoneAt: string | null;
  undoReason: string | null;
  statementLineIds: string[];
  ledgerLineIds: string[];
  total: string;
}

export interface Reconciliation {
  asOf: string;
  reconcileFrom: string;
  ledgerBalance: string;
  bankBalance: string | null;
  lastStatementDate: string | null;
  statementShowsBalance: string | null;
  statementAgrees: boolean | null;
  depositsInTransit: { total: string; lines: LedgerLine[] };
  unpresentedPayments: { total: string; lines: LedgerLine[] };
  bankCreditsNotInBooks: { total: string; lines: StatementLine[] };
  bankDebitsNotInBooks: { total: string; lines: StatementLine[] };
  adjustedBankBalance: string | null;
  difference: string | null;
  reconciled: boolean;
}
