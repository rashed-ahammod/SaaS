# ADR 0005 — WP2: access control and the approval engine

- **Status:** accepted · 2026-10-14

## 1. Roles: system roles in code, custom roles in the database

The seven system roles (Admin, System Admin, HR, Accounts, Dept Head, Employee, Auditor) are
defined once in `src/modules/identity/access/roles.ts`, from the spec §4 matrix. They are the
same for every tenant and cannot be edited. `roles.spec.ts` checks every matrix cell, about 170
checks in all.

A **custom role** is a copy of one system role with some permissions removed. It can never add
a permission the base role lacks; to give more, grant a second role. Its sensitive-field access
and its 2FA rule come from the base role. Customers therefore cannot create a role that is more
powerful than the defaults they copied.

`user_roles` stores one role per row with one scope: `own`, `department` (and everything below
it, via the closure table), `company` or `group`.

## 2. Where checks happen

| Layer | Check |
| --- | --- |
| `AuthGuard` (every route except login/health) | Token valid, login still active, 2FA for privileged roles, the user holds the route's `@RequirePermission` in **some** scope, and a step-up code for `@RequireStepUp` routes |
| Service | The **specific record** is inside a scope: `access.assert('employee.manage', { companyId, departmentId, employeeId })`. List queries use `access.scopeFilter()` in SQL. |
| Response mapping | Sensitive fields: `access.canSeeField('identity' \| 'bank' \| 'salary', resource)`, otherwise masked |

`test/integration/route-permissions.int-spec.ts` fails if any route has no `AuthGuard` or no
`@RequirePermission` / `@AnyAuthenticated`. That turns "permission checks in the API" into
something the build enforces.

**Documented exception to module ownership:** `AccessService` reads `department_paths`
(read-only) to expand department scopes, because access control cuts across all modules.

## 3. 2FA and step-up codes (spec §11)

- **Mandatory 2FA** applies to privileged roles (Admin, System Admin, HR, Accounts). Without it,
  login returns `mfaSetupRequired: true` and only `/auth/me` and the 2FA setup routes work.
  Enabling 2FA returns a new token that counts as 2FA.
- **Step-up codes** (header `X-OTP-Code`, each code works once) are needed to grant or revoke
  roles and field access, reset a password, and request a salary bank/wallet change.
  Generating disbursement files (WP7) is next.
- `SECURITY_MFA_ENFORCED=false` turns both off for local manual testing. Startup refuses it in
  production. The tests run both ways.

## 4. Approval engine

- **Chains.** The first active configured chain whose conditions match, in priority order;
  otherwise the built-in default in `approvals/chains.ts`. The steps are **frozen on the request**
  at submit, so editing a chain does not change requests already in progress.
- **Approvers** are resolved when a step starts, from current org data (`line_manager`,
  `dept_head`, `role:<role>`, `user:<id>`). If a position is vacant, has no login, or belongs to
  the requester, the search moves up the manager chain. If nobody is found, the company's Admins
  approve. The search stops after 10 levels, so a loop such as "A manages B, B manages A" cannot
  run forever.
- **Self-approval is impossible.** The requester, and the login of the employee the request is
  about, are excluded at resolution **and** refused at action time, including through a
  delegation.
- **Slots** decide how many approvals a step needs: `any` means one shared slot, so the first
  approval wins; `all` means one slot per approver. An escalation adds the late approver's
  manager to the same slot.
- **Execution** runs in one transaction. The owning module registers a handler, and on final
  approval `onApproved()` runs in the same transaction, giving the state `executed`.
  Reject, return and cancel call `onClosed()`.
- **The record** of each request: `approval_actions` is append-only. It stores actor,
  on-behalf-of, comment, IP, device and the request snapshot. Each action is also written to the
  tamper-evident audit log.

## 5. SLA in working hours

Hours run normally on working days and **stop for the whole day** on the branch's weekend and
holidays (Asia/Dhaka calendar). For Dhaka HQ (weekend Friday and Saturday), a request submitted
Thursday 15:00 is reminded Sunday 15:00 (24 h) and escalated Monday 15:00 (48 h).
`OrgLookupService.workingDayChecker()` is the single place WP4 will add holiday calendars.

The worker runs `ApprovalSlaService.processDue()` every minute. The scan uses the `erp_worker`
role, which can only read pending assignments. Each change runs as `erp_app` inside that
tenant's transaction.

## 6. Bootstrap

The first user of a new tenant gets System Admin, Admin and HR with group scope. Nobody may
grant roles to themselves, so without HR the first user could not create employees. Another
admin can revoke HR later.

## Deferred

| Item | Work package |
| --- | --- |
| Holiday calendars in SLA calculations | WP4 |
| Leave, attendance-correction and payroll request types and their default chains | WP4–WP6 |
| Refresh tokens and server-side session list | WP9 (PWA) |
| Resubmitting a returned request (modules create a new request for now) | WP5 |
