# ADR 0025 — WP22: finance portal, reports and Gate 2

- **Status:** accepted · 2026-10-30
- **Acceptance (docs/phase-2-plan.md):**
  > "Gate 2: a pilot closes one month and the trial balance reconciles with its old system."

  **What is proved here, and what is not.** The tooling is built and rehearsed end to end. The
  gate itself needs a real pilot company and its real old system: that is an owner decision
  and a field step, not code.

  The rehearsal:
  - `test/integration/close.int-spec.ts` (Meghna Foods test company):
    - **The opening trial balance (Tally, 30 September):**
      - it is refused with every problem listed when it is wrong;
      - once posted through the checker and the Admin, it is the opening voucher with the
        unpaid vendor bill and customer invoices behind the control accounts;
      - the nightly checks pass.
    - **October:**
      - rent, a cash sale, and a customer payment;
      - cash flow (opening cash + flows = closing cash, exactly);
      - department cost and aged receivables.
    - **The close:** the checklist holds the close until the person's items are ticked; then
      October closes.
    - **The comparison with Tally at 31 October:**
      - first two old accounts not mapped;
      - then a rent booked differently in Tally (two differences);
      - then it agrees.
    - **The Gate 2 report passes** on all five criteria.
    - **The AI bill and receipt reader:**
      - the vendor is found by BIN, and figures that do not add up are flagged;
      - unreadable photos are reported as unreadable;
      - its own switch, and its release-gate test set.
  - `src/modules/close/close.spec.ts`: the file parsing, the comparison, and the reader's checks.
  - **Demo:** a second company, Meghna Agro Industries Ltd, runs the same story from the
    sample Tally files in `backend/samples/finance`. Its Gate 2 passes.
  - **Screens:** `Frontend/web/e2e/finance.spec.ts`:
    - new reports;
    - the pilot company's close, comparisons and Gate 2;
    - a bill filled from a scan.
- **Open:**
  - **The real Gate 2:** a pilot company, its accountant's sign-off on the chart (phase-2-plan
    "still open"), its real Tally / old-system exports, one real month.
  - **Not built:**
    - receivables beyond the opening invoices (customer invoicing comes with Phase 3 CRM);
    - no PDF of the reports (screens and API only);
    - the cash flow is the direct method only, classed by account group (1200 investing;
      equity / 2200 financing).
  - **Employee advances in the opening:** the import checks the employee exists. Whether the
    total equals the loans and advances already migrated (WP8) is left to the nightly checks,
    which the month-end checklist requires.
  - **The AI reader:**
    - the photo goes to the provider unmasked: a business document, and the Admin switches the
      feature on knowingly;
    - before a pilot, run its test set with the real provider on real scans (the fake reads
      text embedded in the sample files).

## 1. Opening balances from the old system

- **File:** `POST …/opening-balances` (CSV + cut-over date, a 1st). One row per balance:

  ```
  account_code, old_code, old_name, debit, credit, party, reference, date, due_date, department_code
  ```

  - Payables rows name the vendor code and the bill.
  - Receivables rows name the customer and the invoice.
  - Employee advance rows name the employee code.
  - The file must balance, and every account must exist and take postings.
- **Posting:**
  - The file becomes THE opening voucher: a linked journal with `isOpening`, one per company.
  - It goes through maker-checker; above the voucher limit, the Admin too.
- **Once the voucher is posted:**
  - opening vendor bills (`vendor_bills.is_opening`, carried by the opening voucher) and
    receivable items are created, so every control account equals its sub-ledger from day one;
  - the old codes become the **account map**;
  - the months before cut-over that have no vouchers close (the old system kept them).
- **A posted opening is final** (reversal refused; corrections are journals).

## 2. Receivables

- `receivable_items`: the customers' unpaid invoices from the opening.
- A receipt against an item is a linked receipt voucher to the checker; it counts once posted.
- **The receivables account is now a control account.** No manual voucher lines may touch it,
  and a nightly check compares it with the open items.
- **Aging:** by due date, as of a date (not due, 1–30, 31–60, 61–90, over 90 days).

## 3. Reports

- **Cash flow** (direct method). Each voucher that touches cash or bank attributes its money to
  its other lines, classed by account:

  | Class | Accounts |
  |---|---|
  | Investing | under group 1200 |
  | Financing | equity, or under group 2200 |
  | Operating | everything else |

  - Transfers between cash and bank are left out.
  - The opening voucher is opening cash, not a flow.
  - The difference (opening + flows − closing) is shown; it is zero unless a shared voucher
    rounds.
- **Department cost:** expenses by department and expense group; lines without a department
  show as "not assigned".
- **Already there:** budget vs actual (WP18), aged payables (WP15), and the trial balance, P&L
  and balance sheet (WP14).

## 4. Month-end close

- **The checklist** (`GET …/month-close/:period`):
  - **Automatic:**
    - no draft or waiting voucher in the month;
    - the nightly checks pass;
    - every bank account reconciles at month end and has a statement for the month;
    - depreciation posted (when there are assets);
    - payroll posted (when there is a run);
    - the VAT return data ties.
  - **By a person, with a note:** accruals, prepayments, petty cash, stock count (when there are
    stores), asset additions.
- **The close:** `POST …/close` closes the period only when every item is done. The ledger's
  period rules apply (earlier months first; afterwards, reversals only).

## 5. The old system's trial balance, and Gate 2

- `POST …/old-system-comparisons` takes CSV (`old_code, old_name, debit, credit`) and a date.
  - Each old account goes to ours through the map.
  - The result, stored for good: per account, old balance, ours and the difference; old
    accounts with a balance and no mapping.
  - `matched` means no differences and nothing unmapped.
- **Mapping later accounts:** `PUT …/account-map` maps old accounts that appear after cut-over
  (e.g. income and expense accounts).
- **`GET …/gate-2` criteria:**
  1. opening posted;
  2. a month after cut-over closed;
  3. that month's checklist complete;
  4. the old system's trial balance at that month end matches;
  5. the nightly checks pass.

## 6. AI bill and receipt reader (spec §8)

- **Endpoint:** feature `document_reader`, prompt `document-reader-v1`, with its own switch.
  `POST /ai/document-reader` takes a photo or PDF (at most 5 MB) and a kind (bill / receipt).
- **The answer:**
  - fields in a fixed JSON shape, each checked; anything malformed becomes null;
  - warnings where figures do not add up;
  - the vendor matched by BIN, then by name, when the user may see vendors.
- **Nothing is saved:**
  - the portal's bill form ("Read a scan") is prefilled;
  - in the app, photographing a claim's receipt fills the line's empty date, amount and
    description, with a note to check them.
- **Provider:** user messages can carry files (images, PDF), passed to the provider as
  image / document blocks.
- **Release gate:** `npm run ai:eval -- --only=document_reader` runs
  `test/ai-eval/document-reader.yaml` over `samples/documents`
  (`node scripts/make-sample-documents.mjs`).

## Permissions

| Permission | Roles |
|---|---|
| `receivables.view` | Admin, Accounts, Auditor |
| `receivables.manage` | Accounts |
| Opening balances, account map, comparisons | `ledger.setup` |
| Checklist ticks and close | `ledger.periods.close` |
| Reports, checklist view, Gate 2 report | `ledger.view` |
| Document reader | `payables.manage` (bills) or `expenses.claim_own` (one's own receipts) |
