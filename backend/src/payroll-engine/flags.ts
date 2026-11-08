/**
 * Rule-based payroll checks (guide §12.3, spec §6.4 step 6). Every flag must be
 * cleared with a reason before the run can go for approval. AI explanations
 * (WP11) are added on top of these, never instead of them.
 */
import { Money } from '../platform/money/money.js';
import type { Flag, MonthlyInput, PayResult } from './types.js';

export function buildFlags(
  input: MonthlyInput,
  result: Omit<PayResult, 'flags'>,
): Flag[] {
  const flags: Flag[] = [];
  const net = Money.of(result.net);

  if (input.previousNet !== null && Money.of(input.previousNet).isPositive()) {
    const previous = Money.of(input.previousNet);
    const changePct = net.minus(previous).dividedBy(previous.toDb()).times(100);
    const limit = input.settings.netChangeFlagPercent;
    if (changePct.greaterThan(limit) || changePct.lessThan(-limit)) {
      flags.push({
        code: 'NET_CHANGE',
        message: `Net pay changed ${changePct.round().toString()}% (from ${previous.toDb()} to ${net.toDb()})`,
      });
    }
  }
  if (input.bankAccount.changedInPeriod)
    flags.push({
      code: 'BANK_ACCOUNT_CHANGED',
      message: 'Salary bank / wallet account was changed this month',
    });
  if (!input.bankAccount.hasApproved)
    flags.push({
      code: 'MISSING_BANK_ACCOUNT',
      message: 'No approved salary bank / wallet account',
    });
  // tax is due for the year, yet nothing is withheld now or so far
  if (
    Money.of(result.projection.annualTax).isPositive() &&
    Money.of(result.tax).isZero() &&
    Money.of(input.ytd.taxWithheld).isZero()
  ) {
    flags.push({
      code: 'ZERO_TAX_ON_TAXABLE',
      message: `Annual tax ${result.projection.annualTax} is due but no tax is withheld`,
    });
  }
  if (net.isNegative())
    flags.push({
      code: 'NEGATIVE_NET',
      message: `Net pay is negative (${net.toDb()})`,
    });
  if (input.employee.status === 'notice')
    flags.push({
      code: 'NOTICE_PERIOD',
      message: 'Employee is serving notice',
    });
  const otHours = input.overtime.approvedMinutes / 60;
  if (otHours > input.settings.otMonthlyLimitHours) {
    flags.push({
      code: 'OT_ABOVE_LIMIT',
      message: `Overtime ${otHours.toFixed(1)} h is above the monthly limit of ${input.settings.otMonthlyLimitHours} h`,
    });
  }
  if (input.missingPunchDays > 0)
    flags.push({
      code: 'MISSING_PUNCHES',
      message: `${input.missingPunchDays} day(s) with a missing punch were paid as worked`,
    });
  return flags;
}
