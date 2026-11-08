/**
 * Cross-tenant attack tests (guide §21, release blocker).
 * Two tenants; code running for tenant A tries to read and write tenant B's data.
 * Extend this file whenever a new tenant table or endpoint is added.
 */
import { sql } from 'kysely';
import { appDb, createTenant, type TestTenant } from './helpers.js';

const db = appDb();
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  a = await createTenant(db, 'a');
  b = await createTenant(db, 'b');
});
afterAll(() => db.close());

describe('tenant isolation (RLS)', () => {
  it('a tenant sees only its own users and tenant row', async () => {
    await db.withTenant({ tenantId: a.id }, async () => {
      const users = await db.tx
        .selectFrom('users')
        .select('tenant_id')
        .execute();
      expect(users.length).toBeGreaterThan(0);
      expect(users.every((u) => u.tenant_id === a.id)).toBe(true);

      const tenants = await db.tx.selectFrom('tenants').select('id').execute();
      expect(tenants.map((t) => t.id)).toEqual([a.id]);
    });
  });

  it("reading another tenant's row by id returns nothing", async () => {
    await db.withTenant({ tenantId: a.id }, async () => {
      const row = await db.tx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', b.userId)
        .executeTakeFirst();
      expect(row).toBeUndefined();
    });
  });

  it("updating or deleting another tenant's row changes nothing", async () => {
    await db.withTenant({ tenantId: a.id }, async () => {
      const upd = await db.tx
        .updateTable('users')
        .set({ status: 'disabled' })
        .where('id', '=', b.userId)
        .executeTakeFirst();
      expect(upd.numUpdatedRows).toBe(0n);
      const del = await db.tx
        .deleteFrom('users')
        .where('id', '=', b.userId)
        .executeTakeFirst();
      expect(del.numDeletedRows).toBe(0n);
    });
    await db.withTenant({ tenantId: b.id }, async () => {
      const row = await db.tx
        .selectFrom('users')
        .select('status')
        .where('id', '=', b.userId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('active');
    });
  });

  it('inserting a row for another tenant is rejected', async () => {
    await expect(
      db.withTenant({ tenantId: a.id }, () =>
        db.tx
          .insertInto('users')
          .values({
            tenant_id: b.id,
            email: 'intruder@x.test',
            password_hash: 'x',
          })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('moving a row to another tenant is rejected', async () => {
    await expect(
      db.withTenant({ tenantId: a.id }, () =>
        db.tx
          .updateTable('users')
          .set({ tenant_id: b.id })
          .where('id', '=', a.userId)
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('without a tenant context the app role sees no rows (fail closed)', async () => {
    const users = await db.kysely.selectFrom('users').select('id').execute();
    expect(users).toEqual([]);
    const audit = await db.kysely
      .selectFrom('audit_log')
      .select('seq')
      .execute();
    expect(audit).toEqual([]);
  });

  it('db.tx outside a tenant transaction throws', () => {
    expect(() => db.tx).toThrow(/No tenant context/);
  });

  it('the tenant setting does not leak to the next use of a pooled connection', async () => {
    await db.withTenant({ tenantId: a.id }, async () => {});
    const { rows } = await sql<{
      t: string | null;
    }>`SELECT app_current_tenant_id()::text AS t`.execute(db.kysely);
    expect(rows[0].t).toBeNull();
  });

  it('opening a different tenant inside a tenant transaction is refused', async () => {
    await expect(
      db.withTenant({ tenantId: a.id }, () =>
        db.withTenant({ tenantId: b.id }, async () => 1),
      ),
    ).rejects.toThrow(/different tenant/);
  });
});
