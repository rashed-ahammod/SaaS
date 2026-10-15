# ADR 0002 — Tenancy, database roles and the request transaction

- **Status:** accepted · 2026-10-14
- **Decision:**
  1. **Three roles.** `erp_owner` owns the tables and runs migrations. `erp_app` is the API
     role: no `BYPASSRLS`, and it owns nothing. `erp_worker` is the background-job role; it
     gets narrow policies (all tenants, but only `outbox_events`, read-only `audit_log`, and
     expired `idempotency_keys`). None of them is a superuser.
  2. **RLS helper.** Every tenant table calls `app_secure_tenant_table('<table>')` in its
     migration. `test/integration/rls-coverage.int-spec.ts` fails if any table with
     `tenant_id` lacks RLS, `FORCE`, or the `tenant_isolation` policy.
  3. **One transaction per request.** `TenantTransactionInterceptor` opens it after
     `AuthGuard` and runs `set_config('app.tenant_id', …, true)` (equivalent to `SET LOCAL`).
     Services reach it through `this.db.tx`, which is stored in AsyncLocalStorage. Outside a
     transaction `db.tx` throws, and raw queries as `erp_app` see no rows (fail closed).
  4. **Login before tenant.** The SECURITY DEFINER function `auth_find_tenant_id(slug)` returns
     only the tenant id for a workspace code. Everything after that runs under RLS.
  5. **Query layer:** Kysely with snake_case types that match the SQL. Migrations are plain SQL
     files applied by `src/platform/db/migrator.ts`. They are forward-only and checksummed.
- **Consequences:** a missing `WHERE tenant_id = …` in code cannot leak data. Jobs that work
  across tenants need an explicit worker policy, and that policy is reviewed like code.
