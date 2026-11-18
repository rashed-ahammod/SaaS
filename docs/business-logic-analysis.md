# Business Logic Analysis — Corporate ERP + CRM (Bangladesh)

Analysed 12 Nov 2026 from `E:\SaaS`: BUSINESS_LOGIC_SPEC_v0.2, IMPLEMENTATION_GUIDE, backend README, phase-2/3 plans, ADRs 0002–0034, rule pack BD-LABOUR 2026.3.

## 1. What the product is
Multi-tenant SaaS for Bangladeshi corporate head offices (50–1,000 staff): HR, payroll, accounts, procurement, CRM in one system. **Payroll is the anchor**; AI + n8n automation are the paid differentiator. Factories (RMG) out of scope for v1.

- **Revenue:** per-employee/month subscription (Core / Business / Intelligent), implementation fee, on-prem licence + AMC, AI credits, add-ons (SMS, biometric, workflows).
- **Stack:** NestJS modular monolith, PostgreSQL 16 (RLS), worker jobs, Next.js portal + PWA employee app, n8n, AI gateway (Claude/fake/off).

## 2. Core rules (apply everywhere)
1. Core DB is the system of record; n8n only reacts and calls back via API.
2. AI advises, humans decide (never approves/posts/finalizes).
3. Permissions = union of roles × scope (Own / Dept / Company / Group) × sensitive-field grants (salary, bank, NID, complaints).
4. Configure, don't hardcode — statutory values live in a versioned **rule pack**; "verify" values are blocked in production.
5. Maker–checker on money (creator can't approve).
6. Posted = permanent; corrections by reversal with reason.
7. Effective-dated history (salary, designation, dept, manager) → back-dated changes produce arrears.
8. Bangla/English, mobile-first.
9. Tenant isolation enforced by Postgres RLS + cross-tenant tests.

## 3. Org & roles
Tenant → Company (TIN/BIN, books, payroll) → Branch (calendar, shifts, geo-fence) → Department (head, budget, cost centre) → Section.
Roles: System Admin (no salary), Admin (management approvals), HR, Accounts, Dept Head, Employee, + Sales user, Sales head, Auditor (time-limited). Custom roles = copy of a system role. Delegation by date range records both names.

## 4. Approval engine (shared by all modules)
Draft → Submitted → In approval (steps) → Approved → Executed; side exits Returned / Rejected / Cancelled.
Steps resolved by relationship (line manager, Dept Head, role, named user); sequential or parallel; SLA in working hours (reminder 24 h, escalate 48 h). Nobody approves own request.

| Request | Default chain |
|---|---|
| Leave ≤3 days | Line manager (HR notified) |
| Leave >3 days, ML, LWP | Dept Head → HR |
| Attendance correction / OT | Dept Head (max 3 corrections/month) |
| Expense claim | Dept Head → Accounts; ≥ Tk 50,000 → Admin |
| Purchase requisition | Dept Head → Accounts (budget); over budget/threshold → Admin |
| Salary advance / loan | Dept Head → HR → Accounts |
| Payroll run | HR prepares → Accounts verifies → Admin approves → Accounts disburses |
| Payment voucher | Accounts maker → checker; above threshold → Admin |
| Resignation | Dept Head → HR (clearance) → Accounts (settlement) |
| Discount over limit | Sales head → Admin |
| Sales order over credit limit | Accounts |

## 5. Module logic

### Attendance
- Punches append-only (device / mobile / web / correction); days derived by pure function: Present, Late (after start+grace), Half-day, Absent, On leave, Holiday, Weekend, Missing punch.
- Mobile punch: server clock, one approved phone per employee, geo-fence `radius + min(GPS accuracy, 50 m)`, accuracy >100 m refused; refused attempts logged; punch-review flags (same coords, impossible travel, repeated refusals, shared IP).
- OT only for OT-eligible grades, payable only after Dept Head approval.
- Monthly lock; later changes become adjustments paid/charged in next payroll.
- Late penalty (N lates = 1 day) built but **off** pending legal review.
- Holiday move (Eid) auto-recomputes; locked days → adjustments.

### Leave
- Balance = sum of append-only ledger (opening, accrual, taken, reversal, lapse, carry_in, encash, adjustment); never stored.
- Accrual: annual grant (prorated), monthly, or per worked days (EL = 1 per 18 days).
- Defaults: CL, SL (certificate > 2 days), EL (40-day cap, encashable, 1-yr service), ML (120 days, 6 months' service), LWP. Sandwich rule off, 7-day back-date limit, 30% team-absence warning, calendar leave year.
- Year end: encash above cap → payroll, lapse, carry-in.

### Payroll
- Pure, versioned engine; stored inputs + hash → any run is reproducible.
- Order: structure heads prorated by segment → unpaid days (gross ÷ basis 30/26/calendar) → maternity (wage ÷ 26/day) → OT (basic ÷ 208 × hrs × 2), arrears, adjustments, encashment → PF, loans, notice shortfall → income tax by annual projection (exemption = min(income/3, cap), slabs, minimum tax, spread over remaining months) → employer PF / gratuity.
- Structure default: Basic 60% of gross, HRA 50% of basic, Medical 10% of basic.
- Flags (must be cleared with reason): net change > X%, new/missing bank account, zero tax, negative net, notice period, OT over limit, missing punches.
- States: draft → calculated → in_approval → verified → approved; all-or-nothing calculation; locked after approval.
- Then: one bank/wallet file per run (BEFTN/NPSB/bKash/Nagad), payslips, auto salary journal. DB prevents paying an employee twice per period/type.
- Festival bonus ×2/yr (cap one month's basic, after 1 yr), arrears from back-dated increments, final settlement (salary + encashment + gratuity + PF − notice − advances − unreturned assets).

### Employee lifecycle
Draft → onboarding checklist → Active → probation (reminder 15 days before) → confirm/extend/end → changes (effective-dated) → resignation from app → clearance (IT, assets, advances, handover) → final settlement. **No "do not rehire" flag** (law). Confidential complaint channel.
PF fund: interest by trustee rate, withdrawals from own part, vesting <3y 0%, 3–5y 50%, 5y+ 100% (placeholder).

### Finance
Double-entry GL, BD chart of accounts, July–June fiscal year, monthly close, gapless numbering, vouchers (payment/receipt/journal/contra) with maker–checker. Auto-postings (payroll, claims, bills, invoices, depreciation) — one source = one posting. Vendors + VAT/TDS at source, challans & certificates, aged payables; expense claims & advances; procurement (requisition → quotations/comparative → PO → GRN → bill, 3-way match blocks payment); budgets (PO commits, bill actual; warn 80%, Admin at 100%); assets & stock (depreciation, assignment, never-negative stock); bank reconciliation (auto + manual + AI suggestions); VAT/Mushak returns. Nightly checks: sub-ledgers = control accounts, payroll journal = approved payroll.

### CRM / Sales
Leads (manual, web form, Facebook) with BD phone normalisation + duplicate check, auto-assign by territory then round-robin; customers (credit limit, terms); opportunities with stages, weighted forecast = Σ value × probability; targets; products & price lists; quotations with discount limits → approval; orders (credit check) → Mushak 6.3 invoice → receivables; credit notes (6.7), VDS (6.6); collections with allocation, aged receivables, overdue reminders via n8n.

### AI (guardrails)
Same permissions as user, draft-then-confirm, masked sensitive data, protected attributes stripped, reasons for every score, full audit, metered per tenant, works without AI, outside content untrusted, eval gate before release.

### n8n
Outbox written in same transaction → signed webhooks with event ID → retry + dead letter → callbacks via scoped service keys. Workflows built: notifications, bank statement import.

## 6. Build status
| Phase | Status |
|---|---|
| Phase 1 Core HR & payroll (WP0–WP13) | ✅ Built; Gate 1 (2 parallel payrolls per pilot) awaiting pilots |
| Phase 2 Finance (WP14–WP22) | ✅ Built; Gate 2 awaiting a real pilot close |
| Phase 3 CRM & talent | WP23–27 ✅ (customers, leads, pipeline, quotes, invoices, collections); **WP28 Support, WP29 Recruitment, WP30 Performance, WP31 Commissions/automation/sales AI — not built** |
| Phase 4 Intelligence platform | Not started |
| Recent work | Screen-by-screen portal reviews (ADR 0032–0034: People, Time) |

## 7. Gaps & risks before going live
1. **All statutory/tax values are placeholders ("verify")** — needs a labour lawyer + tax adviser; production refuses them until verified.
2. **Payroll acceptance cases are illustrative** — a payroll accountant must sign real cases.
3. **Bank/wallet file formats illustrative** — confirm with each bank.
4. Biometric device adapter, SMS gateway, email provider, AI provider = mocks/undecided.
5. Pen test + hosting open (security checklist).
6. n8n commercial licence needed before customer-built workflows.
7. Pricing and launch segment not decided; no signed pilots (Gate 0).
8. Smaller: maternity two-child rule not checked; partial leave cancellation missing; selfie punch not built; PF vesting tiers placeholder; mobile GPS spoofing can't be detected in a PWA.
9. Open product decisions: commission basis (invoiced vs collected), appraisal scale, CV retention, discount/credit limit defaults, support tickets in v1.
