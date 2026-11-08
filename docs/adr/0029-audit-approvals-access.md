# ADR 0029 — Role-wise audit: approvals and access

- **Status:** accepted · 2026-10-30
- **Scope:** the same role-wise audit as attendance, leave, payroll and the employee lifecycle
  (ADRs 0007–0009, 0004). Each role was walked through approving, delegating, and granting and
  limiting access.
- **Covered by:**
  - `Frontend/web/e2e/portal.spec.ts`, block "approvals and access audit" (Tanvir, owner);
  - `test/integration/approvals.int-spec.ts` (delegation candidates);
  - the existing access, route-permission and cross-tenant suites (unchanged and green).

## What was found and fixed

The engine and the access model were sound. All of the gaps were screens that were missing.
Each gap is listed with its fix.

1. **Six request types had no name in the inbox.** Purchase requisition, comparative statement,
   purchase order, store request, budget and budget revision showed a raw key. They now have
   Bangla and English names (`lib/access-text.ts`).
2. **A requester could not see their own requests in one place, or withdraw one.** The
   approvals page now has a "Sent by me" tab (`GET /approvals/requests/mine`), and the requester
   can withdraw from the request page (`POST …/cancel`). The approve, return and reject buttons
   are hidden from the requester, and the state is shown in words.
3. **No one could hand over approvals while away.** A "Delegations" tab lists delegations given
   and received, and lets the user create and revoke them.
   - A Dept Head could not list users (that needs `users.manage`).
   - The new `GET /delegations/candidates` returns the active users with a role beyond
     Employee, by name only. It shows no e-mail or phone.
4. **Approval chains could not be set up** (spec §5, "customer can edit"). The new page
   `/portal/approvals/chains` (`approvals.configure`):
   - lists the company's own chains and the built-in defaults;
   - adds a chain: request type, priority, amount range, and steps of line manager, Dept Head
     or a role;
   - switches a chain on or off.
5. **Custom roles could not be made.** The new page `/portal/users/roles` lists the system and
   custom roles. A custom role starts from a system role and keeps only the permissions ticked.
6. **Sensitive fields could not be granted.** The user dialog now shows a user's field grants
   (salary, bank, identity, complaints) and can add or revoke them, with a reason. Custom roles
   can also be granted from the same dialog.
7. **Service keys had no screen.** The Integrations page now creates keys (the secret is shown
   once), lists them with when each was last used, and revokes them. The n8n keys used for lead
   capture and bank statements need this.

## Still open

- **The app (PWA)** has the inbox and decisions, but no delegation screen. Dept Heads use the
  portal for that.
- **A chain's steps** use roles and the line manager or Dept Head. Naming a specific user
  (`user:<id>`) works through the API only.
- **Delegation candidates** are workspace-wide. A delegate outside the requester's company
  still sees only what their own access allows.
