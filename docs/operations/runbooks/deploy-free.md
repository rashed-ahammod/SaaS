# Deploying the ERP for ৳0 a month: Vercel + Render + Supabase

For the person deploying this repository for the first time. Follow the phases in
order; each one ends with a check you can run before moving on.

```
  Employee app (Next.js)          Vercel, Hobby plan
          |  HTTPS, server-side only
  ERP API + scheduled jobs        Render, free web service
          |  PostgreSQL over TLS, through the session pooler
  PostgreSQL + file storage       Supabase, free plan
```

**Read this before you start.** This stack is honest about what it is: a pilot
and demo environment. Three things it cannot give you:

- The API sleeps after 15 minutes with no traffic, and the first request after
  that waits about a minute. A free uptime pinger hides most of it (Phase 3.5).
- The Supabase project is paused after a week with no database activity. The data
  survives; you press Restore in the dashboard. The pinger prevents it.
- There are no automatic backups. You take them yourself (Phase 6.4). Without
  that, a mistake in the Supabase dashboard is unrecoverable.

A pilot that handles real salaries needs a host you pay for. Say so to the
customer before they rely on it.

---

## Phase 1: what this repository is

Already established, so you do not have to look:

| | |
|---|---|
| Layout | one repository: `backend/` (NestJS), `Frontend/web/` (Next.js), `n8n/`, `infra/` |
| Package manager | npm. Node 24 (`backend/.node-version`, both `engines` fields allow 22–24) |
| ORM | none. Kysely plus 40 hand-written SQL migrations in `backend/db/migrations/` |
| Backend build / start | `npm run build` → `node dist/main` |
| Frontend build | `next build` |
| Auth | own JWT + argon2 + TOTP. The browser holds no token: it is in an httpOnly cookie |
| CORS | not needed. The browser only ever calls the Next.js app, which forwards to the API server-side (`Frontend/web/src/app/api/`) |
| Health check | `GET /health` (API + database), `GET /health/ready` (every migration applied) |
| Port | `PORT` from the environment; the server listens on every interface |

## Phase 2: Supabase (the database)

**2.1 Create the project.** supabase.com → new project. Region: Singapore
(`ap-southeast-1`) is the closest to Bangladesh. Keep the database password it
gives you; that is the `postgres` role, used in this phase only.

**2.2 Create the three roles.** The ERP never logs in as `postgres`. It uses
`erp_owner` (owns the tables, runs migrations), `erp_app` (the API) and
`erp_worker` (the jobs). `erp_app` owns nothing and has no `BYPASSRLS`, which is
how PostgreSQL itself stops one tenant reading another's rows — connecting as
`postgres` would quietly disable every tenant-isolation test in this repository.

`npm run db:setup` cannot do this on Supabase: it wants to create a database and
change the owner of the public schema, which no managed provider allows. Use
`backend/db/supabase-setup.sql` instead:

1. Generate three passwords:
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
2. Paste them into a copy of the file (do not commit it).
3. Supabase dashboard → SQL Editor → paste → Run.
4. The last statement prints the roles. **`erp_app` must show `rolbypassrls = false`.**

**2.3 Get the connection details.** Supabase dashboard → Connect → **Session
pooler**. Copy the host exactly as shown (`aws-N-ap-southeast-1.pooler.supabase.com`
— the number cannot be guessed from the region).

Two details decide whether this works at all:

- **The pooler, not the direct host.** `db.<ref>.supabase.co` only has an IPv6
  address unless you buy the IPv4 add-on, and Render does not reach IPv6. The
  shared pooler is IPv4 on every plan.
- **Session mode (port 5432), not transaction mode (6543).** The migration runner
  takes a session-level advisory lock (`pg_advisory_lock` in
  `backend/src/platform/db/migrator.ts`) so two instances cannot migrate at once.
  Transaction mode drops session state and would break it.

The pooler also wants the project in the user name: `erp_app.<project-ref>`. The
code appends `PG_USER_SUFFIX` to each role name for exactly this, so set
`PG_USER_SUFFIX=.<project-ref>`.

**2.4 Run the migrations** from your own machine (they need `tsx`, a dev
dependency). In `backend/.env`, temporarily:

```
PG_HOST=aws-N-ap-southeast-1.pooler.supabase.com
PG_PORT=5432
PG_DATABASE=postgres
PG_USER_SUFFIX=.<project-ref>
PG_SSL=require
PG_OWNER_PASSWORD=...        # the three you generated in 2.2
PG_APP_PASSWORD=...
PG_WORKER_PASSWORD=...
```

Then: `cd backend && npm run db:migrate`

`PG_DATABASE=postgres` because Supabase gives one database and will not create
another. `PG_SSL=require` because Supabase accepts nothing but TLS;
`verify-full` is better wherever the provider publishes its CA certificate.

**Check:** the command ends with `Applied 40 migration(s).` and the Supabase
table editor shows `tenants`, `employees`, `audit_log`.

**2.5 Create the file bucket.** Storage → new bucket, name `erp-files`, **private**
(it will hold NID scans, contracts and expense receipts). Then Storage settings →
S3 access keys → new key. Keep the access key id and secret: Render needs them.
The ERP already speaks S3 (`FILE_STORAGE_DRIVER=s3`), so no code changes.

**Why not a folder on disk:** Render's free plan has no persistent disk. Every
deploy would silently delete every uploaded document.

Keep this `.env` for now; Phase 4.5 needs it once more. Afterwards put your local
database back, so your own work does not run against Supabase.

The first workspace is **not** created here: `npm run bootstrap:tenant` starts the
application context, which applies the production checks, and one of them is that
`PUBLIC_APP_URL` must be an https address. That address only exists after Phase 4.

## Phase 3: Render (the API)

**3.1 What changed in the code**, and why — these were required, nothing else was
touched:

| Change | Reason |
|---|---|
| `PG_SSL`, `PG_SSL_ROOT_CERT` in `backend/src/config/config.ts` | there was no way to ask for TLS, and Supabase refuses a plain connection |
| `PG_USER_SUFFIX` | the pooler needs `erp_app.<project-ref>`, not `erp_app` |
| `RUN_JOBS_IN_API`, and the job list moved from `worker.ts` into `backend/src/jobs.ts` | Render's free plan has no worker instance type. Both processes now call the same `startJobs()`, so nothing diverges, and `npm run start:worker` still works unchanged |
| `maxDuration = 60` in the five Next.js route handlers | a Vercel function would otherwise be cut off while the API is waking up |
| `backend/db/supabase-setup.sql` (new) | `db:setup` needs rights Supabase does not give |
| `infra/render.yaml` (new) | the service definition |

Defaults did not change: without these variables the application behaves exactly
as before.

**3.2 Create the service.** Render dashboard → New → Blueprint → this
repository. It reads `infra/render.yaml`: Node runtime, free plan, Singapore,
root directory `backend`, build `npm ci && npm run build`, start `node dist/main`,
health check `/health`.

**3.3 Fill in the secrets** Render asks for (everything marked `sync: false`):

| Variable | Value |
|---|---|
| `PG_HOST` | the pooler host from 2.3 |
| `PG_USER_SUFFIX` | `.<project-ref>` |
| `PG_OWNER_PASSWORD`, `PG_APP_PASSWORD`, `PG_WORKER_PASSWORD` | from 2.2 |
| `FIELD_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — **keep a copy offline; encrypted fields are unreadable without it** |
| `PUBLIC_APP_URL` | the Vercel address from Phase 4, which does not exist yet. Put `https://example.com` here for now and change it in 4.3 — it may not be left empty: an empty value is not a URL, and the API refuses to start |
| `S3_ENDPOINT` | `https://<project-ref>.storage.supabase.co/storage/v1/s3` |
| `S3_REGION` | `ap-southeast-1` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from 2.5 |

`JWT_SECRET` and `METRICS_TOKEN` are generated by Render itself. `NODE_ENV=production`
means the application refuses to start with 2FA off, a plain-http app address, the
fake AI provider or an example password — that is deliberate (`config.ts`,
`productionProblems`).

**3.4 Check:** `curl https://erp-api-xxxx.onrender.com/health` →
`{"status":"ok","database":"ok"}`, and `/health/ready` reports every migration
applied. The log line `Scheduled jobs run in this process (N jobs)` confirms the
jobs started.

**3.5 Keep it awake.** cron-job.org (free, no card): a job every 10 minutes
calling `https://<your-api>.onrender.com/health`. This does three things at once:
the API does not sleep, so the jobs actually run; the first user of the day does
not wait a minute; and the database activity stops Supabase pausing the project.

750 free instance hours a month are shared by the whole workspace, and one
service awake all month uses about 730. So keep **one** free service on Render.

## Phase 4: Vercel (the employee app)

**4.1 Import** the repository on vercel.com. The one setting that matters:
**Root Directory = `Frontend/web`**. Framework: Next.js (detected). Build
command, output and install command: leave them alone.

**4.2 Environment variable**, for Production, Preview and Development:

```
BACKEND_URL = https://erp-api-xxxx.onrender.com
```

That is all. There is no `NEXT_PUBLIC_*` API address and there must not be one:
the browser calls only this app's own `/api/...` routes, which attach the token
from the httpOnly cookie server-side (`src/lib/server/backend.ts`). This is why
no CORS configuration is needed anywhere, and why the access token is never
visible to JavaScript.

**4.3 Go back to Render** and set `PUBLIC_APP_URL` to the Vercel address
(`https://<project>.vercel.app`). Notification links use it, and in production the
API refuses to start unless it is https.

**4.5 Create the first workspace and its login.** From your own machine, because
a free Render service has no shell. Use the `backend/.env` from Phase 2.4 and add
the values the production checks require:

```
NODE_ENV=production
PUBLIC_APP_URL=https://<project>.vercel.app
SECURITY_MFA_ENFORCED=true
AI_PROVIDER=off
JWT_SECRET=<any 32+ characters; this command issues no token>
FIELD_ENCRYPTION_KEY=<the same one you gave Render>
METRICS_TOKEN=<any 32+ characters>
```

`FIELD_ENCRYPTION_KEY` must be the one Render uses: the workspace's encrypted
fields are written with it. Then:

```
cd backend && npm run build
BOOTSTRAP_OWNER_PASSWORD='<a long password>' \
  node dist/cli/bootstrap-tenant.js --slug=acme --name="Acme Trading Ltd" \
  --email=admin@acme.com.bd
```

The password goes in the environment, not in `--password`, because arguments are
visible to every process on the machine. The owner gets System Admin, Admin and
HR, which is what the first user needs to create employees. Run again with the
same slug and it refuses rather than creating a second workspace.

**Then remove the Supabase values from `backend/.env`.**

**4.6 Check:** open the Vercel address, sign in as that user, and the network tab
shows requests to `/api/erp/...` on the Vercel domain only — never to
onrender.com. Sign-in will ask you to set up 2FA: that is `SECURITY_MFA_ENFORCED`
doing its job.

**On the plan:** Vercel's Hobby plan is for personal, non-commercial use. A pilot
you are not billing for is defensible; the day you charge the customer, this has
to move to Pro ($20/user/month) or to a host without that condition.

## Phase 5: how the three are connected

| From | To | How |
|---|---|---|
| Browser | Vercel | HTTPS. Session in an httpOnly, SameSite=Strict cookie |
| Vercel route handler | Render | `BACKEND_URL` + `Authorization: Bearer` from the cookie, server-side |
| Render | Supabase PostgreSQL | session pooler, port 5432, TLS, as `erp_app` / `erp_worker` |
| Render | Supabase Storage | S3 API, private bucket, server-side keys |
| Your machine | Supabase | only for migrations and backups, as `erp_owner` |

Nothing about the ERP's own guarantees changed: row-level security still runs per
transaction (`set_config('app.tenant_id', …, true)`), the audit chain is still
verified by a job, and every uploaded document still goes to a private bucket.

## Phase 6: security checklist before you hand the link over

1. **No secrets in git.** `git grep -nE "supabase.co|onrender.com|BEGIN .*PRIVATE"`
   should find only documentation. `.env` and `.env.*` are gitignored (except the
   examples). Your filled-in copy of `supabase-setup.sql` must not be committed.
2. **`erp_app` has no BYPASSRLS** — the query at the end of 2.2 proves it. This is
   the single most important check on the list.
3. **2FA on.** `SECURITY_MFA_ENFORCED=true` (production will not start otherwise).
4. **Backups are yours now.** The free plan has none, and `npm run backup` needs a
   `BYPASSRLS` role Supabase will not create. Weekly, from your machine:
   ```
   pg_dump "postgresql://erp_owner.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=require" \
     --no-owner --no-privileges -Fc -f erp-$(date +%F).dump
   ```
   `erp_owner` owns the tables, so it reads every tenant's rows without
   `BYPASSRLS`. Keep the dumps off the laptop that made them, and keep
   `FIELD_ENCRYPTION_KEY` with them — a dump restores to unreadable fields
   without it.
5. **HTTPS everywhere.** Vercel and Render both terminate TLS; the API sends HSTS
   in production and the cookie is `Secure`. Never set `SESSION_COOKIE_SECURE=false`
   on these hosts.
6. **`/metrics` is behind `METRICS_TOKEN`**; `/health` is public by design and
   exposes nothing.
7. **Debug off.** `NODE_ENV=production`, `AI_PROVIDER=off`, no seed data
   (`npm run db:seed` is for development only — never point it at Supabase).

## Phase 7: testing and when it breaks

Test, in this order: `/health` → `/health/ready` → sign in on the Vercel app →
one read (leave balances) → one write (a punch or a leave request) → sign out.
Then upload a document, and confirm the file appears in the Supabase bucket.

| Symptom | What it actually is |
|---|---|
| `Tenant or user not found` | `PG_USER_SUFFIX` missing or wrong. The pooler needs `erp_app.<project-ref>` |
| `no pg_hba.conf entry … no encryption` / connection closed at once | `PG_SSL=off`. Supabase requires TLS |
| `ENETUNREACH` with an IPv6 address in the message | you used `db.<ref>.supabase.co`. Use the pooler host |
| First request fails, the next works | the API was asleep. Check the cron-job.org pinger |
| Everything times out, dashboard says paused | Supabase paused the project. Restore it, then fix the pinger |
| `Refusing to start in production: …` | read the list it prints: that is `config.ts` naming the exact variable |
| `/health/ready` says migrations missing | you deployed before running `npm run db:migrate` |
| 500 on an upload | `S3_*` wrong, or the bucket is not called `erp-files` |
| Build fails on `nest build` | Node version. `NODE_VERSION=24` on Render |
| A CORS error in the browser console | something in a page is calling onrender.com directly. It should call `/api/erp/...` instead — that is a bug, not a configuration problem |

Logs: Render dashboard → Logs for the API and the jobs (`[worker …]` lines);
Vercel → the deployment's Functions tab; Supabase → Logs.

## Phase 8: what the free plans actually give you

**Render (free web service).** Spins down after 15 minutes without inbound
traffic; waking up takes about a minute. 750 instance hours a month for the whole
workspace — one always-awake service fits, two do not. No background worker
instance type, which is why `RUN_JOBS_IN_API=true` exists. Over the limit, free
services are suspended, not billed. Render's free PostgreSQL is deleted after 30
days — that is why the database is in Supabase.

**Supabase (free plan).** 500 MB database, 1 GB file storage, 5 GB egress a
month, 2 active projects. **Paused after a week of database inactivity**, which
the pinger prevents. No automated backups. No IPv4 on the direct host. The schema
here plus a pilot's data fits in 500 MB comfortably; scanned NIDs and receipts
will fill 1 GB faster than you expect.

**Vercel (Hobby).** Personal, non-commercial use only — see Phase 4. Generous
bandwidth and build minutes for an app this size, no card required.

**Taken together:** fine for a demo, a pilot and training. Not something to
promise a customer who is running payroll on it. The path off it is short,
because nothing here is Vercel- or Render-specific: the same build runs in Docker
on any machine.
