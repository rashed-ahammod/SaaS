# Phase 3 — Customers and talent: work packages

The spec's Phase 3 (spec §12) covers:

- **Modules:** CRM pipeline, quotations, invoicing, collections, support, recruitment and
  performance;
- **AI:** a sales assistant, CV screening and review drafting;
- **n8n:** lead capture, collection reminders, expiry alerts, and onboarding and offboarding kits.

**◆ Gate 3:** pilots run their sales pipeline and one appraisal cycle in the system.

This plan continues the numbering and style of Phase 2. Business rules come from:

- spec §6.8 (CRM), §6.5 (performance) and §6.4 (commissions into payroll);
- §5 (the discount approval chain and the headcount chain);
- §4 (the Sales user role and the matrix rows for CRM and appraisal);
- §8 (AI features 3, 8 and 9, and the guardrails, especially fairness and untrusted outside
  content);
- §9 (events lead.created, opportunity.won, invoice.created, invoice.overdue, payment.received,
  ticket.created and ticket.sla_breached).

**Builds on Phase 2:**
- **Invoices** post to the ledger the way vendor bills do (one document, one posting), and the
  VAT invoice (Mushak 6.3) is the sales invoice.
- **Receivables** become a real customer sub-ledger. The WP22 opening invoices move into it.
- **Commissions** reach payroll as payroll variables.

| WP | Scope | Acceptance criteria |
| --- | --- | --- |
| **WP23 Customers and leads** ✅ done (ADR 0026) | Customer master (company or person, BIN / TIN, address, territory, payment terms, credit limit, account manager), contacts, the Sales user role (own scope) and Sales head; leads from manual entry, the website form and Facebook lead ads (API for n8n), walk-ins, calls and referrals; duplicate check on phone and e-mail (Bangladesh phone normalisation); auto-assignment by territory, then round robin; activities (calls, meetings, notes, tasks); qualify a lead into a customer and opportunity; customer import (migration template) | A lead never duplicates an existing phone or e-mail; every new lead has an owner at once; a Sales user sees only their own leads and customers |
| **WP24 Opportunities, pipeline and targets** ✅ done (ADR 0027) | Opportunities with stage (company-defined stages with default probability), value, probability, expected close date, won / lost with reason, stage history; pipeline board and weighted forecast; sales targets per user and department per month | The weighted forecast equals Σ value × probability of open opportunities; every stage change is kept |
| **WP25 Products, price lists and quotations** ✅ done (ADR 0028) | Products and services (linked to VAT items), price lists per customer type and fiscal year, quotations (versions, validity, Bangla and English PDF), discount limits per user, product and customer type; above the limit, the discount chain (Sales head → Admin); an accepted quotation becomes an order | No quotation above a discount limit goes out without its approval; quotation totals and VAT reproduce from the lines |
| **WP26 Orders, invoices and the customer ledger** ✅ done (ADR 0028) | Sales orders (credit-limit check: over the limit needs Accounts' approval), delivery, invoice from the order (Mushak 6.3 VAT invoice, numbered; posted Dr receivables, Cr sales and output VAT), credit notes (Mushak 6.7), customer VDS (Mushak 6.6); receivables per customer and invoice, replacing the WP22 opening items; the VAT register reads invoices | The receivables control account equals the open invoices every night; credit limit enforced; invoice VAT ties to the VAT return |
| **WP27 Collections** ✅ done (ADR 0028) | Receipts allocated to invoices (partial, several, on account), cheques and bank deposits (feeding bank reconciliation), customer statements, aged receivables per customer and account manager; collection follow-up tasks; invoice.overdue reminders through n8n at set intervals, escalation to the account manager | A receipt closes exactly what it pays; reminders go once per stage; the aged receivables equal the ledger |
| **WP28 Support** | Tickets (customer, contact, category, priority), SLA per priority (first response, resolution) on working hours, assignment, internal notes and replies, ticket.created and ticket.sla_breached; the Customer 360 page (contacts, activities, opportunities, quotes, orders, invoices, dues and tickets on one screen) | A breach is raised on time from the SLA clock; Customer 360 shows only what the viewer may see |
| **WP29 Recruitment** | New-position requests (Dept Head → HR → Admin, checked against an approved manpower plan), job openings and postings, applicants and CVs (consent and retention), stages, interviews with scorecards, offers (letter from template), hire → employee record and onboarding (no retyping); AI CV screening with protected characteristics removed and reasons shown | A hired applicant becomes an employee with nothing retyped; CV screening never sees name, gender, religion, age or photo, and passes its test set |
| **WP30 Performance** | Cycles (annual / half-yearly), KPI library per designation, goals and weights, self-review, Dept Head rating, HR calibration across departments, continuous feedback notes, increment and promotion proposals → Admin approval → effective-dated salary change → arrears in payroll; AI review drafting from a year of feedback (manager rewrites) | An approved increment reaches payroll as an effective-dated change with the correct arrears; ratings are calibrated before proposals go out |
| **WP31 Commissions, automation, assistant and Gate 3** | Commission rules (on invoiced or collected sales, per target attainment) → payroll variables each month; n8n: lead capture (website, Facebook), collection reminders, expiry alerts (contracts, vendor agreements, insurance, trade licence), onboarding and offboarding kits (employee.created / employee.separated → accounts, IT tasks, welcome pack, asset return); AI sales assistant (lead score with reasons, next best action, follow-up e-mail and quotation text, call note summary); portal and app screens completed; the Gate 3 report | Commission in payroll equals the rule applied to the source invoices or receipts; Gate 3: a pilot runs its sales pipeline and one appraisal cycle in the system |

Screens are built with each work package's API, as in Phase 2. WP31 completes the portal and
app, and the Gate 3 tooling.

**Still open (owner decisions):**

- **Support tickets in v1** (spec §13). This plan includes them as WP28, which can be dropped
  without touching the others.
- **Facebook lead ads:** whose Facebook app and page token. Until then, leads arrive through the
  website form and manual entry.
- **WhatsApp as a channel** for collection reminders. Until then, e-mail and SMS only.
- **Commission basis:** on invoiced or on collected sales; clawback on credit notes.
- **Appraisal:** the rating scale, and whether a forced distribution is used in calibration.
- **CV data:** retention period, and consent wording (Bangladesh data-protection practice).
- **Discount limits and credit limits:** the default values (placeholders until set per
  customer).
