# Deploy

## Production setup (once)

**Components:**

| Part | How |
| --- | --- |
| API | 2+ instances of `node dist/main.js` behind a load balancer that ends TLS (HTTPS only, HTTP redirects). `GET /health/ready` is the load balancer's readiness check. |
| Worker | Exactly **one** `node dist/worker.js`. Jobs run in its process, so two workers would run each job twice. The jobs are idempotent, but two workers double the load. |
| Employee app | `npm run build && npm run start` behind the same TLS, at `PUBLIC_APP_URL`. |
| PostgreSQL 18 | On encrypted disks, with WAL archiving on (see [backup and restore](backup-and-restore.md)). The roles come from `npm run db:setup`: `erp_owner` runs migrations, `erp_app` serves the API, `erp_worker` runs jobs, `erp_backup` takes backups. Use 20+ random characters for each password. |
| Uploaded files | `FILE_STORAGE_DRIVER=s3` with a **private** S3-compatible bucket (AWS S3, Cloudflare R2, MinIO on-premise): these are NID scans, contracts and expense receipts. Give the key only `PutObject` and `GetObject` on that bucket, and turn on the provider's encryption at rest. `local` keeps files in `FILE_STORAGE_DIR` and works only with a mounted volume **and a single API instance** — two instances cannot share the folder, and a container without a volume loses every document on the next deploy. |
| n8n | Docker, own database, private network only, never on the internet. `NODES_INCLUDE` / `NODES_EXCLUDE` as in `n8n/scripts/env.mjs`. |
| Monitoring | Prometheus with `infra/monitoring/prometheus.yml` and `alerts.yml`, Alertmanager (phone for `page`, channel for `ticket`), a blackbox exporter, plus postgres_exporter and node_exporter on the database host. |

**Secrets** come from the host's secret store, never from files in the repository:

- `JWT_SECRET`;
- `FIELD_ENCRYPTION_KEY`, also kept in a sealed offline copy: without it, encrypted NID, TIN
  and bank details are lost;
- `BACKUP_ENCRYPTION_KEY`, also kept offline: without it, no backup can be restored;
- `PG_*_PASSWORD`;
- `OUTBOX_WEBHOOK_SECRET`;
- `METRICS_TOKEN`;
- `ANTHROPIC_API_KEY`.

**Production refuses to start** when something is unsafe (`config.ts`, `productionProblems`).
The error lists every problem. The checks include:

- 2FA off;
- the fake AI model;
- an `http://` app address;
- placeholder secrets;
- short passwords;
- no metrics token.

**The first workspace.** `npm run db:seed` refuses to run in production (it creates fake
workspaces with a published password), so the first real customer workspace and its login come
from:

```
npm run build
BOOTSTRAP_OWNER_PASSWORD='<one-time password>'   npm run bootstrap:tenant -- --slug=acme --name="Acme Trading Ltd" --email=admin@acme.com.bd
```

The owner gets System Admin, Admin and HR with group scope, so they can set up the company and
its first employees (nobody may grant roles to themselves). Pass the password through
`BOOTSTRAP_OWNER_PASSWORD`, not `--password`: command-line arguments are visible to other
processes on the host. The script refuses a slug that exists, and refuses to add a second
workspace unless `--force-second-workspace` is given. Then sign in, set up 2FA at once
(mandatory for System Admin/Admin/HR/Accounts) and change the password.

## Self-hosted, with Docker Compose

For a pilot, a customer that needs the data to stay in Bangladesh, or any machine
you own, `infra/docker-compose.prod.yml` runs the whole stack — PostgreSQL 18, the
API, the worker and the employee app — on one host. The images are built for
amd64 and arm64.

```
cd infra
cp .env.production.example .env        # then fill in every secret
docker compose -f docker-compose.prod.yml up -d --build
```

The `init` service creates the four roles and the database on the first run and
applies pending migrations on every run; both steps are idempotent, and the API
waits for it to finish. Then create the first workspace:

```
docker compose -f docker-compose.prod.yml run --rm   -e BOOTSTRAP_OWNER_PASSWORD='<one-time password>' api   npm run bootstrap:tenant -- --slug=acme --name="Acme Trading Ltd"     --email=admin@acme.com.bd
```

**Reaching it from the internet.** `PUBLIC_APP_URL` must be `https://`, so a plain
LAN address will not do. The `tunnel` profile runs `cloudflared`, which publishes
the employee app over HTTPS with **no inbound port open and no public IP**: create
a tunnel in Cloudflare Zero Trust, point its hostname at `http://web:3001`, put
the token in `infra/.env`, then
`docker compose -f docker-compose.prod.yml --profile tunnel up -d`.

**What this setup does not give you.** One host is a single point of failure, and
`FILE_STORAGE_DRIVER=local` keeps uploads on a volume, which means **one API
instance only** — for more, switch to `s3`. Nothing scrapes `/metrics` yet, so job
failures are silent. And backups are entirely yours: schedule
`docker compose -f docker-compose.prod.yml exec api npm run backup` on the host,
copy the files off the machine, and run the restore drill before you need it.

## Every release

1. **CI is green on the commit:**
   - lint and types;
   - unit and payroll acceptance cases;
   - integration tests, including the cross-tenant sweep;
   - CodeQL, the secret scan and the dependency audit.
2. **Deploy to staging and smoke-test it:**
   - sign in as an employee and as HR;
   - open a payslip PDF;
   - punch from a test phone;
   - check `GET /health/ready`.
3. **Back up production first:** `npm run backup`.
4. **Migrate:** `npm run db:migrate` as `erp_owner`. Migrations are forward-only and
   backward-compatible (expand, migrate, contract), so the old version keeps working during
   the switch.
5. **Roll the API instances one at a time.** The load balancer waits for `/health/ready`, which
   says "not ready" until every migration file is applied. Then restart the worker and the
   employee app.
6. **Watch the dashboards for 30 minutes:** the 5xx rate, p95 latency, and job successes.
7. **If something is wrong, roll back the code** to the previous image. Migrations are never
   rolled back. A bad migration is fixed with a new forward migration, and data from a backup
   only after an incident decision.

## AI

- **Off by default:** `AI_PROVIDER=off`, so the app works without AI.
- **Before offering AI to a tenant:**
  1. set the provider and its key;
  2. run `npm run ai:eval` against the production model. It records the release gate, which
     production enforces.
  3. The tenant must be on the Intelligent plan, and its Admin switches AI on
     (`PUT /ai/settings`).
