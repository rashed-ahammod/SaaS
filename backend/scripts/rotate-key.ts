/**
 * Re-encrypt the field-encrypted columns with a different master key:
 *
 *   OLD_KEY=<base64> NEW_KEY=<base64> npm run rotate-key -- --apply
 *
 * Needed whenever FIELD_ENCRYPTION_KEY changes, for any reason:
 *   - the key was rotated (a leak, or a scheduled rotation);
 *   - rows were written from a machine holding a different key, which is how
 *     the deployed API first met demo data it could not read: every GET of an
 *     encrypted field answered 500.
 *
 * Without --apply nothing is written: it reports what it would change and rolls
 * back. A value that already opens with the new key is left alone, so the
 * script is safe to run twice, and safe to re-run after it stopped half way.
 *
 * It connects as erp_owner and sets the tenant context per tenant, because
 * every one of these tables has FORCE row-level security. Keys are read from
 * the environment only, never from a file or an argument, so they stay out of
 * the shell history and the process list.
 */
import 'dotenv/config';
import pg from 'pg';
import { loadConfig } from '../src/config/config.js';
import { FieldEncryption } from '../src/platform/crypto/field-encryption.js';

/** Table and the column holding the sealed value. */
const COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['employees', 'nid_encrypted'],
  ['employees', 'tin_encrypted'],
  ['employee_bank_accounts', 'details_encrypted'],
  ['vendor_bank_accounts', 'details_encrypted'],
  ['users', 'mfa_secret'],
];

export type Rotation =
  | { outcome: 'already-new' }
  | { outcome: 'rotated'; value: string }
  | { outcome: 'unreadable'; reason: string };

/**
 * Decide what to do with one stored value. Split out from the database work so
 * the part that must never lose data can be tested on its own.
 */
export function rotate(
  from: FieldEncryption,
  to: FieldEncryption,
  tenantId: string,
  stored: string,
): Rotation {
  try {
    to.decrypt(tenantId, stored);
    return { outcome: 'already-new' };
  } catch {
    // not on the new key yet, which is the normal case
  }
  let plaintext: string;
  try {
    plaintext = from.decrypt(tenantId, stored);
  } catch (err) {
    return {
      outcome: 'unreadable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  return { outcome: 'rotated', value: to.encrypt(tenantId, plaintext) };
}

/** A 32-byte key, base64-encoded, or a message saying what is wrong with it. */
function key(name: string): Buffer {
  const raw = Buffer.from(process.env[name] ?? '', 'base64');
  if (raw.length !== 32)
    throw new Error(
      `${name} must be 32 bytes, base64-encoded (got ${raw.length})`,
    );
  return raw;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const from = new FieldEncryption(key('OLD_KEY'));
  const to = new FieldEncryption(key('NEW_KEY'));

  const client = new pg.Client(loadConfig().db.connectionFor('erp_owner'));
  await client.connect();

  let rotated = 0;
  let already = 0;
  let unreadable = 0;
  try {
    const tenants = (
      await client.query<{ id: string; slug: string }>(
        'SELECT id, slug FROM tenants ORDER BY slug',
      )
    ).rows;

    for (const tenant of tenants) {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenant.id,
      ]);
      for (const [table, column] of COLUMNS) {
        const rows = (
          await client.query<{ id: string; tenant_id: string; value: string }>(
            `SELECT id, tenant_id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`,
          )
        ).rows;
        for (const row of rows) {
          const result = rotate(from, to, row.tenant_id, row.value);
          if (result.outcome === 'already-new') {
            already += 1;
          } else if (result.outcome === 'unreadable') {
            unreadable += 1;
            console.log(
              `  ${table}.${column} ${row.id}: opens with neither key (${result.reason})`,
            );
          } else {
            if (apply)
              await client.query(
                `UPDATE ${table} SET ${column} = $1 WHERE id = $2`,
                [result.value, row.id],
              );
            rotated += 1;
          }
        }
      }
      await client.query(apply ? 'COMMIT' : 'ROLLBACK');
      console.log(`tenant ${tenant.slug}: done`);
    }
  } finally {
    await client.end();
  }

  console.log(
    `\n${apply ? 'rotated' : 'would rotate'} ${rotated} value(s); ` +
      `${already} already on the new key; ${unreadable} unreadable`,
  );
  if (!apply) console.log('Nothing was written. Re-run with --apply.');
  if (unreadable) process.exit(1);
}

// Importing this file for its `rotate` function must not open a connection.
if (process.argv[1]?.includes('rotate-key')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
