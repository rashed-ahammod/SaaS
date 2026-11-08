# ADR 0021 — WP18: budgets

- **Status:** accepted · 2026-10-28
- **Acceptance (docs/phase-2-plan.md):**
  > "Commitments and actuals equal the source documents; thresholds route approvals."

  Where each part is covered:
  - `test/integration/budgets.int-spec.ts` (Meghna Foods): a posted bill is actual; an issued
    order is committed; its bill moves that part from committed to actual with the total unchanged,
    and the actual equals the posted voucher lines; a requisition within the budget has 2 approval
    steps, one over it 3 (the Admin); an order over its account waits for the Admin and commits
    nothing until approved; a department without a budget is flagged; alerts once per level.
  - `src/modules/budgets/budget-math.spec.ts`: the arithmetic and the levels.
  - Screens: `Frontend/web/e2e/finance.spec.ts` (Accounts, Dept Head), with the demo data.
- **Open:**
  - Placeholders: warning at 80 %; spending in a department without a budget needs the Admin.
  - Budgets are yearly; no monthly phasing yet. Commitments are before VAT (a vendor without a BIN
    adds VAT to cost when billed, so the actual can be a little higher than the commitment was).
  - Expense claims are not checked before approval; they count as actual once posted.

## 1. Budget

- One budget per company, fiscal year (the ledger's year, else from the company's year start)
  and department; an amount per expense or asset account (not cash, bank, receivables or
  advances).
- Draft → in approval (the Admin, request type `budget`) → approved. Returned → draft; rejected or
  withdrawn → cancelled.
- An approved budget changes only through a **revision** (request type `budget_revision`):
  Accounts, or the Dept Head for their department (`budgets.request_change`), gives the new yearly
  amount of each account to change, with a reason; the Admin approves; the lines change. One open
  revision per budget. A database trigger refuses any change to the lines of an approved budget
  unless the revision handler sets a transaction-local flag.

## 2. Actual and committed

- **Actual:** posted vouchers, debit − credit, on the account with the department as cost centre,
  dated in the fiscal year. Bills, claims and journals all count; nothing is copied.
- **Committed:** issued purchase orders of the department (order date in the year): each line's
  amount before VAT, less what approved bills of that line already made actual (the bill line's
  amount). A cancelled order, or one still waiting, commits nothing.
- Used = actual + committed; available = budget − used; status within / warning (from the warning
  percent) / over (more than 100 %; exactly 100 % is not over).

## 3. Routing (spec §5 "over budget → Admin")

- Budgets apply once the company has an approved budget for the year; before that every check is
  `not_used`.
- **Requisition** (no accounts yet): the department's whole budget after the estimate. Over it,
  or no budget for the department (setting), the requisition's kind is `over_budget` and the
  default chain adds the Admin (the same chain as `above_admin_threshold`). A warning is shown to
  the approvers in the snapshot. The position is stored on the requisition.
- **Purchase order issue** (accounts known; "purchase-order approval commits the amount"): each
  department × account line after the order. If any line goes over its budget (an account the
  budget does not name counts as 0), the order waits for the Admin (new state `in_approval`,
  request type `purchase_order`); approved → issued; returned or rejected → draft. Otherwise it is
  issued at once. The position is stored on the order.

## 4. Alerts and the report

- Worker job `budget-alerts` (hourly): for the current year's approved budgets, each line and the
  department total reaching the warning percent (level 80) or 100 % raises one
  `budget.threshold_reached` event (table `budget_alerts`, once per level). Notifications: the
  Dept Head at 80 %, the Dept Head and the company's Admins at 100 % (in-app and e-mail).
- **Budget vs actual** (`GET /companies/:id/budget-vs-actual`): each department with a budget (its
  lines and the accounts it spent on without a line), and each department that spent without a
  budget. A Dept Head sees their department.

## 5. Permissions

| Permission | Roles |
|---|---|
| `budgets.view` | Admin, Accounts, Auditor (company); Dept Head (department) |
| `budgets.manage` | Accounts |
| `budgets.request_change` | Dept Head (department) |

Approving budgets, revisions and over-budget orders is an Admin step in the approval engine.
Migration `0028_budgets.sql`.
