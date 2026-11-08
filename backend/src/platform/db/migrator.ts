/**
 * Minimal forward-only SQL migration runner (guide §22: forward-only, backward-compatible).
 *
 * - Migrations are plain .sql files in backend/db/migrations, applied in file-name order.
 * - Each file runs in its own transaction; a failure leaves the database unchanged.
 * - Applied files are recorded in `schema_migrations` with a checksum. Editing a file
 *   after it was applied is an error: write a new migration instead.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/migrations',
);

export async function runMigrations(
  connection: pg.ClientConfig,
  log: (msg: string) => void = () => {},
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = new pg.Client(connection);
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        file_name  text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);

    // Only one migrator at a time (e.g. two app instances starting together).
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [
      'schema_migrations',
    ]);

    const applied = new Map<string, string>(
      (
        await client.query('SELECT file_name, checksum FROM schema_migrations')
      ).rows.map((r) => [r.file_name, r.checksum]),
    );

    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const newlyApplied: string[] = [];

    for (const file of files) {
      const sqlText = await readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sqlText).digest('hex');

      const previous = applied.get(file);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${file} was changed after it was applied. Write a new migration instead.`,
          );
        }
        continue;
      }

      log(`  applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sqlText);
        await client.query(
          'INSERT INTO schema_migrations (file_name, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      newlyApplied.push(file);
    }
    return newlyApplied;
  } finally {
    await client.end();
  }
}
