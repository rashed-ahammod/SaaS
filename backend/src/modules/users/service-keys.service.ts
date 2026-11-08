/**
 * Service keys for machines (office biometric sync agent now, n8n in WP10).
 * The secret is returned ONCE at creation; only its SHA-256 is stored.
 * Creating and revoking keys are high-risk (they let a machine act for the
 * company): integrations.manage + step-up code.
 */
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AccessService } from '../identity/access/access.service.js';
import type { PermissionKey } from '../identity/access/permissions.js';
import { hashServiceKeySecret } from '../identity/service-key.guard.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { CreateServiceKeyDto, RevokeDto } from './dto/users.dto.js';

/** Permissions a machine may hold. Grows with WP10 (n8n callbacks). */
export const SERVICE_KEY_PERMISSIONS: PermissionKey[] = [
  'attendance.ingest',
  'bank.import',
  'crm.capture',
];

@Injectable()
export class ServiceKeysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  async createKey(dto: CreateServiceKeyDto) {
    // rights over the company (or group-wide for a key without company)
    if (dto.companyId) await this.org.assertCompanyExists(dto.companyId);
    this.access.assert(
      'integrations.manage',
      dto.companyId ? { companyId: dto.companyId } : {},
    );
    const unknown = dto.permissions.filter(
      (p) => !SERVICE_KEY_PERMISSIONS.includes(p as PermissionKey),
    );
    if (unknown.length)
      throw new BadRequestException(
        `Not allowed for service keys: ${unknown.join(', ')}`,
      );

    // create; the secret is never stored
    const secret = randomBytes(32).toString('base64url');
    const key = await this.db.tx
      .insertInto('service_keys')
      .values({
        name: dto.name.trim(),
        secret_hash: hashServiceKeySecret(secret),
        permissions: dto.permissions,
        company_id: dto.companyId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'service_key.created',
      entity: 'service_key',
      entityId: key.id,
      after: {
        name: key.name,
        permissions: key.permissions,
        companyId: key.company_id,
      },
    });

    return {
      id: key.id,
      name: key.name,
      permissions: key.permissions,
      companyId: key.company_id,
      // shown only now: put it in the agent's configuration
      authorizationHeader: `ServiceKey ${key.id}.${secret}`,
    };
  }

  async listKeys() {
    // group-wide: every key; company-scoped (an Admin of one company): that company's keys (audit 2026-10-30)
    const scope = this.access.scopeFilter('integrations.manage');
    if (!scope.all && !scope.companyIds.length)
      this.access.assert('integrations.manage', {});
    let q = this.db.tx.selectFrom('service_keys').selectAll();
    if (!scope.all) q = q.where('company_id', 'in', scope.companyIds);
    const keys = await q.orderBy('created_at', 'desc').execute();
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      permissions: k.permissions,
      companyId: k.company_id,
      createdAt: k.created_at,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
      revokedReason: k.revoked_reason,
    }));
  }

  async revokeKey(id: string, dto: RevokeDto) {
    const key = await this.db.tx
      .selectFrom('service_keys')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!key || key.revoked_at) throw new NotFoundException(MSG.NOT_FOUND);
    this.access.assert(
      'integrations.manage',
      key.company_id ? { companyId: key.company_id } : {},
    );

    await this.db.tx
      .updateTable('service_keys')
      .set({ revoked_at: new Date(), revoked_reason: dto.reason })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'service_key.revoked',
      entity: 'service_key',
      entityId: id,
      after: { reason: dto.reason, by: requestContext.get().userId },
    });
    return { revoked: true };
  }
}
