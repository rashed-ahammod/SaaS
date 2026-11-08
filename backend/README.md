# ERP API (backend)

NestJS API for the Corporate ERP + CRM Portal. The business rules are in
`../BUSINESS_LOGIC_SPEC_v0.2.md` and the technical rules in `../IMPLEMENTATION_GUIDE.md`.
Architecture decisions are recorded in `../docs/adr/`.

**Status:** WP0 Foundations, WP1 Organization and employees, WP2 Roles, permissions and
approvals, WP3 Rule pack, WP4 Attendance (without the device-specific agent adapter), WP5
Leave, WP6 Payroll engine, WP7 Disbursement and payslips, WP8 Data migration, WP9 Self-service
PWA (in ../Frontend/web), WP10 Notifications via n8n (workflow in ../n8n), WP11 AI phase 1, WP12 Pilot readiness and WP13 HR & Admin portal (../Frontend/web, /portal) are done. The payroll acceptance
cases are ILLUSTRATIVE and the tax values are placeholders until the payroll accountant signs
real cases (docs/adr/0009); the bank / wallet file layouts are ILLUSTRATIVE until each bank
confirms its format (docs/adr/0010). WP9 acceptance is the usability test with pilot employees
(../docs/usability-test-wp9.md). The SMS gateways and e-mail provider are local mocks until the pilot's
are chosen (docs/adr/0013). WP11 runs with a deterministic fake model until the AI provider is chosen
and its key is set (docs/adr/0014). WP12: the security checklist with its evidence and open items is in
../docs/security/checklist.md, the runbooks are in ../docs/operations/runbooks, and Gate 1 (two parallel
payrolls per pilot) has its comparison tool (docs/adr/0015). Phase 1 is built; pilots start after the open
checklist items (penetration test, hosting) are closed.

Phase 2 (Finance, ../docs/phase-2-plan.md): WP14 General ledger is done (docs/adr/0017): Bangladesh chart of
accounts, July–June fiscal years, vouchers with maker-checker, gapless numbers, period close,
opening balances, automatic payroll and salary-payment postings, trial balance, general ledger,
P&L, balance sheet and nightly checks. The chart template awaits review by a pilot's accountant.
WP15 Vendors, bills and tax at source is done (docs/adr/0018): vendors with TIN / BIN, vendor bank
accounts (maker-checker), bills posted on approval with income tax and VAT deducted at source (rates in
rule pack BD-LABOUR 2026.3, PLACEHOLDERS to verify), vendor payments, challans, certificates, aged payables
and the nightly check that the payables account equals the open bills. The portal has finance screens
(Books, Vouchers, Chart of accounts, Financial reports, Vendors, Vendor bills, VAT & tax at source).
WP16 Expense claims and employee advances is done (docs/adr/0019): claims with receipt photos from the
employee app (Dept Head -> Accounts, Admin from Tk 50,000), payment once, cash advances (payout, settled by
claims, refund, salary recovery), salary advances paid out through the books, and the nightly check that the
staff advances account equals the advances sub-ledger.

## First-time setup

Requirements: Node.js 24+, PostgreSQL 16+ (local install or `../infra/docker-compose.yml`).

```bash
npm install
cp .env.example .env        # then set PG_ADMIN_PASSWORD, JWT_SECRET, FIELD_ENCRYPTION_KEY
npm run db:setup            # creates roles erp_owner / erp_app / erp_worker and databases erp_dev / erp_test
npm run db:migrate          # applies db/migrations to erp_dev
npm run db:seed             # rule pack + demo company, people and logins (see below)
```

To start over with empty local databases: `npm run db:reset`, then the three commands above.

## Run

```bash
npm run start:dev           # API on http://localhost:3000 (restarts on change)
npm run start:worker:dev    # worker: outbox, approval SLA, attendance day close, leave accruals, audit check, ledger checks
```

## AI (WP11)

```bash
# .env
AI_PROVIDER=fake            # off = no AI (all screens work) · fake = deterministic stand-in · anthropic = Claude
ANTHROPIC_API_KEY=...       # for anthropic (or `ant auth login`); AI_MODEL defaults to claude-opus-5-5

npm run ai:eval             # release gate: runs test/ai-eval/*.yaml in the demo workspace, records the result
```

The demo workspace is on the Intelligent plan with AI switched on and the handbook in
`samples/policies` loaded. Outside production the gate is advisory (set
`AI_REQUIRE_RELEASE_GATE=true` to enforce it); in production a feature is offered only while its
latest `npm run ai:eval` for the configured model and prompt version passed.

## Operations (WP12)

```bash
npm run backup              # encrypted pg_dump (BACKUP_ENCRYPTION_KEY) + manifest into BACKUP_DIR
npm run restore:drill       # restore the newest backup into a scratch database and prove it (report in ../docs/operations/drills)
```

Both need `PG_BACKUP_PASSWORD` (the read-only `erp_backup` role, created by `npm run db:setup`). Monitoring:
`GET /health/ready` (deploy gate) and `GET /metrics` with `Authorization: Bearer <METRICS_TOKEN>`; Prometheus config and
alerts in `../infra/monitoring`. See ../docs/operations/runbooks.

## Try it in Postman

Import `postman/ERP-API.postman_collection.json`. Pick a person in **Login as ...**; the token is
saved and used by every other request. All passwords: `Demo-Pass-123`.

| Login (workspace `demo`) | Role(s) | Person |
| --- | --- | --- |
| `admin@demo.test` | System Admin + Admin + HR + Accounts (group, workspace owner; checker for Sujit's bills and vouchers) | — |
| `anisur.rahman@demo.test` | Admin (company) | Managing Director |
| `farzana.akter@demo.test` | HR (company) | HR Manager |
| `sujit.das@demo.test` | Accounts (company) | Finance Manager |
| `tanvir.hossain@demo.test` | Dept Head (Sales) | Sales Manager |
| `nusrat.jahan@demo.test` | System Admin (company), no salary access | IT Officer |
| `rafi@demo.test` | Employee (own), prefers Bangla | Sales Executive |
| `mitu@demo.test` | Employee (own) | Sales Executive |
| `admin@rival.test` (workspace `rival`) | Owner of another company | for isolation checks |

Everyone with an employee record also has the Employee role (own scope).

`demo` is Demo Trading Ltd: Dhaka HQ (weekend Friday and Saturday) and a Chattogram office,
7 departments, 8 employees. Rafi has a promotion plus a back-dated transfer. Waiting in approval
inboxes:
- Rafi's bKash change, in HR's (Farzana's) inbox;
- Mitu's Dutch-Bangla Bank change, in the owner's inbox (Farzana entered it, so she cannot
  approve it).

**Rule pack:** `BD-LABOUR 2026.1` (24 statutory values from spec §7) and `2026.2` (adds the salary
tax exemption, cap and minimum tax for payroll) are published and accepted by both demo workspaces. Every value is still `verify`: it works on your machine, but production
refuses it until the compliance owner verifies it:

```bash
npm run rules -- list BD-LABOUR@2026.1
npm run rules -- verify BD-LABOUR@2026.1 leave.maternity.days --from 2026-04-10 \
  --by "Adv. Nasrin Sultana, labour counsel" --source http://bdlaws.minlaw.gov.bd/...
npm run rules -- unverify BD-LABOUR@2026.1 leave.maternity.days --from 2026-04-10 --by "..." --reason "..."
npm run rules -- publish rule-packs/<new-version>.json --by "Platform team"
```

**Attendance demo:**
- **Calendar and shifts:** a Bangladesh 2026 holiday calendar (lunar dates marked tentative),
  the General shift 09:00–18:00, and Ramadan hours.
- **Punches:** device punches for 1–13 Oct 2026. Mitu is late on the 5th, absent on the 7th and
  has a missing punch on the 8th.
- **Mobile punch:** Rafi's phone `demo-install-rafi-a15` is approved. Geo-fences: Dhaka HQ
  23.7925, 90.4078 and Chattogram office (Agrabad, where Rafi now works) 22.3245, 91.8123, 150 m.
- **Employee app:** `../Frontend/web` (the PWA) signs in with these logins; see its README.
- **Office agent:** `db:seed` prints a service key and the Dhaka HQ branch id for agent uploads,
  only when the attendance demo is first created. Paste them into Postman's `agentKey` and
  `agentBranchId` variables.

**Leave demo:**
- **Types:** the Bangladesh defaults CL, SL, EL, ML and LWP, with 2026 grants.
- **Year end 2025:** opening earned-leave balances were closed at the end of 2025. Anisur
  carries 40 days, and 2 days wait for payroll as an encashment.
- **Approved leave:** Mitu's sick leave on 7–8 Oct, which now shows as "On leave" in
  attendance.
- **Waiting for approval:** Rafi's casual leave on 22–25 Oct, in Tanvir's inbox.

**Payroll demo:**
- **Setup:** the Bangladesh salary heads and the standard structure (Basic 60%, house rent 50%
  of basic, medical 10% of basic), a salary for everyone, Rafi's July increment, and the
  July–August tax figures from the old system as YTD openings.
- **Items:** Rafi's September commission of 6,000. Mitu's salary advance of 12,000 is waiting in
  Tanvir's inbox (then Accounts).
- **September run:** September attendance is locked (Mitu absent on 17 Sep) and the run is
  calculated. Anisur's 2 encashed days are paid. There are 6 "missing bank account" flags to
  clear.
- **Try:** as Farzana, clear the flags and submit. Sujit verifies, then Anisur approves. Sujit
  can never approve both steps. Then run "Reproduce", and see "My payslips" as Rafi.
- **Pay it (WP7):** as Sujit, open "Payments of the run". Tanvir is paid by Nagad and the others
  in cash, because the other salary accounts are still waiting for approval. Generate the Nagad
  and cash files, download them, then settle; the run becomes "disbursed". Rafi can download his
  payslip PDF in Bangla or English.

**Data migration demo:** `samples/migration/1-employees.csv` ... `6-bank_accounts.csv` bring
three Chattogram sales staff (DTL-00201 to DTL-00203) into Demo Trading Ltd with salaries, leave
balances, July-September tax figures, an advance and salary accounts. As Farzana, upload them
in order (Postman folder "Data migration (WP8)"): row 5 of the employees file is wrong on
purpose, so skip it, then dry-run and commit each file. `7-customers.csv` brings five customers (dealers, a
distributor, a Cox's Bazar hotel, a Cumilla shop) with their salespeople and credit terms. As Anisur, check the reconciliation and
sign it off.

**2FA locally:** `.env` has `SECURITY_MFA_ENFORCED=false`, so no authenticator codes are needed.
Set it to `true` to try mandatory 2FA and step-up codes (`X-OTP-Code` header). It is always
`true` in production.

### Routes

Every route needs `Authorization: Bearer <token>`, except login, 2FA verify and health. Each
controller file lists its routes at the top.

| Area | Routes |
| --- | --- |
| Auth | `POST /auth/login` · `POST /auth/mfa/verify` · `GET /auth/me` · `POST /auth/mfa/setup` · `POST /auth/mfa/enable` |
| Self-service | `GET /me/profile` · `PATCH /me/contact` |
| Organization | `/companies`, `/companies/:id/branches`, `/companies/:id/departments`, `/companies/:id/designations`, `/companies/:id/grades` (POST, GET), plus `GET`/`PATCH` on `/branches/:id`, `/departments/:id`, `/designations/:id`, `/grades/:id` |
| Employees | `POST /employees` · `GET /employees?companyId=&departmentId=&status=&q=` · `GET`/`PATCH /employees/:id` · `POST /employees/:id/activate` |
| Job history | `POST`/`GET /employees/:id/job-events` · `POST /employees/:id/job-events/:eventId/cancel` · `GET /employees/:id/assignments?asOf=` |
| Onboarding | `GET /employees/:id/onboarding` · `POST /employees/:id/onboarding/:item/complete` · `.../reopen` |
| Documents | `POST`/`GET /employees/:id/documents` · `GET .../:docId/file` · `POST .../:docId/remove` |
| Bank / wallet | `POST /employees/:id/bank-accounts` (step-up; goes to approval) · `GET /employees/:id/bank-accounts` |
| Approvals | `GET /approvals/inbox` · `GET /approvals/requests/mine` · `GET /approvals/requests/:id` · `POST .../approve` · `.../reject` · `.../return` · `.../cancel` · `GET`/`POST /approvals/chains` · `PATCH /approvals/chains/:id` |
| Users and roles | `POST`/`GET /users` · `GET`/`PATCH /users/:id` · `POST /users/:id/password` · `POST /users/:id/roles` · `POST /users/:id/roles/:grantId/revoke` · `POST /users/:id/field-grants` · `.../revoke` · `GET /permissions` · `GET`/`POST /roles` · `PATCH /roles/:id` |
| Delegation | `POST`/`GET /delegations` · `POST /delegations/:id/revoke` |
| Admin tools | `GET /audit-log` · `GET /integrations/outbox?status=dead` · `POST /integrations/outbox/:id/replay` |
| Rule pack | `GET /rule-packs` · `GET /rule-packs/:id` · `POST /rule-packs/:id/accept` (Admin) · `GET /rules?date=` · `GET /rules/:key?date=` |
| Holidays | `POST`/`GET /companies/:id/holiday-calendars` · `POST`/`GET /holiday-calendars/:id/holidays?year=` · `PATCH /holidays/:id` (move = recompute) · `POST /holidays/:id/remove` · link with `PATCH /branches/:id { holidayCalendarId }` |
| Shifts | `POST`/`GET /companies/:id/shifts` · `PATCH /shifts/:id` · `POST`/`GET /companies/:id/shift-overrides` · `POST`/`GET /employees/:id/shift-assignments` · `GET`/`PATCH /employees/:id/attendance-profile` |
| Punch | `POST /me/devices` · `GET /me/devices` · `POST /me/punches/mobile` · `POST /me/punches/web` · `GET /attendance/devices?status=` · `POST /attendance/devices/:id/approve` · `.../revoke` · `POST /attendance/device-batches` (service key) |
| Attendance | `GET /me/attendance` · `GET /employees/:id/attendance` · `GET /attendance/days?date=` · `GET /attendance/summary?companyId=&period=` · `GET /attendance/adjustments` · `POST /attendance/recompute` · `POST`/`GET /attendance/locks` · `POST`/`GET /employees/:id/attendance-corrections` · `POST`/`GET /employees/:id/overtime-requests` |
| Service keys | `POST`/`GET /service-keys` · `POST /service-keys/:id/revoke` (step-up) |
| Leave setup | `GET`/`PUT /companies/:id/leave-policy` · `POST /companies/:id/leave-types/defaults` · `POST`/`GET /companies/:id/leave-types` · `PATCH /leave-types/:id` · `POST /leave/accruals/run` · `POST /leave/year-end` · `GET /leave/encashments` |
| Leave | `POST /employees/:id/leave-requests/preview` · `POST`/`GET /employees/:id/leave-requests` · `GET /me/leave-requests` · `GET /leave/requests/:id` · `POST .../cancel` · `POST .../resubmit` · `GET /me/leave-balances` · `GET /employees/:id/leave-balances?asOf=` · `GET`/`POST /employees/:id/leave-ledger` · `GET /leave/team-calendar` |
| Payroll setup | `GET`/`PUT /companies/:id/payroll-settings` · `POST /companies/:id/salary-heads/defaults` · `POST`/`GET /companies/:id/salary-heads` · `POST`/`GET /companies/:id/salary-structures` · `POST`/`GET /employees/:id/salaries` · `POST /salaries/:id/cancel` · `GET`/`PUT /employees/:id/ytd-openings` · `POST /employees/:id/notice` |
| Payroll items | `POST`/`GET /companies/:id/payroll-variables?period=` · `POST /payroll-variables/:id/cancel` · `POST`/`GET /employees/:id/loans` (salary advance, approval) |
| Payroll runs | `POST`/`GET /companies/:id/payroll-runs` · `GET /payroll-runs/:id` · `POST .../calculate` · `GET .../employees/:employeeId` · `POST /payroll-flags/:id/clear` · `POST .../submit` · `POST .../cancel` · `GET .../reproduce` · `GET /employees/:id/payslips` · `GET /me/payslips` · `GET /me/payslips/:runId` |
| Payslip PDF, journal | `GET /me/payslips/:runId/pdf?lang=bn&protect=true` · `GET /payroll-runs/:id/employees/:employeeId/payslip.pdf?lang=` · `GET /payroll-runs/:id/journal.csv` |
| Disbursement | `GET /disbursement-formats` · `GET /payroll-runs/:id/payments` · `POST`/`GET /payroll-runs/:id/disbursement-files` (generate: step-up) · `GET /disbursement-files/:id/download` · `POST .../settle` · `POST .../returns` · `POST .../cancel` (Admin approval) · `POST /payments/:id/reissue` (step-up) |
| Data migration | `GET /imports/templates` · `GET /imports/templates/:entity?format=xlsx\|csv` · `POST /companies/:id/imports` (multipart: file, entity, cutOverDate) · `GET /companies/:id/imports` · `GET /imports/:id` · `POST /imports/:id/rows/:rowNo/skip` · `GET /imports/:id/dry-run` · `POST /imports/:id/commit` · `POST /imports/:id/rollback` · `POST /imports/:id/discard` · `GET /companies/:id/migration/reconciliation?cutOverDate=` · `POST /companies/:id/migration/sign-off` (Admin) · `GET /companies/:id/migration/sign-offs` |
| AI (WP11) | `GET /ai/status` · `POST /ai/assistant` { question, history? } · `POST /ai/interactions/:id/feedback` · `POST /payroll-flags/:id/explanation` · `GET`/`PUT /ai/settings` (Admin) · `GET /ai/usage?month=` (Admin) · `GET /ai/interactions` (Admin, auditor) · `GET`/`POST /ai/policy-documents` · `GET /ai/policy-documents/:id` · `POST /ai/policy-documents/:id/deactivate` (HR, Admin) |
| Consent (WP12) | `GET /me/consents` · `POST /me/consents` { purpose, granted } · `GET`/`POST /employees/:id/consents` (HR, paper form) |
| Gate 1 (WP12) | `GET /parallel-comparisons/template` · `POST /payroll-runs/:id/parallel-comparisons` (multipart: file, tolerance) · `GET /parallel-comparisons/:id` · `POST /parallel-comparisons/:id/lines/:employeeCode/explain` · `POST /parallel-comparisons/:id/accept` (Accounts) · `GET /companies/:id/gate-1` |
| Ledger setup (WP14) | `GET /companies/:id/ledger` · `POST /companies/:id/ledger/setup` { asOf? } · `GET`/`POST /companies/:id/accounts` · `PATCH /accounts/:id` · `GET`/`PUT /companies/:id/posting-accounts` { key, accountId } · `GET`/`POST /companies/:id/fiscal-years` { forDate } · `GET /companies/:id/periods?fiscalYearId=` · `POST /companies/:id/periods/:yyyy-mm/close` |
| Vouchers (WP14) | `GET /companies/:id/vouchers?from=&to=&type=&state=` · `POST /companies/:id/vouchers` { voucherType, voucherDate, narration, lines, isOpening? } · `GET`/`PATCH /vouchers/:id` · `POST /vouchers/:id/submit` · `POST .../cancel` (draft) · `POST .../reverse` { reason, voucherDate? } · `POST /payroll-runs/:id/ledger-posting` · `POST /disbursement-files/:id/ledger-posting` (a skipped automatic posting) |
| Ledger reports (WP14) | `GET /companies/:id/trial-balance?to=&from=` · `GET /accounts/:id/ledger?to=&from=` · `GET /companies/:id/profit-and-loss?to=&from=&departmentId=` · `GET /companies/:id/balance-sheet?asOf=` · `GET /companies/:id/ledger/checks` |
| Vendors (WP15) | `GET /companies/:id/payables-settings` · `PUT` { vatWithholdingEntity, defaultPaymentTermsDays? } · `GET /companies/:id/withholding-categories?date=` · `GET`/`POST /companies/:id/vendors` · `GET`/`PATCH /vendors/:id` · `POST /vendors/:id/bank-accounts` (step-up; approval) · `GET /vendors/:id/statement?to=&from=` |
| Bills, payments (WP15) | `GET`/`POST /companies/:id/vendor-bills` · `GET`/`PATCH /vendor-bills/:id` · `POST .../submit` · `POST .../cancel` · `GET`/`POST /companies/:id/vendor-payments` { vendorId, paymentDate, method, reference?, paidFromAccountId, allocations[] } · `GET /vendor-payments/:id` · `GET /companies/:id/payables/aging?asOf=` |
| Tax at source (WP15) | `GET /companies/:id/tax-withholdings?taxType=&period=&deposited=` · `GET`/`POST /companies/:id/tax-challans` { taxType, period, challanNo, challanDate, paidFromAccountId } · `GET /tax-challans/:id` · `POST /vendors/:id/tax-certificates` { taxType, from, to } · `GET /companies/:id/tax-certificates` · `GET /tax-certificates/:id` |
| Expense claims (WP16) | `GET /companies/:id/expense-categories` · `POST .../expense-categories/defaults` · `POST /companies/:id/expense-categories` · `PATCH /expense-categories/:id` · `GET`/`POST /me/expense-claims` · `GET`/`PATCH /expense-claims/:id` · `POST .../receipts` (multipart file) · `GET .../receipts/:receiptId/file` · `POST .../submit` · `POST .../cancel` · `GET /companies/:id/expense-claims?state=` · `POST /expense-claims/:id/payment` |
| Advances (WP16) | `GET`/`POST /me/expense-advances` · `GET /expense-advances/:id` · `GET /companies/:id/expense-advances` · `POST /expense-advances/:id/payout` · `POST .../refund` · `POST .../recover-from-salary` · `POST /loans/:id/payout` · `GET /companies/:id/employee-advances/balances` · `POST /companies/:id/employee-advances/opening-posting` |
| Monitoring | `GET /health` · `GET /health/ready` · `GET /metrics` (Bearer METRICS_TOKEN) |
| Notifications | `GET /me/notifications?unread=true` · `POST /me/notifications/:id/read` · `POST /me/notifications/read-all` · `GET /notifications/deliveries?status=` (integrations admin) · for n8n only (Authorization: EventToken): `POST /notifications/events/:eventId/claim` · `POST /notifications/:id/result` · `GET /notifications/:id/attachment` |

Rules that apply to every route:
- **Writes.** Every POST/PUT/PATCH/DELETE needs an `Idempotency-Key` header with a new UUID per
  action. Sending the same key again returns the first response, with header
  `Idempotent-Replayed: true`.
- **Updates (PATCH).** Send only the fields that change, plus the `version` from the last GET.
  An outdated version returns 409 `STALE_VERSION`.
- **Errors** look like `{ statusCode, code, message }`, in the user's preferred language (or the one
  sent in the `X-Language: bn|en` header, which wins; the employee app sends it).
- **Permissions** follow spec §4: role × scope (own, department, company or group) × sensitive
  fields. Out of scope returns 403. NID, TIN and account numbers are masked unless you may see
  them.

## Tests

```bash
npm test                    # unit tests, incl. the permission matrix (no database)
npm run test:int            # integration tests against erp_test (migrated automatically)
npm run lint && npm run typecheck
```

The integration tests cover the acceptance criteria of WP0 to WP8, WP10 to WP12 and WP14 to WP16 (WP9 and WP13: `npm run e2e` in ../Frontend/web):
- cross-tenant attacks and RLS on every table; a sweep of **every route** with another tenant's real ids;
- the audit hash chain;
- signed outbox delivery;
- idempotency;
- back-dated history and overlapping periods;
- permissions per role and scope;
- no self-approval;
- SLA escalation in working hours;
- mandatory 2FA and step-up codes;
- unverified rule values refused in production;
- duplicate punches, offline-agent catch-up, and holiday moves recomputing unlocked days;
- leave balances equal to the ledger sum, and cancel restoring the balance;
- payroll: the acceptance cases in `test/payroll-cases/*.yaml` (unit), a past run reproducing
  identical lines, maker-checker (nobody approves two steps), arrears, adjustments, bonus and
  final settlement;
- disbursement: a duplicate payment impossible (database), one active file per channel,
  regenerate only after an approved cancel, returns and re-issue, run "disbursed", payslip PDFs,
  salary journal balancing;
- data migration: row-level validation, skip, dry run, one-transaction commit, rollback blocked
  while records are used, reconciliation totals, sign-off locking the batches;
- notifications: replaying every event (dispatcher retry, admin replay) sends no message twice;
  a failed SMS is retried alone; payslip e-mail with the protected PDF; attendance digest;
  the event callback token only opens its own event;
- AI: the app works with AI off; the release-gate test sets (`test/ai-eval/*.yaml`, Bangla and
  English) meet the pass rate; NID / phone / account numbers never reach the model; the
  assistant sees only the asker's own data and cannot act; time-outs and provider errors fall
  back to the normal screens; quota, feature switches, interaction log, tenant isolation;
- pilot readiness: consent before location / biometric data, retention of personal data,
  readiness and metrics (no tenant data), job-run records, encrypted staging of migration
  rows, security headers, production start-up refusing test settings, Gate 1 parallel payroll
  (differences explained, accepted by a second person, outdated after recalculation);
- general ledger: an unbalanced voucher refused by the database, posted vouchers permanent,
  maker-checker (Tk 10 lakh+ also the Admin), gapless numbers, one reversal per voucher, months
  closing in order and accepting only reversals, one posting per source document, the payroll
  journal equal to the approved run, salaries payable cleared by the settled files, a skipped
  posting listed by the checks and posted later, one opening voucher per company, trial balance /
  P&L / balance sheet agreeing;
- payables and tax at source: the withholding cases in `test/withholding-cases/*.yaml` (unit, ILLUSTRATIVE
  rates), no duplicate vendor bills or vendors, maker-checker on bills, vendor bank accounts and payments,
  no payment above what is owed (database), payment reversal reopening the bill, voiding an unpaid bill,
  one challan per withholding, certificates numbered and issued once, aged payables, the payables account
  equal to the open bills (nightly check), no manual entries on the payables account;
- expense claims and advances: receipts required above the category limit, the same receipt in one claim
  only, Dept Head -> Accounts (-> Admin from Tk 50,000), booking against the cash advance, payment only to
  the employee's approved salary account, paid once (database), cash refund and salary recovery of an
  advance, salary advances paid out before payroll recovers them, the staff advances account equal to the
  sub-ledger (nightly check), the opening posting of migrated advances;
- every route declaring a permission.

## Code map

```
src/
  main.ts / app.module.ts     HTTP server and module wiring
  worker.ts                   background jobs (Nest context, no HTTP)
  config/config.ts            environment variables (validated at startup)
  platform/                   shared building blocks, used by every module
    db/                       DatabaseService (db.tx, db.withTenant), schema types, migrator
    tenancy/                  request context + per-request tenant transaction
    audit/                    AuditService.record(), hash-chain verifier
    outbox/                   OutboxService.add(), dispatcher, webhook signatures
    idempotency/              Idempotency-Key interceptor
    money/  dates/            Money, BDT formatting, amount in words; Dhaka dates, working hours
    crypto/ i18n/ http/       field encryption; bn/en messages; error filter, DTO helpers
    storage/  clock.ts        FileStorage (local disk now, S3 later); Clock (tests can set the time)
  modules/
    identity/                 login, 2FA, tokens, AuthGuard
      access/                 permissions, system roles, AccessGrants (can()), decorators
    users/                    logins, role grants, custom roles, field grants, delegations
    org/                      companies, branches, department tree, designations, grades
    employees/                profiles, job history, onboarding, documents, /me
    approvals/                approval engine: chains, approver resolution, SLA
    bank-accounts/            salary bank / wallet accounts (approval request type)
    system/                   audit log viewer, failed-event replay
    rules/                    rule pack: RulesService.get(key, date), operator tools (rule-pack-admin.ts)
    calendar/                 holiday calendars, "is this a working day?" (attendance + approval SLA)
    attendance/               shifts, punches, daily status (day-status.ts), corrections, overtime, lock
    leave/                    leave types, ledger balances, requests, accrual + year end (leave-rules.ts)
    ledger/                   chart of accounts, fiscal years, vouchers, automatic postings, reports (WP14)
    payables/                 vendors, bills, payments, tax at source (withholding.ts), challans, certificates (WP15)
    expenses/                 expense claims with receipts, cash advances, salary-advance payout, advances sub-ledger (WP16)
    payroll/                  setup, items, salary advances, input builder, runs + approval, payslips (+ PDF), salary journal
    disbursement/             payments, bank / wallet / cash files (adapters.ts), returns, re-issue
    data-import/              migration templates, staging + validation (validators.ts), commit / rollback, reconciliation
    notifications/            who gets which message (templates.ts), exactly-once claim for n8n, in-app inbox, retries
    parallel-run/             Gate 1: old payroll register vs ERP run (compare.ts), explanations, acceptance
    ai/                       AI gateway (masking, quota, log, time limit, release gate; providers: anthropic / fake),
                              read-only assistant + its tools, payroll flag explanations, policy documents, eval
  payroll-engine/             PURE payroll engine (no db / clock): earnings, tax, flags, arrears
  dev/seed.ts                 demo data (npm run db:seed)
  platform/monitoring/        /metrics (http-metrics.ts, monitoring.service.ts), job-runs.ts; platform/retention.ts
  dev/ai-eval.ts              AI release gate: runs test/ai-eval and records the result (npm run ai:eval)
db/migrations/                SQL migrations (forward-only; never edit an applied file)
samples/migration/            sample migration files for the demo company (cut-over 2026-10-01)
samples/policies/             the demo company's handbook (English, Bangla), which the AI assistant answers from
test/ai-eval/                 AI release-gate test sets (YAML)
assets/fonts/                 Noto Sans Bengali (payslip PDFs, OFL licence)
rule-packs/                   statutory rule packs (reviewed JSON, published with npm run rules)
scripts/rules.ts              rule pack operator tool (publish, list, verify, unverify)
scripts/backup.ts             encrypted backup (npm run backup); scripts/restore-drill.ts (npm run restore:drill)
test/integration/             tests against a real PostgreSQL
test/payroll-cases/           payroll acceptance cases (YAML; ILLUSTRATIVE until signed)
```

## How to write a new module

```ts
// controller: route, guard, permission, then one call to the service
// GET /leave/requests/:id
@UseGuards(AuthGuard)
@RequirePermission('leave.view')
@Get('leave/requests/:id')
getLeaveRequest(@Param('id', ParseUUIDPipe) id: string) {
  return this.leaveService.getLeaveRequest(id);
}

// service: find, check the specific record's scope, then work
async getLeaveRequest(id: string) {
  const request = await this.db.tx.selectFrom('leave_requests').selectAll().where('id', '=', id).executeTakeFirst();
  if (!request) throw new NotFoundException(MSG.LEAVE_REQUEST_NOT_FOUND);
  await this.employeeAccess.check('leave.view', request.employee_id);
  return toLeaveRequestResponse(request);
}
```

Statutory numbers always come from the rule pack, never from code:

```ts
const days = await this.rules.getInteger('leave.maternity.days', leaveStartDate);
```

Every state change also calls `this.audit.record(...)`, and every business event calls
`this.outbox.add(...)`. Each new table's migration ends with
`SELECT app_secure_tenant_table('<table>');`.

For anything that needs approval, register a handler and submit:

```ts
this.handlers.register('leave_request', { onApproved: (r) => this.applyLeave(r), onClosed: (r, outcome) => this.closeLeave(r, outcome) });
await this.approvals.submit({ requestType: 'leave_request', sourceId, subjectEmployeeId, companyId, summary, days, snapshot });
```
