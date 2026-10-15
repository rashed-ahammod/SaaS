# ADR 0009 — WP6: payroll engine, runs and maker–checker

- **Status:** accepted · 2026-10-15
- **Open:** the acceptance cases are ILLUSTRATIVE and the tax values are placeholders. Both
  must be replaced before any pilot payroll. See section 7.

## 1. A pure engine, with stored inputs

`src/payroll-engine/` is a pure library (guide §12.1). It does not import the database, Nest,
the clock or the environment, and `engine-purity.spec.ts` fails the build if it does. It exposes
three functions:

- `calculateMonthly(input)` calculates a regular month. With `input.finalSettlement` it
  calculates a final settlement instead.
- `calculateBonus(input)` calculates a festival bonus.
- `computeArrears(input)` works out what months already paid would pay under today's salary
  history, minus what was actually paid.

Each run stores, for every employee, the exact engine input with its SHA-256 hash and
`ENGINE_VERSION` in `payroll_run_employees.input`. `GET /payroll-runs/:id/reproduce` recalculates
from those stored inputs and compares every line. This is the WP6 acceptance criterion
"re-calculation of a past run reproduces identical lines". Change `ENGINE_VERSION` whenever a
result could change.

Money is handled with `decimal.js`. Each line is rounded once with the company rule (to the
paisa or to the taka), and net = Σ earnings − Σ deductions exactly. The acceptance runner checks
this sum for every case.

## 2. Order of calculation (guide §12.2)

1. **Structure heads.** Each salary segment (a mid-month change splits the month) is applied
   for its share of the month: paid days ÷ calendar days. This covers joiners, leavers and
   salary changes.
2. **Unpaid days.** Absent days and leave without pay are charged at gross ÷ basis per day. The
   basis is a company setting: calendar days, 30 or 26. The late penalty uses the same day rate
   and applies only when the company has switched it on.
3. **Maternity days.** These are taken out of salary and paid as `MATERNITY_PAY` at monthly wage
   ÷ 26 per day (rule pack `leave.maternity.daily_pay_divisor`).
4. **Other earnings:**
   - attendance adjustments of locked days, refunded or charged at the day rate of *that*
     month's salary;
   - overtime: BASIC ÷ `ot_hours_basis` (208) × hours × the rule pack multiplier;
   - arrears;
   - manual items;
   - leave encashment (gross ÷ 30 per day).
5. **Deductions:**
   - PF (% of earned BASIC);
   - loan installment (the whole outstanding amount at final settlement);
   - manual deductions;
   - notice not served (gross ÷ 30 per day).
6. **Income tax (projection method):**
   1. Project the year's income: year-to-date taxable + this month's taxable + months left ×
      regular monthly taxable + expected bonuses.
   2. Exemption = the lower of income ÷ 3 and the cap.
   3. Apply the slabs. If any tax is due, it is at least the minimum tax.
   4. This month's tax = (annual tax − withheld so far) ÷ months left including this one.
7. **Employer costs:** PF employer share and gratuity provision (optional).
8. **Flags** (rule-based, guide §12.3):
   - net change above X %;
   - bank account changed this month, or no bank account;
   - tax due for the year but nothing withheld;
   - negative net;
   - employee serving notice;
   - overtime above the monthly limit;
   - missing punches paid as worked.

## 3. Where the facts come from

`PayrollInputService` asks each owning module through its service. Payroll never reads another
module's tables.

| Fact | Source |
| --- | --- |
| Absent days, approved OT, late penalty days, missing punches | `AttendanceService.payrollFacts`. A regular run requires the month to be **locked**. |
| Changes to locked days | `AttendanceService.pendingAdjustments`: absent → worked gives `unpaidDelta −1`. Marked paid on approval. |
| Leave without pay, maternity | `LeaveLedgerService.payrollLeave`. Unpaid leave counts only on days attendance shows as "on leave". Maternity counts every calendar day. |
| Encashment | `LeaveLedgerService.pendingEncashments` (year end). At final settlement, the unused encashable balance is added. |
| Bank account | `BankAccountsService.payrollFacts` |
| Year to date | Approved runs of the fiscal year (July–June) plus `payroll_ytd_openings`: go-live opening, and a previous employer's income. |
| Arrears | Approved runs' stored inputs, recalculated under today's salary history (section 4). |
| Statutory values | Rule pack on the last day of the period |

## 4. Arrears from a back-dated increment

Salary history (`employee_salaries`) is never edited. A wrong row is cancelled with a reason and
a new row is added. When a new row starts before months that are already paid, the next regular
run recalculates each of those months:

- the same employment dates, unpaid dates and maternity dates, taken from the stored input;
- the salary history as it is now.

The run then pays the difference as `ARREAR` lines, each tagged with `for_period`. "Already paid"
covers the salary-derived lines of that month plus earlier `ARREAR` lines for it, so an arrear is
never paid twice. An arrear is taxed in the month it is paid (section 7).

## 5. Runs and maker–checker

States are `draft → calculated → in_approval → verified → approved`. A run can also be
`cancelled`, but only from draft or calculated.

- **Calculate is all-or-nothing.** It runs inside the request transaction, so if any employee
  fails, nothing is saved. Recalculating replaces the earlier results.
- **Flags.** Every flag must be cleared with a reason before the run can be submitted.
- **Approval** uses the approval engine, request type `payroll_run`. The default chain is
  `role:accounts` (verify) → `role:admin` (approve). Two hooks were added to the engine:
  - `onStepApproved`: the run becomes `verified` after the Accounts step.
  - `distinctApprovers`: whoever approved an earlier step is never assigned to a later step, and
    is refused if they try (for example, a user who is both Accounts and Admin). The preparer is
    the requester, so as before they can never approve.
- **Returned or rejected** runs go back to `calculated`, so HR can fix the inputs, recalculate
  and resubmit.
- **Frozen in the database.** A trigger refuses any insert or delete of a run's employees, lines
  or flags unless the run is draft or calculated. After approval, corrections go into the next
  run as arrears or adjustments.
- **On approval:**
  - adjustments, encashments and manual items are marked paid;
  - loan recoveries are written (append-only), and a loan closes when fully recovered;
  - a final settlement marks the employee `separated`;
  - `payroll.approved` goes to the outbox with no amounts, per the outbox rule.

There are three run types, each unique while live:

| Type | Unique per | Who is included |
| --- | --- | --- |
| `regular` | company and month | Everyone employed in the month, except leavers whose last working day falls in or before it. |
| `bonus` | company and bonus name | Optionally one festival group. Eligibility and the cap (1 × BASIC, after 12 months) come from the rule pack on the bonus date. Tax = annual tax with the bonus − annual tax without it. |
| `final_settlement` | employee | One leaver. HR records `POST /employees/:id/notice` first, which sets the last working day and status `notice`. |

**Who sees what.** HR, Accounts and Admin can see runs and totals. Individual amounts and lines
need the `salary` field group, so Admin approves totals but cannot see salaries (spec §4). The
employee sees their own approved payslips at `/me/payslips`, without the explanation trace.

## 6. Data model (migration 0011)

| Table | Holds |
| --- | --- |
| `payroll_settings` | Company payroll settings |
| `salary_heads` | Company salary heads (system heads such as TAX are built in) |
| `salary_structures` | Immutable; a new split means a new structure |
| `employee_salaries` | Effective-dated; one active row per date |
| `payroll_ytd_openings` | Go-live and previous-employer tax figures |
| `payroll_variables` | Manual items for one month |
| `loans` | Salary advances |
| `loan_recoveries` | Installments recovered (append-only) |
| `payroll_runs` | Runs and their totals |
| `payroll_run_employees` | Stored engine input, hash and totals per employee |
| `payroll_lines` | Lines with their explanation |
| `payroll_flags` | Flags and who cleared them, with the reason |

Migration 0011 also adds `employees.last_working_day`. Rule pack **BD-LABOUR 2026.2** is 2026.1
plus `tax.salary.exemption_divisor`, `tax.salary.exemption_cap`, `tax.salary.minimum_tax` and
slabs for FY 2025-26. All of these values are still marked `verify`.

## 7. To confirm with the payroll accountant and the compliance owner

The engine is built so that each item below is a setting or a rule pack value, not a rewrite.

1. **Signed acceptance cases.** Replace the ILLUSTRATIVE cases in
   `test/payroll-cases/*.yaml` with the accountant's signed figures (guide §12.6).
2. **Tax values.** Slabs, the ⅓ / 450,000 exemption and the 5,000 minimum tax are placeholders.
   Not yet modelled: the **investment rebate**, and the thresholds for women, senior and disabled
   taxpayers.
3. **Arrears** are taxed in the year they are paid, not reopened in the earlier year.
4. **Maternity pay** is gross ÷ 26 per calendar day of leave. Confirm whether "wage" means gross
   or basic.
5. **Leave encashment** is gross ÷ 30 per day. Confirm the basis (gross or basic) and the
   divisor.
6. **Overtime** is BASIC ÷ 208 × 2 per hour. Confirm the basis (BASIC or gross) and the hours.
7. **Final settlement:**
   - gratuity is 30 days of BASIC per completed year, for every leaver;
   - the statutory **resignation benefit** (`benefit.resignation.wage_days_per_year`) and
     termination benefits are not yet separate lines;
   - notice not served is gross ÷ 30 per day.
8. **Half days** are not deducted as unpaid. Missing-punch days are paid and flagged.
9. **Expected future bonuses** are not projected in monthly tax. The bonus run withholds the
   extra tax the bonus causes, so the year still balances.
