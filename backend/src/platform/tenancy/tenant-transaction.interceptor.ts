/**
 * Wraps every authenticated request in ONE database transaction for the
 * caller's tenant (guide §6 "Per request").
 *
 *   request -> AuthGuard sets req.auth -> this interceptor:
 *     BEGIN; set app.tenant_id / app.user_id;  handler runs;  COMMIT (or ROLLBACK on error)
 *
 * Because the handler, the audit entry and the outbox event all use the same
 * transaction, they are saved together or not at all.
 *
 * Routes marked @ShortTransactions() (AI calls, WP11) get the same tenant, user
 * and access, but no transaction: they wait seconds for an outside service, so
 * they open short ones with db.transaction() around each piece of database work.
 *
 * Requests with neither req.auth nor req.service (login, health) pass straight through; they cannot
 * touch tenant data because db.tx throws outside a tenant transaction.
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import {
  DatabaseService,
  type TenantContextInput,
} from '../db/database.service.js';
import { requestContext } from './request-context.js';

const SHORT_TRANSACTIONS_KEY = 'shortTransactions';

/** The handler opens its own short transactions (db.transaction) instead of one for the whole request. */
export const ShortTransactions = () =>
  SetMetadata(SHORT_TRANSACTIONS_KEY, true);

@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.auth && !req.service) return next.handle();

    const input: TenantContextInput = {
      // a user (AuthGuard) or a machine with a service key (ServiceKeyGuard, no user)
      tenantId: req.auth?.tenantId ?? req.service!.tenantId,
      userId: req.auth?.userId,
      language: req.auth?.language,
      access: req.access,
      callbackEventId: req.callbackEventId,
      ip: req.ip,
      device: req.headers['user-agent']?.slice(0, 300),
    };
    // next.handle() must be called inside the context so the handler sees it.
    const handle = () =>
      lastValueFrom(next.handle(), { defaultValue: undefined });

    const short = this.reflector.getAllAndOverride<boolean>(
      SHORT_TRANSACTIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const work = short
      ? requestContext.run(
          { ...input, language: input.language ?? 'en' },
          handle,
        )
      : this.db.withTenant(input, handle);
    return from(work);
  }
}
