# ADR 0033 — The People section: giving the existing routes a button

- **Status:** accepted · 2026-11-04
- **Why now:** the portal is being reviewed screen group by screen group, starting with
  **People** (employees, probation & leavers, organization, users & roles). The review asked one
  question of every feature — *is it good, and is it needed?* — and found three kinds of answer:
  work the API can do that no screen could reach, text only a developer could read, and a few
  things that needed new API work. ADR 0032 made the portal explain itself; this one makes the
  People screens able to do what the API already allowed.
- **Covered by:**
  - `backend/test/integration/employees.int-spec.ts` — branch and designation filters, a transfer
    moving an employee between branch lists, the CSV export (its columns, the filter, the BOM, the
    audit entry), and the document-expiry list;
  - `backend/test/integration/access.int-spec.ts` — a time-boxed auditor grant read back, and the
    bilingual permission catalogue;
  - `backend/test/integration/portal-home.int-spec.ts` — the new `documentExpiry` reminder;
  - `backend/test/integration/route-permissions.int-spec.ts` — the two new routes declare who may
    call them;
  - the e2e block "People: the work HR and an Admin actually do" in `Frontend/web/e2e/portal.spec.ts`
    (six tests: the branch filter and the download, the emergency contact and the manager fields,
    the papers tab, the login screen, the permission picker, the organization editors).

  Note for whoever runs the e2e suite: an access token lasts 30 minutes, so the saved sign-ins go
  stale. Run the `setup` project with the suite (not `--no-deps`) or every test fails at once.

## 1. Routes that existed with nothing to press

Each of these was already in the API, with its permission and its audit entry, and could only be
reached with `curl`:

- **Closing a login.** `PATCH /users/:id { status: 'disabled' }`, and `AuthService` has always
  refused anyone who is not `active`. The leaver flow even has an "IT clearance" step — but nothing
  in the product ever set `disabled`, so a resigned employee's login stayed usable. The Users
  screen now has it, behind a confirmation, with the hint that it belongs on the last working day.
- **A new password.** `POST /users/:id/password` (step-up protected). An Admin had no way to help
  somebody who forgot theirs.
- **An end date on a role.** `expiresAt` was accepted and stored, and the **auditor role refuses a
  grant without one** — so that role could not be granted from the portal at all. The grant form
  now offers the date (required for a time-limited role) and the table shows "until", or "no end
  date", and marks an expired grant.
- **Unlinking a login from an employee**, its phone and its language.
- **Renaming or re-hanging a department, a designation or a grade**, and **retiring** any of them
  (`isActive`), which the pickers respect: a retired entry stays on old records and is no longer
  offered when somebody is hired or transferred. The closure-table re-parenting in
  `DepartmentsService` was fully built and unreachable.
- **A grade's seniority and salary range** (`rank`, `salaryMin`, `salaryMax`) — the table showed a
  range that could never be entered.
- **Permanent address and the emergency contact.** Stored, returned, and editable by the employee
  through `PATCH /me/contact` — invisible to the HR officer who needs the phone number on the day
  something happens. Now on the hire form, the profile and the edit dialog.
- **Changing a manager.** The job-change form offered the type `manager_change` and had no manager
  field, so the one thing that event exists for could not be done. Line manager and functional
  manager are now on the form.

## 2. Text a person can read

`GET /permissions` has always returned a sentence for every permission and was never called: the
custom-role editor listed raw keys (`payroll.verify`) in a flat eighty-line column. The catalogue is
now bilingual (`PERMISSIONS_BN` beside `PERMISSIONS`, with TypeScript checking that every key has a
Bangla line), and the editor shows the sentence, grouped by the part of the business it belongs to,
with a search box and a count. The key is still printed small underneath, because that is what an
error message or a support question will quote.

The same screen had hardcoded `ROLES` and `SCOPES_FOR` lists in the browser while `GET /roles`
already returns the system roles with their `allowedScopes`, `timeLimited` and `privileged` flags.
Those lists are gone; roles are named, not keyed, and each system role shows one line of what it is
for. Revoking a role no longer uses `window.prompt` for its audit reason.

## 3. New API work

- `GET /employees?branchId=&designationId=` — the placement in force today decides, so a transfer
  moves the employee out of the old branch's list. A company here has branches with their own
  weekend and geo-fence; "who works at Gazipur" was a question the list could not answer.
- `GET /employees/export.csv` — the filtered list as a spreadsheet, for bank letters, audits and
  inspections. It carries **no salary, bank or identity field**: a file that leaves the system shows
  only what the list itself shows. UTF-8 BOM so Excel on Windows opens the Bangla names, capped at
  5000 rows, and the download is audited (`employee.exported`), since personal data left the system.
- `GET /companies/:companyId/document-expiries?withinDays=` — documents that have expired or expire
  soon, with the leavers and the removed ones left out and each row checked against the caller's own
  access. An expiry date was captured on upload and then only ever seen on that one employee's
  screen, so a contract could end with nobody noticing. It is a tab on Probation & leavers, and a
  `documentExpiry` item on the dashboard's "needs your attention" (30 days) links to it.

## 4. One bug found by driving the screens

`Table` rendered its empty state inside a `<p>`. Since ADR 0032 that empty state is often an
`<EmptyState/>` with paragraphs of its own, so every empty list produced a `<p>` inside a `<p>` and
React logged a hydration error on the console. It is a `<div>` now.

## 5. What the review decided *not* to build

- **A graphical org chart.** The indented department tree and the line manager on each profile
  already answer "who reports to whom"; a drawing is a lot of work for the same answer.
- **Per-company onboarding checklist items.** The fixed eight-item list is enough until a pilot asks
  for its own.
- **Bulk employee edit.** Data migration already does mass changes, with a reconciliation and an
  Admin's signature. Bulk edit without that is how a payroll gets quietly corrupted.
