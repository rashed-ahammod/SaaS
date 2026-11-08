// Runs once before all integration tests: bring the test database schema up to date
// and publish the rule pack.
import './setup-env.js';
import { loadConfig } from '../../src/config/config.js';
import { readFileSync } from 'node:fs';
import { publishRulePack } from '../../src/modules/rules/rule-pack-admin.js';
import { DatabaseService } from '../../src/platform/db/database.service.js';
import { runMigrations } from '../../src/platform/db/migrator.js';

export default async function () {
  const config = loadConfig();
  await runMigrations(config.db.connectionFor('erp_owner'));

  // the shipped Bangladesh rule pack (all values 'verify'), as the platform would publish it
  const owner = new DatabaseService(config, 'erp_owner');
  try {
    for (const version of ['2026.1', '2026.2', '2026.3']) {
      await publishRulePack(
        owner.kysely,
        JSON.parse(
          readFileSync(`rule-packs/bd-labour-${version}.json`, 'utf8'),
        ),
        'test setup',
      );
    }
  } finally {
    await owner.close();
  }
}
