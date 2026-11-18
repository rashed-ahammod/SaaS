# Onboarding: running and developing this ERP on your own machine

For a developer joining the project. Follow the parts in order; each one ends with a
check you can run before moving on. Nothing here replaces the two documents that own
the rules — `BUSINESS_LOGIC_SPEC_v0.2.md` (what the system must do) and
`IMPLEMENTATION_GUIDE.md` (how it must be built) — plus the decision records in
`docs/adr/`. Read those after you have the app running.

---

## 0. What you are getting

One repository, three deployable things and some tooling:

```
SaaS/
  backend/        NestJS API + the scheduled jobs. PostgreSQL via Kysely, hand-written SQL migrations.
  Frontend/web/   Next.js app: employee PWA (Bangla/English) and the HR & Admin portal at /portal.
  n8n/            local n8n for the notification workflows (optional; only for WP10/WP20 work)
  infra/          docker-compose for local PostgreSQL, Render blueprint, Prometheus config
  docs/           ADRs, runbooks, security checklist, phase plans
```

How the parts talk to each other locally:

```
browser ──► Next.js app (:3001) ──► ERP API (:3000) ──► PostgreSQL (:5432)
            keeps the JWT in an httpOnly cookie and
            forwards every call server-side
```

The browser never calls the API directly. That is why there is no CORS setup and no
`NEXT_PUBLIC_` API address anywhere — and there must not be one.

---

## 1. Prerequisites

| Thing | Version | Notes |
|---|---|---|
| Node.js | **24** (22–24 accepted) | `backend/.node-version` says 24; CI runs 24. Use nvm-windows or fnm if you juggle versions. |
| npm | the one bundled with Node | No pnpm/yarn. The lockfiles are npm lockfiles. |
| PostgreSQL | 16+ (CI and compose use 18) | Either Docker (easiest, below) or a local install. |
| Git | any recent | |
| Docker Desktop | optional | Only to get PostgreSQL; nothing else runs in Docker locally. |

On Windows: use **PowerShell** for the npm scripts. Git Bash works for most things, but
the test runner resolves paths case-sensitively there and files you just edited can fail
tests for no real reason. PowerShell from the repo root is the known-good shell.

An authenticator app on your phone (Google Authenticator, Authy, Microsoft
Authenticator) is useful but not required locally — see 3.3.

---

## 2. Get the code

You need to be a **collaborator on the GitHub repository** first. Ask the repo owner
(`rashed-ahammod`) to invite your GitHub account to
`https://github.com/rashed-ahammod/SaaS`. Accept the invite from your e-mail or from
GitHub's notifications.

```powershell
git clone https://github.com/rashed-ahammod/SaaS.git
cd SaaS
```

Clone it anywhere you like; no path is hard-coded. Keep the folder out of OneDrive or any
syncing folder — the sync client fights with `node_modules` and `.next`.

Set your identity so commits are attributed to you:

```powershell
git config user.name "Your Name"
git config user.email "you@example.com"
```

**Check:** `git log --oneline -5` shows the recent commits and `git status` is clean.

---

## 3. Backend (the API)

### 3.1 PostgreSQL

**With Docker** (recommended):

```powershell
docker compose -f infra/docker-compose.yml up -d
```

That gives you PostgreSQL 18 on `localhost:5432`, superuser `postgres` with password
`postgres`, and the data in a named volume so it survives restarts. (The compose file
also starts Redis. Nothing in the code uses it today — it is reserved for long jobs
moving to BullMQ later. Ignore it.)

**Without Docker:** install PostgreSQL 16+ locally and remember the password you gave the
`postgres` superuser during setup.

### 3.2 Install and configure

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Now open `backend/.env`. Every variable is documented in `.env.example`; this is the
minimum for a working local machine:

| Variable | Local value |
|---|---|
| `PG_ADMIN_PASSWORD` | your superuser password (`postgres` with the Docker compose above) |
| `PG_OWNER_PASSWORD`, `PG_APP_PASSWORD`, `PG_WORKER_PASSWORD` | any values you like; `db:setup` creates the roles with them |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `FIELD_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SECURITY_MFA_ENFORCED` | `false` while you develop (see 3.3) |
| `AI_PROVIDER` | `off`, or `fake` if you touch AI features |
| `PG_SSL` | leave `off` — it is a database on your own machine |

Generate your **own** `JWT_SECRET` and `FIELD_ENCRYPTION_KEY`. Do not copy the live ones
and do not ask for them: your local database is seeded fresh, so there is nothing to
decrypt with a shared key. `.env` is gitignored and must stay that way.

### 3.3 About 2FA locally

Admin, System Admin, HR and Accounts logins require TOTP two-step verification when
`SECURITY_MFA_ENFORCED=true`. That is correct behaviour — production refuses to start
with it off — but it means scanning a QR code before you can use the portal. While
developing, set `SECURITY_MFA_ENFORCED=false` in `backend/.env`. Switch it back to `true`
whenever you test anything auth-related, because the enforced path is the one that ships.

### 3.4 Create the databases and the demo data

```powershell
npm run db:setup     # roles erp_owner/erp_app/erp_worker + databases erp_dev and erp_test
npm run db:migrate   # applies db/migrations to erp_dev
npm run db:seed      # rule pack + Demo Trading Ltd with people, logins, pending approvals
```

`db:setup` is safe to re-run; every step checks before it creates. To start over from
empty databases: `npm run db:reset`, then the three commands again.

### 3.5 Run it

```powershell
npm run start:dev          # API on http://localhost:3000, restarts on change
npm run start:worker:dev   # second terminal: outbox, SLA escalation, day close, accruals, nightly checks
```

The worker is a separate process on purpose. If you would rather run one process, set
`RUN_JOBS_IN_API=true` in `.env` and start only the API — that is what the free Render
plan does. Never run the worker *and* `RUN_JOBS_IN_API=true` together: every job would
run twice.

**Check:** `curl http://localhost:3000/health` returns `{"status":"ok","database":"ok"}`,
and `/health/ready` reports every migration applied.

---

## 4. Frontend (the employee app and the portal)

```powershell
cd ..\Frontend\web
npm install
Copy-Item .env.example .env.local
npm run dev                # http://localhost:3001
```

`.env.local` needs only `BACKEND_URL=http://localhost:3000`. Leave `ENQUIRY_FORMS` out
unless you are working on the public enquiry form — `Frontend/web/README.md` explains how
to create the service key for it.

The API must be running, or every page shows a connection error.

**Testing on your phone over the office Wi-Fi:** add `SESSION_COOKIE_SECURE=false` to
`.env.local` and open `http://<your-machine-ip>:3001`. The session cookie is HTTPS-only
otherwise. Phone location may still be refused by the browser on plain http.

---

## 5. Sign in

Workspace / company code `demo`, password for everyone: `Demo-Pass-123`.

| Login | Role | Use it for |
|---|---|---|
| `admin@demo.test` | System Admin + Admin + HR + Accounts, workspace owner | everything; the checker for Sujit's vouchers and bills |
| `anisur.rahman@demo.test` | Admin (company) | the Managing Director's view |
| `farzana.akter@demo.test` | HR | people, payroll, HR approvals |
| `sujit.das@demo.test` | Accounts | books, vouchers, bills, payments |
| `tanvir.hossain@demo.test` | Dept Head (Sales) | approval inbox |
| `nusrat.jahan@demo.test` | System Admin (company), no salary access | permission checks |
| `rafi@demo.test` | Employee, prefers Bangla | the employee PWA; Chattogram geo-fence |
| `mitu@demo.test` | Employee | second employee |
| `admin@rival.test` (workspace `rival`) | owner of a different company | tenant-isolation checks |

The demo workspace is Demo Trading Ltd: Dhaka HQ (Friday–Saturday weekend) and a
Chattogram office, 7 departments, 8 employees, with approvals already waiting in inboxes.
The portal is at `http://localhost:3001/portal`.

For the API on its own, import `backend/postman/ERP-API.postman_collection.json`, pick a
person in **Login as …**, and the token is reused by every other request.

---

## 6. Tests — run these before every push

Backend (`cd backend`, from PowerShell):

```powershell
npm test            # unit tests, incl. the permission matrix. No database needed.
npm run test:int    # integration tests against erp_test (migrated automatically)
npm run lint
npm run typecheck
```

Frontend (`cd Frontend/web`):

```powershell
npm test
npm run lint
npm run typecheck
npm run e2e         # Playwright; first time: npx playwright install
```

`npm run e2e` needs the API running with the seeded demo data and the web app built
(`npm run build && npm run start`). It **changes the demo data** — it registers a test
phone for Rafi, punches, and applies for and cancels a leave request. Re-seed afterwards
if that gets in your way.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: lint → typecheck →
unit → integration against a real PostgreSQL → build → `npm audit --audit-level=high`,
plus CodeQL and a gitleaks scan of the full history. If it is red, fixing it is part of
the change — the audit step can fail on a newly published advisory even when your own
code is fine.

---

## 7. How we work in git

- `main` is the branch everything lands on, and it is what deploys. Do not push broken
  code to it.
- Work on a branch: `git checkout -b wp##-short-description`, then open a pull request
  and let CI go green before merging.
- `git pull --rebase` before you start, so you are not building on a stale schema.
- **Never commit a `.env`, a key, a password, a Supabase host or a connection string.**
  Only `*.env.example` is tracked, and gitleaks scans the whole history in CI. If you do
  commit a secret, say so immediately — it has to be rotated, not just deleted.
- Migrations are **forward-only**: add a new file in `backend/db/migrations/`, never edit
  one that has been applied anywhere. Expand, migrate, contract.
- Follow the existing style rather than introducing your own: read `backend/README.md`
  ("How to write a new module") and `IMPLEMENTATION_GUIDE.md` §5 (non-negotiable rules)
  before adding a module. Every route declares a permission, and a test asserts that.
- Significant decisions get an ADR in `docs/adr/`.

---

## 8. Optional pieces

**n8n (notifications, WP10; bank statements, WP20)** — only if you work on those:

```powershell
cd n8n
npm install
npm start          # n8n locally
npm run import     # load the workflows from n8n/workflows
npm run mocks      # mock SMS / e-mail gateways
```

Then set `OUTBOX_WEBHOOK_BASE_URL` and `OUTBOX_WEBHOOK_SECRET` in `backend/.env` — the
example file has the exact local URL. Left empty, events simply stay pending and in-app
notifications still work. `n8n/README.md` has the details.

**AI features (WP11)** — `AI_PROVIDER=off` hides them entirely, which is fine for most
work. `fake` is a deterministic stand-in for tests and demos. `anthropic` needs a real
`ANTHROPIC_API_KEY`; use your own, not the project's.

**Rule pack (compliance values)** — `npm run rules -- list BD-LABOUR@2026.1` and friends.
Every value is still `verify`: it works locally, production refuses unverified values.
The tax numbers and the bank file layouts are **placeholders** until the pilot's
accountant and the banks confirm them (ADR 0009, 0010) — do not treat them as correct.

---

## 9. Working against the live deployment

The live system runs on free plans: **Vercel** (the Next.js app) → **Render** (the API) →
**Supabase** (PostgreSQL + file storage).

| Part | Where | Deploys when |
|---|---|---|
| Employee app / portal | Vercel, root directory `Frontend/web` | a commit lands on `main` |
| API + scheduled jobs | Render, blueprint `infra/render.yaml`, root `backend` | a commit lands on `main` that touches `backend/` (see `buildFilter`) |
| Database, file bucket | Supabase, Singapore region | never automatically — migrations are run by hand |

To see or change any of that you need to be invited to the Render, Vercel and Supabase
projects as well as GitHub. Ask the owner; GitHub access alone lets you trigger deploys
but not debug them.

Things to know before you touch it:

- **Secrets live in the dashboards**, not in the repository. Render holds the API's
  environment (database passwords, `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, S3 keys); Vercel
  holds `BACKEND_URL`. `infra/render.yaml` lists which variables exist, deliberately
  without their values.
- **`FIELD_ENCRYPTION_KEY` is irreplaceable.** Encrypted columns cannot be read without
  the exact key that wrote them. If it ever changes, `npm run rotate-key` re-encrypts the
  rows — and that has to happen with both keys in hand.
- **The API sleeps** after 15 minutes without traffic on Render's free plan, and the first
  request then waits about a minute. A cron pinger on `/health` keeps it awake and also
  stops Supabase pausing the project. If the live site looks dead, check that first.
- **Migrations against live** are run from a developer machine as `erp_owner`, with a
  separate env file pointing at the Supabase session pooler (`PG_SSL=require`,
  `PG_USER_SUFFIX=.<project-ref>`, port 5432 — not 6543). Co-ordinate before doing it: a
  forward-only migration on live data is not undoable, and the free plan has no automatic
  backups. Take one first (`npm run backup`).
- **There are no automatic backups**, and this stack is a pilot/demo environment, not a
  home for real salaries. `docs/operations/runbooks/deploy-free.md` is the full,
  phase-by-phase account of how it was set up and what each free plan does and does not
  give you — read it before changing anything live. The other runbooks in
  `docs/operations/runbooks/` cover backup and restore, background jobs and incident
  response.

A safe habit: develop and test locally, let CI prove it, merge to `main`, then watch the
Render log and `GET /health/ready` (every migration applied) and the Vercel deployment
before telling anyone it is live.

---

## 10. When something does not work

| Symptom | Cause / fix |
|---|---|
| `PG_ADMIN_PASSWORD is not set in backend/.env` | you skipped `Copy-Item .env.example .env`, or the file is in the wrong folder |
| `db:setup` cannot connect | PostgreSQL is not running, or the superuser password in `.env` is wrong |
| API refuses to start, complaining about config | read the message: `src/config/config.ts` validates everything up front, including rejecting example passwords and short secrets |
| API will not start with `NODE_ENV=production` locally | deliberate: production refuses 2FA off, an http app URL, the fake AI provider, example passwords |
| Login asks for an authenticator code you do not have | set `SECURITY_MFA_ENFORCED=false` in `backend/.env` and restart the API |
| Every page in the web app errors | the API is not running, or `BACKEND_URL` in `.env.local` is wrong |
| Tests fail on files you just edited, for no apparent reason | you are in Git Bash. Run them from PowerShell at the repo root. |
| `test:int` fails on a missing table | run `npm run db:setup` once, then re-run; the test migrations are applied automatically |
| `npm run e2e` skips tasks | the AI task is skipped with AI off; the enquiry-form task is skipped without a `demo` form in `ENQUIRY_FORMS` |
| A seeded login stops working | the e2e run or your own testing changed the demo data: `npm run db:reset`, `db:migrate`, `db:seed` |

---

## 11. Reading order once it runs

1. `backend/README.md` — status per work package, the routes, the code map, how to write a new module.
2. `Frontend/web/README.md` — how the app talks to the API, the portal, the enquiry form.
3. `IMPLEMENTATION_GUIDE.md` §5 (non-negotiable rules), §6 (multi-tenancy and RLS), §8 (roles and permissions).
4. `BUSINESS_LOGIC_SPEC_v0.2.md` for whatever area you are given.
5. `docs/adr/` — the ADR for your work package, which says what was decided and why.
6. `docs/security/checklist.md` — what has to stay true.

Multi-tenancy is the one thing to internalise before writing any query: isolation is
enforced by PostgreSQL row-level security per transaction, and `erp_app` is deliberately
neither the table owner nor `BYPASSRLS`. Nothing may work around that, and the integration
tests sweep every route with another tenant's real ids to make sure nothing does.
