/**
 * Re-computes every tenant's audit hash chain and reports the first broken
 * entry (guide §14: nightly job, alert on any break).
 *
 * Runs as erp_worker, which may read audit_log for all tenants but not change it.
 */
import type { DatabaseService } from '../db/database.service.js';
import { computeAuditHash, GENESIS_HASH } from './audit.service.js';

export interface ChainResult {
  tenantId: string;
  entries: number;
  ok: boolean;
  /** First sequence number whose hash, prev_hash or numbering is wrong. */
  brokenAtSeq?: number;
}

export class AuditChainVerifier {
  constructor(private readonly workerDb: DatabaseService) {}

  async verifyAll(): Promise<ChainResult[]> {
    const tenants = await this.workerDb.kysely
      .selectFrom('audit_log')
      .select('tenant_id')
      .distinct()
      .execute();
    const results: ChainResult[] = [];
    for (const { tenant_id } of tenants)
      results.push(await this.verifyTenant(tenant_id));
    return results;
  }

  async verifyTenant(tenantId: string, pageSize = 1000): Promise<ChainResult> {
    let prevHash = GENESIS_HASH;
    let expectedSeq = 1;

    // read the chain page by page, in order
    for (;;) {
      const rows = await this.workerDb.kysely
        .selectFrom('audit_log')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('seq', '>=', expectedSeq)
        .orderBy('seq')
        .limit(pageSize)
        .execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        const hash = computeAuditHash(prevHash, {
          tenantId: row.tenant_id,
          seq: row.seq,
          occurredAt: row.occurred_at.toISOString(),
          actorUserId: row.actor_user_id,
          action: row.action,
          entity: row.entity,
          entityId: row.entity_id,
          before: row.before,
          after: row.after,
          ip: row.ip,
          device: row.device,
        });
        if (
          row.seq !== expectedSeq ||
          row.prev_hash !== prevHash ||
          row.hash !== hash
        ) {
          return {
            tenantId,
            entries: expectedSeq - 1,
            ok: false,
            brokenAtSeq: expectedSeq,
          };
        }
        prevHash = row.hash;
        expectedSeq++;
      }
    }
    return { tenantId, entries: expectedSeq - 1, ok: true };
  }
}
