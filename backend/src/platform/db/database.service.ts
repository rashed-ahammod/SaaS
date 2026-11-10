/**
 * Database access.
 *
 * Rule of thumb for module code:
 *   - inside a request handler or job:   this.db.tx.selectFrom('...')...
 *   - to start tenant work outside HTTP: this.db.withTenant({ tenantId }, async () => { ... })
 *
 * `withTenant` opens ONE transaction and runs
 *   SELECT set_config('app.tenant_id', <tenant>, true)   -- same as SET LOCAL
 * first, so PostgreSQL row-level security limits every query to that tenant
 * (guide §6). When the transaction ends the setting disappears with it, so a
 * pooled connection can never carry one tenant's setting into another request.
 */
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { AppConfig, DbRole } from '../../config/config.js';
import { installPgTypeParsers } from './pg-types.js';
import type { Database } from './schema.js';
import {
  requestContext,
  type RequestContext,
} from '../tenancy/request-context.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nest token for the erp_worker DatabaseService (cross-tenant job scans). */
export const WORKER_DB = Symbol('WORKER_DB');

export type TenantContextInput = Omit<RequestContext, 'tx' | 'language'> & {
  language?: 'bn' | 'en';
};

export class DatabaseService {
  /**
   * Raw query builder for this role. Module code should use `tx` instead.
   * With the erp_app role, queries made here (outside withTenant) see no tenant rows.
   */
  readonly kysely: Kysely<Database>;

  constructor(
    config: AppConfig,
    readonly role: DbRole = 'erp_app',
  ) {
    installPgTypeParsers();
    const pool = new pg.Pool({
      ...config.db.connectionFor(role),
      max: config.db.poolMaxFor(role),
      application_name: `erp-${role}`,
    });
    this.kysely = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
    });
  }

  /** The transaction of the current request or job. Throws if there is none (fail closed). */
  get tx(): Transaction<Database> {
    const tx = requestContext.get().tx;
    if (!tx)
      throw new Error(
        'No open transaction. On a @ShortTransactions() route, wrap database work in db.transaction().',
      );
    return tx;
  }

  /**
   * A short transaction for the current request, with the same tenant, user and
   * access. For @ShortTransactions() routes, which must not hold a transaction
   * (and a pooled connection) open while they wait for a slow outside service.
   * Inside an open transaction it simply joins it.
   */
  transaction<T>(work: () => Promise<T>): Promise<T> {
    const { tx: _open, ...current } = requestContext.get();
    return this.withTenant(current, work);
  }

  /**
   * Run `work` inside one transaction scoped to a tenant. Everything succeeds or
   * everything is rolled back, including audit entries and outbox events.
   *
   * If called while already inside the same tenant's transaction, `work` simply
   * joins it (no nested transaction).
   */
  async withTenant<T>(
    input: TenantContextInput,
    work: () => Promise<T>,
  ): Promise<T> {
    if (!UUID_RE.test(input.tenantId))
      throw new Error(`Invalid tenant id: ${input.tenantId}`);
    if (input.userId && !UUID_RE.test(input.userId))
      throw new Error(`Invalid user id: ${input.userId}`);

    const current = requestContext.find();
    if (current?.tx) {
      if (current.tenantId !== input.tenantId) {
        throw new Error(
          'Cannot open a transaction for a different tenant inside a tenant transaction',
        );
      }
      return work();
    }
    if (current && current.tenantId !== input.tenantId) {
      throw new Error(
        'Cannot open a transaction for a different tenant inside a tenant request',
      );
    }

    return this.kysely.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.tenant_id', ${input.tenantId}, true),
                       set_config('app.user_id', ${input.userId ?? ''}, true)`.execute(
        tx,
      );
      return requestContext.run(
        { ...input, language: input.language ?? 'en', tx },
        work,
      );
    });
  }

  async close(): Promise<void> {
    await this.kysely.destroy();
  }
}
