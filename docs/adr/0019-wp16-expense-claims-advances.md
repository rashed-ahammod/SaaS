# ADR 0019 — WP16: expense claims and employee advances

- **Status:** accepted · 2026-10-17
- **Acceptance (docs/phase-2-plan.md):**
  > "A claim is paid once; advances sub-ledger equals its control account."

  Covered by `test/integration/expenses.int-spec.ts` (Meghna Foods), and in the browser by
  `Frontend/web/e2e/finance.spec.ts` and `usability.spec.ts`, task 8.
- **Illustrative values:** the Tk 50,000 threshold for the Admin step and the receipt limits
  of the default categories (e.g. no receipt for local conveyance up to Tk 500). The company
  can change both: approval chains, and categories through
  `PATCH /expense-categories/:id`.

## 1. Claims

The employee files claims in the app (`/claims`):
- one line per expense: date, category, details, amount;
- a photo or PDF of the receipt per line, taken with the phone camera.

**Receipts.** A receipt is needed when a line is above its category's limit. The server checks
the file type from the file's own bytes, and the size limit is 5 MB. A file with the same
SHA-256 can be in one live claim only (duplicate receipts). The database enforces this; when
a claim is rejected or cancelled, its receipts are released and may be claimed again.

**Approval.** Request type `expense_claim`, following spec §5:

| Claim total | Approvers, in order |
|---|---|
| Below Tk 50,000 | Dept Head, then Accounts (verifies the receipts) |
| Tk 50,000 or more | Dept Head, then Accounts, then Admin |

Nobody approves two steps of the same claim (`distinctApprovers`), and nobody approves their
own claim. Returned: back to draft. Rejected or cancelled: the receipts are released.

**Booking at approval** (journal dated on the approval day):

| Side | Lines |
|---|---|
| Dr | each line's category account, with the employee's department as the cost centre |
| Cr | staff advances (1160, employee as party) for the part settled against a cash advance |
| Cr | claims payable to the employee (2190, employee as party) for the rest |

A claim fully covered by its advance is "settled", and nothing is paid.

**Payment.** Accounts creates a linked payment voucher (Dr 2190, Cr cash or bank), and another
Accounts user approves it.
- Bank and wallet payments go only to the employee's **approved salary account**. A claim never
  brings in a new bank account.
- **Paid once.** Enforced by:
  - one payment voucher per claim (`one_posting_per_source`);
  - a second payment is refused while the first waits;
  - a paid claim never changes (`expense_claim_guard`);
  - its payment voucher cannot be reversed.

  A payment that fails at the bank is handled in WP20 (bank).

## 2. Advances: one sub-ledger on account 1160

| Kind | Out | Back |
|---|---|---|
| **Cash advance** (`expense_advances`, request type `expense_advance`, same approval steps as claims) | linked payment voucher: Dr 1160 (employee), Cr cash or bank | settled by claims (at their approval), a cash refund (linked receipt voucher), or recovery from salary |
| **Salary advance** (WP6 `loans`) | **new:** `POST /loans/:id/payout`, a linked payment voucher like the above | payroll installments (the payroll journal already posts Cr 1160 per employee) |

**Recovering from salary** turns what is still open on a cash advance into a salary advance
(`origin = 'advance'`) with installments. No money moves; the balance moves from the cash
advance to the salary advance.

**Salary advance changes (WP6):**
- **Recovery only after payout:** a company that keeps its books in the ERP no longer recovers
  a salary advance before it was paid out. A company without books recovers it as before.
- **Migrated advances:** advances brought in by data migration are marked `origin = 'import'`.
  `POST /companies/:id/employee-advances/opening-posting` posts them into the books once
  (Dr 1160 per employee, Cr retained earnings).

**The sub-ledger, per employee:**
- salary advances that were paid out, migrated, or turned from a cash advance, less what
  payroll recovered;
- plus cash advances paid out, less what came back.

**The nightly check** (`registerCheck`) compares this with account 1160, in total
(`advances_control`) and employee by employee (`advances_employee_mismatch`). It also reports
any balance with no employee (`advances_without_employee`). Account 1160 now takes no manual
entries (role `employee_advances`, like payables). The database also refuses settlements that
add up to more than the advance.

## 3. Screens and demo

- **Employee app.** A Claims card on the home screen opens the claims list:
  - my claims and my cash advances;
  - a new claim, edited as a draft, with the camera used for receipts;
  - asking for an advance.

  The bottom navigation stays at six items.
- **Portal → Expense claims** (Accounts):
  - claims to pay, and all claims (each with its receipts and a Pay button);
  - cash advances (pay out, cash returned, recover from salary);
  - the advances sub-ledger against the books;
  - categories.

  The approvals inbox labels both new request types.
- **Demo seed:**
  - the Bangladesh categories;
  - Rafi's Chattogram advance and the claim that settles it;
  - Rafi's mobile-bill claim, approved and waiting for payment;
  - Mitu's conveyance claim, waiting for Tanvir.
- **Books set up earlier:** they need setup run again to add the posting keys
  `expenses.claims_payable` and `expenses.advances`. The Books page lists missing posting
  accounts.

## 4. Not in this work package

- **Paying a claim with the next salary** (instead of cash, bank or wallet).
- **A salary-advance payout button in the portal.** The payout is available through the API and
  Postman.
- **The AI receipt reader** (amount, date, vendor and VAT from a photo) and **duplicate
  detection beyond identical files.** Both are planned with WP22's AI receipt and bill reader.
