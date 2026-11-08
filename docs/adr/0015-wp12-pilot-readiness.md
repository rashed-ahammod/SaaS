# ADR 0015 — WP12: pilot readiness

- **Status:** accepted · 2026-10-16
- **Acceptance (guide §24):** "Checklist complete; Gate 1 begins: two parallel payrolls per
  pilot." The checklist is complete on the software side. The items that need a person, a
  vendor or the hosting are listed with owners in
  [docs/security/checklist.md](../security/checklist.md):
  - penetration test;
  - TLS, disks and secret store;
  - recovery targets;
  - counsel review;
  - the leaked admin password.

  The Gate 1 tool and runbook are ready.

## 1. Cross-tenant sweep of every route

The earlier tests attacked a sample of routes. `cross-tenant-sweep.int-spec` reads every
controller (`test/integration/routes.ts`, shared with the route-permission test) and works as
follows:

- **The attacker:** company B's owner, holding every company-wide role.
- **Routes with an id:** called with company A's **real** ids for 33 kinds of record. Each
  answer must be a refusal (400/401/403/404/409/422): never a success, never a 5xx. At least
  80% of the sweep must use real ids, not made-up ones.
- **List routes:** called without ids. The answer must not contain any of A's ids or its
  company name.

A new route is covered without anyone remembering to add it. The sweep found two
inconsistencies, both now answering 404:

- marking another person's notification read answered 200 while changing nothing;
- the new Gate 1 status route answered 200 with empty data for another company's id.

Row-level security meant nothing leaked in either case.

## 2. Consent before biometric and location data

- **Where it is stored:** `employee_consents` is append-only; the latest row per purpose
  counts.
- **Who records it:** the employee agrees in the app, or HR records a signed paper form.
- **The notice:** each row stores the notice version it was given under, so a changed notice
  is traceable.
- **Enforced at the point of use, not only in the UI:**
  - phone registration and each phone punch need location consent, so a withdrawal takes
    effect at the next punch;
  - setting a biometric device number needs biometric consent;
  - the device sync agent's punches for someone without consent are **counted but not stored**
    (`noConsent` in the agent's answer), so HR sees the gap.
- **Biometric templates:** the system never holds fingerprint or face templates; the device
  keeps them. The ERP keeps a device user number and times.
- **Selfie:** not built; its notice exists so consent can be collected up front.

## 3. Retention through a guarded database function

Spec §11 asks for retention periods per data type. Punches are append-only (a trigger), so
clearing a location needs a controlled exception.

- **The function:** `retention_apply()` is `SECURITY DEFINER`, called per tenant by the
  worker. Row-level security still limits it to the tenant that the caller opened.
- **The floors:** it refuses periods shorter than 90 / 180 / 30 days, even when called by
  mistake.
- **The trigger:** the punch trigger allows exactly one change, blanking the location fields,
  and only while the function runs.

The periods are 180 days (punch location), 365 days (AI question and answer texts) and 90
days (finished migration staging). They are illustrative until counsel confirms them
(`src/platform/retention.ts`).

## 4. Monitoring: numbers, not tenant data

- **Endpoints:** `/health` (liveness), `/health/ready` (database plus every migration applied:
  the deploy gate), and `/metrics` in Prometheus text, behind `METRICS_TOKEN` (required in
  production).
- **What the metrics count:**
  - requests by status class and their latency (in-process middleware);
  - outbox backlog and dead letters, undelivered e-mail / SMS, AI failures;
  - each job's last success and failures in a row;
  - tenants whose audit chain breaks.
- **How they are read:** the worker role, and only as counts. The integration test checks
  that no company name or tenant id appears.
- **Job runs:** the worker, and the backup script, record each run in `system_job_runs`. A job
  that stops silently is caught by "stale" alerts.
- **Alerts:** each one names its runbook.

## 5. Backups that prove themselves

- **The backup:** `npm run backup` runs `pg_dump` as `erp_backup`, a role created only for
  this. It bypasses row-level security, because a dump must include every tenant, and holds
  only `pg_read_all_data`, so it can change nothing. The dump is encrypted with AES-256-GCM
  (`BACKUP_ENCRYPTION_KEY`), so a damaged or altered file fails instead of restoring wrong
  data. A manifest records the row count of every table.
- **The drill:** `npm run restore:drill` restores into a scratch database and **proves** that:
  - every row count matches;
  - every migration is recorded;
  - row-level security is still forced;
  - every audit chain verifies;
  - the API role sees only its own tenant.

  It writes a dated report with timings, the measured restore time for the recovery-target
  decision. First run: passed, 6.9 s on demo data. A tampered file was refused.
- **Production:** WAL archiving (point-in-time recovery) is the host's job; the
  [runbook](../operations/runbooks/backup-and-restore.md) covers it.

## 6. Gate 1: parallel payroll as a tool, not a spreadsheet exercise

`parallel-run` module (`parallel_run_comparisons`, `parallel_run_lines`):

- **Upload:** HR uploads the old system's register (XLSX or CSV). Amounts may use lakh
  separators, "Tk" or Bangla digits.
- **Comparison:** every employee is compared with the ERP's run: gross, net, and optionally
  total deductions, tax and PF, within an agreed tolerance. Each employee is a match, a
  difference, or missing on one side.
- **Acceptance:** every non-match must be explained; Accounts accepts. The uploader cannot
  accept (enforced by the service and by a database check).
- **Outdated comparisons:** a recalculation after acceptance makes the comparison outdated,
  so a month cannot pass Gate 1 with figures that have since changed.
- **Gate 1 status:** `GET /companies/:id/gate-1` counts accepted, up-to-date months; two means
  Gate 1 is passed.
- **Who sees amounts:** only users with salary access, as on the run screen.

## 7. Other hardening

- **HTTP:** security headers, a 1 MB JSON limit, and Express client errors (413) passed
  through instead of a 500.
- **Production start-up refuses test settings:** 2FA off, the fake AI model, `http://` app
  addresses, placeholder or CI secrets, the published encryption key, short database
  passwords, a missing metrics token, and a short n8n secret.
- **Dependencies:** `@nestjs/mau` (unused) removed. CI now runs CodeQL, gitleaks, the frontend
  job and the dependency audit; Dependabot is weekly.
- **n8n:** loads only the 7 node types its workflow uses (`NODES_INCLUDE`). This removes the
  attack surface of the nodes carrying most of n8n's open advisories. It was verified to start
  and register its webhook.

## 8. Not included

- **The external penetration test itself.** The scope is ready
  ([penetration-test-scope.md](../security/penetration-test-scope.md)).
- **Production hosting:** infrastructure-as-code, TLS, the secret store, WAL archiving setup,
  Grafana dashboards.
- **A full tenant data export** on request or exit (spec §11, data protection). It is needed
  before the first paying customer leaves, not before the pilot; plan it with WP13.
- **Load test** (guide §21: payroll for 1,000 employees). Run it on staging hardware before the
  pilot's first live payroll.
