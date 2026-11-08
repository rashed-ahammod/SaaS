# ADR 0022 — WP19: fixed assets and stock

- **Status:** accepted · 2026-10-28
- **Acceptance (docs/phase-2-plan.md):**
  > "Depreciation schedule reproducible; stock never negative; asset return blocks final settlement."

  Where each part is covered:
  - `src/modules/assets/depreciation.spec.ts`: straight line and reducing balance, the residual
    value as a floor, an asset brought in with its depreciation so far, catch-up months.
  - `test/integration/assets-stock.int-spec.ts`: each posted run equals the schedule month by
    month (reducing-balance van, straight-line laptop); a period can run once, only the latest
    run can be reversed and the reversal goes to the checker; assignment and acknowledgement;
    an asset still with a leaver blocks the "assets returned" clearance and the final settlement;
    disposal posts the gain or loss; a stock issue cannot take a store below zero, neither through
    the service nor directly in the database; part issues; the reorder report.
  - Screens: `Frontend/web/e2e/finance.spec.ts` (Admin, Accounts, an employee), with the demo data.
- **Open:**
  - Placeholders (verify with the company's accountant / the tax rules): class lives (furniture
    10 years, office equipment 5, computers 3, vehicles 20 % reducing balance), no residual by
    default, depreciation from the month the asset is put into service (a full month).
  - Tax depreciation (the Income Tax Act's Third Schedule rates) is not computed; this is the
    book (accounting) depreciation only.
  - Stock is counted by quantity only: no value, no FIFO/average cost, no posting to an
    inventory account. Consumables are expensed when bought (the bill).

## 1. Asset classes

- Per company: code, name, the asset account in the ledger, the method (straight line with a
  useful life in months, or reducing balance with a yearly rate) and a residual percent.
- `POST …/asset-classes/defaults` creates the standard four (FURN, OFFEQ, IT, VEH) against the
  chart's fixed-asset accounts. The method and life change only before any depreciation of the
  class is posted.

## 2. The register

- Each asset gets a tag `AST-00001` (gapless, `payables_sequences` kind `asset_tag`), name,
  serial, in-service date, cost, residual value, department and location; state in store →
  assigned → disposed.
- **No acquisition posting.** The vendor bill (WP15) already debits the asset account; the
  register records what that money bought. An asset bought before the system is entered with
  `openingAccumulated` as of `openingAsOf` (from the old books); its schedule continues from the
  month after, over the life left.
- The tag label is printed from the asset page with a QR code (`tag|serial`), generated in the
  browser.

## 3. Assignment and acknowledgement

- One open assignment per asset (a unique partial index). The Admin gives it to an employee
  (assigned on, expected return, note) and takes it back (returned on, condition good / damaged /
  lost).
- The employee confirms in the app (Profile → My company assets, `POST /me/assets/:id/acknowledge`);
  the time and IP are kept. Until then the register shows "not acknowledged".
- **Leaving (ADR 0004):** while the register shows an asset with the leaver, the `admin_assets`
  clearance cannot be marked and the final settlement is refused (`ASSETS_NOT_RETURNED`, with the
  tags); the separation screen lists what is still held.

## 4. Depreciation

- `depreciation.ts` is pure: `schedule(asset, until)` gives every month's charge, accumulated and
  book value. Straight line rounds the cumulative amount (so the months add up exactly to cost −
  residual); reducing balance never goes below the residual.
- A run for a month (Accounts, `assets.depreciate`, or the worker every 6 hours for the month just
  ended) charges each asset the schedule's accumulated at that month minus what is already posted
  (so a missed month is caught up). One journal voucher, dated the last day of the month: Dr
  depreciation expense (5280) by department, Cr accumulated depreciation (1290). One posted run per
  company and month; the period must be open in the ledger.
- Only the latest run can be reversed: through the ledger reversal (maker-checker); on approval
  the run becomes reversed and its lines no longer count.

## 5. Maintenance and disposal

- Maintenance: date, service / repair / inspection, what was done, vendor, cost, next due. A
  record only; the bill pays for it.
- Disposal (sale, scrap, write-off) from the store only (take it back first). Depreciation is
  caught up to the month before; then one voucher: Dr accumulated, Dr the receiving account (sale
  proceeds), Cr the asset account (cost), and the difference to gain (4220) or loss (5285) on
  disposal. Setup adds these two accounts to charts made before WP19.

## 6. Stock

- Stores (code, name, keeper) and items (code, name in English and Bangla, unit, reorder level).
- `stock_moves` is append-only: opening, receipt, issue, adjustment (± with a reason).
  `stock_balances` is kept by a SECURITY DEFINER trigger (the app role can only read it) with
  `CHECK (quantity >= 0)`: a move that would take a store below zero fails in the database, whatever
  the code does. The service checks first to give a clear message (`STOCK_NOT_ENOUGH`).
- An employee asks the store from the app (`stock.request_own`, number `SIR/2026-27/00001`); the
  Dept Head approves (request type `stock_issue`); the store issues all or part; the request is
  partly issued until everything asked for is handed over.
- The stock screen shows on hand per store and item, what is below its reorder level, and the
  ledger of a store.

## Permissions

| Permission | Roles |
|---|---|
| `assets.view` | Admin, HR, Accounts, Auditor, Dept Head (their department) |
| `assets.manage` | Admin |
| `assets.depreciate` | Accounts |
| `assets.own` | Employee |
| `stock.view` | Admin, Accounts, Auditor, Dept Head |
| `stock.manage` | Admin, Accounts |
| `stock.request_own` | Employee |
