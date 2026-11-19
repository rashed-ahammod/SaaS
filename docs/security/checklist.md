# Security checklist before the first pilot (guide §20)

Status on 2026-10-16, after WP12. Each item says **what proves it** (a test that runs on every
CI build, a script, or a document), and what is still open.

- **Done:** proven by an automated test or a recorded run.
- **Ready, needs the host:** the software side is done; it is completed when the production
  servers are set up (see [deploy for free](../operations/runbooks/deploy-free.md)).
- **Open:** needs a person or an outside party.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | RLS on every tenant table; cross-tenant test suite passing | **Done** | `rls-coverage.int-spec` (every table with `tenant_id` has forced RLS), `tenancy.int-spec`, and from WP12 `cross-tenant-sweep.int-spec`: company B's owner holds every company-wide role and calls **every route** with company A's real ids (all refused) and every list route (nothing of A appears). New routes are swept automatically. |
| 2 | App role: no superuser, no `BYPASSRLS`, no `UPDATE/DELETE` on `audit_log` | **Done** | `rls-coverage.int-spec` (roles), `audit.int-spec` (app role cannot change or delete audit entries). The backup role `erp_backup` does bypass RLS, but it can only read (`pg_read_all_data`), and it is used only by `npm run backup`. |
| 3 | 2FA for privileged roles; step-up OTP on the four high-risk actions | **Done** for 3 of 4 | `mfa-enforcement.int-spec`. The four actions: salary bank / wallet change, disbursement file, granting roles, and vendor bank details. Vendor bank details do not exist yet (procurement is Phase 2), so step-up must be added when they are built. Production refuses to start with 2FA off (`config.spec`). |
| 4 | Field-level encryption for NID, TIN, bank details, complaint records; keys in a secret store | **Done** (software); **ready, needs the host** (secret store) | AES-256-GCM with per-tenant keys (`field-encryption.ts`, `crypto.spec`). WP12 fixed one gap: NID, TIN and account numbers in data-migration staging rows were plain JSON. They are now encrypted at rest and masked on screen (`data-import.int-spec`). Complaint records: no complaints module yet. The key `FIELD_ENCRYPTION_KEY` must come from the host's secret store; production refuses the published test key. |
| 5 | TLS everywhere; data encrypted at rest; backups encrypted | **Backups: done.** TLS, disk: **ready, needs the host** | `npm run backup` writes AES-256-GCM encrypted dumps. The [restore drill](../operations/drills/restore-drill-2026-10-16.md) passed, and a tampered file was refused. The API sends HSTS in production, and production refuses a non-https app address. TLS termination and encrypted disks belong to the hosting setup. |
| 6 | Login rate limiting and lockout; session timeout | **Done** | `http.int-spec` (login limit, lockout after 5 failures for 15 minutes), 30-minute access token. |
| 7 | Dependency scanning and static analysis in CI; no high-severity findings open | **Done** with two recorded exceptions | CI runs `npm audit --audit-level=high` (backend), CodeQL (security-and-quality), gitleaks (secrets) and Dependabot. Backend: 0 high (WP12 removed the unused `@nestjs/mau`). Employee app production dependencies: 0 high. Exception: (a) is closed — the development-only `eslint-config-next` advisory (now `minimatch` under `@typescript-eslint`) is fixed by a `minimatch` override in `Frontend/web/package.json`, so the employee app has 0 findings at any severity, development dependencies included. The backend is also at 0: its `uuid` advisory, reachable only through `exceljs`, is fixed by an override rather than npm's suggested downgrade to `exceljs` 3.4.0. (b) **n8n 2.43.6** (pinned; 2.46.6 is now the latest stable) carries 12 critical / 78 high advisories in its own dependency tree, mostly in nodes we do not use (AI / LangChain, expression evaluator, XML, git). Mitigation in WP12: n8n loads **only** the 7 node types our workflow uses (`NODES_INCLUDE`), listens on the private network only, and holds no tenant secrets (ADR 0013). Re-check at each n8n release — **this re-check is due**: the pin is three minor versions behind and the high count has grown from 41 to 78. None of it reaches production, which runs the n8n Docker image, and CI has no n8n job; the npm tree here is a developer convenience. |
| 8 | External penetration test completed and findings fixed | **Open** | Scope and rules of engagement are ready: [penetration-test-scope.md](penetration-test-scope.md). Needs a vendor, a staging environment with synthetic data, and the fix-and-retest cycle before the first pilot. |
| 9 | n8n code / shell nodes disabled; n8n admin not exposed to the internet | **Done** (software); **ready, needs the host** (network) | `NODES_INCLUDE` (allow-list) plus `NODES_EXCLUDE` (code, function, command, SSH, file nodes) in `n8n/scripts/env.mjs`. n8n listens on 127.0.0.1 locally. Production must keep it on the private network. |
| 10 | Consent captured for biometric and selfie data | **Done** | WP12 `employee_consents`. Employees agree or withdraw in the app (Me → Consents); HR records signed paper forms. Without consent there is no phone registration or phone punch (location), no biometric enrolment, and device punches are not stored (`attendance.int-spec`). Selfie punches are not built; their consent notice already exists. The notice wording is ILLUSTRATIVE until counsel confirms it. |

## Also checked in WP12

- **Response headers:** `nosniff`, `X-Frame-Options: DENY`, CSP `default-src 'none'`,
  `Cache-Control: no-store`, no `X-Powered-By`, HSTS in production (`http.int-spec`).
- **Request bodies:** JSON limited to 1 MB (413).
- **Error responses:** errors never return stack traces or SQL.
- **Production start-up refuses test settings:** 2FA off, the fake AI model, an `http://` app
  address, placeholder or CI secrets, the published encryption key, short database passwords,
  no metrics token, or a short n8n secret (`config.spec`).
- **Retention:** the exact location of phone punches is cleared after 180 days, AI question and
  answer texts after 365 days, and finished migration staging rows after 90 days. The database
  refuses shorter periods (`operations.int-spec`). The periods are ILLUSTRATIVE until counsel
  confirms them.
- **Monitoring:** alerts on errors, latency, failing or stale jobs, dead letters, audit-chain
  breaks, AI failures, backups, disk and WAL archiving ([alerts.yml](../../infra/monitoring/alerts.yml)).

## Open items before the first pilot (owners)

1. **Rule values, VAT rates and the compliance calendar:** every labour and tax value in the
   system is still marked "verify", and the VAT rates, the Mushak note numbers and the
   calendar's due dates are placeholders with no such guard. Nobody is paid from this system
   until they are confirmed and proved:
   [rule-values-and-vat.md](../operations/runbooks/rule-values-and-vat.md).
   *(Owner: founder, with the pilot's accountant, labour counsel and VAT practitioner.)*
2. **Penetration test:** vendor, test window, fixes and retest. *(Owner: founder.)*
3. **Hosting:**
   - TLS certificates and HTTPS only;
   - encrypted disks;
   - a secret store for `FIELD_ENCRYPTION_KEY`, `JWT_SECRET`, `BACKUP_ENCRYPTION_KEY`, the
     database passwords and `METRICS_TOKEN`;
   - WAL archiving;
   - the off-site backup copy;
   - Prometheus and Alertmanager with an on-call phone.

   *(Owner: operations.)*
4. **Recovery targets per tier:** the acceptable data loss and downtime (guide §27). The drill
   measured a 7-second restore for the demo data, but a pilot's database will be larger.
   *(Owner: founder.)*
5. **Counsel review:** the consent notices, the retention periods, and Bangladesh's data
   protection law in force (spec §11). *(Owner: founder.)*
6. **Leaked password** (checked 2026-11-19, and narrower than it reads below):
   - **Not in this repository.** Commit `0983e3c` is not in `SaaS`'s history: it belonged to the
     old nested `backend/` repository, whose history did not come across in `4545eb3
     Consolidate full ERP stack into a single repository`. Across the whole history of
     `backend/.env.example` and `infra/docker-compose.yml` there is no non-placeholder admin
     password, and the one in `backend/.env` today appears in no commit. At HEAD only
     `change-me` and CI's throwaway service password are committed.
   - **Still to answer:** was that old backend repository ever pushed anywhere - including a
     repository since deleted? If it was, treat the password as public: change it on every
     database that ever used it, **Supabase included**, and anywhere it was reused.
     *(Owner: whoever runs the database.)*
   - **The developer machine was assessed on 2026-11-19** and the leak of its password alone
     would not let an outsider in. Three independent barriers, of which the password is the
     last: Windows Firewall has no rule for 5432 and defaults to blocking inbound;
     `pg_hba.conf` admits `127.0.0.1` and `::1` only, with scram-sha-256, so a remote host is
     refused **even with the right password**; and only `postgres` is a superuser. Whoever can
     use that password is already running code on the machine, where they could read
     `backend/.env` anyway.
   - **What would change that**, in order of likelihood: reusing the password on a service that
     IS reachable (Supabase, Render); widening `pg_hba.conf` to let a colleague connect;
     opening 5432 in the firewall; or publishing the port from a container. Note
     `listen_addresses = *`, so pg_hba and the firewall are the only things holding the line.
     If a superuser connection is ever reachable the severity is high, not moderate: `COPY ...
     FROM PROGRAM` runs commands as the Postgres service account.
   - **The project's own roles are not the problem**: `erp_owner`, `erp_app` and `erp_worker`
     carry 24-character passwords and are scoped to this project. The short one is the
     machine-wide `postgres` superuser, which other projects on that machine also use - so
     changing it, or setting `listen_addresses = 'localhost'`, is done by the machine's owner
     at the keyboard, with pgAdmin and any Docker or WSL project that connects over a LAN
     address fixed in the same sitting.
   - CI runs gitleaks on every push, so a future commit of a real secret is caught there.
7. ~~**Step-up for vendor bank detail changes**~~ - **done** with procurement (WP17): a new
   vendor bank account needs a fresh 2FA code (`@RequireStepUp()` on
   `POST /vendors/:id/bank-accounts`).
