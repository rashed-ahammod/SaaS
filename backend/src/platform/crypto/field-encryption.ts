/**
 * Field-level encryption for sensitive columns: NID, TIN, bank details,
 * complaint records, 2FA secrets (spec §11, guide §20).
 *
 * - AES-256-GCM (authenticated: a tampered value fails to decrypt).
 * - Each tenant gets its own key, derived from the master key with HKDF, so
 *   a value copied into another tenant's row cannot be decrypted there.
 * - Stored format: "v1:<iv>:<auth tag>:<ciphertext>" (base64 parts). The "v1"
 *   prefix allows key rotation later.
 *
 * The master key comes from FIELD_ENCRYPTION_KEY (secret store in production).
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const VERSION = 'v1';

export class FieldEncryption {
  constructor(private readonly masterKey: Buffer) {
    if (masterKey.length !== 32)
      throw new Error('FieldEncryption: master key must be 32 bytes');
  }

  encrypt(tenantId: string, plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.tenantKey(tenantId), iv);
    cipher.setAAD(Buffer.from(tenantId));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(tenantId: string, stored: string): string {
    const [version, iv, tag, ciphertext] = stored.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('FieldEncryption: unknown or damaged value');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.tenantKey(tenantId),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(tenantId));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private tenantKey(tenantId: string): Buffer {
    return Buffer.from(
      hkdfSync(
        'sha256',
        this.masterKey,
        Buffer.from(tenantId),
        'erp-field-encryption',
        32,
      ),
    );
  }
}

/**
 * Masked display of a sensitive value for users without the field grant
 * (guide §8): mask('1234567890124417') -> "**** **** 4417".
 */
export function mask(value: string, visible = 4): string {
  return `**** **** ${value.slice(-visible)}`;
}
