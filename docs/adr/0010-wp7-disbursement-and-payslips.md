# ADR 0010 — WP7: disbursement, payslip PDFs, salary journal

- **Status:** accepted · 2026-10-15
- **Open:** the bank and wallet file layouts are ILLUSTRATIVE. Each must be confirmed with the
  pilot's bank or provider before the first live payroll (guide §13 step 6).

## 1. Payments: one per employee, month and pay type

When a payroll run gets its final approval, `DisbursementService` creates a `payments` row for
every employee whose net pay is positive. It runs inside the approval's own transaction,
through `PayrollRunsService.onRunApproved`, so payroll does not depend on disbursement.

- **Pay type:** `salary`, `final_settlement` or `bonus:<bonus name>`.
- **Destination:** the salary account approved at that moment. That is `bank` for a bank
  account, the provider (`bkash`, `nagad`, `rocket`, `upay`) for a wallet, and `cash` when the
  employee has no approved account. An account change approved later does not redirect a
  payment that already exists. This closes the classic payroll-fraud path.
- **Reference:** each payment gets a random reference such as `PAY-2026-09-7F3A91C2`. It is
  printed in the file and matched in return files.

**Duplicate payments are impossible (WP7 acceptance):**

- The unique index `one_payment_per_period (employee, period, pay_type)` covers payments in the
  `approved`, `in_file` and `paid` states.
- A trigger refuses any change to a payment's amount, employee, run, channel, account, reference
  or pay type. Only status fields move.
- Generating the same file twice is safe: the same Idempotency-Key returns the first file, and a
  new key is refused while a file is active.

Payment states:

```
approved -> in_file -> paid
                 \        \
                  -> returned -> reissued   (the re-issue is a NEW payment, reissue_of = old id)
```

## 2. Files and adapters

`POST /payroll-runs/:id/disbursement-files { channel, adapter? }` builds one file per run and
channel from the payments waiting for it.

- **Security:** the route needs `payroll.disburse` and a step-up 2FA code (spec §11).
- **Storage and checksum:** the file is stored through `FileStorage` with its SHA-256. A
  download is refused if the stored bytes no longer match the checksum.
- **One active file per run and channel**, enforced by a unique index.
- **Cancelling an active file** needs a reason and a second approval, request type
  `disbursement_file_cancel` with default chain `role:admin`. Once approved, the file's unpaid
  payments are freed and a new file can be generated.

Adapters (`src/modules/disbursement/adapters.ts`) are pure functions from payments to file
text:

| Adapter | Format |
| --- | --- |
| `beftn-csv` | BEFTN bank transfer: routing number and account number |
| `bkash-bulk`, `nagad-bulk`, `rocket-bulk`, `upay-bulk` | Wallet bulk files |
| `cash-list` | Cash sheet with a signature column |

To support a new bank format, add an adapter. No other code changes.

## 3. Settling, returns, re-issue

- **Settle** (`POST /disbursement-files/:id/settle`): the bank has paid, so every payment
  still in the file becomes `paid`.
- **Return file import:** the file is a CSV whose header names `REFERENCE`, `STATUS` and
  `REASON`. Statuses RETURNED, REJECTED and FAILED mean returned; SUCCESS, PAID and CREDITED mean
  paid.
  - The import is **all-or-nothing**: an unknown reference or status rejects the whole file.
  - Importing the same returns again changes nothing.
  - Returns are accepted before or after settling.
- **Re-issue** (step-up 2FA) pays a returned payment again, to the account approved now or in
  cash. The new payment then goes into a new file.
- **Run disbursed:** when no payment of a run is waiting, in a file or returned, the run becomes
  `disbursed`. `payroll.disbursed` then goes to the outbox, with no amounts, for payslip
  delivery in WP10.

Payroll treats `approved` and `disbursed` alike for year-to-date tax, arrears and payslips
(`PAID_STATES`).

## 4. Payslip PDF

The PDF is built with pdfkit and the embedded Noto Sans Bengali font (OFL licence, in
`assets/fonts`).

- **Bangla rendering:** fontkit shapes the text, so conjuncts such as ক্ষ, ন্ত and ম্ব render
  correctly. This was checked visually.
- **Mixed text:** the font comes as separate Bangla and Latin files, so text is drawn in
  script runs (`scriptRuns`).
- **Languages:** amounts use lakh grouping, with Bangla digits in the Bangla version. The net
  pay is also written in words, in both languages.
- **Routes:**
  - `GET /me/payslips/:runId/pdf?lang=bn|en&protect=true` for the employee;
  - `GET /payroll-runs/:runId/employees/:employeeId/payslip.pdf` for HR and Accounts, who need
    salary field access.
- **Password protection (optional):** the password is the date of birth as DDMMYYYY, or the
  employee code when no date of birth is recorded. The `X-Payslip-Password` response header
  says which.

**Known limit:** copying or searching Bangla text inside the PDF gives wrong characters,
because pdfkit does not map shaped glyphs back to text. Display and printing are correct. If
search is needed later, render through a browser engine instead.

## 5. Salary journal CSV

`GET /payroll-runs/:id/journal.csv` exports the journal per cost centre. The cost centre is
the department's `cost_centre_code`, taken from each employee's placement at the end of the
period. Phase 2 posts the same entries to the ledger automatically, once per source document.

| Side | Account |
| --- | --- |
| Debit | `Salary expense - <head>` (unpaid days reduce it) |
| Debit | `<employer cost> expense` |
| Credit | Income tax payable (TDS) |
| Credit | Provident fund payable |
| Credit | Staff salary advance |
| Credit | Notice pay recovered |
| Credit | `<deduction> payable` |
| Credit | Salaries payable (net) |

The last row holds the totals, and debit always equals credit. The account names are an
illustrative chart of accounts; the accounts module (Phase 2) will map them.

## 6. Kept for later

- **Payslip visibility:** payslips are visible from approval, not only from disbursement. Spec
  §6.4 publishes them after the file is generated. Switch this if the pilot wants that order.
- **Delivery:** payslip e-mail and SMS delivery, and the "salary credited" SMS, belong to WP10
  (n8n, from `payroll.disbursed`).
- **Bank APIs:** there are no host-to-host bank connections. Files are uploaded by hand to the
  bank or wallet portal.
