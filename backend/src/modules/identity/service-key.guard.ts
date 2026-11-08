/**
 * For machine callers (office biometric sync agent; n8n in WP10) instead of a
 * user login (guide §7.2 service_keys, spec §9 "per-tenant service key limited
 * to the endpoints a workflow needs").
 *
 *   Authorization: ServiceKey <keyId>.<secret>
 *
 *   @UseGuards(ServiceKeyGuard)
 *   @RequirePermission('attendance.ingest')
 *
 * The key must be active, its secret must match (SHA-256, constant-time), and it
 * must carry the route's permission. Requests then run in the key's tenant with
 * only that permission, limited to the key's company if it has one.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { sql } from 'kysely';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessGrants, type ScopedGrant } from './access/access-grants.js';
import { PERMISSIONS_KEY } from './access/decorators.js';
import { isPermissionKey, type PermissionKey } from './access/permissions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hashServiceKeySecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

@Injectable()
export class ServiceKeyGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const required =
      this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    // "ServiceKey <id>.<secret>"
    const [scheme, credential] = (req.headers.authorization ?? '').split(' ');
    const [keyId, secret] = (credential ?? '').split('.');
    if (scheme !== 'ServiceKey' || !keyId || !secret || !UUID.test(keyId))
      throw new UnauthorizedException(MSG.SERVICE_KEY_INVALID);

    // look the key up (before the tenant is known) and check the secret
    const { rows } = await sql<{
      tenant_id: string;
      secret_hash: string;
      permissions: string[];
      company_id: string | null;
      revoked: boolean;
    }>`
      SELECT * FROM auth_find_service_key(${keyId}::uuid)`.execute(
      this.db.kysely,
    );
    const key = rows[0];
    const given = Buffer.from(hashServiceKeySecret(secret), 'hex');
    if (
      !key ||
      key.revoked ||
      !timingSafeEqual(given, Buffer.from(key.secret_hash, 'hex'))
    ) {
      throw new UnauthorizedException(MSG.SERVICE_KEY_INVALID);
    }

    // the key must carry the route's permission
    const permissions = key.permissions.filter(isPermissionKey);
    if (!required.some((p) => permissions.includes(p)))
      throw new ForbiddenException(MSG.FORBIDDEN);

    // record use (separate short transaction)
    await this.db.withTenant({ tenantId: key.tenant_id }, () =>
      this.db.tx
        .updateTable('service_keys')
        .set({ last_used_at: new Date() })
        .where('id', '=', keyId)
        .execute(),
    );

    const grant: ScopedGrant = key.company_id
      ? { scope: 'company', companyId: key.company_id }
      : { scope: 'group' };
    req.service = { tenantId: key.tenant_id, keyId, companyId: key.company_id };
    req.access = new AccessGrants(
      null,
      null,
      new Map(permissions.map((p) => [p, [grant]])),
      new Map(),
      new Set(),
      [`service-key:${keyId}`],
      false,
    );
    return true;
  }
}
