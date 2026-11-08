# ADR 0020 — WP17: procurement

- **Status:** accepted · 2026-10-21
- **Acceptance (docs/phase-2-plan.md):**
  > "Payment impossible without a matched bill; quotation rule enforced."

  Where each part is covered:
  - `test/integration/procurement.int-spec.ts` (Meghna Foods): the quotation rule (too few
    quotations, a reason for a choice that is not the lowest, no order before the Admin approves
    the comparative statement, only the chosen quotation can be ordered), the three-way match
    (more billed than received, a price above the tolerance, the match recovering when the rest
    arrives), payment refused by the service and by the database, the Admin accepting a variance.
  - `src/modules/procurement/three-way-match.spec.ts`: the match rules on their own.
  - Screens: `Frontend/web/e2e/finance.spec.ts` (Accounts, Dept Head) and `usability.spec.ts`
    task 15 (an employee's purchase request), with the demo data.
- **Open:**
  - The thresholds are **placeholders** (company settings): quotations from Tk 50,000, at least
    3; the Admin approves requisitions from Tk 5 lakh; match tolerance 2 %. The customer sets them.
  - The budget check is the Accounts approval step for now; WP18 adds budgets and commitments.
  - A purchase order is printed from the browser; no PDF yet. No e-mail to the vendor.

## 1. Requisition

- **Who:** any employee for themself (`procurement.request_own`, in the app); Accounts may raise
  one for an employee. The department is the requester's department at the time.
- **Lines:** description, quantity, unit and an estimated price each; the estimate is their sum.
- **Approval** (request type `purchase_requisition`, spec §5): Dept Head → Accounts (budget
  check). From the company's Admin threshold the module marks the request with the kind
  `above_admin_threshold` and the default chain adds the Admin. Customers can configure their own
  chains as for every request type. Returned → draft (the requester changes it); rejected or
  withdrawn → closed. Nobody approves their own request (`distinctApprovers`).
- **Numbers:** `PR/2026-27/00001`, `PO/…`, `GRN/…`: gapless per company and fiscal year
  (`payables_sequences`).

## 2. Quotations and the comparative statement

- Accounts records each vendor's quotation with a price (and VAT rate) for every requisition line;
  one live quotation per vendor; a quotation can be withdrawn until a choice is made.
- **Below the quotation threshold:** one quotation is enough and the order may use any of them.
- **From the threshold:** at least the minimum number of quotations, then the comparative
  statement: the chosen quotation, with a reason when it is not the lowest (total with VAT). The
  Admin approves it (request type `comparative_statement`); returned or rejected, Accounts
  chooses again. The portal shows the quotations side by side per line.

## 3. Purchase order and goods received

- The order is made from a quotation (from the threshold: only the approved choice), with the
  account each line will post to (expense or asset; not cash, bank, payables or advances). Its
  lines copy the requisition's quantities and the quotation's prices. One live order per
  requisition; the requisition becomes "ordered".
- Draft → issued (Accounts). Cancelled only while nothing is received or billed; the requisition
  can then be ordered again.
- **Goods / services received** (`procurement.receive`: Accounts, or the Dept Head for their
  department): quantities per line, never more in total than ordered. The order becomes partly
  received or received. A note entered by mistake is cancelled only if the bills still fit what
  stays received.

## 4. Bills against an order: the three-way match

A vendor bill may name a purchase order (`purchaseOrderId`); each line then names an order line
and a quantity (the amount stays the base before VAT). Payables calls procurement through a small
interface (`PurchaseOrderLink`, registered by procurement), so payables does not depend on it:

- **Validate:** same company and vendor, an open order, every line an order line with a quantity.
- **Match** (`three-way-match.ts`, per order line the bill charges, counting the other live bills
  of the order): billed ≤ received, billed ≤ ordered, unit price (amount ÷ quantity) ≤ order price
  × (1 + tolerance). The result and the details per line are stored on the bill
  (`match_status`, `match_details`).
- **When:** on create, change and submit, and again whenever a receipt is recorded or cancelled or
  another bill of the order is cancelled or voided. A bill that was a mismatch becomes matched by
  itself when the rest arrives.
- **Payment:** a bill whose status is `mismatch` cannot be paid: the payment service refuses
  (`BILL_NOT_MATCHED`), and a database trigger on `vendor_payment_allocations` refuses as well, so
  no code path can pay it. The bill can still be approved (it is a real liability).
- **Variance accepted:** the Admin (`procurement.override_match`, not the bill's maker) may accept a
  mismatch with a reason (e.g. a price rise agreed by phone); the status becomes `overridden` and
  stays so.
- An approved bill keeps its purchase order (the bill guard trigger now covers the column).
- Bills without an order (rent, utilities, services) work as before (`not_required`).

## 5. Screens

- **App:** Purchase requests (home card): list with the state and the order, a new request with
  items and the estimated total, change / send / cancel a draft.
- **Portal → Finance → Purchases:** To buy (approved requisitions), Requisitions, Purchase orders,
  Settings. A requisition shows the quotations side by side and the comparative statement; a
  purchase order shows ordered / received / billed per line, the received notes, and its bills
  with their match. "Enter vendor bill" on the order fills the lines with what is received and not
  yet billed. A bill shows its three-way match; "Pay" is hidden while it does not match.

## 6. Permissions

| Permission | Roles |
|---|---|
| `procurement.request_own` | Employee |
| `procurement.view` | Accounts, Admin, Auditor (company); Dept Head (department) |
| `procurement.manage` | Accounts |
| `procurement.receive` | Accounts; Dept Head (department) |
| `procurement.override_match` | Admin |

Migration `0027_procurement.sql`.
