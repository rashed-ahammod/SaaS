/**
 * Fiscal years and accounting periods (spec §6.6: "Fiscal year July–June,
 * monthly period close"). Pure functions; the start month is the company's
 * fiscal_year_start ("07-01" by default).
 */
import {
  addDays,
  addMonths,
  businessDate,
  fiscalYearOf,
  type BusinessDate,
} from '../../platform/dates/business-date.js';

export interface FiscalYearSpan {
  code: string;
  startsOn: BusinessDate;
  endsOn: BusinessDate;
  periods: Array<{
    period: string;
    startsOn: BusinessDate;
    endsOn: BusinessDate;
  }>;
}

/** The fiscal year a date falls in: code, first and last day, and its twelve months. */
export function fiscalYearFor(
  date: BusinessDate,
  startMonthDay = '07-01',
): FiscalYearSpan {
  const code = fiscalYearOf(date, startMonthDay);
  const startYear = Number(code.slice(0, 4));
  const startsOn = businessDate(`${startYear}-${startMonthDay}`);
  const endsOn = addDays(addMonths(startsOn, 12), -1);
  const periods = Array.from({ length: 12 }, (_, i) => {
    const from = addMonths(startsOn, i);
    return {
      period: from.slice(0, 7),
      startsOn: from,
      endsOn: addDays(addMonths(from, 1), -1),
    };
  });
  return { code, startsOn, endsOn, periods };
}

/** "PV/2026-27/00042" */
export function voucherNumber(
  type: 'payment' | 'receipt' | 'journal' | 'contra',
  fiscalYearCode: string,
  no: number,
): string {
  const prefix = { payment: 'PV', receipt: 'RV', journal: 'JV', contra: 'CV' }[
    type
  ];
  return `${prefix}/${fiscalYearCode}/${String(no).padStart(5, '0')}`;
}
