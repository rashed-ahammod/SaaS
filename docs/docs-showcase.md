# Amar Office — product, pitch and technical documentation

**The document behind `/docs`.** Part I is the pitch, readable in two minutes. Part II is the
technical layer, readable in ten. Part III is the specification for the `/docs` route itself —
the access control, the scheduling window and the admin panel that publish this document.

- **Version:** 1.0 · 20 November 2026
- **Product:** Corporate ERP + CRM portal for Bangladeshi head offices
- **Status:** Phases 1–3 code-complete (WP0–WP31). No pilot has run yet; the three
  acceptance gates are open. Every figure in this document is counted from the repository, and
  everything that is a placeholder is labelled as one.
- **Sources of truth:** `BUSINESS_LOGIC_SPEC_v0.2.md` (business rules), `IMPLEMENTATION_GUIDE.md`
  (technical rules), `docs/adr/` (40 architecture decisions)

> **Read this first.** This document does not claim traction it does not have. The product is
> built and deployed; it has not yet run a real company's payroll. Section 7 says exactly what
> that means and what would change it.

---

# Part I — The pitch

## 1. Problem

A Bangladeshi head office with 50–1,000 staff runs its month on four disconnected systems and one
spreadsheet that holds them together.

- **Payroll is reconstructed by hand every month.** Attendance comes off a biometric device as a
  CSV, leave is approved over WhatsApp, the salary sheet is an Excel file one person owns, and the
  bank file is retyped from it. One mistyped account number is a salary that does not arrive.
- **The law is in someone's head, not in the software.** The Labour Act's leave entitlements, the
  Income Tax Act 2023 slabs and investment rebate, AIT and VAT deducted at source, the July–June
  fiscal year, the Friday–Saturday weekend — imported tools do none of this, and the local tools
  that do are not connected to the accounts.
- **Nothing is auditable.** When a figure is questioned three months later, there is no record of
  who changed what, when, or on whose approval. The spreadsheet has no history.
- **The employee is outside the system.** Attendance queries, leave status and payslips all arrive
  at HR as phone calls, because there is nowhere else to ask.

The cost is not licence fees. It is the three days a month a finance team spends assembling
numbers it already has, and the risk carried by every figure nobody can trace.

## 2. Solution

One system of record for people, time, money and customers, with the Bangladeshi rules built into
it rather than configured around it.

| What it replaces | What the product does |
| --- | --- |
| The attendance CSV and the WhatsApp leave thread | Punches from biometric devices or the phone, geo-fenced, with the leave and overtime requests on the same calendar |
| The salary spreadsheet | A payroll engine that reads effective-dated salary history, attendance, leave and loans and produces the run, the payslips and the bank file |
| The retyped bank file | One file per bank, generated from the approved run, downloadable once by Accounts |
| The accounts kept separately | A ledger that payroll, bills, claims and invoices post into themselves, with maker–checker and period close |
| The lead list in a notebook | CRM from enquiry to invoice to collection, with commissions calculated from the source documents |
| The question asked by phone | A mobile self-service portal in Bangla and English |

Four rules make it trustworthy rather than merely featureful, and they are enforced in the
database, not only in the UI:

1. **Posted means permanent.** An approved voucher, a finalized payroll run and a closed period
   cannot be edited. Corrections are reversal entries with a reason.
2. **Maker–checker on money.** Whoever creates a payment, voucher or payroll run cannot approve it.
3. **Effective-dated history.** Salary, designation, department and reporting-line changes carry a
   date and keep their history, so a back-dated increment pays correct arrears by itself.
4. **AI advises, humans decide.** The assistant drafts, scores, flags and explains. It approves
   nothing, posts nothing, hires nobody and rejects nobody.

## 3. Why now

- **The Income Tax Act 2023 reset every payroll calculation in the country.** Slabs, the investment
  rebate and the withholding rules changed; every spreadsheet built before it is wrong, and the
  companies know it.
- **NBR's digital filing has moved VAT and withholding returns onto deadlines that a spreadsheet
  cannot keep.** Mushak 6.3 and 9.1, the monthly return, the challan, the certificate to the
  vendor — these are now dated obligations with penalties.
- **The devices are already installed.** Biometric attendance terminals are standard in these
  offices. The data exists and goes nowhere.
- **Smartphones reached the staff, not just the managers.** Self-service in Bangla is now
  deliverable to the whole headcount, which is what removes the phone calls from HR.
- **Capable models became an API call.** Reading a policy PDF to answer "how much leave do I have
  left and what does the policy say about carry-forward" is now a feature a small team can ship —
  and the same call is what makes CV screening and a sales assistant affordable.

## 4. Product demo — the five-minute path

The fastest honest demonstration of the system, in order. Each step is a screen in the live app.

1. **An employee punches in on their phone** inside the branch geo-fence, applies for four days'
   leave, and sees the balance the Labour Act gives them (`/attendance`, `/leave/apply`).
2. **Their Department Head approves it** from the inbox; the approval chain routes to the manager's
   manager if they are away (`/approvals`).
3. **HR runs October payroll.** The engine reads the attendance register, the approved leave, the
   effective-dated salary and the open loans; it flags what looks wrong and explains each flag
   (`/portal/payroll`).
4. **Accounts verifies and disburses.** Maker–checker refuses the preparer's own approval; the bank
   file downloads once; payroll posts itself into the ledger (`/portal/payroll`, `/portal/finance`).
5. **The employee opens the payslip** on the same phone, in Bangla, password-protected by their
   employee code (`/payslips`).
6. **The same month in sales:** an enquiry from the public form becomes a lead, a quotation, an
   invoice, a collection, and a commission posted into next month's payroll as a payslip line
   (`/enquiry/demo`, `/portal/crm`, `/portal/sales`).

Every figure on every screen above is produced by the source documents. Nothing is a mock.

## 5. Market opportunity

- **Target customer (v1):** corporate head offices with 50–1,000 staff — IT/ITES, pharma and FMCG
  head offices, trading houses, NGOs and group-of-company headquarters.
- **Deliberately out of scope for v1:** factory floors. RMG wage-board grades, piece rates and
  thousands of workers need a separate compliance package, and pretending otherwise is how these
  products fail.
- **Why this segment:** it is large enough to have a real HR and accounts function, small enough
  that no bespoke system exists, and compliance-exposed enough that correctness is worth paying
  for.
- **Expansion path:** group-of-companies (multi-company is built, not retrofitted) → the private
  and on-premise licence that banks and large groups require → the same compliance package for
  factories.

Market sizing figures are an open item: they will be built from NBR and BIDA company registration
data per sector, not estimated here.

## 6. Business model

| Stream | How it is charged | Why it holds |
| --- | --- | --- |
| Subscription | Per active employee per month, three tiers | Recurring, and grows with the customer's headcount |
| Implementation | One-time: setup, data migration, training | Covers onboarding cost up front |
| Private / on-premise licence | Annual licence + maintenance contract | Large groups and banks require data on their own servers |
| AI usage | A quota per tier, extra credits sold | AI calls have real cost; it is passed through, not absorbed |
| Add-ons | SMS bundles, biometric device integration, custom n8n workflows | High margin once built |

**Tiers**

| Tier | What it includes |
| --- | --- |
| Core | Employee records, attendance, leave, payroll, self-service, approvals |
| Business | Core + ledger, expense claims, procurement, assets, bank reconciliation, VAT, CRM |
| Intelligent | Business + AI assistant, AI analytics, the n8n automation library and custom workflows |

**Why payroll is the anchor:** it is used every month, it is painful to get wrong, and once a
company's salary runs through a system it does not switch. Everything else is sold on top of a
product the customer cannot leave.

BDT price points are an open decision, to be fixed after 10–15 prospect interviews rather than
guessed (spec §13).

## 7. Traction — stated honestly

**What exists.** Phases 1, 2 and 3 are code-complete and deployed live. Counted from the
repository on 20 November 2026:

| | |
| --- | --- |
| Business modules | 34 |
| Database migrations / tables | 48 / 215 |
| API endpoints across 58 controllers | ~616 |
| Permissions, across 8 system roles and 4 scopes | 196 |
| Portal and app screens | 110 |
| Automated test suites (43 integration against a real PostgreSQL, 40 unit, 6 end-to-end) | 89 |
| Architecture decisions recorded | 40 |
| n8n workflows | 4 |

The live deployment runs on free tiers end to end: Next.js on Vercel, the NestJS API on Render
(Singapore), PostgreSQL on Supabase. A full Bangladeshi demo tenant seeds in one command — a group
with companies, branches, departments, staff, a closed September payroll, October's bills, invoices
and half-punched attendance register, a pending leave request and a live sales pipeline.

**What does not exist, and matters.**

- **No pilot has run a real company's payroll.** The three acceptance gates are built but open:
  Gate 1 is two parallel payrolls against a pilot's own figures, Gate 2 is a pilot's first real
  month closed in the system, Gate 3 is a quarter of sales and one appraisal cycle.
- **The payroll acceptance cases are illustrative and the tax values are placeholders** until a
  payroll accountant signs real cases (ADR 0009). The rules are configurable per fiscal year, so
  this is a settings change, not a release.
- **The bank and wallet file layouts are illustrative** until each bank confirms its format
  (ADR 0010).
- **The SMS gateways and the e-mail provider are local mocks** until a pilot's are chosen
  (ADR 0013), and the AI runs on a deterministic fake model unless a provider key is set
  (ADR 0014).
- **The penetration test and the hosting decision are open** on the pre-pilot security checklist
  (`docs/security/checklist.md`).

This is a built product awaiting its first customer, not a product with customers. The engineering
risk is largely retired; the validation risk is entirely open.

## 8. Competition

| | Imported suites (Zoho, Odoo, SAP B1) | Local HRM / payroll tools | Spreadsheets + an accountant | This product |
| --- | --- | --- | --- | --- |
| Bangladeshi payroll and tax rules | Configured, by a consultant | Yes | In someone's head | Built in, per fiscal year, as settings |
| VAT / Mushak and withholding at source | Partly, via add-ons | Rarely | Manual | Built in |
| HR, accounts, procurement and CRM in one system of record | Yes | No — HR only | No | Yes |
| Bangla UI, mobile self-service | Partial | Sometimes | — | Both languages, mobile-first |
| Audit trail that survives a question | Yes | Weak | None | Hash-chained, tamper-evident |
| AI assistant and automation | Being added, at enterprise price | No | — | In the top tier |
| Multi-company / group | Yes, expensively | No | No | Built in from the first migration |
| On-premise option | Rarely | Sometimes | — | Licensed |

**The honest version:** the imported suites are more mature and will stay so. They lose on local
compliance, on price, and on the time it takes a consultant to make them fit. The local tools win
on compliance but stop at HR, so the accounts stay separate — which is where the month's work
actually is.

## 9. Unique advantage

1. **Compliance as data, not as code.** Leave rules, salary heads, tax slabs, VAT rates, holidays,
   approval chains and numbering formats are versioned rule packs per fiscal year. When a law
   changes, a rule value changes and the history stays intact. Competitors ship a release.
2. **Correctness enforced one layer below the application.** Tenant isolation is PostgreSQL
   row-level security that fails closed; append-only tables reject UPDATE and DELETE in the
   database; the audit log is a SHA-256 chain, so an edited row breaks it. A bug in the API cannot
   quietly cross a tenant boundary or rewrite history.
3. **One path to every number.** A commission becomes a payslip line through payroll, not through a
   second mechanism; cancelling the run cancels it. There is no second way to produce any figure,
   which is what makes the figures reconcilable.
4. **AI that is safe to switch on in an HR system.** Every call goes through a gateway that masks
   identifying fields, enforces a quota and a time limit, logs the interaction, and is held behind
   a release gate with a test set. CV screening never sees a name, gender, religion, age, photo or
   contact detail. The assistant sees only the asker's own records.
5. **Built for the deployment these customers actually have:** one small instance, a free or cheap
   tier, intermittent connectivity, a phone as the employee's only device.

## 10. Go-to-market

1. **One pilot, run properly.** A 100–300 staff head office, two months of parallel payroll against
   their own figures (Gate 1), their first real month closed in the system (Gate 2). The pilot pays
   the implementation fee and is the reference.
2. **Sell on the gate, not the demo.** "Two months of your payroll, calculated alongside your own,
   figure by figure" is a sales motion no spreadsheet survives.
3. **Channel: the accountants and the device vendors.** The firms that already file these companies'
   returns, and the vendors who install the biometric terminals, each reach the buyer before we do.
4. **Land on payroll, expand into finance and CRM.** The tier structure is the expansion path, and
   the modules are already built.
5. **Groups, then on-premise.** A group-of-companies customer buys several companies at once;
   banks and large groups buy the licence.

## 11. Team

> **Fill this in before publishing.** This table is a template: the `/docs` team grid takes a name,
> the role each person holds **in this application**, an e-mail address they have chosen to publish,
> and a square photo. Photos render in a uniform frame; a member with no photo gets an initials
> avatar, so the grid stays even. Do not publish an address or a photo without the person's consent —
> this page is public while the window is open.

**Team name:** _to be filled in_

| Name | Role in the application | E-mail | Photo |
| --- | --- | --- | --- |
| _Full name_ | _e.g. Payroll engine, rule packs, Gate 1 comparison_ | _name@example.com_ | _square, 512×512_ |
| _Full name_ | _e.g. Portal screens, self-service PWA, Bangla text_ | _name@example.com_ | _square, 512×512_ |
| _Full name_ | _e.g. Ledger, VAT and compliance, period close_ | _name@example.com_ | _square, 512×512_ |

## 12. Vision

**Three years:** the system of record for the Bangladeshi corporate middle market — the place a
head office's month happens, with the compliance package extended to factory floors and the group
and on-premise editions carrying the large accounts.

**The longer bet:** a company's operations are a long sequence of small, rule-bound decisions —
this leave balance, this deduction, this approval, this follow-up. The rules are already data here,
and every decision already leaves an auditable record. That makes it possible to automate the
routine ones and leave the judgement to people, in a system where every automatic step can be
explained and reversed. Starting from payroll is what earns the right to try: it is the one
process a company will not let anyone get wrong.

---

# Part II — Technical documentation

## A. Product overview

A multi-tenant SaaS portal that runs HR, payroll, accounts, procurement and CRM for a Bangladeshi
corporate office in one system, with AI and n8n automation as the paid differentiator.

**Three audiences, three surfaces:**

| Surface | Who | What it is |
| --- | --- | --- |
| `/` (the app) | Every employee | Mobile-first PWA: attendance, leave, payslips, claims, requisitions, approvals, assistant |
| `/portal` | HR, Accounts, Admin, Dept Heads | Desktop portal: 110 screens across People, Time, Payroll, Finance, Sales/CRM and Administration |
| `/enquiry/<form>`, `/docs` | The public | A lead-capture form the company shares; this document, while its window is open |

**Core use cases:** run a correct monthly payroll from attendance and leave; keep a ledger that
payroll, bills, claims and invoices post into themselves; close a period that cannot then be
edited; take an enquiry through to a collected invoice and a paid commission; hire, appraise and
offboard a person without retyping their data.

## B. Feature matrix

Delivered in work packages (WP), each with an architecture decision record. `✓` is code-complete
with tests; the gates are acceptance by a pilot, which has not happened.

| # | Area | State | ADR |
| --- | --- | --- | --- |
| WP0 | Foundations: tenancy, RLS, audit chain, idempotency, migrations | ✓ | 0001–0004 |
| WP1 | Organization tree and employee records, effective-dated history | ✓ | |
| WP2 | Roles, scopes, field grants, approval engine, service keys | ✓ | 0006–0007 |
| WP3 | Rule packs: versioned compliance values per fiscal year | ✓ | 0008 |
| WP4 | Attendance: devices, punches, geo-fence, shifts, overtime | ✓ | 0005 |
| WP5 | Leave: entitlements, balances, encashment | ✓ | |
| WP6 | Payroll engine: salary heads, tax, PF, loans, flags | ✓ · cases illustrative | 0009 |
| WP7 | Disbursement: bank files, payslip PDFs | ✓ · layouts illustrative | 0010 |
| WP8 | Data migration: import batches, validation, sign-off | ✓ | |
| WP9 | Self-service PWA, Bangla and English, offline-tolerant | ✓ | |
| WP10 | Notifications through n8n (e-mail, SMS) | ✓ · providers mocked | 0013 |
| WP11 | AI phase 1: gateway, assistant, flag explanations | ✓ · fake model by default | 0014 |
| WP12 | Pilot readiness, security checklist, runbooks, **Gate 1** | ✓ / gate open | 0015 |
| WP13 | HR & Admin portal | ✓ | |
| WP14 | General ledger: vouchers, maker–checker, period close, reports | ✓ | 0017 |
| WP15 | Vendors, bills, tax and VAT at source, challans, certificates | ✓ · rates placeholder | 0018 |
| WP16 | Expense claims, advances, salary advances | ✓ | 0019 |
| WP17–WP19 | Procurement, budgets, assets and stock | ✓ | 0020–0022 |
| WP20–WP21 | Bank reconciliation, VAT and the compliance calendar | ✓ | 0023–0024 |
| WP22 | Finance portal and reports, **Gate 2** | ✓ / gate open | 0025 |
| WP23–WP24 | Customers, leads, opportunities, pipeline, targets | ✓ | 0026–0027 |
| WP25–WP27 | Quotations, orders, invoices, collections, reminders | ✓ | 0028 |
| WP28 | Support tickets with an SLA in working hours | ✓ · hours placeholder | 0035 |
| WP29 | Recruitment: plan, openings, applicants, interviews, offers, hiring | ✓ | 0036 |
| WP30 | Performance: cycles, KPIs, calibration, increment proposals | ✓ | 0037 |
| WP31 | Commissions, sales assistant, document expiry alerts, **Gate 3** | ✓ / gate open | 0038 |

**Upcoming (no plan written yet — Phase 4 is not scoped):** the factory compliance package,
the on-premise distribution, deeper analytics, and whatever the first pilot proves is missing.

**On the `/docs` page this matrix is live:** module, migration, table, endpoint and screen counts
are read from the running system rather than typed into the page (Part III, section 3).

## C. Architecture

```
                         Browser (phone or desktop)
                                   │
                    ┌──────────────┴───────────────┐
                    │  Next.js 16 (Vercel)         │   React 19 · Tailwind 4
                    │  · PWA, service worker       │   Bangla / English
                    │  · route handlers /api/*      │   session in an httpOnly cookie
                    └──────────────┬───────────────┘
                   Authorization: Bearer <token>, added server-side
                                   │
                    ┌──────────────┴───────────────┐
                    │  NestJS 12 API (Render)      │
                    │  AuthGuard → permissions     │   34 modules, ~616 endpoints
                    │  TenantTransactionInterceptor│   one transaction per request
                    │  IdempotencyInterceptor      │   every write needs a key
                    │  ThrottlerGuard              │   300 req/min per IP
                    └──────────────┬───────────────┘
                                   │ SET LOCAL app.tenant_id
                    ┌──────────────┴───────────────┐
                    │  PostgreSQL (Supabase)       │
                    │  row-level security, forced  │   215 tables, 48 migrations
                    │  append-only audit chain     │   erp_app has no BYPASSRLS
                    └──────────────────────────────┘
                     │                │            │
              S3 / MinIO        n8n workflows   AI gateway
              (documents,       (notifications, (masking, quota,
               payslips)         lead capture,   log, release gate)
                                 kits)              │
                                              Anthropic API
                                              (or a deterministic fake)
```

**The decisions that shape it**

- **One transaction per request, scoped to one tenant.** `TenantTransactionInterceptor` opens it
  and runs `set_config('app.tenant_id', …, true)`; the handler, its audit entry and its outbox
  event commit together or not at all. A pooled connection cannot carry one tenant's setting into
  another request.
- **The API role is not privileged.** `erp_app` is neither the table owner nor `BYPASSRLS`, so
  row-level security applies to every query it makes. `app_current_tenant_id()` returns NULL when
  unset, which matches no rows — the failure mode is "no data", never "all data".
- **The browser never holds a token.** The access token lives in an httpOnly, SameSite=Strict
  cookie; the Next.js route handlers read it and add the `Authorization` header. A page cannot
  choose its own token, and a cross-site form cannot post as the user (`x-erp-client` is required).
- **Background jobs run inside the API process** (`RUN_JOBS_IN_API=true`), because the free hosting
  tier has no worker instance. The same code runs as a separate worker where there is one.
- **Modules own their tables.** A module reads another's data through its service, not its tables.

## D. Data flow

The monthly payroll run, which is the flow every other one resembles:

```
  INPUT                 PROCESSING                   AI (advisory)          OUTPUT
  ─────                 ──────────                   ─────────────          ──────
  biometric punches ─┐
  phone punches      ├─► attendance days ──┐
  approved leave  ───┘   (shifts, holidays,│
                          geo-fence)       │
                                           ├─► payroll run ──► flags ──► explanation
  effective-dated salary ──────────────────┤   (heads, tax,     │        (why this row
  loans, advances ─────────────────────────┤    PF, arrears)    │         looks wrong)
  rule pack (slabs, rates, per FY) ────────┘                    │              │
                                                                ▼              ▼
                                                        HR reviews ◄──── a human decides
                                                                │
                                              maker ≠ checker   ▼
                                                        Accounts verifies
                                                                │
                                   ┌────────────────────────────┼────────────────────┐
                                   ▼                            ▼                    ▼
                            bank file (once)            payslip PDFs          ledger vouchers
                                   │                            │                    │
                                   ▼                            ▼                    ▼
                            salary paid              employee's phone        trial balance,
                                   │                            │            P&L, nightly checks
                                   └──────────► FEEDBACK ◄──────┘
                                        a query becomes a correction with
                                        a reason, an audit entry and, if the
                                        period is closed, a reversal — never
                                        an edit of what was posted
```

Every arrow is a recorded transition. Nothing in the diagram is reachable by editing a row.

## E. Technology stack

| Layer | Choice | Why this one |
| --- | --- | --- |
| Frontend | Next.js 16.4, React 19.3, Tailwind 4, TypeScript 5 | Server components for the first paint on a slow connection; a PWA so the employee app survives a dropped network |
| API | NestJS 12, Express, TypeScript (ESM) | Guards, interceptors and DI map exactly onto "permission, tenant transaction, idempotency" as cross-cutting concerns |
| Database access | Kysely 0.29 | Typed SQL, no ORM magic; the schema is 215 hand-written tables, not generated |
| Database | PostgreSQL (Supabase) | Row-level security is the isolation guarantee, and it belongs in the database |
| Money | decimal.js | No float arithmetic anywhere near a salary or a tax figure |
| Auth | argon2id, `@nestjs/jwt`, otplib (TOTP) | Mandatory 2FA for privileged roles, step-up codes for high-risk actions |
| Files | `@aws-sdk/client-s3` → S3, R2 or MinIO; local disk for one instance | On-premise customers get MinIO without a code change |
| Documents | pdfkit (payslips, offer letters), exceljs (imports, reports) | Bangla-capable PDFs; spreadsheets in and out, because that is what the customer has |
| Validation | class-validator at the edge, zod inside | Every DTO is validated before it reaches a service |
| AI | `@anthropic-ai/sdk` behind an internal gateway, or a deterministic fake | The provider is replaceable and the default is off |
| Automation | n8n (4 workflows) | Notifications, lead capture, onboarding/offboarding kits — reacting to events, never holding truth |
| Hosting | Vercel (web) · Render Singapore (API + jobs) · Supabase (database) | Live on free tiers; the nearest region to Bangladesh |
| Tests | Vitest (43 integration suites against a real PostgreSQL, 40 unit), Playwright (6 e2e) | The integration suite runs the whole application on a pinned clock |

## F. API documentation

**Shape.** ~616 REST endpoints across 58 controllers. JSON in, JSON out; `snake_case` in the
database, `camelCase` on the wire. Errors carry a stable `code`, and the message is resolved into
the caller's language from one table — there is no hardcoded user-facing text.

**Authentication.** Three callers, three mechanisms:

| Caller | Header | Checked by |
| --- | --- | --- |
| A signed-in user | `Authorization: Bearer <access token>` | `AuthGuard` |
| A machine (device agent, n8n) | `Authorization: ServiceKey <keyId>.<secret>` | `ServiceKeyGuard`, limited to the key's permissions and company |
| An n8n callback | A signed callback token | `EventTokenGuard` |

**What `AuthGuard` checks, in order:** a valid token → the login is still active → privileged roles
(Admin, System Admin, HR, Accounts) signed in with 2FA → the permission named by
`@RequirePermission` → a fresh TOTP code in `X-OTP-Code` on `@RequireStepUp` routes. It then loads
the caller's roles and scopes for the services, which check the specific record.

**Conventions every route follows**

- **Every write needs an `Idempotency-Key`.** A double tap or a retry after a lost response cannot
  do the same thing twice.
- **Every route declares who may call it.** An integration test walks every controller and fails
  the build if a route has neither a guard nor a declared permission. The public routes are an
  explicit allow-list of four: login, 2FA verify, and the two health checks.
- **Optimistic locking on editable records.** A stale `version` is rejected rather than merged.
- **Rate limiting:** 300 requests per minute per IP by default, stricter on login.

**Representative endpoints**

```
POST /auth/login                       POST /companies/:id/payroll-runs
GET  /me/leave-balances                POST /payroll-runs/:id/verify      (maker ≠ checker)
POST /me/punches/mobile                POST /payroll-runs/:id/bank-file   (step-up 2FA)
GET  /me/payslips/:runId               POST /companies/:id/vouchers
GET  /approvals/inbox                  POST /companies/:id/leads/capture  (service key)
POST /approvals/:id/approve            GET  /companies/:id/vat/returns
GET  /audit-log?entity=&from=&to=      GET  /health  ·  GET /health/ready  ·  GET /metrics
```

**Exposed to the public, deliberately:** `GET /health`, `GET /health/ready`, the lead-capture
endpoint behind a scoped service key, and — while its window is open — the `/docs` read described
in Part III. `GET /metrics` serves Prometheus text behind a bearer token.

**Outgoing.** Events leave through a transactional outbox with signed webhooks, retries and a
dead-letter list an admin can replay. n8n consumes them and calls back through the API; it never
writes to the database.

## G. Data layer

- **Where data comes from:** typed in by HR, Accounts and employees; punched by biometric devices
  through a service key; imported from spreadsheets through the migration module (batch → row
  validation → sign-off, with nothing applied until signed); captured from the public enquiry form;
  uploaded as documents and receipt photos. **No scraping anywhere.**
- **Storage:** PostgreSQL for everything transactional; S3-compatible object storage for documents,
  receipts, payslips and photos, under keys this code constructs (`<tenantId>/<folder>/<uuid>`) and
  never from user input.
- **Isolation:** every table with a `tenant_id` is registered with `app_secure_tenant_table()`,
  which forces row-level security and grants the API role only what it needs. An integration test
  fails the build if a table is missed, and a cross-tenant sweep tries to read across the boundary
  from every endpoint.
- **History:** effective-dated records for anything that changes over time, append-only tables for
  anything posted, and a hash-chained audit log for everything else.
- **Privacy:** sensitive fields (NID, bank account, 2FA secret) are encrypted per tenant at the
  field level. Sensitive field *groups* need an explicit grant on top of a role — Admin does not
  see salary data by default, so an IT administrator is not a payroll viewer. Applicant data
  carries consent and a retention date, and retention removes expired personal data from the
  bucket as well as the database.
- **Outside content is data, never instruction.** What an enquirer, a customer or a candidate wrote
  is stored and displayed as text and is never acted on — a rule the AI layer enforces again.

## H. AI layer

**Provider.** `@anthropic-ai/sdk` behind an internal gateway, selected by configuration:
`anthropic`, `fake` (a deterministic model, the default in development and CI) or `off` (every AI
feature reports itself unavailable and nothing else changes).

**What the gateway does on every call, without exception:** masks identifying fields → enforces the
tenant's quota → enforces a time limit → logs the interaction → checks the release gate for that
feature. No module calls a model directly.

**Features**

| Feature | What it sees | What it may do |
| --- | --- | --- |
| Policy and balance assistant | The asker's own records, and the company's policy documents chunked for retrieval | Answer and quote the policy. Read-only |
| Payroll flag explanations | One flagged row | Explain in plain language why it looks wrong |
| CV screening | A CV with the name, gender, religion, age, photo and contact details **removed** | Score against the opening's criteria, with reasons |
| Sales assistant | Only the asker's own leads, and no contact details | Score a lead with reasons, suggest the next step, draft a follow-up or quotation, summarise a call note |
| Review drafting | A year of feedback notes on one person | Draft the manager's comment. It rates nobody |

**Retrieval, not a knowledge graph.** Policy documents are chunked and retrieved per tenant
(`ai_policy_documents`, `ai_policy_chunks`); the tenant boundary is the same RLS boundary as
everything else, so one company's policy can never answer another's question. There is no GraphRAG
and no cross-tenant model training — the honest description is retrieval over the asker's own
tenant.

**Explainability and the hard limit.** Every AI output carries its reasons, and every interaction
is logged and attributable. The limit is a product rule, not a configuration: **AI never approves a
request, posts a voucher, finalizes payroll, hires or rejects.** Each feature has a test set
(`backend/test/ai-eval/*.yaml`) and is held behind a release gate that the eval script writes.

## I. Performance and scalability

**Today's load.** One pilot-sized tenant: 100–1,000 employees, a payroll run once a month, a few
hundred portal users, a monthly peak on payroll day and the first days of VAT filing.

**What is already true**

- One transaction per request, held for the request only; routes that wait on a slow outside
  service (AI) are marked `@ShortTransactions()` so they never hold a connection while waiting.
- Partial indexes written for the exact queries the jobs run, not indexes added afterwards.
- Payroll is computed per employee and streamed into the run, so a large month does not build one
  enormous object.
- `decimal.js` arithmetic and set-based SQL for the reconciliation checks that run nightly.
- The free tier is designed around: the API spins down after 15 minutes idle, so the pages that
  call it tolerate a ~60-second cold start instead of showing a false failure.
- Server components and a service worker keep the employee app usable on a slow or dropped
  connection.

**What scaling out needs, in order:** S3 instead of local disk (already abstracted, one
configuration change), the jobs moved back out into their own worker (the code already runs both
ways), connection pooling sized per role (already separate), then read replicas for reporting. None
of these is a rewrite, which is the point of having separated them now.

**Not yet measured.** There is no load test and no latency budget on record. Those belong with the
first pilot's real data, and claiming numbers before then would be inventing them.

## J. Security

| Concern | How it is handled |
| --- | --- |
| Passwords | argon2id, with lockout after repeated failures |
| Two-factor | TOTP, **mandatory** for Admin, System Admin, HR and Accounts; a code is single-use (the last time-step is stored) |
| High-risk actions | Step-up: a fresh code in `X-OTP-Code` for bank-account changes, bank files and role grants, inside an already signed-in session |
| Trusted devices | "Remember this device" is an httpOnly cookie the page itself cannot read |
| Sessions | httpOnly, SameSite=Strict cookie; the browser never holds the access token |
| CSRF | Our own pages send `x-erp-client`; a cross-site form cannot set it |
| Authorization | Role × scope × field sensitivity. 196 permissions, 8 system roles, 4 scopes, plus per-field grants. Checked in the API layer, then again on the specific record by the service |
| Tenant isolation | Forced row-level security on every tenant table, an API role without `BYPASSRLS`, fail-closed when unset, and a cross-tenant sweep in CI |
| Tamper evidence | The audit log is a SHA-256 chain per tenant; editing or deleting any row breaks it, and a verifier checks it |
| Immutability | Posted vouchers, finalized payroll, closed periods and the revision history reject UPDATE and DELETE in the database |
| Secrets at rest | NID, bank accounts and 2FA secrets are field-encrypted per tenant |
| Machine access | Service keys are per tenant, per company and per permission, hashed at rest, revocable |
| Abuse | 300 req/min per IP, stricter on login; the public form is rate-limited per address and has a spam check |
| Open | Penetration test and the hosting decision (`docs/security/checklist.md`) |

## K. Analytics

**For the customer, inside the product:** the portal's dashboard and reports — headcount and
attrition, attendance and overtime, leave liability, payroll cost by department, the trial balance,
P&L and balance sheet, aged payables and receivables, pipeline and target attainment, SLA breaches,
and the compliance calendar with what is due when.

**For operating the system:** `GET /metrics` serves Prometheus text (HTTP metrics, job runs); the
job-run table records every scheduled run, its outcome and its duration; the outbox dead-letter
list surfaces every event that gave up; nightly reconciliation checks prove the sub-ledgers equal
their control accounts and raise it when they do not.

**The KPIs that matter for the business, once a pilot exists:** payroll runs completed without a
correction, time from "attendance closed" to "salary paid", corrections per run, the share of
employees using self-service, and days-to-close for a period. None of them can be reported yet,
because no real month has been run.

## L. Changelog

| Date | Version | What changed |
| --- | --- | --- |
| 2026-11-20 | 1.0 | This document, and the `/docs` showcase specified in Part III |
| 2026-11-19 | — | Gate 2 given its own screen in Finance and Gate 3 moved to Sales/CRM; walking every screen as every role found four real faults (a one-render "loaded" state, three lists refusing Dept Heads their own departments, two detail screens typed wrongly). The demo clock pinned to 29 October 2026 (ADR 0039, 0040) |
| 2026-11 | — | The API now handles SIGTERM, so a deploy or a free-tier spin-down ends cleanly instead of in a kill |
| 2026-11 | — | Public landing page at `/landing` |
| 2026-10 | Phase 3 | WP23–WP31: customers and leads, pipeline, quotations to collections, support, recruitment, performance, commissions and the sales assistant (ADR 0026–0038) |
| 2026-09 | Phase 2 | WP14–WP22: ledger, vendors and withholding, claims, procurement, budgets, assets, bank reconciliation, VAT and the finance portal (ADR 0017–0025) |
| 2026-08 | Phase 1 | WP0–WP13: foundations, organization, roles and approvals, rule packs, attendance, leave, payroll, disbursement, migration, the employee PWA, notifications, AI phase 1 and the admin portal |

## M. Contributors

The team table in Part I, section 11 is the same list the `/docs` page renders as its team grid —
one source, so the deck and the appendix cannot disagree. Add contributors there.

---

# Part III — The `/docs` route: specification

What follows is the design for publishing this document at `{app_base_url}/docs`, with the
admin-controlled window the showcase needs. **It is a specification, not a built feature** — no
code for it exists yet.

## 1. Access control and scheduling

The requirement that makes this a product feature rather than a static page: an admin decides
whether `/docs` is public at all, and for which window.

**Three things decide it, in this order.**

1. **The master switch** (`is_enabled`). Off means closed to everyone, whatever the dates say. This
   is the panic button, and it must be one click.
2. **`opens_at`** — before it, the page says "opens on 10 June" rather than "not found". NULL means
   open from the moment the switch goes on.
3. **`closes_at`** — at and after it, the page is closed. NULL means no end, so only the switch
   closes it.

**Default window:** 10 June 00:00 → 14 June 23:59, **Asia/Dhaka**, in the next June that has not
finished — seeded once, the admin's to change from then on. Asia/Dhaka has had no daylight saving
since 2010, so the offset is a constant +06:00 and no timezone library is needed; the database
keeps absolute time and the admin screen shows Dhaka time, because that is the clock the people
presenting are on.

**Also offered:** a duration form ("publish for the next 4 hours"), which opens the window now and
closes it after the duration — a judging slot without typing two dates.

**What a closed page answers.** `403` with a page that says *why* (not yet / closed / switched off)
and, when it is "not yet", the date it opens. It must not 404, because a judge with the link needs
to know they have the right URL, and it must not reveal whether the workspace exists.

**The clock.** The check reads the `Clock` service, so the pinned demo clock (ADR 0040) moves the
window with the rest of the demo story rather than fighting it.

**Who may change it.** A new `docs.manage` permission, granted to Admin and System Admin only, and
every change recorded in the audit log — opening a public page is exactly the kind of action that
needs to be attributable afterwards.

## 2. Content model

Four tables, and one decision worth stating: **the page's text lives in the database, not in the
repository**, because the window is opened and the deck reworded by whoever is presenting, on the
day, with no deploy.

| Table | What it holds |
| --- | --- |
| `docs_settings` | One row per tenant: the switch, the window, the headline, tagline and team name, and whether export and the live figures are shown |
| `docs_sections` | The page, one row per section, in order. Each row holds **both** the text the public sees (`published_body`) and the admin's unpublished work (`draft_body`), so an edit is never live until it is published — even mid-judging |
| `docs_section_revisions` | Append-only: the text each publish replaced, so a bad edit during a window goes back in one click. `UPDATE` and `DELETE` are rejected by the database, as on the audit log |
| `docs_team_members` | Name, role in the application, published e-mail, photo key, order |

The text this document contains ships in code and is written into those rows the first time an
admin opens the screen, so `/docs` is complete before anyone has typed anything. A shipped section
can be reset to the product's text; a section the admin added is theirs to delete. A section's
`key` is its URL anchor (`/docs#problem`), stable across edits and reorderings.

## 3. Live data

The claim "trust the data as real" is only earned if the figures are read from the running system.
The page's live block is computed server-side and cached briefly:

- module, migration, table, endpoint, screen, permission and test-suite counts;
- the feature matrix's state per work package;
- aggregate tenant activity: companies, active users, employees on record, payroll runs completed,
  vouchers posted, invoices raised.

**Aggregate counts only.** This is a public page, so no name, no amount attributable to a person,
no customer, and nothing identifying ever appears in it — a constraint the implementation must
state at the top of the file that computes it.

## 4. Admin panel

At `/portal/docs`, behind `docs.manage`:

- **The window:** the switch, start and end in Dhaka time, the duration presets, and a line that
  says in words what a visitor sees right now.
- **The sections:** reorder, show/hide, edit, save draft, publish, reset to shipped text, and
  revision history with restore. Editing is Markdown with a formatting toolbar and a live preview,
  rendered by a small in-repo renderer into React nodes — not raw HTML, so a section cannot inject
  script, and no editor dependency is added to a zero-budget deployment.
- **The team grid:** add, reorder, hide, and upload a photo. The browser crops and resizes to a
  square before upload, so every card is identical without an image library on the server, and a
  member with no photo gets an initials avatar.

## 5. The public page

- **Routing:** `/docs`, let through the session proxy like `/landing` and `/enquiry`. The backend
  read is public and resolves the workspace server-side, so no visitor needs a URL parameter.
- **Layout:** the deck first, the technical layer second, the appendix last; a sticky section nav
  with scroll-spy, anchor links on every heading, and a search box (Ctrl-K) over section titles,
  summaries and body text.
- **Diagrams:** hand-authored inline SVG, legible in both light and dark themes, with no diagram
  library to load — the architecture and data-flow diagrams in Part II are the content.
- **Export:** a Markdown download assembled from the published sections, and a print stylesheet so
  "Save as PDF" produces a clean document. Both honour the `allow_export` setting. The shareable
  link is the page itself.
- **SEO:** indexable while open, `noindex` while closed.
- **Performance:** server-rendered, the heavy sections lazy-loaded, the response cached for a short
  window, and the whole page usable on a phone at 16px gutters.

## 6. Success criteria

| Who | Must be able to |
| --- | --- |
| A visitor | Understand the product in two minutes (Part I), evaluate the system in ten (Part II), see that the figures are live, and navigate without scrolling blindly |
| An admin | Turn the page on and off in one click, schedule a window in Dhaka time, edit any section without a deploy, publish or keep a draft, and put back yesterday's text |

---

## Appendix — where to check every claim

| Claim | Where it is verifiable |
| --- | --- |
| Business rules, roles, tiers, revenue streams | `BUSINESS_LOGIC_SPEC_v0.2.md` |
| Technical rules and conventions | `IMPLEMENTATION_GUIDE.md` |
| Every architecture decision, with its reasoning | `docs/adr/0001`–`0040` |
| What is built, and what is a placeholder | `backend/README.md` |
| Tenant isolation, audit chain, immutability | `backend/db/migrations/0001_platform_helpers.sql`, `0002_tenants_and_users.sql` |
| Every route declares who may call it | `backend/test/integration/route-permissions.int-spec.ts` |
| No tenant table is missing RLS | `backend/test/integration/rls-coverage.int-spec.ts` |
| Cross-tenant reads are refused | `backend/test/integration/cross-tenant-sweep.int-spec.ts` |
| AI limits and their test sets | `backend/src/modules/ai/`, `backend/test/ai-eval/*.yaml` |
| Security posture and open items | `docs/security/checklist.md` |
| Operating the system | `docs/operations/runbooks/` |
| The demo, and the day it is told on | `backend/src/dev/seed.ts`, `docs/adr/0040` |
