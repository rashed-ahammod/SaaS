/**
 * DEVELOPMENT ONLY:  npm run db:reset
 *
 * Drops and re-creates the local dev and test databases, then you run
 *   npm run db:setup && npm run db:migrate && npm run db:seed
 * Refuses to run when NODE_ENV=production or PG_HOST is not local.
 */
import 'dotenv/config';
import pg from 'pg';

const env = process.env;
if (env.NODE_ENV === 'production') throw new Error('db:reset refuses to run in production');
if (!['localhost', '127.0.0.1', '::1', undefined].includes(env.PG_HOST)) {
  throw new Error(`db:reset only works on a local database (PG_HOST=${env.PG_HOST})`);
}

async function main() {
  const client = new pg.Client({
    host: env.PG_HOST ?? 'localhost',
    port: Number(env.PG_PORT ?? 5432),
    user: env.PG_ADMIN_USER ?? 'postgres',
    password: env.PG_ADMIN_PASSWORD,
    database: 'postgres',
  });
  await client.connect();
  try {
    for (const name of [env.PG_DATABASE, env.PG_TEST_DATABASE]) {
      if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      console.log(`dropped ${name}`);
    }
  } finally {
    await client.end();
  }
  console.log('Next: npm run db:setup && npm run db:migrate && npm run db:seed');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
