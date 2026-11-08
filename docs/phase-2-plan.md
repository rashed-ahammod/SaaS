# Phase 2 — Finance: work packages

The spec's Phase 2 (spec §12) covers:

- **Modules:** ledger and vouchers, expense claims, procurement, assets and stock, budgets,
  VAT, and tax at source;
- **AI:** a receipt and bill reader, and bank reconciliation matching;
- **n8n:** bank statement import and a compliance calendar.

**◆ Gate 2:** a pilot closes one month fully in the system, and the trial balance reconciles.

The implementation guide details only Phase 1 (guide §24). This plan continues its numbering
and style. Business rules come from spec §6.6 (accounts and finance), §6.7 (procurement,
inventory and assets), §5 (default approval chains) and §11 (financial integrity). Customer
invoicing and collections belong to Phase 3 (CRM). Phase 2 records receipts with receipt
vouchers.

| WP | Scope | Acceptance criteria |
| --- | --- | --- |
| **WP14 General ledger** ✅ done (ADR 0017) | Chart of accounts (Bangladesh template), cost centre = department, July–June fiscal years and monthly periods, vouchers (payment, receipt, journal, contra) with maker–checker through the approval engine, gapless numbering per type per fiscal year, posted = permanent (reversal with a reason), period close, auto-posting framework (one source document = one posting), payroll posting on approval and salary payment on settlement, opening balances, trial balance, general ledger, P&L, balance sheet, nightly integrity checks | Debits always equal credits (database); a closed period accepts only reversals; the same source can never post twice; trial balance, P&L and balance sheet agree with each other; payroll journal equals the approved payroll |
| **WP15 Vendors, bills and tax at source** ✅ done (ADR 0018) | Vendors, vendor bills, VAT deducted at source (withholding entity), income tax deducted at source by payment category (rule pack, per fiscal year), vendor payments, challans and certificates, aged payables, payables control account = sub-ledger | Withholding amounts match the rule pack cases; certificate per vendor per period; control account equals the sub-ledger every night |
| **WP16 Expense claims and employee advances** ✅ done (ADR 0019) | Claims in the employee app with receipts, Dept Head → Accounts (above threshold → Admin), payment, posting, employee advances sub-ledger (with payroll recovery) | A claim is paid once; advances sub-ledger equals its control account |
| **WP17 Procurement** ✅ done (ADR 0020) | Requisition → Dept Head → budget check; quotations (minimum count above a threshold) and comparative statement; purchase order; goods / service received note; vendor bill; three-way match within a tolerance (mismatch blocks payment) | Payment impossible without a matched bill; quotation rule enforced |
| **WP18 Budgets** ✅ done (ADR 0021) | Annual budget per department × account, PO commitment, bill actuals, warning at 80 %, escalation to Admin at 100 %, budget vs actual | Commitments and actuals equal the source documents; thresholds route approvals |
| **WP19 Assets and stock** ✅ done (ADR 0022) | Asset register (tag / QR), assignment with digital acknowledgement, depreciation per class (posted monthly), maintenance, disposal; consumables stock ledger per store with issue requests | Depreciation schedule reproducible; stock never negative; asset return blocks final settlement |
| **WP20 Bank** ✅ done (ADR 0023) | Bank accounts, statement import (CSV per bank), auto-match by amount / date / reference, manual match, reconciliation report; n8n statement import; AI match suggestions | Reconciled balance equals the ledger; no line matched twice |
| **WP21 VAT and compliance** ✅ done (ADR 0024) | VAT rates per item and fiscal year, Mushak data for the monthly return, VDS and TDS challans, compliance calendar (n8n reminders) | Monthly VAT return data ties to the ledger |
| **WP22 Finance portal, reports and Gate 2** ✅ built (ADR 0025; the gate itself awaits a real pilot) | Portal screens for every Phase 2 module, cash flow, aged receivables / payables, department cost, budget vs actual, month-end close checklist, opening trial balance migration and its reconciliation with the old system; AI receipt and bill reader | Gate 2: a pilot closes one month and the trial balance reconciles with its old system |

Screens are built with each work package's API where possible. WP22 completes the portal and
the Gate 2 tooling.

**Still open (owner decisions):**

- Bangladesh chart-of-accounts template reviewed by a pilot's accountant.
- VAT / TDS rates and categories: the placeholder values must be verified, as in Phase 1.
- The first banks' statement formats.
