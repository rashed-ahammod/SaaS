# ADR 0037 — WP30: performance, from goals to an increment in payroll

- **Status:** accepted · 2026-11-17
- **Plan:** `docs/phase-3-plan.md` WP30.
- **Acceptance (docs/phase-3-plan.md):**
  > "An approved increment reaches payroll as an effective-dated change with the correct
  > arrears; ratings are calibrated before proposals go out."

  Where each part is covered:
  - `test/integration/performance.int-spec.ts` (Meghna Foods) runs a whole cycle on a company
    whose September payroll is already **calculated, approved and paid at the old salary**:
    goals from the KPI library, Rafi's self-review, Tanvir's rating of 4, HR's calibration to
    3, HR's increment proposal back-dated to 1 September, the MD's approval, HR applying it —
    and then October's payroll run, which shows `ARREAR 3000.00` for period `2026-09` next to
    October's own pay at the new gross. Nothing in this module calculated that figure: it is
    WP6's `computeArrears` reacting to an effective-dated salary row.
  - **Calibration before proposals** is asserted directly: a proposal from an appraisal that
    has a manager's rating but no calibrated rating is refused (409 `NOT_CALIBRATED`), and the
    Sales head cannot propose at all (403).
  - `src/modules/performance/performance.spec.ts` (no database): the cycle's phases and that
    they only move forward, one appraisal's steps, the weights adding up to 100, the weighted
    score (including that unscored goals are left out rather than counted as zero), and the
    review-draft prompt's four prohibitions.
  - `src/modules/identity/access/roles.spec.ts`: the five new matrix rows.
  - `test/ai-eval/review-draft.yaml` + `npm run ai:eval`: three cases (English and Bangla)
    whose `noneOf` lists are the things a draft must never contain — a rating, a recommended
    increment or promotion, a verdict on keeping the person.
  - `test/integration/cross-tenant-sweep.int-spec.ts`: a cycle, its appraisals, a KPI, a
    feedback note and a proposal of company A are attacked with every route.
  - **Screens:** `Frontend/web/src/app/(portal)/portal/performance/*` — cycles with the
    calibration spread per department, one appraisal (goals, self-review, rating with the AI
    draft, calibration, feedback, proposal), my team's appraisals, and the proposals list.
- **Open:**
  - **No forced distribution.** The plan lists "whether a forced distribution is used in
    calibration" as an owner decision. Calibration here *shows* the spread per department and
    lets HR move any rating with a reason; it does not enforce quotas. Adding a forced
    distribution later is a rule on top of this screen, not a change to the data.
  - **The rating scale is 1 to 5**, which the plan also lists as an open decision. It is a
    column constraint (`BETWEEN 1 AND 5`) and a label set, so changing it is a migration plus
    text, not a redesign.
  - **No appraisal PDF** and no employee-app screen for the self-review yet: the self-review
    is in the portal. The employee app side is WP31 work ("portal and app screens completed").
  - **Commissions into payroll** (spec §6.4, the other half of "what performance leads to")
    are WP31, not here.

## 1. Why the increment is a proposal and not a salary change

The module could have written the salary itself. It does not: an increment is a **proposal**
that goes through the approval engine (`increment_proposal`, chain Admin, with HR first for a
promotion), and only when it is approved does HR press "apply". Applying calls
`PayrollSetupService.addSalary()` — the same method HR uses by hand — and, for a promotion,
`JobHistoryService.createJobEvent({ type: 'promotion' })`.

Three things follow from that, all of them the point:

- **Payroll stays the only place money is calculated.** This module writes an effective-dated
  salary row and stops. A date inside an already-paid month produces arrears because WP6
  compares what was paid with what today's salary history says was due (`computeArrears`);
  there is no second arrears calculation to disagree with the first.
- **There is one path to a salary**, so the audit trail, the flags (`NET_CHANGE`) and the
  payroll checks behave exactly as they do for a manual change.
- **The proposal keeps its own record** of what it became (`applied_salary_id`,
  `applied_event_id`), so "why did this salary change?" has an answer that leads back through
  the approval to the calibrated appraisal.

`increment_proposals` carries the amount, and the amount is a sensitive field: the API returns
`newGross` only to someone who may see salaries, so the Dept Head whose person it is sees the
proposal, its state and its date without the figure.

## 2. The phases, and why they only move forward

A cycle walks `draft → goals → self_review → manager_review → calibration → proposals →
closed`, and `nextPhase()` is the only way to move. There is no "re-open the self-review":
ratings, calibrations and proposals are built on what the earlier phase produced, and a real
HR department that needs to re-open something re-opens *one appraisal's* step, not the
company's phase.

Two details worth recording:

- **The phase does not wait for the slowest manager.** Opening the self-review requires that
  *somebody* has goals, not everybody. Appraisals whose goals are not set stay at the goals
  step — there is nothing for those people to review against — and the rest of the company
  carries on. (The first version refused the phase until every appraisal had goals, which one
  late manager could use to hold up 200 people.)
- **The states are compared by their place in the sequence, not as text.** `'calibration' <
  'goals'` is true alphabetically, so a naive `state < next` moved appraisals *backwards*.
  The phase step now lists the states it moves from, and `performance.spec.ts` keeps that
  trap visible.

## 3. Calibration is a gate, not a report

`appraisals.calibrated_rating` is what a proposal reads, and `ProposalsService.propose()`
refuses outright when it is null. That is the acceptance criterion in code, and it is also
the honest shape of the business rule: the manager's rating is the manager's opinion, and the
rating the company acts on is the one HR has compared across departments.

`GET /appraisal-cycles/:id/calibration` is what HR looks at while doing it: the spread of 1s
to 5s per department, how many are rated and how many are already calibrated. Moving a rating
takes a note, and the original manager rating is never overwritten — both numbers stay on the
appraisal, which is what makes a disagreement arguable later.

## 4. Feedback notes, and who may read them

`feedback_notes` are written any time by someone who may rate or manage that employee. Each
note carries `shared_with_employee`:

- the employee sees only the notes shared with them, and without the author;
- their manager, HR, the Admin and an auditor see all of them, with the author.

A Dept Head holds `performance.rate` in their **department's** scope, so every check on an
employee's notes resolves that employee's current department before asking the access rules —
without it the person who writes most of the feedback would be refused by their own grant.
The same applies to the KPI library, which is company reference data rather than anybody's
personal data, so a department-scoped grant is enough to read it.

## 5. The AI draft rates nobody

`POST /appraisals/:id/review-draft` gives the model the goals with their weights and scores,
the feedback notes of the period, and the self-review — and **no name, gender, religion, age
or family**. It returns text; nothing is saved. `manager_comment` only ever holds what the
manager submitted with `POST .../rate`, which is the same shape as WP29's screening: the model
sorts and summarises, a human decides.

The prompt forbids four things explicitly — inventing evidence, giving a rating, recommending
an increment or promotion, and saying whether to keep the person — and the test set's `noneOf`
lists are those same four, so a model that starts doing any of them closes its own release
gate.
