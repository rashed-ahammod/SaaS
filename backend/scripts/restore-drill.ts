/**
 * Restore drill (guide §21 "monthly", spec §11 "a tested restore drill"; WP12):
 *
 *   npm run restore:drill                         newest backup in BACKUP_DIR
 *   npm run restore:drill -- --file=backups/x.dump.enc [--keep]
 *
 * Restores a backup into a scratch database and proves it is usable:
 *   1. the file matches its manifest (SHA-256) and decrypts (GCM tag = not altered)
 *   2. pg_restore into erp_restore_drill (dropped first; kept with --keep)
 *   3. every table has exactly the rows counted at backup time
 *   4. every migration is recorded
 *   5. row-level security is still on, and forced, on every tenant table
 *   6. every tenant's audit hash chain verifies (tamper evidence survived)
 *   7. the API role, inside one tenant, sees that tenant's rows and nothing else
 * and writes a report (with timings: the measured restore time for the recovery
 * targets) to docs/operations/drills/. Needs PG_ADMIN_* (creates the database).
 */
import { readdir, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { loadConfig } from '../src/config/config.js';
import { AuditChainVerifier } from '../src/platform/audit/audit-chain-verifier.js';
import { DatabaseService } from '../src/platform/db/database.service.js';
import { backupKey, databaseFacts, decryptFile, env, keyId, pgTool, required, run, server, sha256File, type Manifest } from './lib/backup-common.js';

const DRILL_DB = 'erp_restore_drill';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string | undefined]));
  const dir = path.resolve(env.BACKUP_DIR ?? 'backups');
  const file = args.file
    ? path.resolve(args.file)
    : path.join(dir, (await readdir(dir)).filter((f) => f.endsWith('.dump.enc')).sort().at(-1) ?? '');
  if (!file.endsWith('.dump.enc')) throw new Error(`No backup found in ${dir} (run npm run backup first)`);
  const admin = { ...server, user: env.PG_ADMIN_USER ?? 'postgres', password: required('PG_ADMIN_PASSWORD') };
  const checks: Check[] = [];
  const t: Record<string, number> = {};
  const timed = async <T>(label: string, work: () => Promise<T>) => {
    const s = Date.now();
    const r = await work();
    t[label] = (Date.now() - s) / 1000;
    return r;
  };

  // 1. integrity and decryption
  const manifest = JSON.parse(await readFile(`${file}.json`, 'utf8')) as Manifest;
  const key = backupKey();
  checks.push({ name: 'File matches its manifest (SHA-256)', ok: (await sha256File(file)) === manifest.sha256, detail: manifest.sha256.slice(0, 16) + '…' });
  checks.push({ name: 'Encrypted with the current key', ok: keyId(key) === manifest.keyId, detail: `key ${manifest.keyId}` });
  const plain = path.join(os.tmpdir(), `${DRILL_DB}-${Date.now()}.dump`);
  await timed('decrypt', () => decryptFile(file, plain, key));
  checks.push({ name: 'Decrypts (authentication tag valid: not altered)', ok: true, detail: '' });

  // 2. restore into a scratch database
  const root = new pg.Client({ ...admin, database: 'postgres' });
  await root.connect();
  await root.query(`DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)`);
  await root.query(`CREATE DATABASE ${DRILL_DB} OWNER erp_owner ENCODING 'UTF8' TEMPLATE template0`);
  await root.query(`GRANT CONNECT ON DATABASE ${DRILL_DB} TO erp_app, erp_worker`);
  try {
    await timed('restore', () => run(pgTool('pg_restore'), ['-h', admin.host, '-p', String(admin.port), '-U', admin.user, '-d', DRILL_DB, '--exit-on-error', plain], admin.password));
  } finally {
    await rm(plain, { force: true });
  }

  const drill = new pg.Client({ ...admin, database: DRILL_DB });
  await drill.connect();
  await timed('verify', async () => {
    // 3 + 4. complete
    const facts = await databaseFacts(drill);
    const wrong = Object.entries(manifest.tables).filter(([table, n]) => facts.tables[table] !== n);
    const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
    checks.push({ name: 'Every table has the rows counted at backup time', ok: wrong.length === 0 && Object.keys(facts.tables).length === Object.keys(manifest.tables).length, detail: wrong.length ? wrong.map(([tb, n]) => `${tb}: ${facts.tables[tb]} of ${n}`).join(', ') : `${Object.keys(facts.tables).length} tables, ${rows} rows` });
    checks.push({ name: 'Every migration recorded', ok: facts.migrations === manifest.migrations, detail: `${facts.migrations} migrations` });

    // 5. tenant isolation survived
    const { rows: unprotected } = await drill.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id')
         AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    checks.push({ name: 'Row-level security on and forced on every tenant table', ok: unprotected.length === 0, detail: unprotected.map((r) => r.relname).join(', ') || 'all protected' });

    // 6. audit chains
    const config = loadConfig({ ...process.env, PG_DATABASE: DRILL_DB });
    const worker = new DatabaseService(config, 'erp_worker');
    const results = await new AuditChainVerifier(worker).verifyAll();
    await worker.close();
    const broken = results.filter((r) => !r.ok);
    checks.push({ name: "Every tenant's audit hash chain verifies", ok: broken.length === 0, detail: `${results.length} tenants, ${results.reduce((n, r) => n + r.entries, 0)} entries${broken.length ? `; broken: ${broken.map((b) => b.tenantId).join(', ')}` : ''}` });

    // 7. the API role inside one tenant
    const { rows: busiest } = await drill.query<{ tenant_id: string; n: string }>('SELECT tenant_id, count(*) AS n FROM employees GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1');
    if (busiest[0]) {
      const app = new DatabaseService(config, 'erp_app');
      const seen = await app.withTenant({ tenantId: busiest[0].tenant_id }, async () => {
        const n = await app.tx.selectFrom('employees').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
        const others = await app.tx.selectFrom('employees').select('id').where('tenant_id', '<>', busiest[0].tenant_id).limit(1).execute();
        return { n: Number(n.n), others: others.length };
      });
      await app.close();
      checks.push({ name: 'API role sees its tenant, and only its tenant', ok: seen.n === Number(busiest[0].n) && seen.others === 0, detail: `${seen.n} employees visible, ${seen.others} of other tenants` });
    }
  });
  await drill.end();
  if (!('keep' in args)) await root.query(`DROP DATABASE ${DRILL_DB} WITH (FORCE)`);
  await root.end();

  // report
  const passed = checks.every((c) => c.ok);
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  const date = new Date().toISOString().slice(0, 10);
  const report = [
    `# Restore drill ${date}`,
    '',
    `- **Result:** ${passed ? 'PASSED' : 'FAILED'}`,
    `- **Backup:** \`${manifest.file}\` of \`${manifest.database}\`, taken ${manifest.createdAt}, ${(manifest.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
    `- **Restore time:** ${total.toFixed(1)} s in total (decrypt ${t.decrypt.toFixed(1)} s, restore ${t.restore.toFixed(1)} s, checks ${t.verify.toFixed(1)} s)`,
    `- **Machine:** ${os.hostname()} (${os.platform()}), PostgreSQL tools from ${path.dirname(pgTool('pg_restore'))}`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...checks.map((c) => `| ${c.name} | ${c.ok ? 'ok' : '**FAILED**'} | ${c.detail} |`),
    '',
  ].join('\n');
  const out = path.resolve('..', 'docs', 'operations', 'drills');
  await mkdir(out, { recursive: true });
  const reportFile = path.join(out, `restore-drill-${date}.md`);
  await writeFile(reportFile, report);
  console.log(report);
  console.log(`report: ${reportFile}`);
  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
