/**
 * Event outbox (guide §15). Modules publish business events here:
 *
 *   await this.outbox.add({
 *     type: 'leave.approved',
 *     entityId: request.id,
 *     payload: { employeeId, from, to, days },
 *   });
 *
 * The event is written in the current tenant transaction, so it exists only if
 * the business change is saved (no lost events, no events for rolled-back work).
 * OutboxDispatcher (worker) later sends it to n8n as a signed webhook.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service.js';

export interface NewOutboxEvent {
  /** 'area.event', lower case, e.g. 'leave.approved' (spec §9 event catalogue). */
  type: string;
  entityId?: string;
  payload: Record<string, unknown>;
}

/**
 * Payloads leave the core and reach n8n, email and SMS, so they must not carry
 * salary or identity data (guide §15). Send IDs; the receiver fetches details
 * through the API with its permissions.
 */
const FORBIDDEN_PAYLOAD_KEYS =
  /^(salary|gross|net|basic|amount_?paid|nid|tin|bank|account_?number|wallet|password|mfa_?secret)/i;

@Injectable()
export class OutboxService {
  constructor(private readonly db: DatabaseService) {}

  async add(event: NewOutboxEvent): Promise<string> {
    // check the payload contains no sensitive fields
    const badKey = findForbiddenKey(event.payload);
    if (badKey)
      throw new BadRequestException(
        `Outbox payload must not contain sensitive field "${badKey}"`,
      );

    // save in the current transaction
    const row = await this.db.tx
      .insertInto('outbox_events')
      .values({
        type: event.type,
        entity_id: event.entityId ?? null,
        payload: JSON.stringify(event.payload),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** System Admin "replay" of a dead event: send it again from scratch. */
  async replayDead(eventId: string): Promise<boolean> {
    const result = await this.db.tx
      .updateTable('outbox_events')
      .set({
        status: 'pending',
        attempts: 0,
        next_attempt_at: new Date(),
        last_error: null,
      })
      .where('id', '=', eventId)
      .where('status', '=', 'dead')
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}

function findForbiddenKey(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  for (const [key, inner] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.test(key)) return key;
    const nested = findForbiddenKey(inner);
    if (nested) return nested;
  }
  return undefined;
}
