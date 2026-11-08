import { randomBytes } from 'node:crypto';
import {
  signWebhook,
  verifyWebhookSignature,
} from '../outbox/webhook-signature.js';
import { canonicalJson } from './canonical-json.js';
import { FieldEncryption, mask } from './field-encryption.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } }),
    ).toBe(canonicalJson({ a: { c: null, d: [3, { x: 2, y: 1 }] }, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('FieldEncryption', () => {
  const enc = new FieldEncryption(randomBytes(32));

  it('round-trips a value', () => {
    const stored = enc.encrypt(TENANT_A, '1990123456789');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('1990123456789');
    expect(enc.decrypt(TENANT_A, stored)).toBe('1990123456789');
  });

  it('cannot be decrypted under another tenant', () => {
    const stored = enc.encrypt(TENANT_A, 'secret');
    expect(() => enc.decrypt(TENANT_B, stored)).toThrow();
  });

  it('detects tampering', () => {
    const [v, iv, tag, ct] = enc.encrypt(TENANT_A, 'secret').split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 1;
    expect(() =>
      enc.decrypt(TENANT_A, [v, iv, tag, flipped.toString('base64')].join(':')),
    ).toThrow();
  });

  it('masks values', () => {
    expect(mask('1234567890124417')).toBe('**** **** 4417');
  });
});

describe('webhook signatures', () => {
  const secret = 'test-secret';
  const body = '{"id":"e1"}';
  const now = new Date('2026-10-14T06:00:00Z');
  const ts = Math.floor(now.getTime() / 1000);

  it('accepts a correct, fresh signature', () => {
    const signature = signWebhook(secret, ts, body);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: String(ts),
        signature,
        body,
        now,
      }),
    ).toBe(true);
  });

  it('rejects a changed body, wrong secret or old timestamp', () => {
    const signature = signWebhook(secret, ts, body);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: String(ts),
        signature,
        body: '{"id":"e2"}',
        now,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret: 'other',
        timestamp: String(ts),
        signature,
        body,
        now,
      }),
    ).toBe(false);
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: String(ts),
        signature,
        body,
        now: later,
      }),
    ).toBe(false);
  });
});
