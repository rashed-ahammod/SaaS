/**
 * For n8n calling back about one event (WP10):
 *
 *   Authorization: EventToken <X-Callback-Token from the webhook>
 *
 * The token (platform/outbox/callback-token.ts) names the tenant and the event.
 * The request then runs in that tenant with only the "notifications.relay"
 * permission, and services check that everything touched belongs to that event.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { MSG } from '../../platform/i18n/messages.js';
import { verifyCallbackToken } from '../../platform/outbox/callback-token.js';
import { AccessGrants } from '../identity/access/access-grants.js';
import { PERMISSIONS_KEY } from '../identity/access/decorators.js';
import type { PermissionKey } from '../identity/access/permissions.js';

@Injectable()
export class EventTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const required =
      this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (!required.includes('notifications.relay'))
      throw new ForbiddenException(MSG.FORBIDDEN);

    // "EventToken <token>", signed with the outbox secret
    const secret = this.config.outbox.webhookSecret;
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    const claim =
      secret && scheme === 'EventToken'
        ? verifyCallbackToken(secret, token)
        : null;
    if (!claim) throw new UnauthorizedException(MSG.SERVICE_KEY_INVALID);

    // a route about an event must be about the token's event
    const eventId = req.params.eventId;
    if (eventId && eventId !== claim.eventId)
      throw new ForbiddenException(MSG.FORBIDDEN);

    req.service = {
      tenantId: claim.tenantId,
      keyId: `event:${claim.eventId}`,
      companyId: null,
    };
    req.callbackEventId = claim.eventId;
    req.access = new AccessGrants(
      null,
      null,
      new Map([['notifications.relay', [{ scope: 'group' }]]]),
      new Map(),
      new Set(),
      [`event-token:${claim.eventId}`],
      false,
    );
    return true;
  }
}
