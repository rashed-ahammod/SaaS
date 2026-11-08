/**
 * Event callback token (WP10).
 *
 * When the dispatcher sends an event to n8n it adds
 *
 *   X-Callback-Token: v1.<tenantId>.<eventId>.<expiresUnix>.<hmac>
 *
 * With it n8n may call back for THAT event only: fetch the messages to send,
 * report each result, download a payslip attachment. n8n therefore holds no
 * tenant secrets, and a leaked token reaches one event's messages for a few days.
 * The token is made at sending time and never stored.
 *
 * The HMAC key is derived from OUTBOX_WEBHOOK_SECRET with a fixed label, so a
 * webhook signature can never be reused as a token or the other way round.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CALLBACK_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update('erp.callback-token.v1').digest();
}

function mac(
  secret: string,
  tenantId: string,
  eventId: string,
  expires: number,
): string {
  return createHmac('sha256', key(secret))
    .update(`v1.${tenantId}.${eventId}.${expires}`)
    .digest('hex');
}

export function signCallbackToken(
  secret: string,
  tenantId: string,
  eventId: string,
  now = new Date(),
): string {
  const expires = Math.floor(now.getTime() / 1000) + CALLBACK_TOKEN_TTL_SECONDS;
  return `v1.${tenantId}.${eventId}.${expires}.${mac(secret, tenantId, eventId, expires)}`;
}

/** The token's tenant and event, or null when it is malformed, forged or expired. */
export function verifyCallbackToken(
  secret: string,
  token: string | undefined,
  now = new Date(),
): { tenantId: string; eventId: string } | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const [, tenantId, eventId, expiresText, given] = parts;
  if (
    !UUID.test(tenantId) ||
    !UUID.test(eventId) ||
    !/^\d+$/.test(expiresText) ||
    !/^[0-9a-f]{64}$/.test(given)
  )
    return null;
  const expires = Number(expiresText);
  if (expires < Math.floor(now.getTime() / 1000)) return null;
  const expected = Buffer.from(mac(secret, tenantId, eventId, expires), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(given, 'hex'))) return null;
  return { tenantId, eventId };
}
