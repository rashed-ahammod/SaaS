# ADR 0031 — PF fund, resignation from the app, customer import

- **Status:** accepted · 2026-10-30
- **Why now:** the owner's list of what had to be complete before go-live. Migration 0039.
- **Covered by:**
  - `test/integration/completion.int-spec.ts` (5 tests);
  - `src/modules/ledger/pf-fund.spec.ts`;
  - the customer rows in `src/modules/data-import/data-import.spec.ts`;
  - the e2e blocks "completing before go-live" in `portal.spec.ts` and "resignation from the app"
    in `usability.spec.ts`.

## 1. The PF fund (`src/modules/ledger/pf-fund.service.ts`, table `pf_transactions`)

- **Where the fund sits:** the company's books, on PF payable (2170), where payroll credits both
  parts every month. Members' statements now show interest, withdrawals and the settlement,
  dated, beside the monthly contributions.
- **Interest:**
  - **Who and how:** HR or Accounts enters the rate the trustees declared for a fiscal year.
  - **The calculation:** each member's balance on 30 June times the rate, to both parts.
  - **Limits:** once per member and year (unique index), and only after the year has ended.
  - **Posting:** at once, Dr PF interest (5140), Cr PF payable.
- **Withdrawal:**
  - Paid out of the member's own part only, never more than it holds.
  - Accounts prepares the payment voucher for the checker: Dr PF payable, Cr bank.
  - It counts in the statement once posted.
  - A second payment waits until the first is posted.
- **Final settlement:**
  - **Who:** an employee in notice or separated.
  - **What is paid:** the member's own part, plus the employer part vested by completed years
    of service (`PF_VESTING`).
  - **Vesting tiers, a PLACEHOLDER to verify against the trust deed and Labour Act s.264:**
    under 3 years 0%, 3–5 years 50%, 5 years and more 100%.
  - **The rest is forfeited** to the company.
  - **One voucher to the checker:** Dr PF payable (all of it), Cr bank (paid), Cr other income
    (forfeited).
  - **Afterwards** the balance is nil, and there is one settlement per member.
- **Who does what:** payments go out like any payment, so Accounts prepares them
  (`ledger.vouchers.prepare`, plus payroll salary read). HR keeps the opening balances.
- **Posting keys** `pf.payable`, `pf.interest` and `pf.forfeit` were added to the chart template.
  Ledger setup adds them to existing companies (the demo seed runs it every time).

## 2. Resignation from the app (`src/modules/resignation`, table `resignation_requests`)

- **Handing it in:** the employee uses the profile screen, giving a proposed last working day
  and a reason. They see the company's notice period, and a warning when the date is short of
  it.
- **Approval:** request type `resignation`: Dept Head, then HR. The employee can withdraw while
  it waits.
- **Accepted:** `LifecycleService.recordAcceptedResignation` starts the separation exactly as an
  HR-recorded notice does:
  - the status becomes "notice";
  - the clearances are opened;
  - the notice shortfall is worked out;
  - the final settlement follows later.
- **Rejected, returned or withdrawn:** nothing changes for the employee.
- **Its own module,** because the approvals module already depends on employees.

## 3. Customer import (data-import entity `customers`, template 7)

- **The file's columns:** name, company or person, type, Bangla name, old code (kept with the
  batch), BIN, TIN, phone, e-mail, address, district, the salesperson's login e-mail, credit
  limit and payment terms.
- **Checks, in the same way as entering a customer:**
  - Bangladesh phone numbers and e-mails are normalised;
  - districts come from the 64;
  - the BIN is written as 000000000-0000;
  - a phone or e-mail already in the CRM, or twice in the file, is refused;
  - an account manager who is not a Sales user or Admin of the company is refused.
- **Commit and rollback:** commit creates the customers with their credit terms. Rollback
  removes them only while unused (no leads, activities, opportunities, quotations, invoices or
  receipts).
- **Sample:** `backend/samples/migration/7-customers.csv` (five Bangladeshi customers).

## 4. Sales take stock out of the store (2026-10-31, migration 0040)

- **The link:** a product (goods only) can name the stock item it is kept as, in the same unit
  as it is sold.
- **Delivery:**
  - For an order with such products, delivery needs the store the goods leave from.
  - Each stock item leaves as one `sales_issue` move, referencing the order and the challan.
  - It is refused when the store holds less (`STOCK_NOT_ENOUGH`, and the database balance
    check behind it).
  - The order keeps the store.
- **Credit notes:** a credit note with "the goods came back" puts the returned quantity back
  into that store (`sales_return`).
- **A database rule:** a sales issue must name its order, and a sales return its credit note.
- **Quantities, not value:** stock stays in quantity only, as in WP19. There is no
  cost-of-sales posting; inventory valuation would be a later piece of work.
- **The stock overview:** it now lists an item only in the stores it has been kept in. An item
  never stocked anywhere is still listed under every store, since it needs its first receipt.
  Before this, the new finished-goods depot listed every office supply as "low".
- **Demo:** depot FG-CTG (Sagarika Road, Chattogram) holds the three oils from 1 October, and
  the products name them.
