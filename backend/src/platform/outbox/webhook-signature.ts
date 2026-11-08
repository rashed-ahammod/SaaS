/**
 * Signing of outgoing webhooks (guide §15).
 *
 *   X-Timestamp: <unix seconds>
 *   X-Signature: hex HMAC-SHA256(secret, "<timestamp>.<raw body>")
 *
 * The receiver (n8n) recomputes the signature and rejects:
 *   - a wrong signature (body changed or wrong sender), and
 *   - an old timestamp (replay of a captured request).
 * verifyWebhookSignature() is the reference implementation of that check.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhook(
  secret: string,
  timestamp: number,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

export function verifyWebhookSignature(params: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
  maxAgeSeconds?: number;
  now?: Date;
}): boolean {
  const {
    secret,
    timestamp,
    signature,
    body,
    maxAgeSeconds = 300,
    now = new Date(),
  } = params;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

  const age = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));
  if (age > maxAgeSeconds) return false;

  const expected = Buffer.from(
    signWebhook(secret, Number(timestamp), body),
    'hex',
  );
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
