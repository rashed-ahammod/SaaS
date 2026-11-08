/**
 * Admin tools:
 *   - audit log viewer (spec §4: Admin V, Accounts V finance entries; Auditor V)
 *   - failed outgoing events (dead-letter list) with replay (spec §9: "land in a
 *     dead-letter list Admin can see and replay")
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Page } from '../../platform/http/common.dto.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { AccessService } from '../identity/access/access.service.js';
import type { AuditLogQueryDto, OutboxQueryDto } from './dto/system.dto.js';

/** Audit entities that count as finance (visible with audit.view_finance). Grows with WP6/WP7 and Phase 2. */
export const FINANCE_AUDIT_ENTITIES = [
  'payroll_run',
  'payment',
  'disbursement_file',
  'voucher',
  'journal',
];

@Injectable()
export class SystemService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async auditLog(query: AuditLogQueryDto): Promise<Page<unknown>> {
    let q = this.db.tx.selectFrom('audit_log');

    // full log, or finance entries only
    if (!this.access.current().has('audit.view'))
      q = q.where('entity', 'in', FINANCE_AUDIT_ENTITIES);

    // filters
    if (query.entity) q = q.where('entity', '=', query.entity);
    if (query.entityId) q = q.where('entity_id', '=', query.entityId);
    if (query.action)
      q = q.where(
        'action',
        'like',
        `${query.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
      );
    if (query.actorUserId) q = q.where('actor_user_id', '=', query.actorUserId);
    if (query.from) q = q.where('occurred_at', '>=', new Date(query.from));
    if (query.to) q = q.where('occurred_at', '<', new Date(query.to));

    const { total } = await q
      .select(sql<number>`count(*)::int`.as('total'))
      .executeTakeFirstOrThrow();
    const rows = await q
      .selectAll()
      .orderBy('seq', 'desc')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .execute();

    return {
      items: rows.map((r) => ({
        seq: r.seq,
        occurredAt: r.occurred_at,
        actorUserId: r.actor_user_id,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        before: r.before,
        after: r.after,
        ip: r.ip,
        device: r.device,
        hash: r.hash,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async outboxEvents(query: OutboxQueryDto) {
    const rows = await this.db.tx
      .selectFrom('outbox_events')
      .select([
        'id',
        'type',
        'entity_id',
        'status',
        'attempts',
        'last_error',
        'created_at',
        'next_attempt_at',
        'sent_at',
      ])
      .where('status', '=', query.status)
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      entityId: r.entity_id,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      createdAt: r.created_at,
      nextAttemptAt: r.next_attempt_at,
      sentAt: r.sent_at,
    }));
  }

  async replayOutboxEvent(eventId: string) {
    const replayed = await this.outbox.replayDead(eventId);
    if (!replayed) throw new ConflictException(MSG.OUTBOX_EVENT_NOT_DEAD);
    await this.audit.record({
      action: 'outbox.replayed',
      entity: 'outbox_event',
      entityId: eventId,
    });
    return { replayed: true };
  }
}
