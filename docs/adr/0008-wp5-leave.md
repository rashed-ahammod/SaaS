# ADR 0008 — WP5: leave on a ledger

- **Status:** accepted · 2026-10-15

## 1. Balances are the ledger sum (never stored)

`leave_ledger` is **append-only** (trigger). The kinds are opening, accrual, taken, reversal,
lapse, carry_in, encash and adjustment. Days are signed `NUMERIC(6,2)`.

- `balance(asOf)` is the sum of the entries dated on or before `asOf`. This is what
  statements and reports show.
- `available` is the sum of all entries, including approved future leave, minus pending
  requests. Applying and approving check this.

An approved request writes `taken` entries, **split by leave year** (a request over New Year
becomes two entries). Cancelling an approved request writes a `reversal` that mirrors each
`taken` entry, so the balance comes back exactly. Integration tests compare the API balance with
a direct `SUM()` after every operation.

## 2. Jobs are idempotent by period key

Job entries carry a `period_key`: `grant:2026` for the yearly grant, `month:2026-10` for
monthly and earned-leave accrual, and `year_end:2025` for the year end. A partial unique index
`(employee, type, kind, period_key)` makes reruns write nothing. The worker runs both jobs every
6 h for every tenant. HR can also run them (`POST /leave/accruals/run`, `POST /leave/year-end`),
for example after go-live.

- **annual_grant:** the leave year's entitlement, prorated by days for joiners and rounded to a
  half day.
- **monthly:** entitlement ÷ 12 for each completed month.
- **per_worked_days:** days worked in a completed month (present and late count 1, half-day
  counts 0.5, from attendance) ÷ N. This is earned leave, 1 per 18 from the rule pack.
- **Year end:**
  - `encash`: the excess of an encashable type above the carry cap. It also writes a
    `leave_encashments` row with status `pending_payroll` for WP6.
  - `lapse`: closes the rest of the year to zero.
  - `carry_in`: on the first day of the next leave year, re-opens the carried days up to the
    cap.

  Each leave year therefore reads cleanly on its own.

## 3. Statutory numbers come from the rule pack

The Bangladesh defaults (`POST /companies/:id/leave-types/defaults`) are:
- **CL:** entitlement from `leave.casual.days_per_year`.
- **SL:** entitlement from `leave.sick.days_per_year`.
- **EL:** accrual from `leave.earned.worked_days_per_leave_day`.
- **ML:** maximum days per request from `leave.maternity.days`; minimum service from
  `leave.maternity.min_service_months`.

In production, unverified values block these calculations (WP3). The worker logs and skips
such a tenant rather than failing the whole run.

These are **company choices**, editable by HR:
- the sick-leave certificate needed above 2 days;
- the 40-day carry cap and encashment for earned leave;
- the one-year minimum service for earned leave;
- the sandwich rule (off);
- the 7-day back-date limit, which HR itself is not bound by;
- the 30 % team-absence warning;
- the leave year (calendar year).

## 4. Approval

Request type `leave_request` with these default chains (spec §5):
- **Maternity and unpaid (ML, LWP):** Dept Head, then HR. This is selected with the new
  `kinds` chain condition.
- **Up to 3 days:** the line manager. HR is told through the `leave.submitted` event.
- **Otherwise:** Dept Head, then HR.

The engine gained `withdraw()`, so a module can close its own pending request (HR cancelling
someone's leave). Requests sent back with **return** can be **resubmitted** with new dates. This
is a new approval request on the same leave request.

## 5. Attendance

Leave registers itself as attendance's leave source. A full day of approved leave becomes
**On leave** (a half day does not; the half actually worked is computed normally).
Approving or cancelling recomputes the past days of the range. Locked months produce
adjustments, as defined in ADR 0007.

## Deferred

- **Maternity:** the payroll variables (pay = monthly wage ÷ 26 per day) are created by
  payroll, which reads approved ML requests (WP6). The rule limiting maternity benefit when
  there are two or more surviving children is not checked yet.
- **Encashment:** paying it out is WP6. The `leave_encashments` rows are waiting with status
  `pending_payroll`.
- **Partial cancellation** (coming back early) needs a cancel and re-apply for now.
