# ADR 0018 — WP15: vendors, bills and tax at source

- **Status:** accepted · 2026-10-17
- **Acceptance (docs/phase-2-plan.md):**
  > "Withholding amounts match the rule pack cases; certificate per vendor per period; control
  > account equals the sub-ledger every night."

  Where each part is covered:
  - Withholding: the cases in `test/withholding-cases/*.yaml` are checked by `withholding.spec.ts`.
  - Certificates and the sub-ledger: `test/integration/payables.int-spec.ts` (Meghna Foods).
  - Portal screens: `Frontend/web/e2e/finance.spec.ts` (demo data).
- **Open:**
  - The rates are **placeholders**. They are in rule pack BD-LABOUR 2026.3, every value marked
    "verify", and production refuses to use them until verified. The tax adviser must confirm:
    - the categories, slabs and sections (Income Tax Act 2023);
    - the surcharge for a vendor without a TIN;
    - the VAT deducted at source shares (VAT and SD Act 2012 s.49);
    - rounding to the taka.

    The acceptance cases are ILLUSTRATIVE until signed, like the payroll cases.

## 1. Rates come from the rule pack

The rule pack is extended rather than given a second pack, because a tenant accepts one pack
version per date. **BD-LABOUR 2026.3** is 2026.2 plus two values:

- `tax.tds.vendor_categories`: one entry per payment category. Each category has either a flat
  rate or slabs, plus the share of the invoice VAT a VAT withholding entity deducts. The
  categories are SUPPLY, PROFESSIONAL, RENT, TRANSPORT, ADVERTISING, SERVICE and EXEMPT.
- `tax.tds.no_tin_surcharge_percent`: the extra percentage for a vendor without a TIN
  (placeholder 50).

`computeWithholding()` (`src/modules/payables/withholding.ts`) is pure code. The rules:

- **Income tax at source** is charged on the amount before VAT. A category with slabs uses the
  rate of the slab the whole amount falls in.
- **VAT at source** applies only when the company is a VAT withholding entity, and only on VAT
  actually charged. It is never more than that VAT.
- **Input VAT** can be claimed only on a VAT-registered vendor's invoice (one with a BIN).
  Otherwise the VAT is added to the cost of each line.
- **Rounding:** the amounts withheld are rounded to the taka.

## 2. Bills

A bill moves through these steps:

- **Draft:** Accounts enters the vendor's invoice (Mushak 6.3): expense lines with cost centre
  and VAT rate. The tax at source is worked out at once as a preview.
- **Submit:** the rates of the bill date are applied again and frozen. The bill goes to the
  approval engine (request type `vendor_bill`): another Accounts user approves, and the Admin
  too from Tk 10 lakh. The maker is never an approver (`distinctApprovers`).
- **Approved:** an automatic journal is posted on the bill date:

  | Side | Lines |
  |---|---|
  | Dr | each expense line (plus VAT in cost), input VAT |
  | Cr | income tax at source, VAT at source, and the payable to the vendor (with the vendor as the party) |

  One withholding row is recorded per tax, for the challan and the certificate.
- **Returned:** back to draft. **Rejected or withdrawn:** cancelled.
- **Correction:** an approved bill is voided only by reversing its journal, and only while
  nothing is paid or deposited.

The database enforces:

- one live bill per vendor and invoice number (case-insensitive);
- the amount paid is between 0 and the net payable;
- net payable = amount + VAT − income tax − VAT withheld;
- an approved bill's amounts never change;
- a cancelled bill stays cancelled.

## 3. Payments and challans: linked vouchers

A vendor payment or a tax challan is a payment voucher that still needs the checker. Two
additions to `VouchersService` make this work:

- **`createLinked()`:** creates the voucher with its source document, numbers it and submits it.
  A linked voucher is never edited. If the checker returns it, it is cancelled, not sent back
  to draft.
- **`registerSource(type, handler)`:** the owning module hears about each outcome:
  - `onPosted`: the checker approved;
  - `onDropped`: rejected, returned or withdrawn;
  - `assertReversible`: it may refuse a reversal;
  - `onReversed`: a reversal was posted.

Payments:
- **Created:** the payment allocates to bills and is checked against what is still owed after
  payments already waiting. The bill rows are locked while this is checked. The voucher is Dr
  payable (vendor), Cr cash or bank.
- **Posted:** the bills' amount paid goes up.
- **Dropped:** the amount set aside for the bills is released.
- **Reversed** (e.g. a bounced cheque): the bills are open again.
- **Bank transfer:** needs the vendor's approved bank account.

Vendor bank accounts work like salary accounts:
- the request needs a step-up code;
- the details are stored encrypted;
- another Accounts user approves (request type `vendor_bank_account`);
- the previous account is retired.

Challans:
- **Created:** all the month's withholdings of one tax that are not yet deposited go into the
  challan. The voucher is Dr TDS or VDS payable, Cr bank.
- **Posted:** the challan is deposited.
- **Dropped or reversed:** the withholdings wait for a new challan.
- **Refused reversal:** once any of its tax is certified, the challan cannot be reversed.

## 4. Certificates

A certificate is issued per vendor, tax and period. It covers the deposited tax that is not
yet certified, and each withholding is certified once (also enforced by the database).

- **Numbers:** `TDSC/2026-27/00001` (VAT: `VDSC/…`), gapless per company, kind and fiscal year.
- **Contents:** the deductor and the vendor's TIN and BIN, then each bill with its base, rate,
  amount, and the challan number and date.
- **Printing:** the portal shows the certificate laid out for printing from the browser. A PDF
  file is not generated yet.

## 5. The payables account equals the sub-ledger

- **No manual entries:** accounts with the role `payables` (2110) take no manual voucher lines
  (`CONTROL_ACCOUNT_MANUAL`). Only bills, payments and their reversals post to them.
- **Nightly check:** `LedgerReportsService.registerCheck()` lets a sub-ledger add checks to the
  nightly worker job and to `GET /companies/:id/ledger/checks`. Payables checks three things:
  - `payables_control`: the account's balance equals the open bills;
  - `payables_vendor_mismatch`: each vendor's balance in the books equals that vendor's open bills;
  - `payables_without_vendor`: a payables balance has no vendor.
- **Opening vendor balances:** not supported yet. They come with the opening trial balance
  migration in WP22, as opening bills.

## 6. Reports

- **Aged payables** as of a date, by days past due: not due, 1–30, 31–60, 61–90 and over 90
  days. Payments dated after the date are not counted.
- **Vendor statement:** the vendor's account in the books, with a running balance.

## 7. Permissions

| Key | Accounts | Admin | Auditor |
|---|---|---|---|
| `payables.view` | ✓ | ✓ | ✓ |
| `payables.manage` (vendors, bank accounts, bills, payments) | ✓ | | |
| `payables.tax` (settings, challans, certificates) | ✓ | | |

The cross-tenant sweep covers the new routes (`vendorId`, `billId`, `vendorPaymentId`,
`challanId`, `certificateId`). Vendor payment routes use `vendorPaymentId` because `paymentId`
already means a salary payment.

## 8. Portal (finance screens, also for WP14)

Finance screens were moved forward from WP22 so pilots can see the books:

| Screen | Contents |
|---|---|
| Books | setup, nightly checks, what is waiting |
| Vouchers | list, new, detail, submit, reverse |
| Chart of accounts | accounts, posting accounts, closing months |
| Financial reports | trial balance, P&L per department, balance sheet, general ledger, aged payables |
| Vendors | details, bank account, bills, statement, certificate |
| Vendor bills | new, detail with the tax at source, pay |
| VAT & tax at source | waiting by month, deposit by challan, challans, certificates, settings and rates |

The approvals inbox labels the new request types. In the demo data the workspace owner
(`admin@demo.test`) is also an Accounts user, so that someone can check Sujit's work.
