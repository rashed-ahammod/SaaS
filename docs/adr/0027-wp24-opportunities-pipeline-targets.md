# ADR 0027 — WP24: opportunities, pipeline and targets

- **Status:** accepted · 2026-10-30
- **Plan:** `docs/phase-3-plan.md`, WP24.
- **Acceptance (docs/phase-3-plan.md):**
  > "The weighted forecast equals Σ value × probability of open opportunities; every stage
  > change is kept."

  Where each part is covered:
  - `test/integration/crm-opportunities.int-spec.ts` (Meghna Foods; Rafi and Sumaiya sell,
    Tanvir is the Sales head; the clock stands at 3 November 2026).
    - **The forecast:**
      - The Admin's forecast for November to January is compared with Σ value × probability
        computed straight from the `opportunities` table: Tk 1,370,000.35, from
        1,180,000 × 80% + 480,000.50 × 70% + 900,000 × 10%.
      - Rafi's own forecast is compared the same way for his opportunities only.
      - The months, salespeople and stages add up to the same total.
      - The pipeline board gives the same weighted values per stage.
      - An open opportunity already past its close date is shown apart as "late", not hidden
        in the total.
    - **Every stage change kept:**
      - Each move carries the value, probability and note of that moment.
      - Won, lost and opened again are recorded too.
      - A change made around the API (straight in the database) is recorded as well.
      - The history refuses UPDATE and DELETE.
      - The history holds exactly one row per change: 10 for the test's 10 changes.
    - **Scope:**
      - a salesperson sees and sells only to their own customers;
      - the Sales head sees his department, but not Sumaiya, who sits in Finance;
      - Accounts sees no opportunities;
      - the Sales head hands opportunities over within his department only.
    - **Targets:**
      - the Sales head sets his salespeople's targets, not Sumaiya's and not the department's;
      - the Admin sets the department's;
      - the Sales department's achievement counts Sales Dhaka;
      - a salesperson sees only their own row.
  - `src/modules/crm/crm.spec.ts`: rounding the weighted total once, and the months.
  - `test/integration/cross-tenant-sweep.int-spec.ts`: the new routes.
  - **Screens:** `Frontend/web/e2e/finance.spec.ts`, block "CRM: opportunities, pipeline and
    targets (WP24)" (Rafi, Tanvir, Anisur, on the demo data).
- **Open:**
  - **Commission** on won or collected sales is WP31; it reads `opportunity.won` and invoices.
  - **Quotations** (WP25) will move an opportunity to "Quotation sent" by themselves.
  - **No one is notified** of `opportunity.won`. It is in the outbox for WP31 and n8n.
  - **Targets in quantity** (cans, tonnes) wait for products (WP25). Targets are in taka.

## 1. Stages

- Each company has its own **open** stages, in order, each with a default probability.
- The first use creates five:

  | Stage | Bangla | Probability |
  |---|---|---|
  | Prospecting | প্রাথমিক যোগাযোগ | 10% |
  | Needs identified | চাহিদা নির্ণয় | 25% |
  | Quotation sent | কোটেশন পাঠানো | 50% |
  | Negotiation | দরকষাকষি | 70% |
  | Verbal yes | মৌখিক সম্মতি | 90% |

- The Admin (`crm.manage`) adds, renames, re-orders or retires stages. A stage cannot be retired
  while open opportunities sit in it.
- **Won and lost are states, not stages.** A won opportunity is 100% and a lost one 0%; the
  database enforces both. This way no company can define a "won" stage that does not count as
  won.

## 2. Opportunities

- **What one holds:**
  - number `O/2026-27/00001`;
  - customer, and the lead it came from;
  - owner, and the owner's department (for the department target; it changes on hand-over);
  - stage, value (taka), probability, expected close date;
  - state: open → won | lost (with a reason: price, competitor, no budget, no response,
    timing, product fit, other) → open again (with a note).
- **Created by:**
  - a salesperson, for a customer they may see; it is theirs;
  - the Sales head or Admin, for someone (`ownerId`); without one, the customer's account
    manager owns it;
  - qualifying a lead, which can open one at once (spec §6.8 "qualify a lead into a customer
    and opportunity"); the lead's owner owns it.
- **Moving stage:** the probability becomes the stage's, unless the owner gives another (e.g.
  Negotiation at 80% when the buyer has said yes in principle).
- **Won:**
  - The date may not be in the future.
  - The agreed value may differ from the estimate.
  - Raises `opportunity.won` (spec §9) with the owner, department, value and date.
- **Scope:** the same as leads and customers (ADR 0026 §1), by the opportunity's owner.

## 3. The history is kept by the database

- `opportunity_stage_history` is written by an `AFTER INSERT OR UPDATE` trigger on
  `opportunities`, not by the service. It records:
  - every insert;
  - every change of stage or state, with the value and probability of that moment, the note
    given (`change_note`) and who made it.
- It is append-only (`app_reject_change`), and the app role has only SELECT and INSERT.
- `changed_at` is `clock_timestamp()`, so several changes in one transaction keep their order.

## 4. Board, forecast, targets

- **Weighted value:**
  - each opportunity is value × probability / 100, shown rounded to the paisa;
  - **totals add the unrounded values and round once**, so the total equals Σ value ×
    probability exactly (unit test: three half-paisa rows give 1,100.01, not 1,100.02).
- **Board:** the open opportunities by stage (count, value, weighted), late ones marked, and the
  month's won and lost.
- **Forecast (`from`–`to`, up to 24 months):**
  - open opportunities by expected close month, by salesperson and by stage;
  - beside each month, what was won in it;
  - open ones past their date shown apart as "late", so the owner updates the date instead of
    the forecast quietly carrying them.
- **Targets:**
  - in taka per month, for a salesperson or a department;
  - **set by:** the Sales head for the department's salespeople (`crm.assign`); the Admin for
    anyone and for departments (`crm.manage`);
  - **achieved** = opportunities won with a close date in the month; a department counts its
    sub-departments (Sales counts Sales Dhaka and Sales Chattogram);
  - beside it, the weighted value still expected to close in the month.

## 5. Demo data

- **Rafi:**
  - Meghna Dealers' Eid soybean oil: Tk 12.5 lakh in negotiation at 80%;
  - Karim Stores at "Quotation sent";
  - a Puja-season mustard oil order won in October.
- **Mitu:**
  - Sylhet Agro's canteen contract;
  - a North Bengal dealer prospect;
  - Bogura's palm oil tins, lost on price to a local mill.
- **Targets for October and November:**
  - Rafi Tk 15 lakh and Mitu Tk 12 lakh, set by Tanvir;
  - Sales Tk 40 lakh, set by Anisur.
