/**
 * "Remember this device" for two-step verification (spec §11, migration 0041).
 *
 * After someone has typed a code from their authenticator app on a device, they
 * may tick a box to trust it. The next sign-in from that device then needs the
 * password only; the code is skipped until the trust expires or is revoked.
 *
 * What stays in place, deliberately:
 *   - the password is still checked on every sign-in;
 *   - the step-up code for high-risk actions (role grants, bank-account changes)
 *     is still asked for, because that guard does not look at how the session
 *     began (auth.guard.ts);
 *   - a device is trusted only when the user ticks the box, never by default;
 *   - changing the password, or turning 2FA off and on again, revokes every
 *     device, so a stolen laptop is cut off by a password change.
 *
 * The cookie holds a 32-byte random token. The database keeps only its SHA-256,
 * so a copy of the table cannot be used to sign in anywhere, for the same reason
 * password hashes are stored instead of passwords.
 */
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../../platform/db/database.service.js';

/** How long a trusted device stays trusted. */
export const TRUSTED_DEVICE_DAYS = 30;

/** The token the browser keeps: 32 random bytes, base64url (43 characters). */
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface DeviceTrust {
  token: string;
  expiresInSeconds: number;
}

@Injectable()
export class TrustedDevicesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Remember this device for the user. Runs inside the user's tenant
   * transaction. Returns the token for the cookie; it is never stored.
   */
  async remember(
    userId: string,
    client: { ip?: string | null; device?: string | null },
  ): Promise<DeviceTrust> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(
      Date.now() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.db.tx
      .insertInto('trusted_devices')
      .values({
        user_id: userId,
        token_hash: hash(token),
        // the browser's own description, shortened; shown when devices are listed
        label: client.device?.slice(0, 200) ?? null,
        created_ip: client.ip ?? null,
        expires_at: expiresAt,
      })
      .execute();
    return {
      token,
      expiresInSeconds: TRUSTED_DEVICE_DAYS * 24 * 60 * 60,
    };
  }

  /**
   * Is this token a live trust for this user? Runs inside the user's tenant
   * transaction, so a token from another tenant is invisible (row-level
   * security), and one belonging to another user of the same tenant is refused
   * by the user_id check below.
   *
   * A match also records the time, which is what lets the user recognise a
   * device they no longer use.
   */
  async isTrusted(userId: string, token: string | undefined): Promise<boolean> {
    if (!token || !TOKEN_RE.test(token)) return false;
    const row = await this.db.tx
      .selectFrom('trusted_devices')
      .select(['id', 'user_id', 'token_hash', 'expires_at', 'revoked_at'])
      .where('token_hash', '=', hash(token))
      .executeTakeFirst();
    if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now())
      return false;
    // the hash already identifies the row; compare the user too, so a token
    // can never be replayed for a different account
    if (!sameString(row.user_id, userId)) return false;

    await this.db.tx
      .updateTable('trusted_devices')
      .set({ last_used_at: new Date() })
      .where('id', '=', row.id)
      .execute();
    return true;
  }

  /** The user's live devices, newest first (for a "where am I signed in" list). */
  async list(userId: string) {
    const rows = await this.db.tx
      .selectFrom('trusted_devices')
      .select(['id', 'label', 'created_at', 'last_used_at', 'expires_at'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
    }));
  }

  /**
   * Stop trusting devices: one of them, or all of the user's (after a password
   * change, or when 2FA is turned off). Returns how many were revoked.
   */
  async revoke(userId: string, deviceId?: string): Promise<number> {
    let query = this.db.tx
      .updateTable('trusted_devices')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null);
    if (deviceId) query = query.where('id', '=', deviceId);
    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison, so no timing tells one id from another. */
function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
