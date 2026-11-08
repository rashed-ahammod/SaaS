/**
 * Optimistic locking (guide §7: editable tables have a `version` column).
 *
 *   const before = await findOrThrow(id);
 *   assertVersion(before, dto.version);                       // client read an old copy? -> 409
 *   const result = await tx.updateTable(...).where('version', '=', dto.version)...
 *   assertUpdated(result);                                    // someone saved a moment ago? -> 409
 *
 * The database trigger app_touch_row() adds 1 to `version` on every update.
 */
import { ConflictException } from '@nestjs/common';
import type { UpdateResult } from 'kysely';
import { MSG } from '../i18n/messages.js';

export function assertVersion(
  row: { version: number },
  expectedVersion: number,
): void {
  if (row.version !== expectedVersion)
    throw new ConflictException(MSG.STALE_VERSION);
}

/**
 * Removes undefined fields from an update object (undefined = "not sent, keep it").
 * Returns null when nothing is left to update.
 */
export function changesOnly<T extends Record<string, unknown>>(
  values: T,
): Partial<T> | null {
  const out = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
  return Object.keys(out).length ? out : null;
}

export function assertUpdated(result: UpdateResult): void {
  if (result.numUpdatedRows === 0n)
    throw new ConflictException(MSG.STALE_VERSION);
}
