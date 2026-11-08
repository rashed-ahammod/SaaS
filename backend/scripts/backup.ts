/**
 * Encrypted database backup (guide §22, spec §11; WP12):  npm run backup
 *
 *   npm run backup                          the main database (PG_DATABASE)
 *   npm run backup -- --database=erp_test   another database
 *
 * 1. pg_dump (custom format) as erp_backup: read-only, sees every tenant.
 * 2. Counts rows per table, so the restore drill can prove the copy is complete.
 * 3. Encrypts with BACKUP_ENCRYPTION_KEY (AES-256-GCM) into BACKUP_DIR; the plain
 *    dump is deleted at once.
 * 4. Writes a manifest (size, SHA-256, key id, counts) next to it and copies both
 *    to BACKUP_COPY_DIR (the second location) when set.
 * 5. Keeps the newest BACKUP_KEEP backups (default 30) in BACKUP_DIR.
 * 6. Records the run as job "backup" (system_job_runs), so the BackupMissing alert
 *    fires when no backup succeeded for 26 hours.
 *
 * Production adds continuous WAL archiving for point-in-time recovery (runbook
 * docs/operations/runbooks/backup-and-restore.md); this daily dump is the
 * portable copy and the input of the monthly restore drill.
 */
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { loadConfig } from '../src/config/config.js';
import { DatabaseService } from '../src/platform/db/database.service.js';
import { JobRuns } from '../src/platform/monitoring/job-runs.js';
import { backupKey, databaseFacts, encryptFile, env, keyId, pgTool, required, run, server, sha256File, type Manifest } from './lib/backup-common.js';

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
  const database = args.database ?? required('PG_DATABASE');
  const password = required('PG_BACKUP_PASSWORD');
  const key = backupKey();
  const dir = path.resolve(env.BACKUP_DIR ?? 'backups');
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `${database}-${stamp}.dump.enc`;
  const plain = path.join(os.tmpdir(), `${database}-${stamp}.dump`);
  const target = path.join(dir, name);
  const started = Date.now();

  // dump (as the read-only backup role)
  console.log(`backing up ${database} ...`);
  await run(pgTool('pg_dump'), ['-h', server.host, '-p', String(server.port), '-U', 'erp_backup', '-d', database, '-Fc', '-f', plain], password);

  // counts for the drill
  const client = new pg.Client({ ...server, user: 'erp_backup', password, database });
  await client.connect();
  const facts = await databaseFacts(client);
  await client.end();

  // encrypt, delete the plain dump
  try {
    await encryptFile(plain, target, key);
  } finally {
    await rm(plain, { force: true });
  }

  const manifest: Manifest = {
    file: name,
    database,
    createdAt: new Date().toISOString(),
    sizeBytes: (await stat(target)).size,
    sha256: await sha256File(target),
    keyId: keyId(key),
    migrations: facts.migrations,
    tables: facts.tables,
  };
  await writeFile(`${target}.json`, JSON.stringify(manifest, null, 2));

  // second location
  if (env.BACKUP_COPY_DIR) {
    await mkdir(env.BACKUP_COPY_DIR, { recursive: true });
    await copyFile(target, path.join(env.BACKUP_COPY_DIR, name));
    await copyFile(`${target}.json`, path.join(env.BACKUP_COPY_DIR, `${name}.json`));
  }

  // keep the newest N
  const keep = Number(env.BACKUP_KEEP ?? 30);
  const old = (await readdir(dir)).filter((f) => f.startsWith(`${database}-`) && f.endsWith('.dump.enc')).sort().slice(0, -keep);
  for (const f of old) {
    await rm(path.join(dir, f), { force: true });
    await rm(path.join(dir, `${f}.json`), { force: true });
  }

  const rows = Object.values(facts.tables).reduce((a, b) => a + b, 0);
  const summary = { file: name, sizeBytes: manifest.sizeBytes, rows, copied: !!env.BACKUP_COPY_DIR };
  console.log(`backup ${name}: ${(manifest.sizeBytes / 1024 / 1024).toFixed(2)} MB, ${Object.keys(facts.tables).length} tables, ${rows} rows, ${facts.migrations} migrations, key ${manifest.keyId}, ${((Date.now() - started) / 1000).toFixed(1)} s${env.BACKUP_COPY_DIR ? `, copied to ${env.BACKUP_COPY_DIR}` : ''}`);
  return summary;
}

/** Run the backup and record the result for monitoring (as the worker role). */
async function recorded() {
  const worker = new DatabaseService(loadConfig(), 'erp_worker');
  const runs = new JobRuns(worker, (m) => console.error(m));
  await runs.record('backup', 'started');
  try {
    const details = await main();
    await runs.record('backup', 'ok', { details });
  } catch (err) {
    await runs.record('backup', 'failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    await worker.close();
  }
}

recorded().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
