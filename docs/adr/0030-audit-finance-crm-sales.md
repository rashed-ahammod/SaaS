# ADR 0030 — Role-wise audit: finance, CRM and sales

- **Status:** accepted · 2026-10-30
- **Method:**
  - **API without a screen.** A script compared every route of the finance, CRM and sales
    controllers with the web code. It found 31 candidates; most were paths the screens build
    dynamically. The real gaps are fixed below.
  - **Every menu screen, for every role.** A new test,
    `Frontend/web/e2e/roles-portal.spec.ts`, signs in as each demo role and opens every
    portal screen in that role's menu, then the employee app screens for Rafi, Tanvir and
    Sujit. A screen fails on a browser error, an error box, or any API call refused (403) or
    failing (5xx). The roles are the Sales user, the Dept Head, HR, Accounts, the MD (Admin)
    and the owner. The test stays in the suite, so a menu entry that a role cannot open fails
    the build.

## Found and fixed

1. **A skipped payroll or salary posting could not be posted.**
   - Payroll never waits for the books (ADR 0017): when a run cannot post, it is skipped and
     the nightly checks list it. The API to post it later had no button.
   - The checks now carry the run or file id (`sourceId`), and the finance home has a
     "Post now" button for Accounts.
2. **The next fiscal year could not be opened.** The finance home now lists the fiscal years
   and has an "Open 2027-28" button (`ledger.setup`).
3. **Five ledger checks had no name:** staff advances (three checks), receivables control and
   customer advances control. They now have names in both languages.
4. **Migrated staff advances could not be posted.** When the advances do not match the books and
   the books are empty, the balances tab now offers to post them as opening balances on a date.
5. **Products and stock items could not be edited.** Name, unit, VAT item, reorder level and "in
   use" are now editable; the code stays.
6. **Money on account could not be applied from a screen.** The customer page now has an
   "Apply" button for each open invoice (Accounts).
7. **The Dept Head's budget page was refused its settings (403).** The warning level was checked
   at company scope. Any budget reader may now read it.
8. **The MD's Integrations page was refused the service keys (403).** The list was
   workspace-wide only. A company-scoped Admin now sees that company's keys; creating and
   revoking were already company-aware.
9. **An employee could not withdraw an expense claim from the app once sent.** The claim page in
   the app now has "Withdraw" while the claim is in approval (`POST /approvals/requests/:id/cancel`).
   The claim is cancelled and its receipts released.
10. **The demo inbox filled up.** The app usability test left a claim waiting for Tanvir every
    run. The test now withdraws its claim. The 20 claims left by earlier runs were withdrawn
    through the API as Rafi ("Left behind by automated tests").

## Not changed

- **No auditor demo user**, so the Auditor role was checked by the role matrix tests only.
- **The receipt detail** (`GET /customer-receipts/:id`) and the **VAT sale detail** have no
  page of their own. Their lists show what is needed.
