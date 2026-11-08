/**
 * Roles: the seven system roles (read-only) and custom roles.
 *
 * Spec §4: "Custom roles are built by copying a default role and adjusting it,
 * so customers cannot break the defaults." Here a custom role may only REMOVE
 * permissions from its base role; to give more, grant a second role. Its
 * sensitive-field access and 2FA rule come from the base role.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { CustomRole, SystemRoleKey } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import {
  PERMISSIONS,
  PERMISSIONS_BN,
  type PermissionKey,
} from '../identity/access/permissions.js';
import { SYSTEM_ROLE_KEYS, SYSTEM_ROLES } from '../identity/access/roles.js';
import type {
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
} from './dto/users.dto.js';

@Injectable()
export class CustomRolesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /** The permission catalogue, for building role screens. */
  listPermissions() {
    return Object.entries(PERMISSIONS).map(([key, description]) => ({
      key,
      description,
      descriptionBn: PERMISSIONS_BN[key as PermissionKey],
    }));
  }

  /** System roles + this tenant's custom roles. */
  async listRoles() {
    const system = SYSTEM_ROLE_KEYS.map((key) => {
      const r = SYSTEM_ROLES[key];
      return {
        type: 'system' as const,
        key,
        nameEn: r.nameEn,
        nameBn: r.nameBn,
        privileged: r.privileged,
        allowedScopes: r.allowedScopes,
        timeLimited: r.timeLimited ?? false,
        permissions: r.permissions,
        fieldGroups: r.fieldGroups,
      };
    });
    const customRows = await this.db.tx
      .selectFrom('custom_roles')
      .selectAll()
      .orderBy('name_en')
      .execute();
    const custom = await Promise.all(
      customRows.map((r) => this.toCustomRoleResponse(r)),
    );
    return [...system, ...custom];
  }

  async createCustomRole(dto: CreateCustomRoleDto) {
    this.access.assert('roles.manage', {});
    const permissions = this.checkPermissions(dto.basedOn, dto.permissions);

    // save role and its permissions
    const role = await this.db.tx
      .insertInto('custom_roles')
      .values({
        name_en: dto.nameEn.trim(),
        name_bn: dto.nameBn ?? null,
        based_on: dto.basedOn,
        description: dto.description ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.savePermissions(role.id, permissions);

    await this.audit.record({
      action: 'role.created',
      entity: 'custom_role',
      entityId: role.id,
      after: { name: role.name_en, basedOn: dto.basedOn, permissions },
    });
    return this.toCustomRoleResponse(role);
  }

  async updateCustomRole(id: string, dto: UpdateCustomRoleDto) {
    // find, check access and version
    this.access.assert('roles.manage', {});
    const before = await this.findRole(id);
    assertVersion(before, dto.version);
    const permissions = dto.permissions
      ? this.checkPermissions(before.based_on, dto.permissions)
      : undefined;

    // save fields
    const changes = changesOnly({
      name_en: dto.nameEn?.trim(),
      name_bn: dto.nameBn,
      is_active: dto.isActive,
    });
    const result = await this.db.tx
      .updateTable('custom_roles')
      .set(changes ?? { version: before.version }) // always bump the version (permissions may change)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);

    // replace permissions
    if (permissions) {
      await this.db.tx
        .deleteFrom('custom_role_permissions')
        .where('role_id', '=', id)
        .execute();
      await this.savePermissions(id, permissions);
    }

    const after = await this.findRole(id);
    await this.audit.record({
      action: 'role.updated',
      entity: 'custom_role',
      entityId: id,
      before: { name: before.name_en, isActive: before.is_active },
      after: {
        name: after.name_en,
        isActive: after.is_active,
        permissions: permissions ?? '(unchanged)',
      },
    });
    return this.toCustomRoleResponse(after);
  }

  // ------------------------------------------------------------------ helpers

  /** Known permissions, and only ones the base role has. */
  private checkPermissions(
    basedOn: SystemRoleKey,
    requested?: string[],
  ): PermissionKey[] {
    const base = SYSTEM_ROLES[basedOn].permissions;
    if (!requested) return [...base];
    for (const p of requested) {
      if (!(p in PERMISSIONS))
        throw new BadRequestException(`${MSG.PERMISSION_UNKNOWN}: ${p}`);
      if (!base.includes(p as PermissionKey)) {
        throw new BadRequestException(
          `Permission ${p} is not part of the ${basedOn} role; grant a second role instead`,
        );
      }
    }
    return requested as PermissionKey[];
  }

  private async savePermissions(
    roleId: string,
    permissions: PermissionKey[],
  ): Promise<void> {
    if (permissions.length === 0) return;
    await this.db.tx
      .insertInto('custom_role_permissions')
      .values(permissions.map((p) => ({ role_id: roleId, permission_key: p })))
      .execute();
  }

  private async findRole(id: string): Promise<CustomRole> {
    const role = await this.db.tx
      .selectFrom('custom_roles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!role) throw new NotFoundException(MSG.ROLE_NOT_FOUND);
    return role;
  }

  private async toCustomRoleResponse(r: CustomRole) {
    const perms = await this.db.tx
      .selectFrom('custom_role_permissions')
      .select('permission_key')
      .where('role_id', '=', r.id)
      .execute();
    const base = SYSTEM_ROLES[r.based_on];
    return {
      type: 'custom' as const,
      id: r.id,
      nameEn: r.name_en,
      nameBn: r.name_bn,
      basedOn: r.based_on,
      description: r.description,
      privileged: base.privileged,
      allowedScopes: base.allowedScopes,
      permissions: perms.map((p) => p.permission_key).sort(),
      fieldGroups: base.fieldGroups,
      isActive: r.is_active,
      version: r.version,
    };
  }
}
