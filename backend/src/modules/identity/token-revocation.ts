/**
 * Ending a user's sessions early (0049).
 *
 * An access token is a stateless JWT: once signed, nothing about it can be
 * changed. `users.tokens_valid_from` is how it is taken back — AuthGuard
 * refuses any token issued before that moment, so moving it forward ends every
 * session that user holds, on every device, at once.
 *
 * Note what does NOT need this: roles and field access. AuthGuard reloads them
 * from the database on every request, so granting or revoking one already takes
 * effect on the very next call. Only facts fixed into the token at signing time
 * -- that it exists at all, and that its session passed 2FA -- outlive a
 * change, and the only one worth taking back is the token itself.
 *
 * A plain function rather than a method on AuthService, so that a caller in
 * another Nest module does not have to inject AuthService and make the two
 * modules depend on each other in a circle.
 */
import type { DatabaseService } from '../../platform/db/database.service.js';

/**
 * Refuse every access token this user already holds. Runs in the caller's
 * tenant transaction, so it commits with whatever caused it.
 *
 * Safe to call more than once: it only moves a timestamp forward.
 */
export async function revokeTokensFor(
  db: DatabaseService,
  userId: string,
): Promise<void> {
  await db.tx
    .updateTable('users')
    .set({ tokens_valid_from: new Date() })
    .where('id', '=', userId)
    .execute();
}
