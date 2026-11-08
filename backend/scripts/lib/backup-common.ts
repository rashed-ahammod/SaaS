/**
 * Shared by backup.ts and restore-drill.ts (WP12).
 *
 * Backup file format (".dump.enc"): "ERPBK1" | 12-byte IV | AES-256-GCM ciphertext of
 * a pg_dump custom-format file | 16-byte auth tag. A damaged or altered file fails
 * to decrypt instead of restoring silently wrong data.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';

export const env = process.env;
const MAGIC = Buffer.from('ERPBK1');

export function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set in backend/.env`);
  return value;
}

export function backupKey(): Buffer {
  const key = Buffer.from(required('BACKUP_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return key;
}

/** Which key encrypted a file, without revealing the key. */
export const keyId = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 12);

export const server = {
  host: env.PG_HOST ?? 'localhost',
  port: Number(env.PG_PORT ?? 5432),
};

/** pg_dump / pg_restore: PG_BIN_DIR, else PATH, else the usual Windows install folder. */
export function pgTool(name: 'pg_dump' | 'pg_restore'): string {
  const dirs = [env.PG_BIN_DIR, 'C:/Program Files/PostgreSQL/18/bin', 'C:/Program Files/PostgreSQL/17/bin'].filter(Boolean) as string[];
  for (const dir of dirs) {
    const file = path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    if (existsSync(file)) return file;
  }
  return name;
}

export function run(cmd: string, args: string[], password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, PGPASSWORD: password }, stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}: ${stderr.trim()}`))));
  });
}

export async function encryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(target);
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(source), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), () => resolve()).on('error', reject));
}

export async function decryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const { size } = await stat(source);
  const fh = await open(source, 'r');
  const head = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  await fh.read(head, 0, head.length, 0);
  await fh.read(tag, 0, 16, size - 16);
  await fh.close();
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an ERP backup file');
  const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(source, { start: head.length, end: size - 17 }), decipher, createWriteStream(target));
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), new Transform({ transform: (chunk, _e, cb) => (hash.update(chunk), cb()) }));
  return hash.digest('hex');
}

/** Rows per table (all tenants) and applied migrations: what a restore must reproduce. */
export async function databaseFacts(client: pg.Client) {
  const tables = await client.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables.rows) {
    counts[name] = Number((await client.query(`SELECT count(*) AS n FROM public.${pg.escapeIdentifier(name)}`)).rows[0].n);
  }
  const migrations = Number((await client.query('SELECT count(*) AS n FROM schema_migrations')).rows[0].n);
  return { tables: counts, migrations };
}

export interface Manifest {
  file: string;
  database: string;
  createdAt: string;
  sizeBytes: number;
  sha256: string;
  keyId: string;
  migrations: number;
  tables: Record<string, number>;
}
