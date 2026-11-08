/**
 * Audit log (guide §14). The ONLY way to write audit entries.
 *
 *   await this.audit.record({
 *     action: 'user.mfa_enabled',
 *     entity: 'user',
 *     entityId: user.id,
 *     before: { mfa_enabled: false },
 *     after: { mfa_enabled: true },
 *   });
 *
 * - Runs in the current tenant transaction, so the entry is saved only if the
 *   change itself is saved.
 * - Tenant, actor, IP and device are taken from the request context.
 * - Each entry is chained to the previous one of the same tenant:
 *       hash = SHA-256(prev_hash + canonical_json(entry))
 *   so editing or deleting any row breaks the chain (see AuditChainVerifier).
 * - Never put secrets (passwords, 2FA secrets, full NID/bank numbers) in before/after.
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../db/database.service.js';
import { canonicalJson, sha256Hex } from '../crypto/canonical-json.js';
import { requestContext } from '../tenancy/request-context.js';

export interface AuditEntryInput {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** prev_hash of the first entry of every tenant. */
export const GENESIS_HASH = '0'.repeat(64);

/** The fields covered by the hash, in one fixed shape (used by record() and the verifier). */
export interface HashedAuditFields {
  tenantId: string;
  seq: number;
  occurredAt: string; // ISO-8601 UTC
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  device: string | null;
}

export function computeAuditHash(
  prevHash: string,
  fields: HashedAuditFields,
): string {
  return sha256Hex(prevHash + canonicalJson(fields));
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(input: AuditEntryInput): Promise<void> {
    const ctx = requestContext.get();
    const tx = this.db.tx;

    // one writer per tenant at a time, so sequence numbers have no gaps or duplicates
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'audit:' + ctx.tenantId}, 0))`.execute(
      tx,
    );

    // find the previous entry of this tenant (RLS limits the query to the current tenant)
    const last = await tx
      .selectFrom('audit_log')
      .select(['seq', 'hash'])
      .orderBy('seq', 'desc')
      .limit(1)
      .executeTakeFirst();

    // build the entry; JSON round-trip so the hashed values equal what jsonb returns later
    const fields: HashedAuditFields = {
      tenantId: ctx.tenantId,
      seq: (last?.seq ?? 0) + 1,
      occurredAt: new Date().toISOString(),
      actorUserId: ctx.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: toJsonValue(input.before),
      after: toJsonValue(input.after),
      ip: ctx.ip ?? null,
      device: ctx.device ?? null,
    };
    const prevHash = last?.hash ?? GENESIS_HASH;

    // save
    await tx
      .insertInto('audit_log')
      .values({
        tenant_id: fields.tenantId,
        seq: fields.seq,
        occurred_at: new Date(fields.occurredAt),
        actor_user_id: fields.actorUserId,
        action: fields.action,
        entity: fields.entity,
        entity_id: fields.entityId,
        before: jsonParam(fields.before),
        after: jsonParam(fields.after),
        ip: fields.ip,
        device: fields.device,
        prev_hash: prevHash,
        hash: computeAuditHash(prevHash, fields),
      })
      .execute();
  }
}

function toJsonValue(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/** jsonb parameters must be sent as JSON text (pg would send arrays as PG arrays). */
function jsonParam(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}
