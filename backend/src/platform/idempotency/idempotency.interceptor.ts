/**
 * Idempotent write endpoints (guide §5 rule 7, spec §11).
 *
 * Every authenticated POST / PUT / PATCH / DELETE must send an
 * `Idempotency-Key` header (e.g. a UUID the client generates once per user action).
 *
 *   first request with key K  -> handler runs, response saved with K
 *   same K again              -> saved response returned, handler NOT run again
 *                                (response header "Idempotent-Replayed: true")
 *   same K, different body    -> 422 IDEMPOTENCY_KEY_REUSED
 *
 * Double-clicks are safe too: the key row is inserted inside the request
 * transaction, so a second concurrent request waits on the unique index until the
 * first commits, then gets the saved response. If the first request fails, its
 * transaction (and key) rolls back, so the client can retry with the same key.
 *
 * Routes that must not use it (none yet among tenant routes) can opt out
 * with @SkipIdempotency().
 */
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { DatabaseService } from '../db/database.service.js';
import { canonicalJson, sha256Hex } from '../crypto/canonical-json.js';
import { MSG } from '../i18n/messages.js';

const SKIP_IDEMPOTENCY = 'skipIdempotency';
export const SkipIdempotency = () => SetMetadata(SKIP_IDEMPOTENCY, true);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_IDEMPOTENCY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if ((!req.auth && !req.service) || !WRITE_METHODS.has(req.method) || skip)
      return next.handle();

    return from(this.handle(context, next, req));
  }

  private async handle(
    context: ExecutionContext,
    next: CallHandler,
    req: Request,
  ): Promise<unknown> {
    // read the key
    const key = req.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 200)
      throw new BadRequestException(MSG.IDEMPOTENCY_KEY_REQUIRED);

    const endpoint = `${req.method} ${req.route?.path ?? req.path}`;
    const requestHash = sha256Hex(
      canonicalJson({ endpoint, url: req.originalUrl, body: req.body ?? null }),
    );

    // claim the key (waits if another request holds the same key)
    const claimed = await this.db.tx
      .insertInto('idempotency_keys')
      .values({
        key,
        endpoint,
        request_hash: requestHash,
        user_id: req.auth?.userId ?? null,
      })
      .onConflict((oc) => oc.columns(['tenant_id', 'key']).doNothing())
      .returning('id')
      .executeTakeFirst();

    // key used before: replay the saved response
    if (!claimed) {
      const saved = await this.db.tx
        .selectFrom('idempotency_keys')
        .selectAll()
        .where('key', '=', key)
        .executeTakeFirstOrThrow();
      if (
        saved.request_hash !== requestHash ||
        saved.user_id !== (req.auth?.userId ?? null)
      ) {
        throw new UnprocessableEntityException(MSG.IDEMPOTENCY_KEY_REUSED);
      }
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Idempotent-Replayed', 'true');
      return saved.response_body;
    }

    // first time: run the handler and save its response with the key
    const result = await lastValueFrom(next.handle(), {
      defaultValue: undefined,
    });
    await this.db.tx
      .updateTable('idempotency_keys')
      .set({
        response_status: this.statusCodeOf(context, req),
        response_body: JSON.stringify(result ?? null),
      })
      .where('id', '=', claimed.id)
      .execute();
    return result;
  }

  private statusCodeOf(context: ExecutionContext, req: Request): number {
    return (
      this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? 201 : 200)
    );
  }
}
