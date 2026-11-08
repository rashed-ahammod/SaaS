/**
 * One-time local database setup:  npm run db:setup
 *
 * Connects as the PostgreSQL superuser (PG_ADMIN_USER / PG_ADMIN_PASSWORD from .env) and:
 *   1. creates or updates the three roles (erp_owner, erp_app, erp_worker) with the passwords from .env;
 *   2. creates the dev and test databases owned by erp_owner;
 *   3. installs the extensions the migrations need and locks down the public schema;
 *   4. if PG_BACKUP_PASSWORD is set: the read-only backup role erp_backup (WP12), which
 *      bypasses row-level security so pg_dump sees every tenant, and can change nothing.
 *
 * Safe to run again: every step checks before it creates.
 * Production databases are provisioned by infrastructure code, not by this script.
 */
import 'dotenv/config';
import pg from 'pg';

const env = process.env;

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set in backend/.env`);
  return value;
}

const admin = {
  host: env.PG_HOST ?? 'localhost',
  port: Number(env.PG_PORT ?? 5432),
  user: env.PG_ADMIN_USER ?? 'postgres',
  password: required('PG_ADMIN_PASSWORD'),
};

const roles = [
  // Owns the tables and runs migrations. Not a superuser.
  { name: 'erp_owner', password: required('PG_OWNER_PASSWORD') },
  // Used by the API. Must NOT have BYPASSRLS and must NOT own the tables (guide §6).
  { name: 'erp_app', password: required('PG_APP_PASSWORD') },
  // Used by background workers (outbox dispatch, audit verification).
  { name: 'erp_worker', password: required('PG_WORKER_PASSWORD') },
];

const databases = [required('PG_DATABASE'), required('PG_TEST_DATABASE')];

async function main() {
  const server = new pg.Client({ ...admin, database: 'postgres' });
  await server.connect();
  try {
    for (const role of roles) {
      const exists = await server.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.name]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      // Role names are constants above; the password is passed as a quoted literal.
      await server.query(
        `${verb} ROLE ${role.name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${pg.escapeLiteral(role.password)}`,
      );
      console.log(`role ${role.name}: ${exists.rowCount ? 'updated' : 'created'}`);
    }

    // backups (npm run backup): read everything, write nothing
    if (env.PG_BACKUP_PASSWORD) {
      const exists = await server.query("SELECT 1 FROM pg_roles WHERE rolname = 'erp_backup'");
      await server.query(
        `${exists.rowCount ? 'ALTER' : 'CREATE'} ROLE erp_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD ${pg.escapeLiteral(env.PG_BACKUP_PASSWORD)}`,
      );
      await server.query('GRANT pg_read_all_data TO erp_backup');
      console.log(`role erp_backup: ${exists.rowCount ? 'updated' : 'created'} (read-only, for backups)`);
    }

    for (const dbName of databases) {
      if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`Unsafe database name: ${dbName}`);
      const exists = await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (!exists.rowCount) {
        await server.query(`CREATE DATABASE ${dbName} OWNER erp_owner ENCODING 'UTF8' TEMPLATE template0`);
        console.log(`database ${dbName}: created`);
      } else {
        console.log(`database ${dbName}: already exists`);
      }
      await prepareDatabase(dbName);
    }
  } finally {
    await server.end();
  }
  console.log('\nDone. Next: npm run db:migrate  (and  npm run db:migrate:test)');
}

/** Extensions need superuser rights, so they are installed here rather than in migrations. */
async function prepareDatabase(dbName: string) {
  const db = new pg.Client({ ...admin, database: dbName });
  await db.connect();
  try {
    // btree_gist: needed for "no overlapping periods" exclusion constraints (guide §7.3).
    await db.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
    // Only erp_owner may create objects in the public schema.
    await db.query('ALTER SCHEMA public OWNER TO erp_owner');
    await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await db.query('GRANT USAGE ON SCHEMA public TO erp_app, erp_worker');
    await db.query(`REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC`);
    await db.query(`GRANT CONNECT ON DATABASE ${dbName} TO erp_owner, erp_app, erp_worker`);
    if (env.PG_BACKUP_PASSWORD) await db.query(`GRANT CONNECT ON DATABASE ${dbName} TO erp_backup`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
