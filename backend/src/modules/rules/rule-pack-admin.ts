/**
 * Operator actions on the central rule pack (guide §18). Used by the
 * command-line tool scripts/rules.ts (runs as erp_owner) and by tests.
 * The API never calls these: tenants can only read packs and accept a version.
 *
 *   publish   load a reviewed rule-packs/*.json file; every value starts as "verify"
 *   verify    the compliance owner confirms one value against an official source
 *   unverify  take a value back to "verify" (e.g. the law was challenged)
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/db/schema.js';
import { validateRulePackFile, type RulePackFile } from './rule-pack-file.js';

export async function publishRulePack(
  db: Kysely<Database>,
  file: RulePackFile,
  publishedBy: string,
): Promise<{ packId: string; created: boolean }> {
  const problems = validateRulePackFile(file);
  if (problems.length)
    throw new Error(
      `Rule pack file is not valid:\n  - ${problems.join('\n  - ')}`,
    );

  // a published version is never changed: publishing it again does nothing
  const existing = await db
    .selectFrom('rule_packs')
    .select('id')
    .where('code', '=', file.code)
    .where('version', '=', file.version)
    .executeTakeFirst();
  if (existing) return { packId: existing.id, created: false };

  return db.transaction().execute(async (tx) => {
    const pack = await tx
      .insertInto('rule_packs')
      .values({
        code: file.code,
        version: file.version,
        title: file.title,
        notes: file.notes ?? null,
        published_by: publishedBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    for (const v of file.values) {
      const row = await tx
        .insertInto('rule_values')
        .values({
          pack_id: pack.id,
          rule_key: v.key,
          value_type: v.type,
          value: JSON.stringify(v.value),
          unit: v.unit ?? null,
          description_en: v.descriptionEn,
          description_bn: v.descriptionBn ?? null,
          effective_from: v.effectiveFrom,
          effective_to: v.effectiveTo ?? null,
          source_note: v.sourceNote ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('rule_value_history')
        .values({
          rule_value_id: row.id,
          action: 'published',
          by_name: publishedBy,
        })
        .execute();
    }
    return { packId: pack.id, created: true };
  });
}

export interface ValueSelector {
  code: string;
  version: string;
  key: string;
  /** Needed when the key has several periods in the pack. */
  effectiveFrom?: string;
}

export async function verifyRuleValue(
  db: Kysely<Database>,
  selector: ValueSelector,
  verification: { by: string; sourceUrl: string; note?: string },
): Promise<void> {
  if (!/^https?:\/\//.test(verification.sourceUrl))
    throw new Error(
      'sourceUrl must be the URL of the official source (gazette, NBR order)',
    );
  if (!verification.by.trim())
    throw new Error('by: the name of the person verifying is required');

  await db.transaction().execute(async (tx) => {
    const value = await findValue(tx, selector);
    await tx
      .updateTable('rule_values')
      .set({
        status: 'verified',
        verified_by: verification.by,
        verified_at: new Date(),
        source_url: verification.sourceUrl,
      })
      .where('id', '=', value.id)
      .execute();
    await tx
      .insertInto('rule_value_history')
      .values({
        rule_value_id: value.id,
        action: 'verified',
        by_name: verification.by,
        source_url: verification.sourceUrl,
        note: verification.note ?? null,
      })
      .execute();
  });
}

export async function unverifyRuleValue(
  db: Kysely<Database>,
  selector: ValueSelector,
  change: { by: string; reason: string },
): Promise<void> {
  if (!change.reason.trim()) throw new Error('reason is required');
  await db.transaction().execute(async (tx) => {
    const value = await findValue(tx, selector);
    await tx
      .updateTable('rule_values')
      .set({ status: 'verify', verified_by: null, verified_at: null })
      .where('id', '=', value.id)
      .execute();
    await tx
      .insertInto('rule_value_history')
      .values({
        rule_value_id: value.id,
        action: 'unverified',
        by_name: change.by,
        note: change.reason,
      })
      .execute();
  });
}

export async function listPackValues(
  db: Kysely<Database>,
  code: string,
  version: string,
) {
  return db
    .selectFrom('rule_values as v')
    .innerJoin('rule_packs as p', 'p.id', 'v.pack_id')
    .select([
      'v.rule_key',
      'v.value',
      'v.unit',
      'v.effective_from',
      'v.effective_to',
      'v.status',
      'v.verified_by',
    ])
    .where('p.code', '=', code)
    .where('p.version', '=', version)
    .orderBy('v.rule_key')
    .orderBy('v.effective_from')
    .execute();
}

async function findValue(db: Kysely<Database>, s: ValueSelector) {
  let q = db
    .selectFrom('rule_values as v')
    .innerJoin('rule_packs as p', 'p.id', 'v.pack_id')
    .select(['v.id', 'v.effective_from'])
    .where('p.code', '=', s.code)
    .where('p.version', '=', s.version)
    .where('v.rule_key', '=', s.key);
  if (s.effectiveFrom) q = q.where('v.effective_from', '=', s.effectiveFrom);
  const rows = await q.execute();
  if (rows.length === 0)
    throw new Error(
      `No value ${s.key} in ${s.code} ${s.version}${s.effectiveFrom ? ` from ${s.effectiveFrom}` : ''}`,
    );
  if (rows.length > 1) {
    throw new Error(
      `${s.key} has ${rows.length} periods (${rows.map((r) => r.effective_from).join(', ')}); add --from YYYY-MM-DD`,
    );
  }
  return rows[0];
}
