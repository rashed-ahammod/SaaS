/**
 * Salary journal for an approved run, per cost centre (guide §12.5: "In Phase 1,
 * before the accounts module, produce a salary journal export (CSV) per cost
 * centre"). Phase 2 posts the same entries automatically.
 *
 *   Dr  Salary expense - <earning head>        earnings (UNPAID_DAYS reduces it)
 *   Dr  <employer cost> expense                PF employer share, gratuity provision
 *     Cr  Income tax payable (TDS)             TAX
 *     Cr  Provident fund payable               PF employee + employer share
 *     Cr  Staff salary advance                 LOAN_RECOVERY
 *     Cr  <deduction> payable / income         other deductions
 *     Cr  Salaries payable                     net pay
 *
 * Debits always equal credits: earnings = deductions + net, and each employer
 * cost is booked on both sides. The total row proves it.
 */
import { Money } from '../../platform/money/money.js';

export interface JournalLineInput {
  employeeId: string;
  headCode: string;
  kind: 'earning' | 'deduction' | 'employer_cost';
  amount: string;
}

export interface JournalRow {
  costCentre: string;
  account: string;
  debit: string;
  credit: string;
}

/** Credit accounts of the statutory / system deductions and employer costs (illustrative chart of accounts). */
const CREDIT_ACCOUNT: Record<string, string> = {
  TAX: 'Income tax payable (TDS on salary)',
  PF_EMPLOYEE: 'Provident fund payable',
  PF_EMPLOYER: 'Provident fund payable',
  LOAN_RECOVERY: 'Staff salary advance',
  NOTICE_SHORTFALL: 'Notice pay recovered (other income)',
  GRATUITY_PROVISION: 'Gratuity payable (provision)',
};

/**
 * @param costCentreOf  employee -> cost centre label (e.g. "CC-210 Sales Dhaka")
 * @param headName      head code -> readable name
 */
export function buildSalaryJournal(
  lines: JournalLineInput[],
  netByEmployee: Map<string, string>,
  costCentreOf: (employeeId: string) => string,
  headName: (code: string) => string,
): JournalRow[] {
  // signed amounts: + debit, - credit
  const book = new Map<string, Money>();
  const post = (cc: string, account: string, amount: Money) => {
    const key = `${cc}\u0000${account}`;
    book.set(key, (book.get(key) ?? Money.zero()).plus(amount));
  };

  for (const l of lines) {
    const cc = costCentreOf(l.employeeId);
    const amount = Money.of(l.amount);
    if (l.kind === 'earning')
      post(cc, `Salary expense - ${headName(l.headCode)}`, amount);
    if (l.kind === 'deduction')
      post(
        cc,
        CREDIT_ACCOUNT[l.headCode] ?? `${headName(l.headCode)} payable`,
        amount.negate(),
      );
    if (l.kind === 'employer_cost') {
      post(cc, `${headName(l.headCode)} expense`, amount);
      post(
        cc,
        CREDIT_ACCOUNT[l.headCode] ?? `${headName(l.headCode)} payable`,
        amount.negate(),
      );
    }
  }
  for (const [employeeId, net] of netByEmployee)
    post(costCentreOf(employeeId), 'Salaries payable', Money.of(net).negate());

  const rows = [...book.entries()]
    .filter(([, amount]) => !amount.isZero())
    .map(([key, amount]) => {
      const [costCentre, account] = key.split('\u0000');
      return {
        costCentre,
        account,
        debit: amount.isPositive() ? amount.toDb() : '0.00',
        credit: amount.isNegative() ? amount.negate().toDb() : '0.00',
      };
    })
    .sort(
      (a, b) =>
        a.costCentre.localeCompare(b.costCentre) ||
        Number(b.debit !== '0.00') - Number(a.debit !== '0.00') ||
        a.account.localeCompare(b.account),
    );
  return rows;
}

export function journalTotals(rows: JournalRow[]): {
  debit: string;
  credit: string;
} {
  return {
    debit: Money.sum(rows.map((r) => r.debit)).toDb(),
    credit: Money.sum(rows.map((r) => r.credit)).toDb(),
  };
}

/** CSV text with a header and a TOTAL row. */
export function journalCsv(
  meta: { company: string; period: string; runType: string; runId: string },
  rows: JournalRow[],
): string {
  const cell = (v: string) =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const totals = journalTotals(rows);
  const out = [
    [
      'COMPANY',
      'PERIOD',
      'RUN_TYPE',
      'RUN_ID',
      'COST_CENTRE',
      'ACCOUNT',
      'DEBIT',
      'CREDIT',
    ],
    ...rows.map((r) => [
      meta.company,
      meta.period,
      meta.runType,
      meta.runId,
      r.costCentre,
      r.account,
      r.debit,
      r.credit,
    ]),
    [
      meta.company,
      meta.period,
      meta.runType,
      meta.runId,
      'TOTAL',
      '',
      totals.debit,
      totals.credit,
    ],
  ];
  return out.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
