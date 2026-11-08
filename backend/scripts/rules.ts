/**
 * Rule pack operator tool (compliance owner / platform operations). Runs as erp_owner.
 *
 *   npm run rules -- publish rule-packs/bd-labour-2026.1.json --by "Platform team"
 *   npm run rules -- list BD-LABOUR@2026.1
 *   npm run rules -- verify BD-LABOUR@2026.1 leave.maternity.days --from 2026-04-10 \
 *        --by "Adv. Nasrin Sultana, labour counsel" --source https://... [--note "..."]
 *   npm run rules -- unverify BD-LABOUR@2026.1 leave.maternity.days --from 2026-04-10 \
 *        --by "Adv. Nasrin Sultana" --reason "Section stayed by High Court"
 *
 * Add --test to run against PG_TEST_DATABASE.
 */
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config/config.js';
import { listPackValues, publishRulePack, unverifyRuleValue, verifyRuleValue } from '../src/modules/rules/rule-pack-admin.js';
import { DatabaseService } from '../src/platform/db/database.service.js';

const args = process.argv.slice(2);
if (args.includes('--test')) process.env.PG_DATABASE = process.env.PG_TEST_DATABASE;

function option(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
function pack(ref: string | undefined): { code: string; version: string } {
  const [code, version] = (ref ?? '').split('@');
  if (!code || !version) throw new Error('Pack must be written as CODE@VERSION, e.g. BD-LABOUR@2026.1');
  return { code, version };
}

async function main() {
  const db = new DatabaseService(loadConfig(), 'erp_owner');
  try {
    const [command, first, second] = args;
    switch (command) {
      case 'publish': {
        const file = JSON.parse(readFileSync(first, 'utf8'));
        const result = await publishRulePack(db.kysely, file, option('by') ?? 'platform');
        console.log(result.created ? `Published ${file.code} ${file.version} (${file.values.length} values, all "verify")` : `${file.code} ${file.version} is already published; nothing changed`);
        break;
      }
      case 'list': {
        const { code, version } = pack(first);
        for (const v of await listPackValues(db.kysely, code, version)) {
          const period = `${v.effective_from} .. ${v.effective_to ?? 'open'}`;
          console.log(`${v.status === 'verified' ? 'VERIFIED' : 'verify  '}  ${v.rule_key.padEnd(42)} ${JSON.stringify(v.value).slice(0, 40).padEnd(42)} ${period}${v.verified_by ? `  by ${v.verified_by}` : ''}`);
        }
        break;
      }
      case 'verify': {
        await verifyRuleValue(db.kysely, { ...pack(first), key: second, effectiveFrom: option('from') }, { by: required('by'), sourceUrl: required('source'), note: option('note') });
        console.log(`Verified ${second}`);
        break;
      }
      case 'unverify': {
        await unverifyRuleValue(db.kysely, { ...pack(first), key: second, effectiveFrom: option('from') }, { by: required('by'), reason: required('reason') });
        console.log(`${second} is back to "verify"`);
        break;
      }
      default:
        console.log('Commands: publish <file> | list CODE@VERSION | verify CODE@VERSION <key> | unverify CODE@VERSION <key>   (see scripts/rules.ts)');
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
