/**
 * Apply pending SQL migrations:
 *   npm run db:migrate         -> PG_DATABASE (dev)
 *   npm run db:migrate:test    -> PG_TEST_DATABASE
 */
import { loadConfig } from '../src/config/config.js';
import { runMigrations } from '../src/platform/db/migrator.js';

const useTestDb = process.argv.includes('--test');
if (useTestDb) process.env.PG_DATABASE = process.env.PG_TEST_DATABASE;

const config = loadConfig();
console.log(`Migrating database "${config.db.database}" as erp_owner ...`);

runMigrations(config.db.connectionFor('erp_owner'), console.log)
  .then((applied) => console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Already up to date.'))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
