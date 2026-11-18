# ADR 0035 — WP28: support tickets and Customer 360

- **Status:** accepted · 2026-11-17
- **Plan:** `docs/phase-3-plan.md` WP28 (the last open decision on it — "support tickets in
  v1" — is answered yes by building it).
- **Acceptance (docs/phase-3-plan.md):**
  > "A breach is raised on time from the SLA clock; Customer 360 shows only what the viewer
  > may see."

  Where each part is covered:
  - `test/integration/support.int-spec.ts` (Meghna Foods, clock Thursday 12 November 2026,
    Dhaka HQ with a Friday–Saturday weekend):
    - **the clock:** a ticket's two deadlines are set in working hours when it is raised; a
      deadline still in the future raises nothing; the resolution breach is raised once and
      never a second time; a ticket nobody answered breaches its first response *and* its
      resolution, each exactly once; both appear in the "past its SLA" list.
    - **the clock is honest about who was slow:** asking the customer something stops the
      resolution clock, and their answer pushes the deadline out by exactly the working hours
      waited (Friday and Saturday never counted).
    - **Customer 360:** the account manager sees the CRM blocks, the money and the tickets;
      Accounts sees the money and no ticket at all (the block is absent, not empty); HR, who
      has no claim on the customer, is refused the page.
  - `src/modules/support/support.spec.ts` (no database): the ticket's life (what may follow
    what), the shipped SLA hours being consistent, and the working-hours arithmetic both ways
    — `addWorkingHours` for a deadline and `workingHoursBetween` for a wait, including that
    pushing a deadline out by the hours waited leaves the team exactly the time it had left.
  - `src/modules/identity/access/roles.spec.ts`: the three new matrix rows.
  - `test/integration/cross-tenant-sweep.int-spec.ts`: a ticket of company A is attacked with
    every route (this is what caught `GET /companies/:id/support/sla` answering for another
    tenant's company before it asserted the company exists).
  - **Screens:** `Frontend/web/e2e/finance.spec.ts` — Rafi works his ticket and records the
    customer's answer; Sujit (Accounts) opens Customer 360 and sees the money with the tickets
    block saying plainly that he may not see it.
- **Open:**
  - **The SLA hours are placeholders**, like the withholding rates of WP15: 2/8, 4/24, 8/48
    and 24/120 working hours for urgent / high / normal / low. A pilot's service manager sets
    the real ones per company (`PUT /companies/:id/support/sla`). Nothing in the code depends
    on the shipped numbers.
  - **No ticket from outside yet.** Tickets are raised by the team (phone, e-mail, walk-in,
    field visit). A customer-facing form or an e-mail mailbox would be WP31 work with n8n; the
    public enquiry form stays a CRM lead, which is a different thing.
  - **No ticket PDF or customer statement of tickets.** Nobody asked for one.

## 1. Why tickets reuse the approval SLA clock rather than a clock of their own

Spec §5 settled how an SLA is counted — "in working hours, excluding weekends and holidays" —
and ADR 0005 settled what that means precisely: hours run through the whole of a working day
and stop completely on a weekend or holiday at the branch. Approvals already do this with
`addWorkingHours` and `WorkCalendarService.workingDayChecker`.

A service desk needs the arithmetic the other way round as well: "how long did the customer
keep this ticket", so the team is not blamed for the wait. That is one new pure function,
`workingHoursBetween(from, to, isWorkingDay)` in `platform/dates/working-time.ts`, tested
beside the one it mirrors. Nothing else was added, and a holiday the HR office adds later
changes ticket deadlines the same way it changes approval deadlines.

The branch whose calendar counts is the assignee's (their current placement), falling back to
the company default — the same rule approvals use for the subject employee.

## 2. The two clocks, and what stops them

Each ticket carries its own clock, `sla_from`, and two deadlines computed from it:

| | set when | stopped by | pushed out by |
|---|---|---|---|
| `first_response_due_at` | raised, priority changed, reopened | the first reply to the customer | nothing |
| `resolution_due_at` | raised, priority changed, reopened | resolving | the working hours a ticket sat in `waiting_customer` |

- **An internal note is not an answer.** Only a `reply` stops the response clock, which is why
  the thread stores `kind` ('reply' to the customer, 'note' internal, 'customer' what they
  sent back) rather than one flat list of comments.
- **A new priority recomputes both deadlines from `sla_from`,** not from now. Raising an old
  ticket to urgent therefore makes it overdue immediately, which is the honest answer: it has
  been urgent all along and nobody knew.
- **A breach already recorded is never un-recorded.** Lowering the priority, or the customer
  answering, moves the *deadline*; `first_response_breached_at` and `resolution_breached_at`
  keep what happened. Reopening is the one exception: it is a new piece of work with a new
  clock, so both breach marks and the answer time are cleared and `reopened_count` goes up —
  the count is what makes a repeatedly reopened ticket visible instead of hiding it.

## 3. A breach is raised once, and the database is what guarantees it

The `ticket-sla` job (every 5 minutes, `src/jobs.ts`, so it also runs inside the API with
`RUN_JOBS_IN_API=true`) reads only open tickets past a deadline with that deadline's breach
column still NULL — there is a partial index for exactly that query — and sets the column with
`UPDATE … WHERE <column> IS NULL`. The outbox event is published only when that UPDATE matched
a row, so two overlapping job runs, a restart in the middle, or a second API instance cannot
produce a second `ticket.sla_breached` for the same clock. This is the same shape as the
WP18 budget alerts and WP27 collection reminders: the "once" lives in the write, not in the
scheduler.

`ticket.sla_breached` goes to the person holding the ticket, and for an urgent or high ticket
also to the company's Admin — the escalation spec §5 asks for on a breach. The notification
uses the same three channels as an escalated approval (in-app, e-mail, SMS), because a missed
service promise is the one support event worth the SMS cost.

## 4. What the database refuses, whatever the code does

- a resolved or closed ticket without a resolution note, and a resolution note without a
  resolved time (`resolution_recorded`);
- a closed ticket with no closing time, a waiting ticket with no waiting time;
- a ticket on another tenant's customer, contact or category (RLS plus the foreign keys);
- two tickets with the same number in a company.

The number is `T/2026-27/00001`, from the shared gapless sequence (`payables_sequences`,
kind `ticket`), like leads, requisitions and certificates.

## 5. Access, and Customer 360

Three permissions:

| Permission | Who | What |
|---|---|---|
| `support.view` | Admin (company), Dept Head (department), Auditor | read tickets in scope, and Customer 360 |
| `support.own` | Dept Head, Sales user (own scope) | work the tickets on their desk: reply, note, ask, resolve, close, priority |
| `support.manage` | Admin, Dept Head | raise and hand over tickets, reopen a closed one, categories and the SLA |

A ticket hangs on its assignee — before that, on the customer's account manager — and the
scope check runs on that person's employee record. That is deliberately the same rule
`CrmAccess` uses for a lead or a customer, so a Sales user's own scope means the same thing in
both modules and there is one place to get it right.

**Customer 360** (`GET /customers/:id/360`) is one read assembled from the modules that own
each part, and every block is gated on its own permission:

- header and contacts: CRM scope, or Accounts (`crm.credit`), or support;
- activities and opportunities: CRM scope;
- quotations, orders, invoices and dues: CRM scope or `receivables.view`;
- tickets: `support.view` / `support.manage` / `support.own` on this customer.

A block the viewer may not see is **absent from the response**, not empty and not masked, and
the page says so in one line rather than pretending the customer has no invoices. Someone who
may see none of it is refused the page. `sees: { crm, money, support }` tells the screen which
blocks it got, so the refusal is not guessed from missing keys.

## 6. Demo data

`npm run db:seed` adds three tickets to Demo Trading Ltd, one of each kind the screens must
handle:

- **Meghna Dealers** (Rafi): two cans leaked on the Khatunganj delivery — answered, now
  waiting for the customer's photo;
- **Sylhet Agro** (Mitu): a VAT query nobody has answered, backdated so its SLA is already
  missed and the "past its SLA" list and the red badges are visible without waiting for the
  job;
- **Bogura Traders** (Mitu): a mustard oil complaint, bottles replaced, resolved and closed.
