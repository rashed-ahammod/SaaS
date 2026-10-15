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
