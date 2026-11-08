# ADR 0017 — WP14: general ledger

- **Status:** accepted · 2026-10-16
- **Acceptance (docs/phase-2-plan.md):** "Debits always equal credits (database); a closed
  period accepts only reversals; the same source can never post twice; trial balance, P&L and
  balance sheet agree with each other; payroll journal equals the approved payroll." Covered by
  `test/integration/ledger.int-spec.ts` (Meghna Foods, fiscal year 2026-27).
- **Open:** the chart-of-accounts template must be reviewed by a pilot's accountant before go-live.

## 1. Data model (migrations 0020, 0021)

| Table | Holds |
|---|---|
| `fiscal_years`, `accounting_periods` | July–June years (or the company's `fiscal_year_start`), twelve monthly periods each |
| `accounts` | chart of accounts: code, name (en/bn), type, parent group, postable, role (cash, bank, payables, …) |
| `posting_accounts` | key → account for automatic postings (`payroll.earning.BASIC`, `payroll.salaries_payable`, …) |
| `voucher_sequences` | the next number per company × fiscal year × voucher type |
| `vouchers`, `voucher_lines` | double entry; a line is debit **or** credit, with optional cost centre (department) and party |

`POST /companies/:id/ledger/setup` copies the Bangladesh template (`chart-template.ts`, codes
1000–5310), the default posting accounts, and opens the fiscal year of the given date. It is
idempotent. Accounts may add accounts and re-map posting keys.

## 2. The database enforces the books

The service checks everything first so the user gets a clear message. The database then
refuses the same mistakes from any other path:

- **Balanced.** A voucher can only become `posted` if its lines balance (`voucher_guard`).
- **Created as a draft.** A voucher row is inserted only as a draft; posting is an update
  that runs the balance check.
- **Posted is permanent.** No column of a posted voucher changes except `reversed_by`. Lines
  are frozen once the voucher leaves draft. `erp_app` has no UPDATE on lines and no DELETE on
  vouchers.
- **Closed periods.** A closed month accepts only reversals, and it never reopens.
- **One posting per source document** (`one_posting_per_source`). **One reversal per voucher**
  (`reversed_once`). **One opening voucher per company** (`one_opening_per_company`).

## 3. Vouchers

- **Types:** payment, receipt, journal, contra.
  - Payment and receipt vouchers need a cash or bank line on the matching side.
  - Contra vouchers move money only between cash and bank accounts.
- **Numbers:** given when the draft is created (`PV/2026-27/00001`), gapless per type and fiscal
  year. A cancelled draft keeps its number and stays visible, so there is no hole to explain.
- **Maker-checker:** done by the approval engine (`voucher` request type).
  - Below Tk 10 lakh, another Accounts user approves.
  - From Tk 10 lakh, another Accounts user approves, then the Admin.
  - The maker is never an approver (`distinctApprovers`).
  - If the voucher is returned, it goes back to draft. If it is rejected, it is cancelled.
- **Correction:** a reversal with a reason. It has swapped lines, is submitted for approval
  automatically, may be dated in a closed month, and is allowed once per voucher.
- **Opening balances:** a journal with `isOpening: true`, dated on the first day of the
  cut-over month, one per company. To change it, reverse it and enter a new one.

## 4. Automatic postings (payroll)

| Event | Voucher |
|---|---|
| Payroll run approved | Journal dated on the last day of the run's month. Dr expense per earning head and employer cost. Cr TDS, PF, staff advances (per employee), other deductions, employer cost payables, salaries payable (net). Per cost centre. |
| Salary file settled | Payment dated on the settlement day. Dr salaries payable, Cr the bank, wallet or cash posting account. Amount = payments paid in the file. |

**Payroll never waits for the books.** The posting runs inside the approval or settlement
transaction, and all its checks run before its first write. If the ledger is not set up, a
posting account is missing or the month is closed, the posting is skipped and
`ledger.posting_skipped` is audited. The nightly worker job `ledger-checks` (and
`GET /companies/:id/ledger/checks`) lists every approved run and settled file without a
posting. Accounts fixes the cause and posts it with `POST /payroll-runs/:id/ledger-posting` or
`/disbursement-files/:id/ledger-posting`. A database error is never swallowed.

**Not yet automatic:** a bank return after settlement (money back into the bank). Until WP20
(bank reconciliation), Accounts books it as a receipt voucher.

## 5. Reports

These read posted vouchers only:

- **Trial balance:** every account's opening balance, the period's movements and the closing
  balance, plus a `balanced` flag.
- **General ledger:** one account's opening balance and every line with a running balance.
- **P&L:** for a date range, optionally for one department (cost centre).
- **Balance sheet:** as of a date. Retained earnings brought forward are computed from earlier
  fiscal years, and profit for the year to date is shown in equity.

The test checks that the balance sheet's profit line equals the P&L's net profit and that both
statements balance.

## 6. Permissions

| Key | Accounts | Admin | Auditor |
|---|---|---|---|
| `ledger.view` | ✓ | ✓ | ✓ |
| `ledger.vouchers.prepare`, `ledger.setup`, `ledger.periods.close` | ✓ | | |

The cross-tenant sweep covers the new routes (`accountId`, `voucherId`). It found two cases,
now fixed:

- Listing vouchers for another tenant's company answered with an empty list. It now returns 404.
- Posting another tenant's bank file returned a 500. It now returns 404.

## 7. Deferred

- **Portal screens** for the ledger come in WP22 with the rest of the finance portal. Until
  then, use the API and the Postman folder "General ledger (WP14)".
- **Year-end close** (moving P&L into retained earnings) is not needed: the balance sheet
  derives retained earnings. A closing voucher can be added later if the auditors want one.
