# ADR 0023 — WP20: bank reconciliation

- **Status:** accepted · 2026-10-30
- **Acceptance (docs/phase-2-plan.md):**
  > "Reconciled balance equals the ledger; no line matched twice."

  Where each part is covered:
  - `test/integration/bank.int-spec.ts` (Meghna Foods, Dutch-Bangla current account on 1130):
    - **Reconciled balance:** on 31 October the adjusted bank balance equals the ledger, with the
      difference computed rather than forced. Deposits in transit, an unpresented cheque and
      unrecorded interest each equal their source lines. On 30 September a cheque from before
      the start is still out.
    - **No line matched twice:** refused by the API (`BANK_LINE_ALREADY_MATCHED`) and by the
      database: a unique partial index per side, a deferred check that a match balances and
      that each item is the line's own amount, and items the app cannot switch off directly.
    - Also covered: import (a bad file, the same file twice, overlapping files), auto-match by
      cheque number and by the only line of an amount, a pair offered for one deposit, undo,
      recording a bank charge, the AI suggestion, and the n8n service key.
  - `src/modules/bank/bank.spec.ts`: statement layouts, the running-balance check, line keys,
    and the matching rules.
  - `test/ai-eval/bank-match.yaml`: the AI release-gate set (10 cases, English and Bangla).
  - Screens: `Frontend/web/e2e/finance.spec.ts` (Accounts, MD), with the demo data.
- **Open:**
  - **Bank layouts are ILLUSTRATIVE:** Dutch-Bangla, BRAC, City and a generic CSV. Column names
    and date styles must be checked against real statements of the pilot's banks.
  - **Placeholder matching window (verify):** the bank date may be 5 days before to 30 days
    after the books' date.
  - **Not built:**
    - No PDF or Excel statements, and no MT940 / camt.053.
    - No direct bank API: the bank feed reaches n8n by host-to-host push or a fetcher, signed.
    - No cheque register: cheque numbers come from vendor payments (`reference`) or the
      voucher narration.

## 1. Bank account

- `company_bank_accounts` links a ledger account of role `bank` with the bank's details.
  These are the company's own accounts, not the employees' salary accounts.
- **Statement layout:** `generic`, `dbbl`, `brac` or `city`.
- **Start of reconciliation:**
  - `reconcile_from` is the first day reconciled.
  - `opening_bank_balance` is the bank's balance at the end of the day before.
  - Both can change only until the first statement is imported.
- **Permissions:**
  - `bank.view`: Admin, Accounts, Auditor.
  - `bank.reconcile`: Accounts. Setup, import, matching.
  - `bank.import`: Accounts, and service keys only (n8n).

## 2. Statement import

- `statement-formats.ts` is pure:
  - It finds the header row below the bank's account details.
  - It reads day-first dates (`05/10/2026`, `05-Oct-2026`) and lakh-style amounts.
  - It reads "Dr/Cr" balances and brackets.
  - It skips trailer rows.
- **Refused as a whole** (`BANK_STATEMENT_INVALID`, with the problems listed):
  - a row that is not a date or an amount;
  - a row with both a withdrawal and a deposit;
  - a running balance that does not follow from the line before.
- **The same file twice** (by SHA-256) is refused (`BANK_STATEMENT_DUPLICATE`).
- **Line keys:**
  - Each line gets a key built from date, amount, balance, description and reference.
  - A line already imported from an overlapping file is skipped.
  - Without a balance column, identical lines on a day are told apart by their order.
- **Lines before the start** are skipped.
- Statement lines are append-only; the app role has SELECT and INSERT only.
- Each import runs the rules (section 3) at once.

## 3. Matching

- A match links statement lines to posted ledger lines of the bank's ledger account:
  - It can be one-to-one or any number on each side, as long as the totals are equal.
  - Signs: a deposit or a debit to the bank is +; a withdrawal or a credit is −.
- **The rules (`matching.ts`, pure), for auto-matching:**
  - The amount must be the same, inside the date window.
  - **Agreeing reference:** a cheque or transfer reference, or the voucher number, found on
    both sides.
  - **Auto-match** only when:
    - the best candidate is unique for the bank line;
    - the bank line is the unique best for that ledger line;
    - and either a reference agrees, or it is the only line of that amount on both sides.
  - Ties are left for a person.
  - Ledger lines from up to 30 days before the start are candidates, for old cheques presented
    after it.
- **Options for a person** (`GET /bank-statement-lines/:id/options`): single lines, and two
  lines that together make the amount (one deposit for two receipts).
- **By hand:** any lines, equal totals. Kind `manual`, or `suggestion` when an option or the AI
  was accepted.
- **Undo:** with a reason. The match stays on record with who undid it and when; its items
  leave it by trigger.
- **Record a line:** for a charge or interest the books do not have.
  - `POST /bank-statement-lines/:id/voucher` creates a draft payment or receipt voucher, which
    goes through maker-checker as usual.
  - Once it is posted, the rules match it (on demand, or by the hourly worker job
    `bank-auto-match`).

## 4. AI suggestions (spec §8)

- **Feature `bank_match_suggestion`:**
  - prompt `bank-match-v1`;
  - its own switch in AI settings (`bankMatchSuggestionsEnabled`);
  - the same gateway as the other features (plan, switch, release gate, quota, masking, log).
- **What the model sees:** the bank line and the rules' options (at most 5). It answers JSON
  `{choice, reason}`.
- **How the answer is used:**
  - An answer that is not one of the options counts as no choice.
  - No options means no AI call.
- **The AI never matches.** The accountant accepts or not.
- **Release gate:** `npm run ai:eval -- --only=bank_match_suggestion` runs
  `test/ai-eval/bank-match.yaml`. The fake provider passes 10 of 10; it chooses by shared
  words. Run it with the real provider before a pilot.

## 5. Reconciliation (`GET /bank-accounts/:id/reconciliation?asOf=`)

**The calculation:**

```
bank balance          = opening bank balance + statement lines up to asOf
+ deposits in transit   ledger debits not cleared by asOf
+ unpresented payments  ledger credits not cleared by asOf (negative)
- bank lines not in the books (interest, direct credits; charges with the opposite sign)
= adjusted bank balance          must equal the ledger balance at asOf
```

**What counts as cleared:**
- A line is cleared at asOf when it is in an active match whose every line is dated on or
  before asOf.
- Ledger lines before the start count only when matched; the opening balance stands for the
  rest.

**The difference:**
- It is shown, never forced. A non-zero difference means the opening balance or a line is wrong.
- `statementAgrees` compares the bank's own balance column on its last line with our running
  total. A gap there means a statement is missing.

## 6. n8n statement import (spec §10)

- **Workflow** `n8n/workflows/erp-bank-statements.json`:
  - A signed push (`X-Signature` HMAC-SHA256 of `timestamp.body` with the feed secret, at most
    5 minutes old) is checked.
  - It is posted to `POST /bank-accounts/:id/statements/n8n` with a service key that carries
    only `bank.import`, limited to the company.
  - The Idempotency-Key is the signature, so the same push is one import.
- **No new n8n node types;** the allow-list is unchanged.
- **Response:**
  - The webhook answers at once and never returns workflow data. With "last node" responses, a
    refused push got back the expected signature; this was found in testing and changed.
  - The import's result shows in the ERP's Statements tab.
- **Local test:** `npm run push-statement -- <bank account id> <file.csv>` in `n8n/`.

## 7. Demo data

- The Demo Trading Ltd Dutch-Bangla account on 1130 is reconciled from 1 October 2026.
- **October books:** dealer receipts (two banked as one deposit, two Tk 5,000 receipts on one
  day) and the Link3 internet cheque.
- **Statement to 25 October,** made from the books:
  - cheques presented 3 days late;
  - the last cheque not yet presented;
  - Rahim Traders' deposit in transit;
  - an SMS charge and interest.
- **Sample push file:** `backend/samples/bank/dbbl-sample-26-27-oct-2026.csv`.
