/**
 * Disbursement file formats ("bank adapters", guide §13 step 2). One adapter per
 * bank or wallet format; each is a pure function from payments to file text.
 *
 * STATUS: ILLUSTRATIVE. Every bank and wallet provider has its own bulk-upload
 * layout. Before the first live payroll, get the exact format from the pilot's
 * bank / provider, add or adjust an adapter here, and have them accept a test
 * file (guide §13 step 6).
 *
 *   beftn-csv     bank transfer through BEFTN (any bank: routing number + account)
 *   bkash-bulk    bKash disbursement (wallet number + amount)
 *   nagad-bulk    Nagad disbursement
 *   rocket-bulk   Rocket (DBBL mobile banking)
 *   upay-bulk     Upay
 *   cash-list     cash payment sheet with a signature column
 */
import type { PaymentChannel } from '../../platform/db/schema.js';
import type { AccountDetails } from '../bank-accounts/bank-accounts.service.js';

export interface FileItem {
  reference: string;
  amount: string; // "29000.00"
  employeeCode: string;
  employeeName: string;
  details: AccountDetails | null; // null for cash
}

export interface FileContext {
  companyName: string;
  period: string; // 2026-09
  payType: string; // salary, bonus:Durga Puja 2026, final_settlement
  fileDate: string; // 2026-10-02
}

export interface DisbursementAdapter {
  code: string;
  channel: PaymentChannel;
  label: string;
  build(ctx: FileContext, items: FileItem[]): string;
}

/** CSV cell: quoted when it holds a comma, quote or line break. */
function cell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Short narration shown on the employee's statement (banks cut long text). */
function narration(ctx: FileContext): string {
  const what =
    ctx.payType === 'salary'
      ? 'Salary'
      : ctx.payType === 'final_settlement'
        ? 'Final settlement'
        : ctx.payType.replace(/^bonus:/, '');
  return `${what} ${ctx.period}`.slice(0, 35);
}

const beftn: DisbursementAdapter = {
  code: 'beftn-csv',
  channel: 'bank',
  label: 'BEFTN bank transfer (CSV)',
  build: (ctx, items) =>
    csv([
      [
        'SL',
        'BENEFICIARY_NAME',
        'ACCOUNT_NUMBER',
        'ROUTING_NUMBER',
        'BANK_NAME',
        'BRANCH_NAME',
        'AMOUNT',
        'PAYMENT_REFERENCE',
        'NARRATION',
      ],
      ...items.map((it, i) => [
        i + 1,
        it.details?.accountName ?? it.employeeName,
        it.details?.accountNumber ?? '',
        it.details?.routingNumber ?? '',
        it.details?.bankName ?? '',
        it.details?.branchName ?? '',
        it.amount,
        it.reference,
        narration(ctx),
      ]),
    ]),
};

function walletAdapter(
  channel: 'bkash' | 'nagad' | 'rocket' | 'upay',
  label: string,
): DisbursementAdapter {
  return {
    code: `${channel}-bulk`,
    channel,
    label,
    build: (ctx, items) =>
      csv([
        [
          'SL',
          'WALLET_NUMBER',
          'AMOUNT',
          'BENEFICIARY_NAME',
          'REFERENCE',
          'NARRATION',
        ],
        ...items.map((it, i) => [
          i + 1,
          it.details?.walletNumber ?? '',
          it.amount,
          it.details?.accountName ?? it.employeeName,
          it.reference,
          narration(ctx),
        ]),
      ]),
  };
}

const cashList: DisbursementAdapter = {
  code: 'cash-list',
  channel: 'cash',
  label: 'Cash payment sheet (CSV)',
  build: (ctx, items) =>
    csv([
      [
        `${ctx.companyName} - ${narration(ctx)} - cash payment sheet - ${ctx.fileDate}`,
      ],
      [
        'SL',
        'EMPLOYEE_CODE',
        'EMPLOYEE_NAME',
        'AMOUNT',
        'REFERENCE',
        'RECEIVED_SIGNATURE',
      ],
      ...items.map((it, i) => [
        i + 1,
        it.employeeCode,
        it.employeeName,
        it.amount,
        it.reference,
        '',
      ]),
    ]),
};

export const ADAPTERS: DisbursementAdapter[] = [
  beftn,
  walletAdapter('bkash', 'bKash bulk disbursement (CSV)'),
  walletAdapter('nagad', 'Nagad bulk disbursement (CSV)'),
  walletAdapter('rocket', 'Rocket bulk disbursement (CSV)'),
  walletAdapter('upay', 'Upay bulk disbursement (CSV)'),
  cashList,
];

/** The adapter asked for, or the default for the channel. */
export function adapterFor(
  channel: PaymentChannel,
  code?: string,
): DisbursementAdapter | undefined {
  return ADAPTERS.find(
    (a) => a.channel === channel && (!code || a.code === code),
  );
}

/** Payment channel of a salary account: bank, the wallet provider, or cash when there is none. */
export function channelOf(
  account: { kind: 'bank' | 'wallet'; provider: string } | undefined,
): PaymentChannel {
  if (!account) return 'cash';
  return account.kind === 'bank'
    ? 'bank'
    : (account.provider as PaymentChannel);
}

// ------------------------------------------------------------------ return files

export interface ReturnLine {
  line: number;
  reference: string;
  outcome: 'returned' | 'success';
  reason: string;
}

const RETURNED = ['RETURNED', 'REJECTED', 'FAILED', 'RETURN', 'FAIL'];
const SUCCESS = ['SUCCESS', 'PAID', 'CREDITED', 'OK', 'COMPLETED'];

/**
 * A bank / wallet result file (CSV) with a header row naming the columns
 * REFERENCE, STATUS and REASON (any order, any case; extra columns ignored):
 *
 *   REFERENCE,STATUS,REASON
 *   PAY-2026-09-7F3A91C2,RETURNED,Account closed
 *   PAY-2026-09-1B22C0D4,SUCCESS,
 *
 * Returns the lines, or a list of problems (nothing is applied if there are any).
 */
export function parseReturnFile(content: string): {
  lines: ReturnLine[];
  problems: string[];
} {
  const rows = content
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map(splitCsvRow);
  const problems: string[] = [];
  if (rows.length === 0) return { lines: [], problems: ['The file is empty'] };

  const header = rows[0].map((h) => h.trim().toUpperCase());
  const col = (name: string) => header.indexOf(name);
  if (col('REFERENCE') < 0 || col('STATUS') < 0)
    return {
      lines: [],
      problems: ['The header row must name REFERENCE and STATUS columns'],
    };

  const lines: ReturnLine[] = [];
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const reference = (row[col('REFERENCE')] ?? '').trim();
    const status = (row[col('STATUS')] ?? '').trim().toUpperCase();
    const reason = col('REASON') >= 0 ? (row[col('REASON')] ?? '').trim() : '';
    if (!reference) return problems.push(`Line ${line}: no reference`);
    if (RETURNED.includes(status))
      lines.push({
        line,
        reference,
        outcome: 'returned',
        reason: reason || 'Returned by the bank',
      });
    else if (SUCCESS.includes(status))
      lines.push({ line, reference, outcome: 'success', reason });
    else problems.push(`Line ${line}: unknown status "${status}"`);
  });
  return { lines, problems };
}

/** One CSV row, honouring quoted cells. */
function splitCsvRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(current);
      current = '';
    } else current += ch;
  }
  cells.push(current);
  return cells;
}
