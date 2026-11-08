/**
 * The compliance calendar's rules: which filings and deposits fall due when. Pure.
 *
 *   dueItems(today)   the items of the months around today (3 back, the current one) and
 *                     of the current half-year and fiscal year, with their due dates
 *
 * Every due date here is a PLACEHOLDER (verify against the VAT and SD Act 2012, the Income
 * Tax Act 2023, the NBR orders and the City Corporation rules before a pilot).
 */

export type ComplianceKind =
  | 'vat_return'
  | 'vds_deposit'
  | 'tds_deposit'
  | 'salary_tax_deposit'
  | 'withholding_return'
  | 'company_tax_return'
  | 'trade_licence';

export interface DueItem {
  kind: ComplianceKind;
  period: string;
  title: string;
  dueDate: string;
}

const RULES: Record<
  ComplianceKind,
  { every: 'month' | 'half_year' | 'fiscal_year'; title: string }
> = {
  vat_return: { every: 'month', title: 'VAT return (Mushak 9.1)' },
  vds_deposit: {
    every: 'month',
    title: 'Deposit VAT deducted at source (VDS challan)',
  },
  tds_deposit: {
    every: 'month',
    title: 'Deposit income tax deducted from vendor payments (TDS challan)',
  },
  salary_tax_deposit: {
    every: 'month',
    title: 'Deposit income tax deducted from salaries',
  },
  withholding_return: {
    every: 'half_year',
    title: 'Return of tax withheld at source (half-yearly)',
  },
  company_tax_return: {
    every: 'fiscal_year',
    title: 'Company income tax return',
  },
  trade_licence: {
    every: 'fiscal_year',
    title: 'Trade licence renewal (City Corporation)',
  },
};

export const COMPLIANCE_KINDS = Object.keys(RULES) as ComplianceKind[];

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Due date of a kind for a period ("2026-10", "2026-27-H1", "2026-27"). */
export function dueDateOf(kind: ComplianceKind, period: string): string {
  if (RULES[kind].every === 'month') {
    const [y, m] = period.split('-').map(Number);
    const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
    // VAT return and VDS by the 15th, income tax by the 14th of the next month
    const day = kind === 'vat_return' || kind === 'vds_deposit' ? 15 : 14;
    return `${ny}-${pad(nm)}-${pad(day)}`;
  }
  const start = Number(period.slice(0, 4));
  if (RULES[kind].every === 'half_year') {
    // July-December: 31 January; January-June: 31 July
    return period.endsWith('H1') ? `${start + 1}-01-31` : `${start + 1}-07-31`;
  }
  if (kind === 'company_tax_return') return `${start + 2}-01-15`; // the 15th day of the 7th month after 30 June
  return `${start}-09-30`; // trade licence: by 30 September of the fiscal year
}

export function titleOf(kind: ComplianceKind, period: string): string {
  return `${RULES[kind].title}: ${period}`;
}

/** The items to have in the calendar on a day. */
export function dueItems(today: string): DueItem[] {
  const [y, m] = today.split('-').map(Number);
  const out: DueItem[] = [];
  for (let back = 3; back >= 0; back--) {
    const d = new Date(Date.UTC(y, m - 1 - back, 1));
    const period = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    for (const kind of COMPLIANCE_KINDS.filter(
      (k) => RULES[k].every === 'month',
    ))
      out.push({
        kind,
        period,
        title: titleOf(kind, period),
        dueDate: dueDateOf(kind, period),
      });
  }
  // the fiscal year (July-June) of today, and the half-year just ended or running
  const fyStart = m >= 7 ? y : y - 1;
  const fy = `${fyStart}-${pad((fyStart + 1) % 100)}`;
  const lastFy = `${fyStart - 1}-${pad(fyStart % 100)}`;
  const halves =
    m >= 7 ? [`${lastFy}-H2`, `${fy}-H1`] : [`${fy}-H1`, `${fy}-H2`];
  for (const period of halves)
    out.push({
      kind: 'withholding_return',
      period,
      title: titleOf('withholding_return', period),
      dueDate: dueDateOf('withholding_return', period),
    });
  out.push({
    kind: 'company_tax_return',
    period: lastFy,
    title: titleOf('company_tax_return', lastFy),
    dueDate: dueDateOf('company_tax_return', lastFy),
  });
  out.push({
    kind: 'trade_licence',
    period: fy,
    title: titleOf('trade_licence', fy),
    dueDate: dueDateOf('trade_licence', fy),
  });
  return out;
}

/** Days from today to the due date (negative: overdue). */
export function daysLeft(today: string, due: string): number {
  return Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Which reminder is due now, if any (each sent once per item). */
export function reminderStage(
  today: string,
  item: {
    dueDate: string;
    reminded7: boolean;
    reminded1: boolean;
    remindedOverdue: boolean;
  },
): '7' | '1' | 'overdue' | null {
  const left = daysLeft(today, item.dueDate);
  if (left < 0) return item.remindedOverdue ? null : 'overdue';
  if (left <= 1) return item.reminded1 ? null : '1';
  if (left <= 7) return item.reminded7 ? null : '7';
  return null;
}
