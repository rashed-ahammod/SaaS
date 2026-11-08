/**
 * Guide §6 "Migration check" and §20: fails if any tenant-owned table lacks
 * row-level security, or if the app role could bypass it.
 */
import { sql } from 'kysely';
import { ownerDb } from './helpers.js';

const db = ownerDb();
afterAll(() => db.close());

describe('row-level security coverage', () => {
  it('every table with tenant_id has RLS enabled, forced, and a tenant_isolation policy', async () => {
    const { rows } = await sql<{
      table_name: string;
      rls: boolean;
      forced: boolean;
      has_policy: boolean;
    }>`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = c.relname
                        AND p.policyname = 'tenant_isolation') AS has_policy
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND EXISTS (SELECT 1 FROM information_schema.columns col
                      WHERE col.table_schema = 'public' AND col.table_name = c.relname
                        AND col.column_name = 'tenant_id')
       ORDER BY c.relname`.execute(db.kysely);

    expect(rows.length).toBeGreaterThan(0);
    const unprotected = rows
      .filter((r) => !r.rls || !r.forced || !r.has_policy)
      .map((r) => r.table_name);
    expect(unprotected).toEqual([]);
  });

  it('the tenants table is protected too', async () => {
    const { rows } = await sql<{ rls: boolean; forced: boolean }>`
      SELECT relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'tenants'`.execute(
      db.kysely,
    );
    expect(rows[0]).toEqual({ rls: true, forced: true });
  });

  it('the app and worker roles cannot bypass RLS and own no tables', async () => {
    const { rows: roles } = await sql<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('erp_app', 'erp_worker')`.execute(
      db.kysely,
    );
    expect(roles).toHaveLength(2);
    for (const r of roles)
      expect([r.rolsuper, r.rolbypassrls]).toEqual([false, false]);

    const { rows: owned } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_tables
       WHERE schemaname = 'public' AND tableowner IN ('erp_app', 'erp_worker')`.execute(
      db.kysely,
    );
    expect(owned[0].n).toBe(0);
  });

  it('the app role cannot UPDATE or DELETE the audit log', async () => {
    const { rows } = await sql<{ upd: boolean; del: boolean; ins: boolean }>`
      SELECT has_table_privilege('erp_app', 'audit_log', 'UPDATE') AS upd,
             has_table_privilege('erp_app', 'audit_log', 'DELETE') AS del,
             has_table_privilege('erp_app', 'audit_log', 'INSERT') AS ins`.execute(
      db.kysely,
    );
    expect(rows[0]).toEqual({ upd: false, del: false, ins: true });
  });
});
