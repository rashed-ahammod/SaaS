# Gate 3: a pilot runs its sales pipeline and one appraisal cycle

Spec §12: Phase 3 is accepted when a pilot has actually **run its sales pipeline and one
appraisal cycle in the system** — not when the screens exist. This runbook is how that is
checked and decided, and it has the same standing as [Gate 1](gate-1-parallel-payroll.md)
(two parallel payrolls) and Gate 2 (one real finance close).

The tooling is one report: **`GET /companies/:id/gate-3`**, in the portal as **Gate 3 report**
(permission `gate3.view`; it looks back one quarter by default, `?days=` changes that). It
decides nothing. It counts what the pilot's own records say and marks each check met or not
met, with the numbers behind the answer, so the decision is taken with evidence in hand.

## Before you start the quarter

1. **Gate 1 and Gate 2 are passed** for this pilot. Phase 3 sits on payroll and on finance:
   commission reaches a payslip, and a sales invoice posts to the ledger.
2. **People and permissions:** the sales team has `crm.*` and their own targets set
   (`sales_targets`), managers have `performance.*`, support has `support.*`, HR has
   `recruitment.*`. Roles are per company — check with the pilot's Admin, not from memory.
3. **The commission scheme is agreed in writing** with the pilot: basis (on **invoiced** or on
   **collected** sales), the rate, any better rate above target, any minimum attainment, and
   whether credit notes claw back. Enter it once (`PUT /companies/:id/commission-scheme`); the
   rule in force is snapshotted on each month's run, so a later change does not rewrite an
   earlier month.
4. **The SLA and the appraisal calendar** are set: support working hours and response /
   resolution targets (`PUT /companies/:id/support/sla`), and the appraisal cycle's phase dates
   agreed with the pilot's HR before goals are written.
5. **Say plainly which figures are illustrative.** The demo rates (2% / 3% above target) and
   the demo SLA are ours, not the pilot's.

## During the quarter

Nothing here is operations' work — it is the pilot using the system. Watch for the pattern that
fails this gate: records created once and then abandoned.

- **Sales:** leads captured (web form, Facebook workflow or manual), activities logged,
  opportunities **closed** won or lost — not left open forever — and the chain quotation →
  order → delivery → invoice run at least once end to end, with customer receipts allocated
  against those invoices.
- **Commission:** each month calculated (`POST /companies/:id/commission-runs`), the lines read
  with the salespeople against the invoices and receipts in their `detail`, then **posted into
  payroll before that month's payroll is approved**. Posting after approval is refused
  (`COMMISSION_PERIOD_LOCKED`) — that commission belongs in the next month's run, with a note.
- **Appraisals:** one cycle taken as far as **calibration**, with ratings calibrated across
  departments, and any increment proposals applied through payroll (they appear as arrears if
  back-dated).
- **Support:** tickets raised by whoever takes the customer's call, and resolved. SLA breaches
  are information, not a failure of the gate — a quarter with no breach and no ticket is the
  one to worry about.
- **Recruitment:** at least one opening run to a hire, so the hand-over from applicant to
  employee has actually been used.

## Reading the report

Seven checks, each with `what` (in the words of spec §12), `met`, and `detail`:

| Check | Met when |
| --- | --- |
| `pipeline` | Leads captured, opportunities created **and** at least one closed (won or lost) |
| `quote_to_invoice` | A quotation, an order and an invoice in the period |
| `collections` | Customer receipts recorded in the period (`openItems` shows what is still unpaid) |
| `appraisal_cycle` | A cycle at calibration or beyond, with at least one calibrated rating |
| `commission` | An active scheme **and** at least one posted month |
| `support` | Tickets raised and at least one resolved (`slaMissed` is shown, not judged) |
| `recruitment` | An opening created in the period and at least one hired application |

`allMet` is a fact about the seven checks. It is not the gate.

## Deciding the gate

**Gate 3 is passed** when, with the report in hand, the pilot's Admin and our founder agree in
writing that the pilot ran a quarter of sales and one appraisal cycle in the ERP. Keep the
report (date, `from`/`to`, the seven checks) with that note: it is the evidence, like Gate 1's
two accepted comparisons.

Do not pass the gate on a report with a check you had to explain away. Two honest cases:

- **A check is not met because the pilot does not do that work** — for example no recruitment
  this quarter. Record it as out of scope for this pilot, in writing, and say which check was
  waived and why. Do not make the report say otherwise with test records.
- **A check is not met because something does not work.** That is a defect, not a gate
  decision. Fix it with a test that fails first, and run the quarter on. Gate 3 may need a
  second quarter; that is the point of the gate.

## If the numbers look wrong

1. **Commission disagrees with a salesperson's own figure.** Open the run's lines: each keeps
   the invoices or receipts it was computed from, and the rule as it stood. `collected` counts
   **allocations** against that salesperson's invoices, so money sitting on account is not
   commission yet. If the rule itself is wrong, fix the scheme and recalculate the month —
   posting is what makes it real, and a posted month must be cancelled (which cancels its
   payroll variables) before it is recalculated.
2. **A posted commission does not appear on a payslip.** It is a payroll variable on the
   `COMMISSION` head: recalculate that month's payroll run. If the run was already approved,
   the commission goes to the next month.
3. **`appraisal_cycle` is not met although the cycle looks finished.** Calibration is what
   counts: `calibrated` counts appraisals with a calibrated rating, so a cycle whose manager
   scores were never calibrated does not pass.
4. **`support` shows tickets but none resolved.** Check the SLA job (`ticket-sla`, every five
   minutes) is running — [Background jobs](background-jobs.md) — and that resolutions are being
   recorded in the system rather than over the phone only.
5. **Counts look low for the quarter.** The report's window is `?days=` (default 90, maximum
   730) and it is read in Asia/Dhaka. Check `from`/`to` in the response before concluding
   anything.
