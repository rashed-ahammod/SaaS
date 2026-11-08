# ADR 0024 — WP21: VAT and compliance

- **Status:** accepted · 2026-10-30
- **Acceptance (docs/phase-2-plan.md):**
  > "Monthly VAT return data ties to the ledger."

  Where it is covered:
  - `test/integration/vat.int-spec.ts` (Meghna Foods, a VAT withholding entity):
    - **The tie:** October's Mushak 9.1 figures from the documents equal the ledger. Input VAT
      account 12,000; output VAT account 25,500 (30,000 less the customer's VDS); VDS payable
      18,000.
    - **A stray journal** to the input VAT account makes the return "not tied". It is listed,
      and filing is refused until it is corrected.
    - **After filing and paying,** the input and output VAT accounts come to exactly zero
      (September's credit included).
    - Also covered:
      - a bill line naming its VAT item takes the item's rate (10 %, not the 15 % typed);
      - VAT from a supplier without a BIN is not claimable;
      - the credit carried forward;
      - a filed month takes no new invoice and no reversal;
      - returns filed in order, for months that have ended;
      - the VAT challan through the checker;
      - the calendar: items closing themselves, closing by hand, reminders once per stage.
  - `src/modules/vat/vat.spec.ts`: VAT and SD arithmetic, the return figures, due dates, and
    reminder stages.
  - Screens: `Frontend/web/e2e/finance.spec.ts` (Accounts, MD), with the demo data.
- **Open:**
  - **PLACEHOLDERS (verify before a pilot):**
    - item rates (standard 15 %; reduced 5 / 10 %; truncated 5 %);
    - the Mushak 9.1 note numbers;
    - every due date of the calendar;
    - the treatment of VDS in the net tax.
  - **Not built:**
    - **Forms:** no Mushak 6.3 / 6.6 PDFs, and no e-return file for the NBR portal. The return
      is filed on the portal, and its acknowledgement is recorded here.
    - **Sales:** no amended returns (corrections go in a later month); no credit and debit notes
      (Mushak 6.7 / 6.8); no export documents.
    - **Ledger:** no separate SD account (SD shares the output VAT account).
  - **Phase 3:** VAT invoices are cash or bank sales. Credit sales and customer invoicing come
    with Phase 3 (CRM).

## 1. Items and rates

- **`vat_items`:**
  - code, name in English and Bangla, goods or service, HS or NBR service code, unit.
  - `POST …/vat-items/defaults` adds a standard set (placeholder rates).
- **`vat_item_rates`:**
  - one rate per item and national fiscal year (July–June: the budget changes rates every July);
  - each rate has a class (standard, reduced, truncated, zero, exempt), a VAT % and an SD %;
  - zero and exempt are 0 % (database check);
  - `POST …/vat-rates/copy` carries a year's rates to the next;
  - a year with filed returns keeps its rates.
- **Vendor bills:**
  - A bill line may name a VAT item (`vatItemId`). Its rate for the bill's fiscal year replaces
    the percent typed, and the class is stored on the line.
  - Lines without an item are classed by percent (15 → standard, 0 → exempt, else reduced).
  - The VAT module plugs into payables through `VendorBillsService.registerVatRates`, the same
    pattern as procurement's purchase-order link, so payables does not depend on VAT.

## 2. Sales register (Mushak 6.2 data)

- **A VAT invoice** (`POST …/vat-sales`):
  - Number `VI/2026-27/00001`, gapless per company and fiscal year (`payables_sequences`, kind
    `vat_invoice`).
  - Lines at their item's rate. SD is charged on the value; VAT on value + SD; both are rounded
    to the paisa.
  - The customer may have deducted VAT at source; the Mushak 6.6 certificate number is then
    required.
- **Its receipt voucher goes to the checker** (`createLinked`, source `vat_sale`):

  ```
  Dr cash / bank   received
  Dr output VAT    VDS deducted by the customer
  Cr sales (4100)  value
  Cr output VAT    VAT + SD
  ```

- The invoice counts in the return once its voucher is posted. Cancelled or reversed invoices
  do not count.
- New posting keys `vat.output` (2160) and `vat.sales` (4100). Ledger setup adds them to existing
  charts.

## 3. The monthly return (Mushak 9.1 data)

**`GET …/vat-returns/preview?period=` works from the documents** (`mushak.ts`, pure):

```
output tax  = VAT + SD of posted VAT invoices, by rate class
input tax   = VAT of approved bills from suppliers with a BIN, by rate class
              (VAT from suppliers without a BIN is shown, not claimed)
net tax     = output - input - VAT deducted by customers - last month's credit
            -> to deposit by VAT challan, or a credit carried to next month
VDS deducted from suppliers: shown; it is deposited by its own VDS challans
```

**Tie to the ledger** (the acceptance). For the month, per account:

| Account | Ledger figure | Must equal |
|---|---|---|
| Input VAT (1180) | net debits | input VAT of the approved bills |
| Output VAT (2160) | net credits | output VAT + SD, less the VAT the customers deducted |
| VDS payable (2150) | net credits | VAT deducted from suppliers |

- **Left out of the tie:** the return's own settlement journal, and VAT / VDS challan payments.
- **Reversals** count under their original voucher's source.
- **Unexplained lines:** every ledger line not from a VAT document (a vendor bill or a VAT
  invoice) is listed.

**Filing** (`POST …/vat-returns`):
- Only a month that has ended, one month after the other, and only when tied.
- It stores the figures and the ties.
- It posts the settlement journal on the last day of the month: Dr output VAT, Cr input VAT, for
  the month's input VAT.
- **One return per company and month** (unique index).
- **A filed month closes for VAT:**
  - no new VAT invoice is dated in it;
  - its invoices and its settlement cannot be reversed;
  - a later change to its bills shows as `changedSinceFiling`.

**VAT challan** (`POST /vat-returns/:id/challan`):
- It is a `tax_challans` row with tax type `vat`.
- Its payment voucher (Dr output VAT, Cr bank) goes to the checker; the challan is "deposited"
  once posted.
- After a month is filed and paid, both VAT accounts net to zero.

## 4. Compliance calendar (spec §10)

- **`compliance_items`:** company, kind, period, title, due date, state (open / done / not
  applicable), evidence.
- **Rules** (`compliance-rules.ts`, placeholders):
  - VAT return and VDS deposit by the 15th of the next month;
  - TDS and salary tax deposits by the 14th;
  - the half-yearly withholding return;
  - the company tax return;
  - the trade licence by 30 September.
- **Kept up to date** on every read and by the worker:
  - items of the months around today are added;
  - open items whose filing or deposit the system can see are closed with evidence;
  - this covers the VAT return filed, VDS / TDS withholdings in deposited challans ("not
    applicable" when nothing was withheld), and the salary tax challan.
- **Closed by hand:** a company's own items (fire licence, ...), and the rest, with evidence.
- **Reminders** (worker job `compliance-reminders`, every 6 hours):
  - one outbox event per item and stage: `compliance.due_soon` at 7 days and at 1 day,
    `compliance.overdue` once overdue;
  - notifications go to the company's Accounts users, and its Admins too when overdue
    (in-app, e-mail; SMS when overdue);
  - n8n delivers them through the existing notifications workflow ("n8n reminders").

## Permissions

| Permission | Roles |
|---|---|
| `vat.view` | Admin, Accounts, Auditor |
| `vat.manage` | Accounts |
| `compliance.view` | Admin, Accounts, Auditor |
| `compliance.manage` | Admin, Accounts |
