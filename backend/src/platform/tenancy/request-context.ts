/**
 * The context of the work being done right now: which tenant, which user, from
 * where, and the open database transaction.
 *
 * It is stored in AsyncLocalStorage, so any service can read it without passing
 * it through every function call. It is set in exactly two places:
 *   - TenantTransactionInterceptor, for each authenticated HTTP request;
 *   - DatabaseService.withTenant(), for jobs, scripts and the login flow.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Transaction } from 'kysely';
import type { Database } from '../db/schema.js';
import type { AccessGrants } from '../../modules/identity/access/access-grants.js';

export interface RequestContext {
  tenantId: string;
  /** The acting user; undefined for system jobs and before login completes. */
  userId?: string;
  ip?: string;
  device?: string;
  language: 'bn' | 'en';
  /**
   * What the acting user may do (loaded by AuthGuard). AccessGrants.system() for
   * jobs and the seed script. Missing = nothing is allowed (fail closed).
   */
  access?: AccessGrants;
  /** n8n calling back for one outbox event (event callback token, WP10). */
  callbackEventId?: string;
  /**
   * The transaction every query of this unit of work must use. Missing only on
   * routes marked @ShortTransactions() (AI calls): they open short ones with
   * DatabaseService.transaction() instead of holding one open while waiting.
   */
  tx?: Transaction<Database>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
    return storage.run(ctx, fn);
  },

  /** The current context, or undefined outside a tenant transaction. */
  find(): RequestContext | undefined {
    return storage.getStore();
  },

  /** The current context. Throws if called outside a tenant transaction (fail closed). */
  get(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        'No tenant context. Tenant data may only be accessed inside an authenticated request ' +
          'or DatabaseService.withTenant().',
      );
    }
    return ctx;
  },
};
