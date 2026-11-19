# ADR 0039 — Where the three gates live, and the screens a Dept Head was refused

- **Status:** accepted · 2026-11-19
- **Why now:** a question about the Payroll menu — *it shows Gate 1 and Gate 3, where is Gate 2?* —
  which turned out to be true of the menu, and then the walk that proved the answer found three
  screens that refuse the role whose menu offers them, one screen that crashed for every role that
  can see it, and one way a head of one company could read another company's rows.
- **Covered by:**
  - `Frontend/web/src/lib/api.test.ts` — `apiState`: the render between "no path yet" and the
    request starting, and one path never answered with another path's data or error;
  - `backend/test/integration/performance.int-spec.ts` — a Dept Head reads the cycles they rate in,
    counted and listed over their own people only, and an employee is refused that screen;
  - `backend/test/integration/recruitment.int-spec.ts` — a Dept Head reads their own departments'
    plan lines and openings, and a role with no recruitment grant still reads none;
  - `backend/test/integration/cross-tenant-sweep.int-spec.ts` — unchanged, and still passing over
    the routes whose gate moved;
  - `Frontend/web/e2e/roles-portal.spec.ts` — every demo role opens every screen its own menu
    offers: 15 passed, where 6 role walks failed before;
  - the Hiring and Performance blocks of `Frontend/web/e2e/finance.spec.ts` — 13 passed on a freshly
    seeded database.

## 1. Gate 2 was the only gate without a menu entry

Gate 1 is a screen (`/portal/gate-1`, Payroll). Gate 3 is a screen (`/portal/gate-3`). Gate 2 was a
panel — `Gate2Panel` — rendered inside **Finance → Month-end close** and **Finance → Opening
balances**. Nothing was missing from the product: the report existed, tied to the work that moves
it. But a gate you can only reach by knowing which other screen carries it is a gate nobody finds,
and because the Ctrl+K search runs over screen names, typing "Gate 2" found nothing at all.

Decided:

- Gate 2 becomes a screen of its own, `/portal/gate-2`, in the **Finance** group after Opening
  balances, reusing the same panel. The panels on Close and Opening stay, because that is where the
  work that moves the gate is done.
- Gate 3 moves out of **Payroll** into **Sales/CRM**, beside Commission. It measures a sales
  pipeline and one appraisal cycle; it sat in Payroll only because Gate 1 already did, and its own
  "where to next" already pointed at Commission and the appraisal cycles.
- Gate 1 stays in Payroll, where the parallel payroll run it measures lives.

Each gate now sits with the work it measures, and all three are findable by name.

## 2. The render between "no path yet" and the request starting

`useApi(path)` took its first `loading` from the path at mount. A screen that waits for the company
asks with `null` first, so the state said `loading: false` — and the effect that starts the request
runs *after* the render in which the path appears. For that one render a page saw no data, no error,
and nothing loading. A page written as

```ts
if (report.loading && !report.data) return <Loading />;
if (report.error) return <ErrorBox … />;
const r = report.data!;          // boom
```

crashed on it. **Gate 3 crashed for every role that can see it** — HR, the Admin and the workspace
owner — and so did the manpower plan. The pages were not wrong; the hook was.

The hook now remembers which path its state belongs to. A path that does not match is loading, and
the previous path's data or error is never served as this path's answer — which also stops a company
switch showing the old company's figures for a frame. The decision is a pure function, `apiState`,
so it is pinned by tests without a DOM (this project's vitest runs node-only).

## 3. Three lists that refused the role whose menu offers them

A Dept Head's grant is held at **department** scope. `allows('recruitment.view', { companyId })` is
therefore false for them, deliberately — `access-grants.spec.ts` has pinned that from the start:
asking "may you see the whole company?" must be false for a head of one department.

Three list endpoints asked exactly that and then refused:

| Route | Who was refused |
| --- | --- |
| `GET /companies/:id/job-openings` | Dept Head |
| `GET /companies/:id/manpower-plan` | Dept Head |
| `GET /companies/:id/appraisal-cycles` | Dept Head, and every employee |

The same module already had the answer: `position-requests` finds the departments the user reaches
and filters the rows by them. That rule now lives once, in `RecruitmentAccess.departmentScope`
(modelled on `CrmAccess`), used by position requests, openings and the manpower plan.

For appraisals the shape is different, because **a cycle belongs to the company, not to a
department**: there is nothing to filter the cycle row by. So `assertSee` now answers *whose
appraisals* rather than yes-or-no, and the scope is applied to what hangs off the cycle — the
per-cycle count and the cycle's appraisal list. A Dept Head sees the company's cycle calendar with
their own four people counted in it; HR sees the same calendar with all eight.

So `assertSee` answers three ways, and what hangs off a cycle is filtered to the answer:

| Grant | Sees | Demo cycle |
| --- | --- | --- |
| company (Admin, HR, auditor) | the company | 8 appraisals |
| department (Dept Head) | their departments, subtree included | 4 |
| own (every employee) | their own appraisal | 1 |

The employee rung was nearly a mistake. Reading the cycles screen as "the company's cycles and HR
starting one", this ADR first took `performance.own` **out** of its menu entry — and
`finance.spec.ts` then showed what that broke: an employee reaches their own appraisal *through*
this screen (the cycle, then their row), and has no other way to it. `GET /appraisal-cycles/:id/mine`
exists for exactly that, and nothing calls it. So the screen keeps `performance.own`, and the scope
does the work: the employee gets the cycle's name and dates — the calendar they are being appraised
against — and their own row, counted as one.

Deliberately unchanged: the applicant and CV lists stay HR's, at company scope.

## 4. "My team" for a login that is not an employee

`GET /appraisal-cycles/:id/my-team` returns the appraisals this person manages, and threw FORBIDDEN
when the login had no employee record. The workspace owner is exactly that login, and holds
`performance.manage`, so the screen is in their menu and refused them. A login that is not an
employee manages nobody: that is an empty team, and the screen says so.

## 5. The hole that filtering by department opened, and how it is closed

A department-scoped grant names departments but **not their company**. Filtering rows by such a
scope is safe only while the company stays in the question too. Where rows carry both — openings,
plan lines, appraisals — `company_id = :id AND department_id IN (…)` is enough. Where the row
belongs to the company itself — a cycle's name and period, a plan's state and note — it is not: a
Dept Head of Demo Trading would have passed Meghna Agro's gate and read them.

`OrgLookupService.departmentsOfCompany(companyId, ids)` now intersects a grant's departments with
the company, and both scope helpers go through it. A Dept Head of one company gets 403 on all four
of the other company's routes. This also tightened `position-requests`, which used to answer 200
with an empty list there.

## 6. Two crashes from a record printed where a name belongs

`openings.service.get()` returned `departmentName`, `designationName`, `gradeName` and `branchName`
as the **lookup's records** — `{code, name}` — while the field names, and the frontend's type
(`string | null`), say string. React refuses to render an object, so the **opening detail screen
crashed for every role that could open it** (error #31). `positions.service.get()` had the identical
four lines, crashing the new-position detail the same way, and its approval summary built the
sentence an approver reads as `New position NP/…: 1 x [object Object] in [object Object]`. All of it
now takes the name: `?.name`, and `?.nameEn` for a designation.

## 7. What the reset exposed in the demo seed

Running `db:reset` to get a clean e2e baseline turned up two faults of its own:

- **The demo could no longer be seeded from scratch.** The sales step refused itself with
  VALIDATION_FAILED because the seeded quotations carry no `quoteDate` — so they are dated today —
  while `validUntil` was hardcoded to `2026-11-15`. From 16 November on, every fresh seed failed on
  a rule that is right (a validity cannot precede its quotation). The quotation validities, the job
  offer's validity and joining date, and the opening's closing date are now relative to the day the
  demo is seeded.
- **A failed step still reports itself seeded.** After that failure, the next `db:seed` printed
  "demo sales already seeded" over half-written data. The guards are per step and the steps are not
  atomic, so a failure leaves a guard claiming success — worth knowing before trusting a seed that
  errored once.

## 8. Found, not fixed

- **The demo narrative is written as if today were late October** (September payroll just closed,
  October invoices, the October VAT return, October's commission run). Seeded fresh on 19 November
  the story lands in the wrong month — `demo commission seeded: October 0.00 … for 0 salesperson(s)`
  — and 13 of 131 e2e tests fail on it: payroll fixes (×3), VAT (×2), commission (×2), procurement,
  bank reconciliation, the phone register, an approval, a usability task and the public enquiry.
  None of them are hiring, performance or gate tests. Fixing it means dating the demo story
  explicitly instead of inheriting "today", across the whole seed.
- **Part of that set is order- or state-dependent.** Two clean runs each failed 13, but not the same
  13: bank reconciliation failed in one and passed in the other.
- **The Phase 3 verification never included e2e.** Five of the failures fixed here were strict-mode
  locator defects in the WP29-WP31 blocks (`getByText` matching two or three elements), the
  signature of tests written but never run. Worth adding e2e to what a work package counts as done.
- The portal review still owes its remaining groups: **Payroll**, **Sales/CRM**, **Finance**,
  **Administration** (ADR 0033 did People, ADR 0034 Time).
