# Corporate ERP + CRM Portal (Bangladesh) — Business Logic Specification v0.2

**Version:** 0.2 · 13 October 2026
**Live copy (editable, with diagrams):** https://claude.ai/code/artifact/bfb9f51f-9edf-47da-95c3-2d5074c22bf1
**Companion document:** IMPLEMENTATION_GUIDE.md (same folder)

> This file is an exported copy. The live doc is the master; if they differ, the live doc wins.
> The two diagrams in the live doc are shown here as text versions.

## 1. Product vision, market and profit model

The product is a multi-tenant SaaS portal that runs HR, payroll, accounts, procurement and CRM for a Bangladeshi corporate office in one system, with AI and n8n automation as the paid differentiator. Payroll is the anchor: it is used every month, it is painful to get wrong, and once a company's salary runs through a system it rarely switches.

**Target customer (v1):** corporate head offices with 50–1,000 staff — IT/ITES, pharma and FMCG head offices, trading houses, NGOs, group-of-company HQs. Factory floors (RMG wage-board grades, piece rates, thousands of workers) are out of scope for v1; they need a separate compliance package.

**Positioning:** local compliance built in (Labour Act, income tax, VAT/Mushak, BDT, Bangla), plus an AI assistant and automation that existing local HRM/accounting tools do not offer as one product.

### Revenue streams

| Stream | How it is charged | Why it is profitable |
| --- | --- | --- |
| Subscription | Per active employee per month, three tiers | Recurring, grows with customer headcount |
| Implementation | One-time fee for setup, data migration, training | Covers onboarding cost up front |
| Private / on-prem licence | Annual licence + maintenance contract (AMC) | Large groups and banks often require data on their own servers |
| AI usage | Included quota per tier, extra credits sold | AI calls have real cost; pass it through |
| Add-ons | SMS bundles, biometric device integration, custom workflows | High margin, low effort once built |

### Tiers

| Tier | Modules |
| --- | --- |
| Core | Employee records, attendance, leave, payroll, self-service, approvals |
| Business | Core + accounts, expense claims, procurement, assets, CRM |
| Intelligent | Business + AI assistant, AI analytics, n8n automation library and custom workflows |

Actual BDT price points are an open decision (section 13): validate them with 10–15 prospect interviews before fixing.

## 2. Core design principles

These nine rules settle most later design arguments; every module below follows them.

1. **The ERP core is the system of record.** All money, balances and approval states live in the core database. n8n only reacts to events and calls back through the core's API; it never holds the truth.
2. **AI advises, humans decide.** AI drafts, scores, flags and answers. It never approves a request, posts a voucher, finalizes payroll, hires or rejects a candidate.
3. **One person, many roles.** A Department Head is also an Employee; an HR officer may also head HR. Permissions are the union of a user's roles, each limited by its scope (section 4).
4. **Configure, don't hardcode.** Leave rules, salary heads, tax slabs, holidays, approval chains and numbering formats are company settings with defaults, so a law or policy change is a settings change, not a code release.
5. **Maker–checker on money.** Whoever creates a payment, voucher or payroll run cannot approve it.
6. **Posted means permanent.** Approved vouchers, finalized payroll and closed periods cannot be edited; corrections are reversal entries with a reason.
7. **Effective-dated history.** Salary, designation, department, grade and reporting-line changes carry an effective date and keep full history, so back-dated increments produce correct arrears.
8. **Bangla and English, mobile-first for employees.** Self-service (attendance, leave, payslip, claims) must work fully on a phone.
9. **Strict tenant isolation.** One company can never see another's data, including through AI answers or shared workflows.

## 3. Organization structure and master data

Every record in the system hangs off a five-level tree, and every employee has exactly one line manager at any date.

1. **Tenant (customer account)** — the subscribing group; billing and subscription live here.
    1. **Company (legal entity)** — own TIN, BIN, bank accounts, chart of accounts and payroll. A group can run several.
        1. **Branch / location** — Dhaka HQ, Chattogram office; holds its own holiday calendar, shifts and geo-fence.
            1. **Department** — one Department Head; owns a budget and a cost centre.
                1. **Section / team** — optional sub-unit with a team lead.

An employee is placed by **company + branch + department + designation + grade**, plus a **line manager** (approves leave, attendance, claims) and an optional **functional manager** (performance input only). If the line manager is absent or leaves, approvals route to that manager's own manager.

### Master data owned by each role

| Master data | Owner | Notes |
| --- | --- | --- |
| Companies, branches, departments, users, roles | Admin | Department Head assignment needs Admin |
| Designations, grades, salary structures, leave types, shifts, holidays | HR | Each change is effective-dated |
| Employee profile (personal, job, bank, NID, TIN) | HR, employee edits own contact details | Employee changes to bank account need HR approval |
| Chart of accounts, cost centres, tax and VAT rates, bank accounts | Accounts | Tax tables stored per fiscal year (July–June) |
| Customers, vendors, products/services | Accounts and sales users | Vendor bank details need maker–checker |

Employee ID format, probation length, notice periods and retirement age are company settings.

## 4. Roles, scopes and permissions

Access = role × scope × field sensitivity: a role says what a user may do, a scope says over whose data, and sensitive fields (salary, bank, NID, health) need an extra grant.

**Scopes:** Own (self) · Department (own department and below) · Company · Group (all companies in the tenant).

**Roles:**

- **Admin** — company management and system owner: settings, users, roles, departments, workflows, final approvals above thresholds. Salary data is hidden from Admin unless granted, so an IT administrator does not see payroll by default.
- **HR** — employee lifecycle, attendance, leave, payroll preparation, performance cycles, policies.
- **Accounts** — ledger, vouchers, payroll verification and disbursement, claims payment, vendors, invoices, VAT and tax.
- **Department Head** — approves and monitors their department: leave, attendance corrections, claims, requisitions, appraisals, department budget and KPIs.
- **Employee** — self-service: attendance, leave, payslips, claims, requisitions, tasks, AI assistant.
- Optional add-on roles: **Sales user** (CRM pipeline, own scope), **Auditor** (read-only, time-limited).

### Permission matrix

F = full manage · P = prepare (maker) · A = approve · V = view · O = own records only · — = no access. Scope in brackets.

| Capability | Admin | HR | Accounts | Dept Head | Employee |
| --- | --- | --- | --- | --- | --- |
| Company settings, users, roles | F | — | — | — | — |
| Employee profiles | V (company) | F (company) | V payroll fields | V (dept), no salary | O, edit contact |
| Salary and bank data | grant only | F | V | — | O |
| Attendance and corrections | V | F | — | A (dept) | O, request |
| Leave | V | F, final A | — | A (dept) | O, apply |
| Payroll run | A final | P | A verify, disburse | — | O payslip |
| Expense claims | A above limit | — | A, pay | A (dept) | O, submit |
| Purchase requisition / PO | A above limit | — | P PO, pay | A (dept) | O, raise |
| Vouchers, ledger, bank | V, A above limit | — | F (maker–checker inside team) | — | — |
| Budgets | A | — | F | V (dept), request change | — |
| Assets | F | V | V (depreciation) | V (dept) | O assigned |
| Performance appraisal | V | F, run cycle | — | A, rate (dept) | O, self-review |
| CRM pipeline | V (company) | — | invoices, collections | V (dept) | Sales users: O |
| Reports and dashboards | company | HR | finance | dept | own |
| AI assistant | yes, within scope | yes | yes | yes | yes |
| n8n workflows | F | — | — | — | — |
| Audit log | V | — | V finance entries | — | — |

**Rules that apply across the matrix:**

- Nobody approves their own request; a Department Head's own leave or claim goes to their manager or to Admin.
- An approver can delegate to another user for a date range (e.g. while on leave); every delegated action records both names.
- Custom roles are built by copying a default role and adjusting it, so customers cannot break the defaults.

## 5. Approval workflow engine

One shared engine handles every request type, so leave, claims, purchases, payroll and discounts all follow the same states, audit trail, reminders and escalation.

**Request states:** Draft → Submitted → In approval (step 1…n) → Approved → Executed (posted, paid or applied). Side exits: Returned for correction (back to Draft), Rejected (final, reason required), Cancelled by requester (only before final approval).

**A chain is defined by:**

- **Request type** and **conditions** — amount, number of days, department, grade, budget status.
- **Ordered steps** — each approver resolved by relationship (line manager, Department Head, holder of a role, named user), not by a hardcoded person, so chains survive staff changes.
- **Step mode** — sequential, or parallel with "any one" or "all".
- **SLA** — counted in working hours, excluding weekends and holidays. Default: reminder at 24 h, escalation to the approver's manager at 48 h.

### Default chains (customer can edit)

| Request | Chain | Extra rule |
| --- | --- | --- |
| Leave, up to 3 days | Line manager / Dept Head | HR notified, not an approver |
| Leave over 3 days, maternity, unpaid | Dept Head → HR | HR checks entitlement and documents |
| Attendance correction | Dept Head | Limit on corrections per month (setting) |
| Expense claim | Dept Head → Accounts (verify, pay) | Above threshold → Admin before payment |
| Purchase requisition | Dept Head → Accounts (budget check, PO) | Over budget or above threshold → Admin |
| Salary advance / loan | Dept Head → HR → Accounts | Above threshold → Admin; repayment schedule set at approval |
| Payroll run | HR prepares → Accounts verifies → Admin approves → Accounts disburses | Locked after approval |
| Payment voucher | Accounts maker → Accounts checker | Above threshold → Admin |
| New position (headcount) | Dept Head → HR → Admin | Checked against approved manpower plan |
| Resignation | Dept Head → HR (clearance) → Accounts (final settlement) | Asset return and dues cleared before settlement |
| CRM discount above limit | Sales head → Admin | Limit set per product or customer type |

Every action stores who, when, from which device or IP, the comment, and the amounts or values at that moment. Approvers can act from email, in-app or mobile; the action is valid only after the core confirms it (n8n carries the notification, the core records the decision).

## 6. Module business logic

Eight modules share one employee record, one approval engine and one ledger; every module that moves money posts to accounts automatically.

### 6.1 Employee lifecycle

1. **Recruitment** — approved position → job post → applications → AI-ranked shortlist (HR decides) → interviews with scorecards → offer letter → acceptance.
2. **Onboarding** — accepted offer creates the employee in Draft; a checklist (documents, NID, TIN, bank account, assets, email, ID card) must be complete before status becomes Active.
3. **Probation** — length per company setting; reminder to Dept Head 15 days before end; Dept Head recommends confirm, extend or end; HR confirms.
4. **Changes** — transfer, promotion, increment, grade or manager change; each effective-dated, back-dated changes create arrears in the next payroll.
5. **Separation** — resignation, termination, retirement or contract end. Notice period checked; clearance from IT, Admin (assets), Accounts (advances) and Dept Head (handover) before final settlement.
6. **Final settlement** — salary to last day + leave encashment + gratuity (if eligible) + PF payout − notice shortfall − advances − unreturned assets; approved like payroll, then experience certificate issued.

### 6.2 Attendance and shifts

- **Sources:** biometric devices synced on a schedule, mobile punch with geo-fence (and optional selfie), web punch for approved remote staff.
- **Shift** = start, end, grace minutes, half-day threshold, weekend days per branch (Friday, or Friday + Saturday), plus temporary overrides such as Ramadan hours.
- **Daily status:** Present, Late (after start + grace), Half-day, Absent (no punch, no leave), On leave, Holiday, Weekend, Missing punch (needs correction request).
- **Late policy:** configurable penalty (e.g. N lates per month = one day deducted from leave or pay). Flag: confirm this rule with legal counsel before using a pay deduction.
- **Overtime:** only for grades marked OT-eligible; hours over the daily/weekly limit, paid at the statutory rate (section 7); Dept Head approves OT before it reaches payroll.
- **Monthly lock:** HR locks attendance a set number of days before payroll; later corrections flow to next month as adjustments.

### 6.3 Leave

- Leave types carry entitlement, accrual method, carry-forward cap, encashable yes/no, document rule and eligibility (gender, service length, probation).
- Defaults follow the Labour Act (section 7): casual, sick, earned/annual, maternity, plus company types such as leave without pay or study leave. Public and festival holidays come from the branch holiday calendar, not the leave balance.
- **On apply:** balance check, overlap check, back-dated limit, half-day support, and a "sandwich rule" setting (whether a weekend between two leave days counts as leave).
- **For approvers:** a team calendar warns when too many people in one department are off on the same day.
- **Year end (fiscal or calendar, setting):** lapse, carry forward up to cap, or encash, per leave type.

### 6.4 Payroll

**Salary structure:** gross split into heads by rule — basic (a set % of gross), house rent, medical, conveyance and other allowances. Heads are tagged taxable/exempt and earning/deduction.

**Monthly run:**

1. Lock attendance and leave for the month.
2. Pull variables: overtime, arrears, bonuses, commissions (from CRM), loan and advance instalments, other deductions.
3. Compute earnings, including proration for joiners and leavers and deduction for unpaid days.
4. Compute deductions: income tax withheld at source (annual projection spread over the remaining months of the fiscal year), employee PF, loan instalments, others.
5. Net pay and employer costs (employer PF, gratuity provision).
6. Validation: AI and rule checks flag outliers (e.g. net pay changed more than a set % vs last month, new bank account, zero tax for a taxable salary).
7. Approval chain (section 5), then lock.
8. Disbursement file per bank (BEFTN/NPSB format), cash list, or mobile-wallet list.
9. Payslips published (portal, email, optional password-protected PDF).
10. Salary journal posted to accounts automatically.

**Other payroll events:** two festival bonuses per year with eligibility and cap rules; bonus timing set per employee by a "festival group" field; annual tax certificate per employee; PF ledger per member with company match.

**Payroll acceptance cases:** a fixed set of worked examples, checked by a payroll accountant, that must pass before every release:

- Joiner and leaver mid-month, and both in the same month.
- Back-dated increment that spans a fiscal-year boundary (arrears and tax split across two years).
- Unpaid leave crossing a month end; attendance corrected after the monthly lock.
- Maternity leave crossing months, paid at monthly wage ÷ 26 per day.
- Mid-year salary change and its effect on the remaining-months tax projection; joiner with prior-employer income this fiscal year.
- Festival bonus at exactly one year of service; an Eid holiday moved after attendance was locked.
- Final settlement where deductions exceed dues (negative net).
- Rounding per company rule, with payslip totals, bank file and salary journal agreeing to the taka.

### 6.5 Performance

Cycle (annual or half-yearly) → goals/KPIs set from a library per designation → self-review → Dept Head rating → HR calibration across departments → increment and promotion proposals → Admin approval → effective-dated salary change → arrears in payroll. Continuous feedback notes can be added any time and are visible in the review.

### 6.6 Accounts and finance

- **Ledger:** double-entry, chart of accounts from a Bangladesh template, cost centre = department. Voucher types: payment, receipt, journal, contra.
- **Sub-ledgers:** customers (receivables), vendors (payables), employees (advances, loans).
- **Auto-postings:** payroll, expense claims, vendor bills, customer invoices, depreciation — each links back to its source document.
- **Fiscal year July–June,** monthly period close; closed periods accept only reversal entries.
- **Tax and VAT:** VAT on sales invoices, VAT deducted at source on purchases when the company is a withholding entity, income tax withheld from vendor payments by payment category, challan and certificate tracking, and data prepared for the monthly VAT return.
- **Bank:** statement import, auto-match by amount, date and reference, manual match for the rest.
- **Budget:** annual budget per department and account. Purchase-order approval commits the amount; vendor bill makes it actual. Warning at 80%, escalation to Admin at 100%.
- **Reports:** trial balance, profit and loss, balance sheet, cash flow, aged receivables and payables, budget vs actual, department cost.

### 6.7 Procurement, inventory and assets

1. Requisition (any employee) → Dept Head approval → budget check.
2. Quotations: minimum count above a threshold (setting); comparative statement prepared and approved.
3. Purchase order → goods/service received note → vendor bill.
4. Three-way match (PO, receipt, bill) within a tolerance; mismatch blocks payment.
5. Payment with VAT and tax deducted at source; certificate issued to the vendor.

**Assets:** register with tag/QR code, assignment to an employee with digital acknowledgement, depreciation method per asset class, maintenance log, disposal. **Consumables:** stock ledger per store with issue requests from departments.

### 6.8 CRM

1. **Lead** — from website forms, Facebook lead ads, referrals, calls, walk-ins; auto-assigned by round robin or territory; duplicate check on phone and email.
2. **Qualification** → **Opportunity** with stage, value, probability and expected close date.
3. **Quotation** — price list, discount limits per user; above limit uses the discount approval chain.
4. **Order / contract** — customer credit-limit check; over limit needs Accounts approval.
5. **Invoice** — created from the order, posted to receivables.
6. **Collection** — due-date reminders and follow-up tasks; payment receipt closes the invoice.
7. **Support** — tickets with priority and SLA, linked to the customer.

Customer 360 view shows contacts, activities, quotes, orders, invoices, dues and tickets on one screen. Sales targets per user and department feed commission into payroll.

## 7. Bangladesh compliance and localization

The Labour Act was heavily amended in late 2025, and the change now covers office staff: the Bangladesh Labour (Amendment) Ordinance 2025 removed the old exclusion of managerial and administrative staff and brought "officers" into the definition of worker ([Mahbub & Company](https://mahbub-law.com/bangladesh-labour-law-amendment-2025-a-new-era-of-compliance-challenges-for-employers/)). Corporate offices that used to run purely on company policy now need statutory leave, benefits and complaint processes — a strong selling point for a compliance-ready product. Reports say Parliament then passed it as the Labour (Amendment) Act 2026, effective 10 April 2026 ([MiHCM summary](https://mihcm.com/mm/?p=59800)); confirm the final Act text before go-live.

### Statutory defaults the system ships with

Every value below is a setting with an effective date, so the next amendment is a configuration change. "Verify" = taken from general knowledge, not yet checked against the amended text.

| Rule | Default value | Status |
| --- | --- | --- |
| Maternity leave | 120 days paid; 6 months' service required; pay = monthly wage ÷ 26 per day | Changed in 2025 ([source](https://mahbub-law.com/bangladesh-labour-law-amendment-2025-a-new-era-of-compliance-challenges-for-employers/)) |
| Festival holidays | 13 paid days per calendar year, dates fixed by employer | Changed from 11 ([source](https://juralacuity.com/labour-law-ordinance/)) |
| Resignation benefit | 7 days' wages per year after 1 year; 15 days per year from 3–10 years; 30 days per year (or gratuity) above 10 years | Changed ([source](https://juralacuity.com/labour-law-ordinance/)) |
| Provident fund | Mandatory at 100+ permanent employees, or an approved pension scheme instead | New ([source](https://juralacuity.com/labour-law-ordinance/)) |
| Lay-off compensation eligibility | 3 months' continuous service | Changed from 1 year ([source](https://juralacuity.com/labour-law-ordinance/)) |
| Complaint committee | Required for violence, harassment and discrimination complaints | New ([source](https://juralacuity.com/labour-law-ordinance/)) |
| Equal pay | Equal pay for equal work regardless of gender or disability | New ([source](https://mahbub-law.com/bangladesh-labour-law-amendment-2025-a-new-era-of-compliance-challenges-for-employers/)) |
| No blacklisting | No list that makes former staff ineligible for re-hire | New ([source](https://juralacuity.com/labour-law-ordinance/)) |
| Casual leave | 10 days per year, no carry forward | Verify |
| Sick leave | 14 days per year, full pay | Verify |
| Earned/annual leave | Accrual rate per days worked; rate differs by establishment type | Verify — may have changed |
| Working hours and overtime | 8 h/day, 48 h/week; overtime at twice the ordinary rate of basic | Verify |
| Festival bonus | Two per year, each capped at one month's basic, after 1 year's service | Verify (Labour Rules) |
| Gratuity | Days' wages per completed year of service, per company scheme and the Act | Verify |
| Workers' profit participation fund | 5% of net profit for qualifying companies | Verify applicability |

### How rules are verified

The sources above are law-firm summaries: good leads, not authority. Before any rule goes live:

- Each statutory value links to its official source — the gazetted text of the Act and Rules, and NBR orders and circulars for income tax and VAT.
- A named compliance owner (labour lawyer and tax adviser on retainer) reviews the rule pack after every budget (June) and every amendment; the review date is stored with each rule.
- A rule still marked "Verify" cannot be activated for a live customer.

### Product consequences

- **Rule packs:** statutory rules ship as a versioned "Bangladesh Labour Rule Pack"; when law changes, we publish a new version and each customer accepts it with an effective date.
- **Blacklisting:** the system must not offer a "do not rehire" flag; separation records keep only factual reasons.
- **Complaint portal:** a confidential complaint channel routed to the complaint committee, hidden from the accused's management chain.
- **Income tax:** salary tax withheld under the Income Tax Act 2023; slabs, exemptions and rebates stored per fiscal year (July–June) because they change in every budget.
- **VAT:** VAT invoices, VAT deducted at source and return data under the VAT and Supplementary Duty Act 2012; rates per item and per fiscal year.

### Localization

- Bangla and English interface, switchable per user; payslips and letters in either language; Bangla digits optional.
- BDT with lakh/crore grouping (12,34,567.00); amount in words in Bangla and English on payslips and cheques.
- Weekend per branch; holiday calendar editable at short notice, because Eid dates depend on moon sighting — moving a holiday recalculates affected attendance and leave automatically.
- Disbursement through bank transfer files, cash, or mobile wallets (e.g. bKash, Nagad); local SMS gateways for alerts.
- Hosting option inside Bangladesh for customers that require local data residency.

## 8. AI layer: features and guardrails

AI is sold as "a smart assistant inside every workflow", not a separate chatbot: each feature sits where a user already works, saves a specific chore, and ends in a human decision.

### Features

| # | Feature | Used by | What AI does | Human decides |
| --- | --- | --- | --- | --- |
| 1 | Bangla/English self-service assistant | Everyone | Answers policy and balance questions; turns "leave on Thursday" into a draft request | User confirms the draft |
| 2 | Ask-your-data reports | Admin, HR, Accounts, Dept Head | Turns a question into a report within the user's scope ("overtime cost by department last quarter") | User reads, exports |
| 3 | CV screening | HR | Ranks applicants against job criteria with reasons; name, gender, religion, age and photo removed before scoring | HR builds the shortlist |
| 4 | Receipt and bill reader | Employee, Accounts | Reads amount, date, vendor, VAT from a photo; flags duplicate receipts | Submitter checks, Accounts verifies |
| 5 | Payroll pre-check | HR, Accounts | Explains outliers before approval (big net-pay change, new bank account, unusual overtime) | Approvers clear or fix each flag |
| 6 | Spend anomaly watch | Accounts, Admin | Flags split purchases under approval limits, duplicate vendor bills, unusual vendors | Accounts investigates |
| 7 | Cash-flow forecast | Accounts, Admin | Projects 90-day cash from receivables, payables, payroll and history | Management plans |
| 8 | Sales assistant | Sales users, Dept Head | Lead score with reasons, next best action, drafts follow-up emails and quotation text, summarizes call notes | Salesperson sends or edits |
| 9 | Review drafting | Dept Head | Summarizes a year of feedback notes into a draft review | Manager rewrites and rates |
| 10 | Letter drafting | HR | Drafts non-standard letters; standard letters stay template-based | HR approves before issue |
| 11 | Bank reconciliation matching | Accounts | Suggests matches for unmatched bank lines | Accountant confirms |
| 12 | Team health trends | HR, Admin | Department-level trends in leave, overtime, late arrivals, turnover | HR acts; no individual "flight-risk" scores |

### Guardrails (non-negotiable)

1. **Same permissions as the user.** AI reads data only through the core API with the asking user's role and scope; a Department Head's question can never return another department's salaries. Ask-your-data reports use an approved catalogue of metrics and filters exposed by the API, never free-form database queries.
2. **Draft, then confirm.** AI can prepare a request, report or message; only a user click submits, sends or approves it.
3. **Data minimization.** Only the fields a task needs leave the system; NID, bank account and tax numbers are masked; AI provider contract must exclude training on customer data; customers can switch individual features off.
4. **Fairness by design.** Protected characteristics are stripped before any scoring of people, consistent with the 2025 anti-discrimination provisions.
5. **Explain every score.** Scores and flags always show the reasons behind them.
6. **Full audit.** Each AI output is logged with user, time, model and prompt version, and what the human did with it.
7. **Metered cost.** AI usage is counted per tenant against the tier quota (section 1).
8. **Graceful failure.** Every process works without AI; if the AI service is down, users see the normal screens.
9. **Outside content is untrusted.** CVs, receipts, emails and lead messages can carry hidden instructions; AI treats them as data only and can never trigger an action from them.
10. **Measured before release.** Each feature ships only after passing a fixed test set at an agreed pass rate (Bangla and English policy answers, receipt fields, CV ranking consistency). In production, override and rejection rates are tracked per feature; a feature that falls below its bar is switched off until fixed.

The model provider is hidden behind one internal "AI gateway" service, so the product can switch or mix models without changing business logic.

## 9. n8n automation layer: event model and workflows

n8n is the integration and notification layer around the core, never inside it: the core publishes business events, n8n reacts and talks to the outside world, and anything n8n wants to change goes back through the core's API and its rules.

**Architecture (text version of the live doc's diagram — "The core owns every decision; n8n and AI work only through its API"):**

```
 Users: Admin, HR, Accounts, Dept Heads, Employees
 (web portal and mobile app, Bangla and English)
                    |
                    v
 +------------------ ERP core — system of record ------------------+
 |  API and permission check                                       | <----> AI gateway
 |  (every request runs as a user or a scoped service key)         |        (masks sensitive fields,
 |                                                                 |         meters usage per tenant)
 |  Business modules              Approval engine                  |              |
 |  (HR, payroll, accounts, CRM)  (chains, SLAs, delegation)       |              v
 |                                                                 |        AI model provider
 |  Database, event outbox, audit log                              |        (swappable behind the gateway)
 |  (events written in the same transaction as the action)        |
 +-----------------------------------------------------------------+
        ^                                   |
        | callbacks through the API         | events, signed webhooks
        |                                   v
 +------------------------------------------------+      +-------------------------------------------+
 | n8n automation                                 | <--> | Outside channels                          |
 | receives signed event webhooks                 |      | email, SMS, WhatsApp, payslip PDFs        |
 | runs prebuilt and custom workflows             |      | bank transfer and statement files         |
 | writes back only through the core API          |      | Facebook leads, Google / Microsoft accts  |
 +------------------------------------------------+      +-------------------------------------------+
```

Events leave the core from the outbox; anything n8n changes comes back in through the same API and permission check users go through.

### How events flow

1. A business action commits in the core (e.g. leave approved) and, in the same database transaction, writes an event to an **outbox** table — so no event is lost and none is sent for a rolled-back action.
2. A dispatcher sends each event to n8n as a signed webhook with a unique event ID; n8n ignores IDs it has already processed.
3. Failed deliveries retry with back-off, then land in a dead-letter list Admin can see and replay.
4. n8n calls back with a **per-tenant service key** limited to the endpoints a workflow needs; every call passes the same validation, permissions and approval rules as a human user.

### Event catalogue (v1)

- **People:** employee.created, employee.confirmed, employee.separated, probation.ending, contract.expiring, asset.assigned
- **Time:** attendance.daily_closed, leave.submitted, leave.approved, leave.rejected
- **Approvals:** approval.pending, approval.sla_breached, approval.completed
- **Money:** payroll.approved, payroll.disbursed, claim.approved, invoice.created, invoice.overdue, payment.received, budget.threshold_reached
- **Customers:** lead.created, opportunity.won, ticket.created, ticket.sla_breached

### Prebuilt workflow library

| Workflow | Trigger | What it does |
| --- | --- | --- |
| Onboarding kit | employee.created | Creates email and chat accounts, opens IT laptop task, sends welcome pack, schedules day-1 orientation |
| Offboarding | employee.separated | Revokes accounts on last day, opens asset-return and clearance tasks |
| Approval nudges | approval.pending, sla_breached | Reminders by email, SMS or WhatsApp with a one-click link; escalation message on breach |
| Payslip delivery | payroll.disbursed | Password-protected PDF by email, "salary credited" SMS |
| Daily attendance digest | attendance.daily_closed | Each Dept Head gets absent and late lists every morning |
| Lead capture | Facebook lead ads, website forms | Creates lead through the API, auto-assigns, sends welcome message |
| Collection reminders | invoice.overdue | Reminders at set intervals; escalates to the account manager |
| Expiry alerts | Daily schedule + probation/contract events | Probation ends, contracts, trade licence, vendor agreements, insurance |
| Bank statement import | Daily schedule | Fetches statements from bank email or SFTP and loads them into reconciliation |
| Compliance calendar | Monthly schedule | Reminders for tax, VAT and statutory filing dates set by Accounts |

### Custom workflows (Intelligent tier)

Customer Admins build their own workflows from templates in a per-tenant n8n workspace that can only use that tenant's service key. A reviewed template gallery becomes a long-term differentiator and a source of add-on revenue.

**Licensing risk to resolve first:** n8n is source-available under its Sustainable Use License, which is aimed at internal business use. Offering n8n-powered automation to paying customers, especially letting them build workflows, likely needs n8n's commercial embed licence. Confirm with n8n before committing to this design (section 13).

## 10. Integrations and data migration

Migration was missing from v0.1 and is the step most likely to stall a sale: a company cannot move payroll mid-year without its year-to-date salary and tax, so the system must import history and balances, not just people.

### Data migration

| Data imported | Why it matters | Check before go-live |
| --- | --- | --- |
| Employees, job history, salary structures | Payroll and reporting start correct | HR signs off headcount and gross pay per department |
| Leave balances at cut-over | Employees keep what they earned | Each balance matches the old record |
| Year-to-date salary, tax withheld, PF balances | Tax projection for the rest of the fiscal year depends on it | Totals match the old payroll register |
| Outstanding loans and advances | Instalments continue without gaps | Outstanding total matches Accounts |
| Opening trial balance, open receivables and payables | Ledger starts correct | Trial balance equals the old system at the cut-over date |
| Customers, vendors, open quotations and orders | CRM and purchasing continue | Sample check by the customer |

1. Data loads through Excel/CSV templates with field-by-field validation; nothing is loaded until every error is fixed or explicitly skipped.
2. Each import is a batch that can be rolled back until the customer signs it off.
3. Cut-over happens at a month start; for accounts, preferably at the fiscal year start (1 July).
4. The customer signs a reconciliation report before go-live; for payroll this sits alongside the parallel-run gate (section 12).

### Integration reliability

Integrations that touch money or attendance records run inside the core behind replaceable adapters; n8n handles notifications and convenience flows. This follows principle 1 and keeps payment status out of n8n.

| Integration | Runs in | Reliability rule |
| --- | --- | --- |
| Biometric devices | Core, through a small sync agent on the office network | Buffers punches when the internet drops, removes duplicate punches, flags device clock drift |
| Bank salary files | Core | One file per approved run; each bank's format tested with that bank before first live use; rejected payments imported back and marked unpaid for re-issue |
| Mobile-wallet disbursement | Core | Same rules as bank files; per-employee payment status; needs a corporate agreement with each provider |
| SMS | n8n, through a gateway | Second gateway as fallback; delivery status logged; SMS is never the only channel for a critical notice |
| Email, WhatsApp, Google/Microsoft accounts | n8n | Retries and dead-letter list (section 9) |

## 11. Audit, security, reliability and data integrity

Customers trust a payroll and accounts system only if every number can be traced and nothing can change silently; these rules apply to all modules.

**Audit trail**

- Every create, change, approval, export and login is logged with user, time, IP/device, and before/after values. The log is append-only; no role, including Admin, can edit it.
- Exports of salary or personal data are logged and watermarked with the exporter's name.

**Access and authentication**

- Two-factor login (OTP by SMS or app) mandatory for Admin, HR and Accounts; optional SSO with Google or Microsoft.
- Session timeout, login-attempt lockout, and device registration for mobile attendance.
- Sensitive fields (salary, bank account, NID, TIN, complaint records) encrypted at field level and shown masked unless the user holds the grant.

**Financial integrity**

- Gapless numbering per voucher type per fiscal year; cancelled numbers stay visible as cancelled.
- Posted entries are never edited; reversal entries with a reason correct them. Closed periods accept nothing else.
- Nightly checks: sub-ledger totals equal their control accounts, payroll journal equals the approved payroll, bank balance equals the reconciled ledger. Mismatches alert Accounts.

**Data protection**

- Consent recorded for biometric and selfie attendance data; retention periods set per data type.
- Daily backups with point-in-time recovery and a tested restore drill; full tenant data export on request or exit.
- Personal-data handling aligned with Bangladesh's data protection law as currently in force — confirm the law's status and obligations with counsel before launch.

**Tenant isolation, enforced rather than promised**

- Every table carries the tenant ID and the database itself enforces it (row-level security), so one missed filter in code cannot leak another company's data.
- Automated tests in every release try to read and write across tenants through the API, reports, exports and the AI assistant; any success blocks the release.
- All data encrypted in transit and at rest; sensitive fields use per-tenant keys.

**High-risk actions**

- Step-up OTP for the classic payroll-fraud paths: changing a salary bank or wallet account, changing vendor bank details, generating a disbursement file, and granting roles. The employee is also notified on their existing contact. Mandatory two-factor for every employee is not required: it adds daily friction without protecting these paths better.
- The audit log is tamper-evident: each entry carries a hash of the previous one, checked nightly.
- In tenant n8n workspaces, code-execution and shell nodes are disabled and credentials are stored encrypted, so a customer-built workflow cannot reach other tenants or the server.

**Security testing**

- Dependency and code scanning on every build; an external penetration test before the first paying customer, then yearly.

**Reliability and duplicate protection**

- An employee can be paid once per period per pay type: the database rejects a second approved payment line for the same employee, period and type.
- A payroll run produces its bank or wallet file once; a new file requires cancelling the old one with a reason and a second approval.
- Every auto-posted journal stores its source document reference, unique per source, so a retried job cannot post twice.
- Every write API, including n8n callbacks, accepts an idempotency key; a repeated key returns the first result instead of acting again.
- Long jobs (payroll run, imports, bank files) are resumable and all-or-nothing: a failure leaves no half-written data.
- Monitoring and alerts for errors, uptime, failed payroll jobs, a growing dead-letter list and nightly reconciliation mismatches.
- Payroll, tax, leave-accrual and ledger calculations run against the acceptance cases (section 6.4) on every release.
- Recovery targets — acceptable data loss and downtime per tier — are an open decision (section 13).

## 12. Release phasing

Validate demand first, then build payroll, because it is the module customers pay for first and the one that makes them stay; every later phase is sold as an upgrade to the same customers.

**Roadmap (text version of the live doc's diagram — "Validate first, then payroll: each phase opens only after its gate passes"):**

| Step | Contents |
| --- | --- |
| **Phase 0 — Validate before code** | Interviews and willingness-to-pay checks with HR and finance heads of target companies · Clickable prototype tested with HR staff and employees on mid-range Android phones · Output: confirmed module priority, price points, signed pilot companies |
| ◆ Gate 0 | 2–3 companies sign pilot agreements and the prototype passes usability tests |
| **Phase 1 — Core HR and payroll (the anchor)** | Modules: org and roles, approvals, employees, attendance, leave, payroll, self-service app, data import · AI: read-only policy and balance assistant; payroll pre-check (rules first, AI explanations) · n8n: approval nudges, payslip delivery, attendance digest |
| ◆ Gate 1 | Pilots run two parallel payrolls that match their current payroll |
| **Phase 2 — Finance** | Modules: ledger and vouchers, expense claims, procurement, assets and stock, budgets, VAT, tax at source · AI: receipt and bill reader, bank reconciliation matching · n8n: bank statement import, compliance calendar |
| ◆ Gate 2 | A pilot closes one month fully in the system and the trial balance reconciles |
| **Phase 3 — Customers and talent** | Modules: CRM pipeline, quotations, invoicing, collections, support, recruitment, performance · AI: sales assistant, CV screening, review drafting · n8n: lead capture, collection reminders, expiry alerts, onboarding and offboarding kits |
| ◆ Gate 3 | Pilots run their sales pipeline and one appraisal cycle in the system |
| **Phase 4 — Intelligence and automation platform** | Modules: management dashboards, custom workflow builder, reviewed template gallery · AI: ask-your-data reports, spend anomaly watch, cash-flow forecast, team health trends · n8n: customer-built workflows (after the licence decision) |

Each phase is sellable on its own: Phase 1 is the Core tier, Phases 2–3 complete the Business tier, and Phase 4 completes the Intelligent tier. Phase 0 needs only a prototype, so it is the cheapest point to learn which modules customers will pay for. Phase 1 is kept lean: its AI is read-only and low-risk, and the onboarding and offboarding kits moved to Phase 3, where they pair with recruitment and need account integrations. Durations are set once the team size and tech stack are decided.

## 13. Open decisions to finalize before implementation

These fifteen answers lock the logic; once they are settled, we move to data model, API design and tech stack.

- [ ] **Who is "Admin"?** Top management, IT system administrator, or both? Proposal: split into Admin (management approvals) and System Admin (settings, no salary access).
- [ ] **Launch segment and pilots:** which industry first, and 2–3 pilot companies willing to run parallel payroll for two months.
- [ ] **BDT pricing per tier** after prospect interviews.
- [ ] **Deployment:** SaaS only at launch, or on-premise from day one for large customers?
- [ ] **n8n licence:** buy the embed licence, or use n8n only behind the scenes for prebuilt workflows and drop customer-built workflows from v1?
- [ ] **AI provider:** Bangla quality, cost per tenant, and whether AI calls may leave Bangladesh for customers needing local data residency.
- [ ] **Multi-company groups** in v1, or single company first?
- [ ] **Leave year:** calendar year or fiscal year (July–June) as default.
- [ ] **Late-arrival penalty:** keep, change, or drop after legal review.
- [ ] **Integrations first:** which banks' transfer formats, which mobile wallets, which biometric device brands, which SMS gateway.
- [ ] **CRM scope in v1:** sales pipeline only, or include support tickets.
- [ ] **Legal sign-off:** labour lawyer and tax adviser confirm every "Verify" value in section 7 against the amended Act and current Finance Act.
- [ ] **Compliance owner:** which lawyer and tax adviser own the rule-pack reviews after each budget and amendment.
- [ ] **Migration sources:** Excel templates only at launch, or direct import from the payroll and accounting tools prospects use today.
- [ ] **Recovery targets per tier:** acceptable data loss and downtime after a failure, which set backup frequency and hosting cost.

## 14. v0.2 review: decisions on the seven concerns

Five of the seven concerns were partly covered in v0.1; two real gaps — data migration and duplicate-payment protection — are now the top priorities. Changes were made only where they reduce a concrete risk; the architecture, vision and phasing are unchanged.

| # | Concern | Already in v0.1 | v0.2 decision | Priority |
| --- | --- | --- | --- | --- |
| 1 | Phased rollout | Payroll-first phases with pilot gates (section 12) | Kept. Added Phase 0 validation; trimmed Phase 1 AI to read-only and moved onboarding kits to Phase 3 | High (Phase 0) |
| 2 | Security | MFA for Admin/HR/Accounts, field encryption, append-only log, isolation as a principle | Added database-enforced tenant isolation with cross-tenant tests, step-up OTP on bank and role changes, tamper-evident log, n8n code nodes disabled, scanning and pen test. Not adopted: mandatory MFA for every employee | Medium–high |
| 3 | Payroll and compliance | "Verify" column, versioned rule packs, legal sign-off, parallel-payroll gate | Added official-source register, named owner and review cycle, "Verify" blocks activation, payroll acceptance cases | High |
| 4 | Reliability | Backups and restore drill, nightly reconciliation, event outbox, retries | Added once-only payment constraint, one file per run, unique source on postings, idempotent write API, monitoring, recovery targets as a decision | High |
| 5 | Integrations and migration | Integrations listed only as an open decision; migration absent | New section 10: validated, reversible imports with sign-off; money and attendance integrations moved into the core | High (migration) |
| 6 | AI safety | Permissions, draft-then-confirm, minimization, fairness, explanations, audit | Added untrusted-input rule, approved metric catalogue, evaluation gate per feature | Medium |
| 7 | Usability and market | Pricing interviews, pilot companies | Phase 0: interviews, willingness-to-pay, prototype tests on phones, signed pilots as Gate 0 | High |

**Order of work:** (1) Phase 0 validation, which runs while (2) migration templates, (3) payroll acceptance cases and duplicate-payment rules, and (4) enforced tenant isolation are designed — all four must exist before the first pilot payroll.
