/**
 * The decision the key-rotation script makes about a single stored value. This
 * is the part that could silently destroy data — a wrong "rotated" would write
 * a value nobody can open again — so it is tested without a database.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { FieldEncryption } from '../src/platform/crypto/field-encryption.js';
import { rotate } from './rotate-key.js';

const oldKey = new FieldEncryption(randomBytes(32));
const newKey = new FieldEncryption(randomBytes(32));
const tenant = randomUUID();

describe('rotate', () => {
  it('re-encrypts a value sealed with the old key, keeping the plaintext', () => {
    const result = rotate(oldKey, newKey, tenant, oldKey.encrypt(tenant, '1990123456789'));

    expect(result.outcome).toBe('rotated');
    if (result.outcome !== 'rotated') return;
    expect(newKey.decrypt(tenant, result.value)).toBe('1990123456789');
    // and the sealed form really changed, so the old key no longer opens it
    expect(() => oldKey.decrypt(tenant, result.value)).toThrow();
  });

  it('leaves a value that already opens with the new key alone', () => {
    expect(
      rotate(oldKey, newKey, tenant, newKey.encrypt(tenant, '1990123456789')),
    ).toEqual({ outcome: 'already-new' });
  });

  it('reports a value that opens with neither key instead of touching it', () => {
    const strangers = [
      new FieldEncryption(randomBytes(32)).encrypt(tenant, 'written elsewhere'),
      'v1:not:base64:either',
      'plain text that was never encrypted',
    ];
    for (const stored of strangers)
      expect(rotate(oldKey, newKey, tenant, stored).outcome).toBe('unreadable');
  });

  it('does not rotate one tenant row into another tenant', () => {
    // the tenant id is the AAD, so a value moved between tenants is unreadable
    const stored = oldKey.encrypt(tenant, '1990123456789');

    expect(rotate(oldKey, newKey, randomUUID(), stored).outcome).toBe('unreadable');
  });
});
