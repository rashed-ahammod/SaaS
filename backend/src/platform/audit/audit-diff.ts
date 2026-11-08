/**
 * Keeps only the fields that actually changed, for the audit log's before/after.
 *
 *   auditDiff({ name: 'HR', code: 'HR', version: 3 }, { name: 'People', code: 'HR', version: 4 })
 *     -> { before: { name: 'HR' }, after: { name: 'People' } }
 *
 * Bookkeeping columns (updated_at, version) and any column ending in
 * "_encrypted" are left out; an encrypted field that changed is shown as
 * "[changed]" so the log records the fact without the value.
 */
const IGNORED = new Set(['updated_at', 'version', 'created_at', 'created_by']);

export function auditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (IGNORED.has(key)) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    const secret = key.endsWith('_encrypted');
    b[key] = secret ? '[changed]' : before[key];
    a[key] = secret ? '[changed]' : after[key];
  }
  return { before: b, after: a };
}
