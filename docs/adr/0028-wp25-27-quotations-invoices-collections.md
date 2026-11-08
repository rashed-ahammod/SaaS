# ADR 0028 — WP25–WP27: quotations, orders, invoices and collections

- **Status:** accepted · 2026-10-30
- **Plan:** `docs/phase-3-plan.md`, WP25, WP26 and WP27, built together as one sales module
  (`src/modules/sales`, migrations 0037–0038).
- **Acceptance (docs/phase-3-plan.md)** and where each part is covered. Everything below is in
  `test/integration/sales.int-spec.ts` (Meghna Foods, clock 3 November 2026; 12 tests) unless it
  says otherwise.
  - **WP25:** "No quotation above a discount limit goes out without its approval; quotation
    totals and VAT reproduce from the lines".
    - A line typed below the list price counts as discount: 170 against 185 is 8.11%, above
      Rafi's 5%.
    - Such a quotation cannot be sent (409) until the Sales head and then the Admin approve.
    - The quotation's value and VAT equal the sums of its stored lines.
  - **WP26:** "The receivables control account equals the open invoices every night; credit
    limit enforced; invoice VAT ties to the VAT return".
    - The ledger checks are clean after the invoices, the credit note and the receipts. The
      control check now subtracts credit notes.
    - An order that takes Khatunganj Traders to Tk 5,88,524 against a Tk 5 lakh limit waits for
      Accounts and cannot be invoiced until approved.
    - The November VAT preview ties output VAT to the invoices, the credit note and the VAT the
      customer deducted: Tk 64,200.80 = 74,200.80 − 10,000, with no unexplained lines.
  - **WP27:** "A receipt closes exactly what it pays; reminders go once per stage; the aged
    receivables equal the ledger".
    - Three receipts close two invoices to the paisa. They are a cheque with VAT deducted at
      source, a transfer split across two invoices, and bKash money kept on account and applied
      later.
    - The receivables account comes back to 0.
    - A run on the same day sends nothing again.
    - A run that skipped stages sends only the latest stage (16 days late: stage 15, with stage 7
      recorded).
    - Aging, per customer and per account manager, equals the ledger.
  - **Also:**
    - `src/modules/sales/sales.spec.ts`: pricing, totals, limit selection, the credit check,
      reminder stages, credit-note shares.
    - The cross-tenant sweep covers the new routes.
    - **Screens:** `Frontend/web/e2e/finance.spec.ts`, block "Sales: quotations, orders,
      invoices, receipts" (Rafi, Tanvir, Sujit, on the demo data).

## 1. Products, prices, limits (WP25)

- **Products** (code, Bangla name, unit, goods or service) sit on a WP21 VAT item, so the VAT
  rate follows the national fiscal year.
- **Price lists:**
  - per fiscal year (July–June), for every customer or for one customer type (dealer,
    retail, …);
  - a new list replaces the active one of the same year and type;
  - the customer type's list is used first, then the list for everyone;
  - a salesperson may type another price, which counts against their discount limit.
- **Discount limits:**
  - set per salesperson, product and customer type, or company-wide;
  - the most specific limit applies, and between two equally specific limits the lower one;
  - with none set, the limit is a 5% default (placeholder; owner decision in the plan).
- Products, price lists and limits are set up by the Admin or Accounts (`sales.catalogue`).
  Salespeople read them.

## 2. Quotations (WP25)

- **Numbering:** `QT/2026-27/00001`. A revision keeps the number, adds `revision`, and the old
  one is superseded.
- **States:**
  - draft → (in approval) → approved → sent → accepted | declined;
  - a sent one past its validity reads as expired (set when it is read; no job needed);
  - draft, in-approval and approved quotations can be cancelled.
- **The discount chain** (spec §5), request `quotation_discount`: the owner's Dept Head (the
  Sales head), then the Admin, with distinct approvers. A rejection sends it back to draft.
- **Sending** moves a linked open opportunity to "Quotation sent", if that stage exists and the
  opportunity is at an earlier stage.
- **Accepting** places the order. A linked opportunity is then won at the quotation's value,
  which raises `opportunity.won`.
- **PDF:** a Bangla or English PDF, on the same layout as the invoice.

## 3. Orders, invoices, credit notes (WP26)

- **Orders** (`SO/…`) copy the accepted quotation's lines.
- **The credit check** adds open invoices, open orders and the new order, and compares that
  with the credit limit set by Accounts:
  - over the limit, the order waits for Accounts (request `sales_order_credit`);
  - a rejection cancels the order;
  - a customer with no limit set (Tk 0) needs that approval for every order on credit.
- **Delivery:** the order is marked delivered with the delivery challan number. Stock is not
  moved: the WP19 stores are internal, and sales stock is not built.
- **Invoices** (Accounts):
  - **Numbering:** they take the Mushak 6.3 numbers of the WP21 VAT invoices (`VI/…`), so
    there is one gapless series.
  - **Due date:** the invoice date plus the customer's payment terms.
  - **Posting:** posted at once (one document, one posting): Dr receivables, Cr sales (4100),
    Cr output VAT (2160).
  - **Sub-ledger:** the invoice becomes a `receivable_item`, the WP22 sub-ledger, which now
    knows the customer and the invoice.
  - **Event:** `invoice.created`.
  - **Corrections:** invoices are never reversed by hand; a credit note corrects them.
  - **Services:** an order of services only can be invoiced once confirmed.
- **Credit notes** (`CN/…`, Mushak 6.7):
  - a quantity back on each invoice line, at that line's share of value, SD and VAT;
  - never more than was invoiced and is still owed;
  - Dr sales, Dr output VAT, Cr receivables;
  - the item's `credited` goes up by the note's total.
- **The VAT register:** `VatService.registerSalesSource` adds invoice lines, and credit-note
  lines as negatives, to the month's sales. The return's output-VAT tie accepts these sources
  as explained.
- **PDFs:** the Mushak 6.3 PDF layout is ILLUSTRATIVE; the VAT consultant checks the boxes.

## 4. Collections (WP27)

- **Receipts** (`CR/…`, Accounts):
  - **How:** cash, cheque (number and bank), bank transfer, bKash, Nagad.
  - **Allocations:** to the customer's open invoices, never more than is open after receipts
    still waiting; what is left stays on account.
  - **VAT deducted at source** by the customer (Mushak 6.6 certificate) settles the invoice
    too, and posts Dr output VAT as WP21 does.
  - **The voucher** goes to the checker: Dr cash/bank, Dr output VAT (VDS), Cr receivables
    (allocated), Cr customer advances (on account).
  - **A deferred trigger** checks at commit that the allocations add up to `allocated`.
  - **Posted:** the invoices count the money (`payment.received`).
  - **Reversed** (a bounced cheque): the invoices owe it again. This is refused if money on
    account from that receipt has been applied since.
  - **Bank reconciliation:** the money lands on the bank's ledger account, so WP20 matches it.
- **Money on account:**
  - posts to a new control account, 2105 "Customer advances", with role `customer_advances`
    (no manual lines);
  - applied to an invoice later by an automatic journal (Dr 2105, Cr 1150);
  - a nightly check keeps 2105 equal to the money on account.
- **Statement of account** between two dates: invoices, credit notes, receipts (and
  reversals), with the running balance. A negative balance is money on account.
- **Aged receivables (WP22 report, extended):**
  - counts every payment and credit up to the date;
  - per customer or per account manager.
- **Reminders** (worker job `collection-reminders`, every 6 hours):
  - stages at 1, 7, 15 and 30 days late (placeholders);
  - each stage is recorded once (`collection_reminders`), and only the latest stage reached
    goes out;
  - `invoice.overdue` carries the customer's e-mail and phone for n8n (the workflow is WP31);
  - from 15 days late, the account manager gets an in-app and e-mail notification
    (`invoice_overdue`) and a collection task.

## 5. Demo data (Demo Trading Ltd)

- **Products:** rice bran oil 5 L, soybean oil 1 L and mustard oil 500 ml.
- **Price lists:** 2026-27 prices and a dealer list.
- **Discount limits:** 3% for everyone, 5% for Rafi and Mitu.
- **Karim Stores:** the quotation is accepted, delivered, invoiced (VI/2026-27/00004) and part
  paid by cheque (Tk 2 lakh).
- **Meghna Dealers:** the Eid quotation at 8% off is waiting for Tanvir.
- **Sylhet Agro:** an order over its Tk 3 lakh credit limit is waiting for Sujit.
- **Bogura Traders:** an invoice dated 5 October with 15 days' terms is past due, so it gets
  reminders.

## 6. Not built (and why)

- **Stock** is not issued on delivery: sales stock is not built.
- **Credit notes for returns** do not bring goods back into stock.
- **The customer's own reminder e-mail and SMS** go through n8n; the workflow is WP31.
- **The customer import from the old system** (migration template) is still open (ADR 0026).
- **Placeholders:** discount limits, reminder stages and the Mushak layouts.
