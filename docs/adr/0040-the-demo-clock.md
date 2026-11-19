# ADR 0040 — The demo is one story told on one day

- **Status:** accepted · 2026-11-19
- **Why now:** a `db:reset` taken to get a clean e2e baseline, which found that the demo could no
  longer be seeded from scratch at all, and that a third of the e2e failures were the calendar
  rather than the code.
- **Covered by:**
  - `backend/src/config/config.spec.ts` — the demo clock is read in development, parsed, defaulted
    to null, and **refused in production**;
  - `Frontend/web/e2e/*` — the full suite on a freshly seeded database (see §6 for the count);
  - the seed's own output, which now names the day it is telling the story on.

## 1. The story has a "today", and it was the author's

`npm run db:seed` writes one coherent scenario: September's payroll is the month just closed,
October holds the bills, the invoices and a half-punched attendance register, the October VAT return
is not due yet, Rafi's leave for 22-25 October is still waiting for his manager.

Nothing in that story said *which* day "now" was — the seed built it through the services, and a
service stamps today's date on whatever it creates. So the story was coherent only on the day it was
written (late October 2026) and bent a little further out of shape every day after:

- a quotation created "today" with a `validUntil` of 15 November was refused outright once that date
  passed — **the demo could not be seeded from scratch after 15 November 2026**;
- the Karim Stores invoice landed in November, so October's commission run found nothing:
  `demo commission seeded: October 0.00 posted to payroll for 0 salesperson(s)`;
- the October VAT return could be filed, because October was over;
- the compliance calendar showed its October items overdue instead of due.

## 2. Pinning the clock, not re-dating the story

Two ways out. Re-date the story onto the current month every time it is seeded — which means
re-deriving 169 dates, and breaks the weekday fidelity the story leans on (the weekend here is
Friday-Saturday, and leave, punches and an absence all sit on named weekdays). Or tell the story on
its own day.

The second is what this codebase already does with time-sensitive fixtures: the integration suite
runs the whole application under a `ManualClock` ("the clock starts 15 October 2026") against a real
database, 534 tests of evidence that the app behaves correctly on a pinned clock. So:

- `DEV_CLOCK` in `backend/.env` — an ISO date-time, validated, and **refused in production** by
  `productionProblems`, because a frozen clock there would freeze every date the business runs on;
- the `Clock` provider returns a `ManualClock` when it is set, the real clock when it is not;
- the seed prints the day it is telling the story on, and warns loudly when the clock is not pinned.

The day is **Thursday 29 October 2026**: after the story's last events, inside its October, and a
working day — the weekend is Friday-Saturday, so a Friday would have broken every punch.

Tokens are untouched by this: JWTs are signed and verified against the machine's own clock, so a
pinned business clock cannot expire a session.

## 3. Pinning one side made it worse

With the API pinned to 29 October and the **browser** still on the real 19 November, the two
disagreed about what day it was, and the suite went from 12 failures to 17. Every flow that sends a
date the browser chose broke: a claim dated today was refused as being in the future, and HR opening
an employee's month asked for a month the API had not reached, so there was no day to fix.

The app reads "today" through one helper, so both sides now agree:
`dhakaNow()` honours `NEXT_PUBLIC_DEV_CLOCK`, which is inlined at build time and never set in
production. The two variables are a matched pair, and both `.env.example` files say so.

**The general lesson**: pinning a clock is only safe when everything that reads a clock is pinned
with it. Half-pinned is worse than not pinned at all.

## 4. What the demo was missing, not mis-dating

Three failures had nothing to do with dates — they wanted data the seed never created:

- **No paid month.** Payslips, the tax certificate, the PF statement and the salary tax challan all
  read `PAID_STATES` runs, and the demo's only run was left "calculated, waiting for HR". Every one
  of those screens was therefore empty on a fresh seed, and the tests that read them had been
  written against a dev database where someone had paid that run by hand in Postman. September now
  goes all the way: HR answers its flags, Accounts verifies, the MD approves — three different
  logins, because the engine refuses the same person twice. October deliberately has **no** run:
  payroll refuses a month whose attendance is not locked, and October is half punched and not over.
  Locking it and running it is the exercise that used to be the waiting run.
- **No phone waiting for approval.** The phone register opens on the queue of phones waiting to be
  allowed. With nothing in it the table rendered an empty state with no columns at all, and a
  reviewer could not tell an empty queue from a broken screen. Mitu's new phone now waits there.
- **A public form pointing at a company that no longer existed.** `ENQUIRY_FORMS` holds a company id
  and a `crm.capture` service key, pasted in by hand once; every reseed invalidated both and the
  form answered "not found" with nothing to say why. The seed now creates that key, prints the line,
  and rewrites it in `Frontend/web/.env.local` when the line is already there (a file that does not
  mention it is left alone).

## 5. Tests that had never run

Of the failures fixed here, eight were defects in the tests rather than the product, and they share
a cause: the WP28-WP31 e2e blocks were written but never run (the Phase 3 verification covered unit,
integration, lint and typecheck). The kinds:

- `getByText` / `getByRole(name)` matching **two or three** elements — a page heading and a panel
  heading carrying the same words, three screening reasons, two "Sylhet Agro" book lines;
- `getByRole("button", { name: "Pay" })` matching the sidebar's collapsible **Payroll** group, since
  that name match is a substring — it had been asserting against the menu since ADR 0032 introduced
  collapsible groups;
- an assertion on a leave reason (*"Family matter in Cumilla"*) that **no seed has ever written**: the
  demo's request reads "Sister's wedding in Sylhet". Written against a request made by hand.

**A work package is not done until its e2e has run**, and these would all have been caught the day
they were written.

## 6. Where it leaves the suite

| Run | Failures |
| --- | --- |
| before, on a long-lived database | 11 |
| on a freshly seeded database | 16, then 12 |
| API clock pinned, browser not | 17 |
| both clocks pinned, paid month, form key, phone in the queue | 3 |
| those three (all test defects) fixed | see the session's final run |

## 7. Still open

- The demo's story lives inside fiscal year 2026-27. When the real date leaves it, the anchor day
  and the story's own July dates have to move together; the seed does not detect that yet.
- `DEV_CLOCK` is a development convenience, so a developer reading the UI sees October while their
  wall clock says otherwise. That is the price of a coherent demo, and the seed says so on every run.
