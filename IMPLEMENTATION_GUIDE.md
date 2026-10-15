# Implementation Guide — Corporate ERP + CRM Portal (Bangladesh)

**Version:** 1.0 (implementation start: Phase 0 and Phase 1)
**Date:** 13 October 2026
**Source of business logic:** Business Logic Specification v0.2
(https://claude.ai/code/artifact/bfb9f51f-9edf-47da-95c3-2d5074c22bf1)

> **Precedence rule.** The specification decides *what* the system does (business rules).
> This guide decides *how* it is built (technical rules). If they conflict, the specification
> wins and this guide must be corrected. Section references like "spec §6.4" point to the specification.

---

## 0. How to use this guide

1. Read sections 1–6 before writing any code. They hold the rules every module must follow.
2. Build in the order given in section 24 (work packages). Do not start a work package until the
   previous one meets its acceptance criteria.
3. Every work package ends with the Definition of Done in section 25.
4. If you use an AI coding agent (e.g. Claude Code), give it this file and the specification, and
   follow section 26.

---

## 1. Assumed decisions (defaults until the owner decides otherwise)

The specification lists open decisions (spec §13). Development starts with these defaults. Each is
chosen so that changing it later is cheap.

| Open decision | Default used for building | Why this default is safe |
| --- | --- | --- |
| Who is "Admin" | Two roles: **Admin** (management approvals) and **System Admin** (settings, no salary access) | Merging two roles later is easy; splitting one later is not |
| Multi-company groups | Schema supports many companies per tenant; UI exposes one company in Phase 1 | No migration needed when groups are switched on |
| Deployment | SaaS first; everything runs in Docker so on-premise is possible later | Same images for both |
| n8n licence | n8n used **only internally** for prebuilt workflows; no customer-built workflows in Phase 1 | Avoids the embed-licence question until Phase 4 |
| Leave year | Calendar year, configurable per company | Setting, not code |
| Late-arrival penalty | Feature built, **switched off by default** | Pending legal review |
| Migration sources | Excel/CSV templates only | Direct importers added per demand |
| CRM | Not in Phase 1 | Per roadmap |
| AI provider | Behind the AI gateway; provider chosen in Phase 0 | Provider can change without touching modules |
| Recovery targets | Working assumption until decided: daily full backup + continuous WAL archiving | Final RPO/RTO set in Phase 0 |

---

## 2. Technology stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript everywhere (Node.js LTS) | One language for backend, frontend and n8n custom nodes; small team |
| Backend | NestJS, as a **modular monolith** | Clear module boundaries, dependency injection, guards for permissions; one database transaction across modules for money |
| Database | PostgreSQL 16+ | Row-level security (tenant isolation), strong transactions, NUMERIC money type, JSONB |
| Query layer | Kysely (or Drizzle) with SQL migrations | Works cleanly with per-transaction `SET LOCAL`; no ORM magic around money |
| Background jobs | Redis + BullMQ | Payroll runs, imports, outbox dispatch, SLA timers |
| Web frontend | Next.js (React) + Tailwind + shadcn/ui | Fast admin screens; server components for reports |
| Employee app (Phase 1) | Progressive Web App (PWA) | Works on mid-range Android without app-store work; native app only if pilots need it |
| Files | S3-compatible storage (MinIO for on-premise) | Payslips, documents, imports |
| Automation | n8n, self-hosted in Docker, own database | Spec §9 |
| AI | Internal **AI gateway** service calling the chosen model provider | Spec §8 |
| Observability | OpenTelemetry, Sentry (errors), Prometheus + Grafana (metrics), uptime checks | Spec §11 monitoring |
| CI/CD | GitHub Actions, Docker images, staging + production environments | Spec §11 security testing |

**Not chosen on purpose:** microservices (too much operational cost for the team size and they
break single-transaction money flows), NoSQL as the main store (weak for ledgers and payroll).

---

## 3. Architecture

```
            Web app (Next.js)            Employee PWA
                    \                       /
                     \                     /
                 +-----------------------------+
                 |  API (NestJS) + auth guard  |  <- every request: user or scoped service key
                 +-----------------------------+
                 |  Modules (same process):    |
                 |  org, identity, approvals,  |
                 |  attendance, leave, payroll,|
                 |  disbursement, audit,       |
                 |  rulepack, migration, notify|
                 +-------------+---------------+
                               |
              PostgreSQL (RLS, outbox, audit log)      Redis/BullMQ (jobs)
                               |
                  outbox dispatcher (worker)
                               |  signed webhooks
                             n8n  ---> email / SMS / WhatsApp
                               |  callbacks with idempotency key
                               +----> API (same permission checks)

   API ---> AI gateway ---> model provider          Biometric sync agent ---> API
```

**Module rules**

- A module owns its tables. Other modules call its service interface, never its tables directly.
- Modules talk synchronously through service calls inside one transaction, or asynchronously
  through domain events written to the outbox.
- No module calls n8n or the AI provider directly: n8n is reached only through the outbox,
  the AI provider only through the AI gateway.

---

## 4. Repository layout

```
E:\SaaS\
  IMPLEMENTATION_GUIDE.md
  apps/
    api/                 NestJS application (all modules)
      src/modules/
        org/  identity/  approvals/  attendance/  leave/  payroll/
        disbursement/  audit/  rulepack/  migration/  notify/  ai/
      src/platform/      tenancy, db, outbox, idempotency, money, dates, i18n
    web/                 Next.js admin and manager web app
    pwa/                 Employee self-service PWA (may live inside web/ as a route group)
    worker/              BullMQ workers (payroll, imports, outbox, SLA)
    ai-gateway/          AI gateway service
    biometric-agent/     Small sync agent installed on office network
  packages/
    shared-types/        DTOs and event schemas shared by apps
    payroll-engine/      Pure calculation library (no I/O)
    ui/                  Shared UI components
  db/
    migrations/          Ordered SQL migrations
    seeds/               Dev seed data (fake companies only)
  n8n/
    workflows/           Exported prebuilt workflows (JSON), version-controlled
  tests/
    payroll-cases/       Golden payroll acceptance cases (YAML)
    tenancy/             Cross-tenant attack tests
    e2e/                 Playwright end-to-end tests
  infra/
    docker-compose.yml   Local development stack
    deploy/              Staging and production deployment files
  docs/
    adr/                 Architecture decision records
```

---

## 5. Non-negotiable engineering rules

These come from spec §2 and §11. Code review rejects any change that breaks them.

1. **Money is never a floating-point number.** Database: `NUMERIC(18,2)`. Code: a decimal
   library (e.g. decimal.js) wrapped in a `Money` type. Rounding happens only at defined points
   with the company's rounding rule.
2. **Every table has `tenant_id`** and row-level security (section 6). No exceptions, including
   lookup tables owned by a tenant.
3. **Posted data is never updated.** Finalized payroll, approved payments and posted journals are
   corrected only by new reversal records with a reason.
4. **History is effective-dated.** Salary, assignment, grade and manager changes are new rows with
   `effective_from`; nothing is overwritten.
5. **Every state change writes an audit entry** in the same transaction (section 14).
6. **Every business event is written to the outbox** in the same transaction as the change
   (section 15).
7. **Every write endpoint accepts an `Idempotency-Key` header**; repeating a key returns the first
   result.
8. **Permission checks happen in the API layer, not the UI.** Hiding a button is not security.
9. **No one approves their own request**, enforced in the approval engine, not just the UI.
10. **Dates:** timestamps stored as `timestamptz` in UTC; business dates (attendance day, leave day,
    payroll period) stored as `date` in the `Asia/Dhaka` calendar.
11. **Secrets never in code or git.** Use environment variables from a secret store.
12. **Statutory values are never hardcoded.** They come from the rule pack (section 18).

---

## 6. Multi-tenancy and data access

**Approach:** shared database, shared schema, `tenant_id` on every row, enforced by PostgreSQL
row-level security (RLS). The application connects as a role **without** `BYPASSRLS` and is not
the table owner.

```sql
-- Applied to EVERY tenant-owned table by a migration helper
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON employees
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

**Per request:**

1. Auth guard resolves the user and their tenant.
2. The request runs inside one transaction that begins with
   `SET LOCAL app.tenant_id = '<tenant uuid>'` (and `app.user_id` for audit).
3. If `app.tenant_id` is not set, queries return no rows (fail closed).

**Platform operator access** (support staff) uses a separate, audited break-glass role with
time-limited access approved by the tenant. It is never the default connection.

**Migration check:** a CI test lists every table and fails if any tenant-owned table lacks RLS
and the policy.

---

## 7. Data model — Phase 1

Columns shown are the important ones; every table also has `id uuid`, `tenant_id`,
`created_at`, `created_by`, and (where editable) `updated_at`, `version` for optimistic locking.

### 7.1 Organization (spec §3)

| Table | Key columns / rules |
| --- | --- |
| `tenants` | name, plan_tier, status, data_region |
| `companies` | legal_name, tin, bin, fiscal_year_start (default 07-01), base_currency (BDT) |
| `branches` | company_id, name, weekend_days (e.g. `{FRI}` or `{FRI,SAT}`), holiday_calendar_id, geo_fence (lat, lng, radius_m) |
| `departments` | company_id, parent_id, name, head_employee_id, cost_centre_code; hierarchy stored as closure table `department_paths(ancestor_id, descendant_id, depth)` for fast scope checks |
| `designations`, `grades` | name, grade has `ot_eligible`, salary band |

### 7.2 Identity and access (spec §4)

| Table | Key columns / rules |
| --- | --- |
| `users` | email, phone, password_hash (argon2id), mfa_secret (encrypted), status, preferred_language (`bn`/`en`), employee_id (nullable) |
| `roles` | name, is_system (default roles cannot be edited, only copied) |
| `role_permissions` | role_id, permission_key (e.g. `leave.request.approve`) |
| `user_roles` | user_id, role_id, scope_type (`own`/`department`/`company`/`group`), scope_id |
| `field_grants` | user_id, field_group (`salary`, `bank`, `identity`, `complaint`) |
| `delegations` | from_user_id, to_user_id, permission_keys[], starts_on, ends_on |
| `service_keys` | tenant-scoped API keys for n8n and agents; hashed; allowed endpoints list |

### 7.3 Employees (spec §6.1)

| Table | Key columns / rules |
| --- | --- |
| `employees` | employee_code (unique per company), names (bn/en), dob, gender, nid (encrypted), tin (encrypted), join_date, status (`draft`/`probation`/`active`/`notice`/`separated`), `festival_group` |
| `employee_assignments` | employee_id, effective_from, effective_to, company_id, branch_id, department_id, designation_id, grade_id, line_manager_id, functional_manager_id — **no overlapping periods** (exclusion constraint) |
| `employee_bank_accounts` | employee_id, kind (`bank`/`wallet`), details (encrypted), status (`pending`/`approved`/`retired`), approved_by, effective_from_period |
| `employee_documents` | employee_id, doc_type, file_key, expires_on |
| `onboarding_checklists` | employee_id, item, done_at, done_by |

```sql
-- No overlapping assignment periods per employee
ALTER TABLE employee_assignments ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (employee_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&);
```

### 7.4 Approvals (spec §5)

| Table | Key columns / rules |
| --- | --- |
| `approval_chains` | request_type, conditions (JSON rule), priority, active |
| `approval_chain_steps` | chain_id, step_no, approver_rule (`line_manager`/`dept_head`/`role:<key>`/`user:<id>`), mode (`sequential`/`any`/`all`), sla_hours |
| `approval_requests` | request_type, source_id, requester_id, chain_id, current_step, state, amount, submitted_at |
| `approval_actions` | request_id, step_no, actor_id, on_behalf_of (delegation), action, comment, ip, device, snapshot (JSON of key values at that moment) |

### 7.5 Attendance (spec §6.2)

| Table | Key columns / rules |
| --- | --- |
| `holiday_calendars`, `holidays` | date, name, type (`public`/`festival`/`company`), editable at short notice |
| `shifts` | start_time, end_time, grace_minutes, half_day_minutes, crosses_midnight |
| `shift_assignments` | employee_id, shift_id, effective_from, effective_to; plus `shift_overrides` (e.g. Ramadan) by date range and branch |
| `attendance_punches` | employee_id, punched_at, source (`device`/`mobile`/`web`), device_id, location, raw_ref — **raw, never edited**; unique on (employee_id, punched_at, source, device_id) to drop duplicates |
| `attendance_days` | employee_id, date, status, first_in, last_out, late_minutes, ot_minutes, locked — **computed** from punches + leave + holidays |
| `attendance_corrections` | employee_id, date, requested_in/out, reason, approval_request_id |
| `attendance_locks` | company_id, period, locked_at, locked_by |

### 7.6 Leave (spec §6.3) — ledger design

Balances are **never stored as an editable number**. They are the sum of a ledger.

| Table | Key columns / rules |
| --- | --- |
| `leave_types` | code, name (bn/en), paid, encashable, carry_cap_days, doc_rule, eligibility (JSON), rule_ref (link to rule pack value) |
| `leave_ledger` | employee_id, leave_type_id, entry_date, kind (`opening`/`accrual`/`taken`/`reversal`/`lapse`/`carry_in`/`encash`), days (signed NUMERIC(6,2)), source_type, source_id |
| `leave_requests` | employee_id, leave_type_id, from_date, to_date, half_day, days_counted, reason, approval_request_id, state |

Balance = `SUM(days)` from the ledger up to a date. An approved request writes a `taken` entry;
a cancellation writes a `reversal`. Year-end processing writes `lapse`, `carry_in` and `encash`.

### 7.7 Payroll (spec §6.4)

| Table | Key columns / rules |
| --- | --- |
| `salary_heads` | code, name, kind (`earning`/`deduction`/`employer_cost`), taxable, formula_ref |
| `salary_structures` | name, rules (e.g. basic = 60% of gross; house rent = 50% of basic) — versioned |
| `employee_salaries` | employee_id, effective_from, gross, structure_id, overrides (JSON) |
| `payroll_periods` | company_id, year, month, state (`open`/`locked`) |
| `payroll_variables` | period_id, employee_id, head_code, amount, source (`overtime`/`arrear`/`bonus`/`loan`/`manual`), approval_request_id |
| `loans` / `loan_installments` | principal, schedule, recovered |
| `tax_years` / `tax_rules` | fiscal_year (e.g. 2026-27), slabs, exemptions, rebates — from the rule pack |
| `payroll_runs` | period_id, run_type (`regular`/`bonus`/`final_settlement`/`arrear`), state (`draft`/`calculated`/`verified`/`approved`/`disbursed`/`cancelled`), input_hash, engine_version |
| `payroll_lines` | run_id, employee_id, head_code, amount, explanation (JSON trace) |
| `payroll_flags` | run_id, employee_id, flag_code, message, cleared_by, clear_reason |
| `payments` | run_id, employee_id, period_id, pay_type, amount, channel, status (`approved`/`in_file`/`paid`/`returned`/`reissued`) |
| `disbursement_files` | run_id, channel, bank_code, file_key, checksum, state (`active`/`cancelled`), cancelled_reason |

```sql
-- An employee can be paid once per period per pay type (spec §11)
CREATE UNIQUE INDEX one_payment_per_period ON payments
  (tenant_id, employee_id, period_id, pay_type)
  WHERE status IN ('approved', 'in_file', 'paid');

-- One active disbursement file per run and channel
CREATE UNIQUE INDEX one_active_file ON disbursement_files
  (tenant_id, run_id, channel) WHERE state = 'active';
```

### 7.8 Platform tables

| Table | Purpose |
| --- | --- |
| `outbox_events` | id, type, payload, created_at, status, attempts, next_attempt_at, last_error |
| `idempotency_keys` | key, endpoint, request_hash, response, created_at (kept ≥ 7 days) |
| `audit_log` | seq (per tenant), occurred_at, actor, action, entity, entity_id, before, after, ip, device, prev_hash, hash |
| `rule_values` | rule_key, value, effective_from, effective_to, source_url, verified_by, verified_at, status (`verify`/`verified`) |
| `import_batches` / `import_rows` | migration staging, validation errors, state |
| `notifications` | in-app notifications and delivery status |
| `ai_interactions` | user, feature, model, prompt_version, input_ref, output, human_action |

---

## 8. Identity, roles and permissions

**Login:** email or phone + password (argon2id). Two-factor (TOTP app or SMS OTP) mandatory for
Admin, System Admin, HR and Accounts. Use maintained libraries; never write crypto by hand.

**Step-up OTP** (spec §11) is required again, even within a session, for:
changing a salary bank/wallet account, changing vendor bank details, generating a disbursement
file, and granting or changing roles.

**Authorization check** (one function used everywhere):

```
can(user, permissionKey, resource) =
  any role of user (or active delegation to user) that
    has permissionKey
    AND resource is inside the role's scope:
        own        -> resource.employee_id == user.employee_id
        department -> resource.department_id is a descendant of scope_id (closure table)
        company    -> resource.company_id == scope_id
        group      -> resource.tenant_id == user.tenant_id
  AND (if resource has sensitive fields) user holds the field grant
```

- Sensitive fields are removed from API responses (not just hidden in UI) unless the field grant
  is held. Masked format example: `**** **** 4417`.
- Default roles from spec §4 are seeded as `is_system = true`. Custom roles are created by copying.
- Write the permission matrix from spec §4 as a seed file **and** as an automated test that checks
  each role/capability cell.

---

## 9. Approval engine (spec §5)

Implement as one generic module used by every request type.

**State machine**

```
draft -> submitted -> in_approval(step n) -> approved -> executed
           |                 |                    
           |                 +-> returned -> draft
           |                 +-> rejected (final, reason required)
           +-> cancelled (requester, only before final approval)
```

**Rules**

1. On submit, pick the first matching chain by `priority` and `conditions`
   (amount, days, department, grade, budget status).
2. Resolve each step's approver **when the step becomes active**, from the current org data.
   If the position is vacant or the approver is the requester, move up to that person's manager.
3. If an active delegation exists, the delegate can act; both names are recorded.
4. SLA timers count **working hours** using the branch's weekend and holiday calendar.
   Reminder at 50% of SLA, escalation at 100% (defaults: 24 h / 48 h).
5. Each action stores a snapshot of the key values (amount, dates) so later edits cannot change
   what was approved. Editing a request after submit returns it to `draft`.
6. Final approval calls the owning module's `execute()` (e.g. leave writes ledger entries) inside
   the same transaction, then writes `approval.completed` to the outbox.
7. Approvals from email links open the app; the decision is valid only when the API records it.

---

## 10. Attendance (spec §6.2)

1. **Ingest:** punches arrive from the biometric agent, mobile PWA (with location and optional
   selfie) or web. Store raw in `attendance_punches`; duplicates dropped by the unique key.
2. **Biometric sync agent** (runs on the office network): pulls punches from devices on a
   schedule, buffers locally when offline, sends batches with an idempotency key, reports device
   clock drift. Confirm the first supported device brands in Phase 0.
3. **Mobile punch:** reject if outside the branch geo-fence (configurable tolerance) or if the
   device is not registered to the employee.
4. **Daily computation job** (after shift end + buffer): build `attendance_days` from punches,
   shifts, overrides, holidays, weekends and approved leave. Statuses per spec §6.2.
5. **Recompute** a day whenever a correction is approved, leave changes, or a holiday moves
   (e.g. Eid date changes after moon sighting). Locked days are not recomputed; the difference
   becomes an adjustment in the next payroll.
6. **Overtime** only for OT-eligible grades and only after Dept Head approval.
7. **Monthly lock** by HR before payroll; writes `attendance_locks`.

---

## 11. Leave (spec §6.3)

1. **Apply:** validate eligibility, balance (ledger sum), overlap with other leave, back-dated
   limit, half-day rule and the company's sandwich-rule setting. Calculate `days_counted`
   excluding holidays and weekends as configured.
2. **Team calendar warning** to the approver when the department's absence on any day exceeds
   the configured share.
3. **Approval** via the approval engine; `execute()` writes `taken` ledger entries.
4. **Accrual job** (monthly or per worked days, per leave type rule) writes `accrual` entries.
5. **Year-end job** writes `lapse`, `carry_in` (up to cap) and `encash` (creates a payroll variable).
6. **Maternity leave** uses the rule pack (120 days, eligibility, pay = monthly wage ÷ 26 per day;
   spec §7) and creates the matching payroll variables.

---

## 12. Payroll engine (spec §6.4)

### 12.1 Design

- `packages/payroll-engine` is a **pure library**: no database, no network, no clock.
  Input = an employee snapshot + rule values + period variables. Output = payroll lines, each with
  an explanation trace (which rule and which inputs produced it).
- The engine version and a hash of all inputs are stored on every run so any past payroll can be
  re-calculated and compared.
- Calculation runs as a background job per run, in chunks, and is **all-or-nothing**: a failure
  leaves the run in `draft` with no partial lines.

### 12.2 Calculation order (per employee)

1. Load effective assignment, salary and structure for the period (handle mid-month changes by
   splitting the month into segments).
2. Earnings by head from the structure; proration for joiners and leavers.
3. Unpaid-day deduction from locked attendance and leave (basis per company setting).
4. Variables: overtime, arrears, bonuses, encashment, manual items.
5. Deductions: employee PF, loan instalments, other deductions.
6. Income tax withheld: project annual taxable income for the fiscal year (year-to-date actuals +
   remaining months + known bonuses), apply the fiscal year's slabs, exemptions and rebates from
   the rule pack, subtract tax already withheld, spread the balance over remaining months.
7. Employer costs: employer PF, gratuity provision.
8. Rounding per company rule; net pay.

### 12.3 Validation flags (before approval)

Rule-based flags first (AI explanations are added on top, never instead):
net pay change above the configured %, new or changed bank account this period, zero tax on
taxable income, negative net, missing bank account, employee in `notice` status, OT above limit.
Every flag must be cleared with a reason before the run can be approved.

### 12.4 Run states and approvals

`draft -> calculated -> verified (Accounts) -> approved (Admin) -> disbursed`.
HR prepares; the user who prepares cannot verify or approve (maker–checker). After `approved`
the run is locked; corrections go into an `arrear` or adjustment run next period.

### 12.5 Accounting hand-off

On approval, write `payroll.approved` to the outbox. In Phase 1 (before the accounts module) also
produce a **salary journal export** (CSV) per cost centre. In Phase 2 the journal is posted
automatically with a unique `(source_type, source_id)` so it can never post twice.

### 12.6 Acceptance cases

The cases in spec §6.4 live in `tests/payroll-cases/*.yaml`, each with inputs and expected lines,
prepared and signed by a payroll accountant. They run in CI on every change.

```yaml
# tests/payroll-cases/joiner-mid-month.yaml (shape only; values set by the payroll accountant)
case: joiner mid-month
period: 2026-11
employee:
  join_date: 2026-11-16
  gross: <amount>
  structure: <structure code>
attendance: { unpaid_days: 0 }
expected:
  lines:
    - { head: BASIC, amount: <expected> }
    - { head: HOUSE_RENT, amount: <expected> }
  net: <expected>
```

---

## 13. Disbursement and payslips

1. After approval, create one `payments` row per employee per pay type (unique index blocks
   duplicates).
2. Generate the disbursement file per channel using a **bank adapter** (one adapter per bank or
   wallet format). Store the checksum. Requires step-up OTP.
3. Regenerating requires cancelling the active file with a reason and a second approval.
4. Import bank/wallet return files: mark rejected payments `returned`; re-issue creates a new
   payment row linked to the original.
5. Payslips: PDF per employee in Bangla or English, optionally password-protected; published to
   self-service and announced via the outbox (`payroll.disbursed`).
6. Test each bank's file format with that bank before the first live payroll.

---

## 14. Audit log

- Written in the same transaction as the change, by a shared `audit.record()` call (never by
  hand-written inserts in modules).
- Tamper evidence: per tenant, `hash = SHA-256(prev_hash || canonical_json(entry))`.
  A nightly job re-computes the chain and alerts on any break.
- The application role can only `INSERT` into `audit_log` (no `UPDATE`/`DELETE` grants).
- Exports of salary or personal data are audited and the file is watermarked with the exporter.

---

## 15. Events, outbox and n8n (spec §9)

**Outbox write** (inside the business transaction):

```ts
await outbox.add(tx, {
  type: 'leave.approved',
  tenantId, entityId: request.id,
  payload: { employeeId, from, to, days }, // no salary or identity numbers in payloads
});
```

**Dispatcher worker**

1. Reads pending events in order, sends each to the n8n webhook URL for that event type.
2. Signs the request: header `X-Signature = HMAC-SHA256(secret, timestamp + "." + body)` and
   `X-Timestamp`; n8n rejects old timestamps (replay protection) and bad signatures.
3. Retries with exponential back-off; after the maximum attempts, status `dead`, visible to
   System Admin with a replay button. Alert when dead events grow.

**n8n rules**

- Every workflow starts by verifying the signature and checking the event ID has not been
  processed (n8n data table or Redis key).
- n8n writes back only through the API with a tenant service key and an `Idempotency-Key`.
- Disable code-execution and shell nodes in n8n configuration (e.g. the `NODES_EXCLUDE`
  setting — confirm the exact option for the n8n version deployed).
- Workflows are exported to `n8n/workflows/` and reviewed like code.
- Phase 1 workflows: approval nudges, payslip delivery, daily attendance digest.

---

## 16. AI gateway — Phase 1 scope (spec §8)

Phase 1 ships only two low-risk features:

1. **Read-only policy and balance assistant** (Bangla and English).
   - Policy answers from the tenant's own uploaded policy documents (retrieval limited to that
     tenant).
   - Balance and payslip questions answered by calling the core API **with the user's own token**
     (the assistant has no wider access than the user).
   - No actions in Phase 1 (no draft creation yet).
2. **Payroll pre-check explanations:** plain-language explanation of each rule-based flag.

**Gateway responsibilities:** mask NID, bank and tax numbers before any call; enforce per-tenant
quota and log usage; record every interaction in `ai_interactions`; time out gracefully so the
app works without AI; treat content from documents, CVs and emails as data, never instructions.

**Release gate:** a fixed test set of policy questions (Bangla and English) with expected answers;
the feature is enabled for pilots only after it meets the agreed pass rate.

---

## 17. Data migration tool (spec §10)

1. Downloadable Excel templates per entity: employees, assignments, salaries, leave opening
   balances, year-to-date salary/tax/PF, loans, bank accounts.
2. Upload → staging tables (`import_rows`) → validation with row-level errors (missing fields,
   unknown departments, invalid NID/TIN formats, duplicates, totals).
3. **Dry run** shows what will be created, with totals per department.
4. Commit in one transaction per batch; batch can be rolled back until signed off.
5. **Reconciliation report** (headcount, gross by department, leave balances, YTD tax and PF
   totals) is signed by the customer before go-live.
6. Opening values are written as normal records (`opening` leave ledger entries, YTD tax records)
   so all later logic treats them the same way.

---

## 18. Compliance rule pack (spec §7)

- Every statutory or tax value is a row in `rule_values` with `effective_from`, `source_url`
  (official gazette or NBR document), `verified_by`, `verified_at` and `status`.
- Code reads values by key and date: `rules.get('leave.maternity.days', onDate)`.
- A value with status `verify` **cannot** be used for a live tenant (the getter throws in
  production mode); it can be used in development and tests.
- Rule pack versions are published centrally; each tenant accepts a version with an effective date.
- Seed the pack from spec §7, all marked `verify` until the compliance owner signs them off.

---

## 19. Localization

- UI strings in `bn` and `en` from day one (no hardcoded text). User chooses language.
- Number formatting: `Intl.NumberFormat('en-IN')` gives lakh/crore grouping (12,34,567.00);
  `'bn-BD'` gives Bangla digits. Amount-in-words helper for both languages (payslips, cheques).
- Names stored in both scripts where provided; search works for both.
- Timezone `Asia/Dhaka`; week start and weekend per branch.
- PDF templates embed a Bangla font that renders conjunct characters correctly; test with real
  names.

---

## 20. Security checklist (must be true before the first pilot)

- [ ] RLS on every tenant table; cross-tenant test suite passing (section 21).
- [ ] App database role has no superuser, no `BYPASSRLS`, no `UPDATE/DELETE` on `audit_log`.
- [ ] Two-factor for privileged roles; step-up OTP on the four high-risk actions.
- [ ] Field-level encryption for NID, TIN, bank details, complaint records; keys in a secret store.
- [ ] TLS everywhere; data encrypted at rest; backups encrypted.
- [ ] Login rate limiting and lockout; session timeout.
- [ ] Dependency scanning and static analysis in CI; no high-severity findings open.
- [ ] External penetration test completed and findings fixed.
- [ ] n8n code/shell nodes disabled; n8n admin not exposed to the internet.
- [ ] Consent captured for biometric and selfie data.

---

## 21. Testing strategy

| Test type | What it covers | When it runs |
| --- | --- | --- |
| Unit | Payroll engine, leave ledger, tax projection, money and rounding, permission function | Every commit |
| Payroll acceptance cases | Golden cases from spec §6.4 (section 12.6) | Every commit; release blocker |
| Permission matrix | Each role × capability cell from spec §4 | Every commit |
| Cross-tenant attacks | Two seeded tenants; every endpoint, report, export and AI call tries to read/write the other tenant | Every commit; release blocker |
| Integration | API + real PostgreSQL (containers): approvals, attendance, leave, payroll run, idempotency, outbox | Every pull request |
| Duplicate protection | Re-submit same idempotency key; double-click approve; retry payroll job; regenerate bank file | Every pull request |
| End-to-end | Playwright: employee applies leave → manager approves → payroll reflects it | Nightly |
| Load | Payroll run for 1,000 employees; month-end attendance computation | Before each release |
| Restore drill | Restore production backup into a scratch environment and verify | Monthly |

Test data is always synthetic. Never copy a customer's real data into development.

---

## 22. Environments, CI/CD and operations

- **Environments:** local (Docker Compose), staging (production-like, synthetic data),
  production. Pilots run in production with their own tenants.
- **CI pipeline:** lint → type-check → unit + acceptance tests → integration tests → security
  scans → build images → deploy to staging → smoke tests → manual approval → production.
- **Database migrations:** forward-only, backward-compatible (expand, migrate, contract); run
  automatically before the new version starts.
- **Backups:** daily full backup + continuous WAL archiving (point-in-time recovery); copies
  stored in a second location; encrypted.
- **Monitoring and alerts:** error rate, API latency, job failures (payroll, imports, outbox),
  dead-letter count, nightly reconciliation and audit-chain mismatches, disk and database health.
- **Incident basics:** on-call contact list, status message to tenants, post-incident review.

---

## 23. Phase 0 — tasks before Phase 1 code (spec §12)

Phase 0 is mainly business work; engineering supports it.

1. Customer interviews and willingness-to-pay checks (owner: founder/product).
2. Clickable prototype of the Phase 1 screens (employee PWA: punch, leave, payslip; manager:
   approvals; HR: payroll run) and usability tests on mid-range Android phones.
3. Sign 2–3 pilot companies; collect their current payroll registers, leave policies, salary
   structures and bank/device details (with their consent, stored securely).
4. Decide the open items blocking Phase 1: AI provider, first banks/wallets, first biometric
   device brands, SMS gateway, recovery targets, compliance owner.
5. Compliance owner verifies the Phase 1 rule values (leave, maternity, festival holidays,
   overtime, festival bonus, income tax for the current fiscal year).
6. Engineering in parallel: repository, CI, local stack, ADRs for this guide's key choices.

**Gate 0:** pilots signed and prototype passes usability tests → start Phase 1.

---

## 24. Phase 1 work packages (build in this order)

| WP | Scope | Acceptance criteria |
| --- | --- | --- |
| WP0 Foundations | Repo, CI, Docker stack, tenancy + RLS helper, auth + 2FA, audit log with hash chain, outbox + dispatcher, idempotency middleware, money/date utilities, i18n skeleton | Cross-tenant test harness running; audit chain verified by job; outbox delivers to a test webhook with signature |
| WP1 Organization and employees | Companies, branches, departments (closure table), designations, grades, employee profile, effective-dated assignments, documents, onboarding checklist | Back-dated transfer shows correct history; no overlapping assignments possible |
| WP2 Roles, permissions, approvals | Seeded roles, permission matrix, scopes, field grants, delegation, approval engine with SLA timers | Permission matrix tests pass; self-approval impossible; SLA escalation fires on working hours |
| WP3 Rule pack | `rule_values`, getter, verification states, seed from spec §7 | Unverified value blocks production use |
| WP4 Attendance | Shifts, overrides, holidays, punches, mobile geo-fence, daily computation, corrections, monthly lock, biometric agent (first brand) | Moving a holiday recomputes unlocked days; duplicate punches ignored; offline agent catches up |
| WP5 Leave | Leave types, ledger, apply/approve/cancel, accrual and year-end jobs, team calendar warning | Balances always equal ledger sum; cancel restores balance |
| WP6 Payroll engine | Pure engine, runs, variables, loans, tax projection, flags, maker–checker states | All payroll acceptance cases pass; re-calculation of a past run reproduces identical lines |
| WP7 Disbursement and payslips | Payments, unique constraints, bank adapters (first banks), return-file import, Bangla/English payslip PDFs, salary journal export | Duplicate payment impossible in tests; bank test file accepted by the pilot's bank |
| WP8 Data migration | Templates, staging, validation, dry run, commit/rollback, reconciliation report | Pilot data imported and reconciliation signed |
| WP9 Self-service PWA | Punch, leave apply/status, balances, payslips, profile contact edit, approvals inbox for managers | Usability test tasks completed by pilot employees on their phones |
| WP10 Notifications via n8n | Approval nudges, payslip delivery, attendance digest; SMS gateway with fallback | Replayed events do not send duplicate messages |
| WP11 AI (Phase 1) | AI gateway, read-only assistant, payroll flag explanations, usage metering | Test-set pass rate met; app works with AI switched off |
| WP12 Pilot readiness | Security checklist (section 20), penetration test, restore drill, monitoring, runbooks | Checklist complete; **Gate 1** begins: two parallel payrolls per pilot |

---

## 25. Definition of Done (every work package and pull request)

- [ ] Business behaviour matches the specification section it implements (reference it in the PR).
- [ ] Tenant isolation: new tables have RLS; cross-tenant tests extended and passing.
- [ ] Permissions enforced in the API and covered by tests.
- [ ] State changes write audit entries; business events write to the outbox.
- [ ] Write endpoints idempotent.
- [ ] Money uses the `Money` type; no floats.
- [ ] UI text in Bangla and English.
- [ ] Unit and integration tests added; payroll acceptance cases still pass.
- [ ] No new high-severity security findings.
- [ ] Migration is backward-compatible.
- [ ] Docs updated (ADR if a technical decision changed).

---

## 26. Instructions for AI coding agents

When using an AI coding agent (e.g. Claude Code) on this repository:

1. Give it this guide and the specification at the start of every session.
2. Work **one work package (or smaller) at a time**; ask it to propose a plan first and review the
   plan before code is written.
3. Require it to follow section 5 rules and the Definition of Done; ask it to list which rules
   the change touches.
4. Payroll, tax, leave balances and permissions: a human reviews every line, and the acceptance
   cases are written or approved by a payroll accountant, not generated by the agent.
5. Never give the agent production credentials or real customer data.
6. Keep architecture decisions in `docs/adr/`; the agent must not change the stack or module
   boundaries without a new ADR approved by the tech lead.

---

## 27. Still open (owner decisions needed)

These do not block WP0–WP3 but must be settled before the work package named.

| Decision | Needed before |
| --- | --- |
| AI provider and data-residency stance | WP11 |
| First banks and mobile wallets | WP7 |
| First biometric device brands | WP4 |
| SMS gateway (primary and fallback) | WP10 |
| Recovery targets (data loss / downtime) per tier | WP12 |
| Compliance owner and verified Phase 1 rule values | WP6 |
| Final Admin/System Admin split confirmed | WP2 |
