# ADR 0004 — WP1: organization, composite tenant keys, job history as events

- **Status:** accepted · 2026-10-14

## 1. Foreign keys always include `tenant_id`

PostgreSQL checks foreign keys **without** row-level security. With a plain
`department_id REFERENCES departments(id)`, a request in tenant A could store the id of a
department in tenant B, and the database would accept it.

**Decision:** every tenant table has `UNIQUE (tenant_id, id)`, and references use
`(tenant_id, x_id)`. Where a record must stay inside one company, the reference includes the
company too:

```sql
FOREIGN KEY (tenant_id, company_id, department_id) REFERENCES departments (tenant_id, company_id, id)
```

So the database itself guarantees that an employee's branch, department, designation and
grade (and a department's parent and head) belong to the employee's own company.
Services still check first, so users get a clear 404 instead of a constraint error.

## 2. Job history = immutable events + rebuilt timeline

Spec §6.1 and guide §5 rule 4: changes are effective-dated and nothing is overwritten.
A row-patching approach gets back-dated changes wrong. Example: a transfer effective
1 March, recorded after a promotion effective 1 June, must also apply to the June period.

**Decision:**
- `employee_job_events`: each decision as recorded (type, effective date, only the fields
  it changes, reason, who and when). It is never edited (a trigger enforces this). A mistake
  is cancelled with a reason and stays visible.
- `employee_assignments`: the resulting timeline, one row per period, recomputed by the pure
  function `buildTimeline()` (`src/modules/employees/job-timeline.ts`) after every new or
  cancelled event. The `no_overlap` exclusion constraint guarantees that periods never overlap.
- The only exception: while an employee is still `draft`, changing the joining date moves the
  joining event.

Payroll (WP6) reads the timeline. A change inside an already-paid month will produce arrears.

## 3. Module boundary: `OrgLookupService`

The employees module never queries organization tables directly (guide §3). It calls
`OrgLookupService` (placement checks, names, department subtree, employee codes). The
foreign keys above are the safety net.

## 4. Other choices

| Topic | Decision |
| --- | --- |
| API field names | JSON is camelCase; the database is snake_case. Each service has an explicit `toXResponse()` mapper. |
| Updates | PATCH sends only changed fields plus `version` (optimistic locking → 409 `STALE_VERSION`). |
| Employee codes | `<prefix>-00001`, allocated by locking the company row (no duplicates under concurrency). A manual code is allowed. |
| NID / TIN | Encrypted per tenant and always masked in responses. Full value with the `identity` field grant (WP2). Audit logs record `[changed]`, never the value. |
| Documents | Local disk behind a `FileStorage` interface (S3/MinIO later). Type is detected from file content. Max 10 MB. Never deleted, only marked removed. Downloads are audited. |
| Onboarding | Seven default items (spec §6.1). Activation requires all of them. An item that doesn't apply is completed with a note. |
| Bank accounts | Deferred to WP2: changes need step-up OTP and HR approval (approval engine). |
| Permissions | Deferred to WP2. Until then, any signed-in user of the tenant can use WP1 routes. |
| `db:seed` | Runs the compiled app (`dist/dev/seed.js`), because Nest dependency injection needs decorator metadata, which `tsx` does not emit. |

## Update 2026-10-21: role-by-role check, lifecycle gaps closed

A check of the employee lifecycle for every role (spec §3, §4, §6.1) found records, onboarding,
job history and access correct, but the lifecycle stopping half-way. Recruitment and the
onboarding / offboarding kits are Phase 3 and stay out. These gaps were closed (migration
`0026_employee_lifecycle.sql`, `src/modules/employees/lifecycle.*`):

1. **Probation never ended.** Every demo employee was still "probation" years after it ended.
   - `GET /companies/:id/probation-reviews` lists probations ending within 30 days or already over.
   - The Dept Head recommends confirm / extend / end (new permission `employee.lifecycle.review`,
     department scope); HR decides. Confirm → active (`confirmed_at`); extend → new end date;
     end → a separation of kind "end of probation". Nobody reviews their own probation.
   - Worker job `probation-reminders` (every 6 h): event `employee.probation_ending` once per end
     date, 15 days before; notifications send the Dept Head an in-app and e-mail message.
   - Table `probation_reviews` keeps reminder, recommendation and decision per end date.
2. **Separation stopped at "notice".**
   - The notice records the kind (resignation, termination, retirement, contract end), the notice
     date, the required notice (company setting) and the shortfall (table `separations`).
   - Clearance (table `separation_clearances`): IT (`users.manage`), Admin assets
     (`org.structure.manage`), Accounts advances (`payroll.disburse`, shown what is still owed),
     Dept Head handover (`employee.lifecycle.review`); HR may clear any; the leaver never clears
     themself. The final settlement run is refused (`SEPARATION_NOT_CLEARED`) until all four are
     done; a resignation's shortfall becomes the run's default notice shortfall. A termination's
     shortfall is the employer's: shown, to be paid in lieu as a payroll item.
   - HR can withdraw a notice while no final settlement run exists (status goes back).
   - Employees put on notice before this change have no separation record and are not blocked.
   - The approved final settlement marks the separation "separated"; HR then prints the
     experience certificate (Bangla / English PDF; wording is a placeholder).
3. **Documents had no screens.** Portal → employee → Documents (upload with type and expiry,
   download, remove with a reason); the app's profile lists the employee's own documents.
4. **Company settings.** Notice for resignation (60 days) and termination (120 days) and the
   retirement age (60) are company settings next to the probation length, editable on the
   Organization page. Defaults are Bangladesh Labour Act placeholders (verify).
5. **Job changes.** The Job tab lists the recorded changes and cancels a wrong one.
6. **The app.** The profile shows designation, department, office, line manager and the
   probation / notice status.

Not done: the functional manager (only used by performance, Phase 3); a list of upcoming
retirements; an employee submitting their own resignation from the app (HR records it).
`pdf-canvas.ts` moved to `src/platform/pdf` (payslip, tax and experience certificates).
