/**
 * One-off: re-encrypt the field-level encrypted columns with a different master
 * key. Needed because the demo data was seeded from a developer machine, whose
 * FIELD_ENCRYPTION_KEY is not the one the deployed API uses, so every read of an
 * encrypted field failed with 500.
 *
 *   OLD_KEY=<base64> NEW_KEY=<base64> node rotate-key.mjs [--apply]
 *
 * Without --apply it only reports what it would change. Each value is decrypted
 * with the old key and encrypted with the new one; a value that already opens
 * with the new key is left alone, so running it again is safe.
 */
import 'dotenv/config';
import pg from 'pg';
import { FieldEncryption } from './dist/platform/crypto/field-encryption.js';
import { loadConfig } from './dist/config/config.js';

const apply = process.argv.includes('--apply');
const oldKey = Buffer.from(process.env.OLD_KEY ?? '', 'base64');
const newKey = Buffer.from(process.env.NEW_KEY ?? '', 'base64');
if (oldKey.length !== 32 || newKey.length !== 32) {
  console.error('OLD_KEY and NEW_KEY must each be 32 bytes, base64-encoded.');
  process.exit(1);
}
const from = new FieldEncryption(oldKey);
const to = new FieldEncryption(newKey);

/** table, the column holding the sealed value, and how to find the tenant. */
const COLUMNS = [
  ['employees', 'nid_encrypted'],
  ['employees', 'tin_encrypted'],
  ['employee_bank_accounts', 'details_encrypted'],
  ['vendor_bank_accounts', 'details_encrypted'],
  ['users', 'mfa_secret'],
];

const client = new pg.Client(loadConfig().db.connectionFor('erp_owner'));
await client.connect();
const tenants = (await client.query('SELECT id, slug FROM tenants ORDER BY slug'))
  .rows;

let changed = 0;
let already = 0;
let failed = 0;

for (const tenant of tenants) {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
  for (const [table, column] of COLUMNS) {
    const rows = (
      await client.query(
        `SELECT id, tenant_id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`,
      )
    ).rows;
    for (const row of rows) {
      // already readable with the new key? then leave it
      try {
        to.decrypt(row.tenant_id, row.value);
        already += 1;
        continue;
      } catch {
        /* needs rotating */
      }
      let plaintext;
      try {
        plaintext = from.decrypt(row.tenant_id, row.value);
      } catch (err) {
        failed += 1;
        console.log(
          `  ${table}.${column} ${row.id}: opens with neither key (${err.message})`,
        );
        continue;
      }
      if (apply) {
        await client.query(
          `UPDATE ${table} SET ${column} = $1 WHERE id = $2`,
          [to.encrypt(row.tenant_id, plaintext), row.id],
        );
      }
      changed += 1;
    }
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(`tenant ${tenant.slug}: done`);
}
await client.end();

console.log(
  `\n${apply ? 'rotated' : 'would rotate'} ${changed} value(s); ` +
    `${already} already on the new key; ${failed} unreadable`,
);
process.exit(failed ? 1 : 0);
