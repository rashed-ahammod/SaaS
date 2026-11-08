# ADR 0016 — WP13: the HR & Admin portal

- **Status:** accepted · 2026-10-16
- **Why:** Phase 1 had screens only for employees (the PWA). HR, Accounts and Admin could do
  everything through the API, but in practice only with Postman. Spec §4 promises a web
  portal, and Gate 1 (two parallel payrolls per pilot) cannot be run by a pilot's HR team
  without screens.

## 1. One app, two front doors

The portal lives in the same Next.js app as the employee PWA, under `/portal`
(`src/app/(portal)`). It shares:

- the login and the httpOnly session cookie;
- the API pass-through with its CSRF header;
- the Bangla / English translator;
- the UI kit.

The two parts differ in layout and audience:

- **The employee app:** phone layout with bottom navigation.
- **The portal:** desktop layout with a sidebar, a company selector (a group switches
  between its companies), and the language switch.

A second app would have duplicated the session and security code for no gain. Staff with
portal access get a link to it on the employee app's "Me" screen.

## 2. Showing what the user's roles allow

`GET /auth/me` now also returns `permissions`: the keys held in at least one scope.

- **Sidebar:** the portal shows a screen only when the user holds one of its permissions. An
  employee sees "no screens here".
- **Hiding is convenience, not security.** The API still checks every request with scope and
  field grants. For example, a user without salary access sees "hidden" where amounts would
  be.

## 3. High-risk actions: step-up in the client

The API asks for a fresh 2FA code (`AUTH_STEP_UP_REQUIRED`) on these actions:

- salary bank / wallet changes;
- generating a bank file;
- granting or revoking roles.

The portal registers a handler (`setStepUpHandler`) that opens a code dialog. It then sends
the request again with `X-OTP-Code` and the **same Idempotency-Key**, so the action can
never happen twice.

## 4. Screens

| Area | Screen | Who |
| --- | --- | --- |
| Overview | Dashboard: approvals waiting, headcount, latest run with open flags, Gate 1, phones to approve | Anyone with a portal permission |
| People | Employees: list, search, filters | HR, viewers |
| | New employee (draft + placement) | HR |
| | Employee detail tabs: profile (edit), onboarding checklist, job history and changes, salary (set new), bank accounts, leave balances, attendance profile and consent (paper forms), payslips (PDF) | HR, viewers |
| | Organization: companies, branches (geo-fence), departments (tree, heads), designations, grades | Admin, HR |
| | Users & roles: logins, link to employee, grant / revoke roles (step-up) | Admin, System Admin |
| Time | Attendance: day, month summary and lock, phone approvals, shifts, holidays | HR, viewers |
| | Leave: types (Bangladesh defaults), policy, accruals | HR |
| | Approvals inbox and detail | Approvers |
| Payroll | Runs: create (monthly / bonus / final settlement) | HR |
| | Run detail: calculate, flags (clear with reason; AI explanation when offered), employees with calculation trace and payslip PDF, submit, reproducibility check, salary journal, payments and bank files (generate with step-up, download, settle, returns, cancel) | HR, Accounts, Admin |
| | Monthly items | HR |
| | Payroll setup: settings, heads, structures | HR |
| | Gate 1: status, register upload, comparison with per-employee differences, explain, accept | HR uploads and explains; Accounts accepts |
| Administration | Data migration: templates, upload, rows and errors, skip, dry run, commit / roll back, reconciliation, sign-off | HR, Admin |
| | AI: switches, usage, policy documents, recent answers | Admin, HR |
| | Audit log, integrations (dead letters, replay, failed e-mail / SMS) | Admin, auditors |

## 5. Choices

- **Text:** the portal's text is in `src/lib/portal-text/*.ts`, one file per area, with keys
  `p.*`. Each Bangla dictionary must have every key of its English one (TypeScript checks
  it), and they are merged into the existing translator.
- **Components:** small in-house components (`components/portal/kit.tsx`: table, modal,
  tabs, panel, stat, and a `useAction` busy/error/success helper) instead of shadcn/ui
  (guide §2). The PWA's Tailwind classes cover what the screens need, without a second
  component system. Revisit if the portal grows richer widgets (date ranges, virtualised
  tables).
- **Tests:** `e2e/portal.spec.ts` runs on a desktop browser. As HR it walks the Gate 1 path:
  - an employee's salary, leave and consent;
  - a run's employees with the calculation trace, and the reproducibility check;
  - a monthly item added and cancelled;
  - the Gate 1 page and its template;
  - attendance;
  - Bangla.

  It also checks what Accounts and an employee may see, and fails on any browser error.

## 6. Not included

- **Editing everything:** some changes are still API-only (Postman):
  - custom roles, delegations and approval chains;
  - service keys;
  - field grants;
  - leave year-end;
  - YTD openings;
  - loans and salary advances;
  - documents upload;
  - per-type leave settings;
  - editing branches, grades and designations after creation (except department heads).
- **End-to-end tests that change payroll data.** Creating, calculating and approving a run,
  the bank file and the Gate 1 acceptance are covered by the backend integration tests;
  a UI test would change the shared demo month for everyone.
- **A design pass with pilot HR staff** (the WP9 usability-test approach) on desktop.
