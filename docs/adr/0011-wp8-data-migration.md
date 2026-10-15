# ADR 0011 — WP8: data migration (templates, staging, commit, rollback, sign-off)

- **Status:** accepted · 2026-10-15

## 1. Templates and load order

A company moving to the system mid-year needs its people, salaries, balances and year-to-date
tax figures, not just a list of names (spec §10). There are six templates, loaded in this
order because later ones refer to employees by `employee_code`:

| # | Entity | Becomes |
| --- | --- | --- |
| 1 | `employees` | Employees with their first placement, **active** (or on probation with an end date). Onboarding is marked done. Old employee codes are kept. |
| 2 | `salaries` | `employee_salaries` rows, effective-dated. Earlier history can be included. |
| 3 | `leave_balances` | One leave ledger **`opening`** entry per employee and type, dated the day before cut-over. |
| 4 | `ytd_openings` | `payroll_ytd_openings` (kind `opening`): taxable income, tax withheld, and employee and employer PF for the fiscal year of the cut-over. |
| 5 | `loans` | Approved loans. The principal is what is still outstanding, recovered from `next_period`. |
| 6 | `bank_accounts` | **Approved** salary accounts (encrypted). Later changes go through the approval flow. |

The templates can be downloaded as Excel (a data sheet with an example row, plus an
instructions sheet) or as CSV. Files are uploaded as `.xlsx` or `.csv`; Excel date cells are
accepted. Opening values become **normal records** (guide §17 step 6), so payroll, leave and
disbursement treat them like data entered in the system.

Every record is created through the owning module's service: `EmployeesService`,
`PayrollSetupService`, `PayrollVariablesService`, `LeaveLedgerService` and
`BankAccountsService`. Data import never writes another module's tables directly.

## 2. Staging and validation

An upload creates an `import_batches` row and one `import_rows` row per sheet row, holding the
raw cells and their errors. Nothing else is created at this stage.

- **File-level problems reject the whole file:** a missing required column, an unknown column
  (usually a typo), no data rows, or more than 5,000 rows.
- **Row-level errors are listed per column:**
  - required fields;
  - unknown branch, department, designation, grade, structure or leave type codes;
  - NID of 10, 13 or 17 digits;
  - e-TIN of 12 digits;
  - phone number, dates, and amounts (`"1,80,000"` is accepted);
  - join date before the cut-over;
  - duplicates within the file (code, NID, employee and date, employee and type);
  - duplicates of data already in the system;
  - an unknown or circular line manager;
  - bank details: routing number of 9 digits, account number of 8–20 digits, and a wallet
    provider and number for wallets.
- **Validators are pure functions** (`validators.ts`) over a lookup context read from the
  database. The same rules run at upload, at dry run and again at commit.
- **Fixing errors:** correct the file and upload it again (discard the old batch), or **skip**
  a row with a reason. Nothing is committed while any row that is not skipped has an error.
- **Dry run** shows what would be created, with totals: headcount per department and status,
  gross per department, days per leave type, YTD totals, outstanding advances, and accounts per
  channel.

## 3. Commit and rollback

**Commit** validates again, because data may have changed since the upload. It then creates
everything in **one transaction**: any failure leaves nothing behind. Employees are created
managers-first, so a line manager in the same file exists before their team. Each row records
what it created (`created_record`: table, id and creation order).

**Rollback** is allowed until sign-off. It removes the created records in reverse creation
order.

- The app role cannot delete history, so removal goes through the owner function
  `import_remove_record(table, id)`. It only removes a record that a committed import row
  created.
- It refuses when the record is already used: an employee with salaries, leave, payroll, a
  login, people reporting to them, or a department they head; a loan with recoveries; a bank
  account already used for payments. Rollback is therefore all-or-nothing, and later batches
  must be rolled back first.
- The leave ledger stays append-only. Its trigger allows a delete only from that owner function,
  only for `opening` entries, and only while a transaction-local flag is set.

## 4. Reconciliation and sign-off

`GET /companies/:id/migration/reconciliation?cutOverDate=` adds up what is in the system on the
day before cut-over. The report contains:

- headcount and gross per department, including people with no salary;
- leave balances per type;
- YTD taxable income, tax withheld and PF totals for the fiscal year;
- outstanding advances;
- salary accounts per channel;
- the batches loaded.

It shows only totals, so the customer's Admin can sign without seeing individual salaries.

**Sign-off** (`data.import.sign_off`, held by Admin) stores the exact report and its SHA-256
in `migration_signoffs`, which is append-only. The committed batches of that cut-over become
`signed_off` and can no longer be rolled back. This is the WP8 acceptance check: "pilot data
imported and reconciliation signed". For payroll, sign-off sits alongside the parallel-run gate
(Gate 1).

**Permissions:** `data.import` belongs to HR, who loads the data. `data.import.sign_off` belongs
to Admin, who represents the customer.

## 5. Not included (later, on demand)

- **Not imported yet:** job history before the current placement, attendance history, documents,
  logins, and the opening trial balance with open receivables and payables (Phase 2 finance).
- **No direct importers** from other payroll or accounting tools (guide §1: "Direct importers
  added per demand").
- **PF balances** are recorded as year-to-date figures only. There is no provident fund ledger
  yet.
