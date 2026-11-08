/**
 * Audit log (guide §14): entries chain correctly, cannot be changed, and the
 * verifier detects tampering.
 */
import 'dotenv/config';
import pg from 'pg';
import { AuditChainVerifier } from '../../src/platform/audit/audit-chain-verifier.js';
import { AuditService } from '../../src/platform/audit/audit.service.js';
import { appDb, config, createTenant, ownerDb, workerDb } from './helpers.js';

const db = appDb();
const worker = workerDb();
const owner = ownerDb();
const audit = new AuditService(db);
const verifier = new AuditChainVerifier(worker);

afterAll(async () => {
  await Promise.all([db.close(), worker.close(), owner.close()]);
});

describe('audit log', () => {
  it('chains entries and the verifier accepts the chain', async () => {
    const t = await createTenant(db, 'audit');
    await db.withTenant(
      { tenantId: t.id, userId: t.userId, ip: '10.0.0.1' },
      async () => {
        await audit.record({
          action: 'test.created',
          entity: 'thing',
          entityId: '1',
          after: { name: 'x', amount: '100.00' },
        });
        await audit.record({
          action: 'test.updated',
          entity: 'thing',
          entityId: '1',
          before: { name: 'x' },
          after: { name: 'y' },
        });
      },
    );

    const result = await verifier.verifyTenant(t.id);
    expect(result).toEqual({ tenantId: t.id, entries: 2, ok: true });
  });

  it('keeps sequence numbers gapless under concurrent writes', async () => {
    const t = await createTenant(db, 'audit-conc');
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        db.withTenant({ tenantId: t.id }, () =>
          audit.record({
            action: 'test.concurrent',
            entity: 'thing',
            entityId: String(i),
          }),
        ),
      ),
    );
    const result = await verifier.verifyTenant(t.id);
    expect(result).toMatchObject({ entries: 15, ok: true });
  });

  it('an entry is discarded when its transaction rolls back', async () => {
    const t = await createTenant(db, 'audit-rb');
    await expect(
      db.withTenant({ tenantId: t.id }, async () => {
        await audit.record({ action: 'test.never', entity: 'thing' });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    expect(await verifier.verifyTenant(t.id)).toMatchObject({
      entries: 0,
      ok: true,
    });
  });

  it('the app role cannot update or delete entries', async () => {
    const t = await createTenant(db, 'audit-ro');
    await db.withTenant({ tenantId: t.id }, () =>
      audit.record({ action: 'test.x', entity: 'thing' }),
    );
    await expect(
      db.withTenant({ tenantId: t.id }, () =>
        db.tx.updateTable('audit_log').set({ action: 'forged' }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.withTenant({ tenantId: t.id }, () =>
        db.tx.deleteFrom('audit_log').execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('even the table owner cannot update or delete entries (trigger)', async () => {
    const t = await createTenant(db, 'audit-own');
    await db.withTenant({ tenantId: t.id }, () =>
      audit.record({ action: 'test.x', entity: 'thing' }),
    );
    await expect(
      owner.withTenant({ tenantId: t.id }, () =>
        owner.tx.updateTable('audit_log').set({ action: 'forged' }).execute(),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      owner.withTenant({ tenantId: t.id }, () =>
        owner.tx.deleteFrom('audit_log').execute(),
      ),
    ).rejects.toThrow(/append-only/);
  });

  // Simulates an attacker with superuser access editing a row directly.
  it.skipIf(!process.env.PG_ADMIN_PASSWORD)(
    'the verifier detects a tampered entry',
    async () => {
      const t = await createTenant(db, 'audit-tamper');
      await db.withTenant({ tenantId: t.id }, async () => {
        await audit.record({
          action: 'payroll.approved',
          entity: 'run',
          after: { total: '100000.00' },
        });
        await audit.record({ action: 'payroll.disbursed', entity: 'run' });
      });

      const admin = new pg.Client({
        ...config.db.connectionFor('erp_owner'),
        user: process.env.PG_ADMIN_USER ?? 'postgres',
        password: process.env.PG_ADMIN_PASSWORD,
      });
      await admin.connect();
      try {
        await admin.query('BEGIN');
        await admin.query('ALTER TABLE audit_log DISABLE TRIGGER append_only');
        await admin.query(
          `UPDATE audit_log SET after = '{"total":"999999.00"}' WHERE tenant_id = $1 AND seq = 1`,
          [t.id],
        );
        await admin.query('ALTER TABLE audit_log ENABLE TRIGGER append_only');
        await admin.query('COMMIT');
      } finally {
        await admin.end();
      }

      expect(await verifier.verifyTenant(t.id)).toMatchObject({
        ok: false,
        brokenAtSeq: 1,
      });
    },
  );
});
