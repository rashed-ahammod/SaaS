/**
 * Loads a user's roles, scopes and field grants into an AccessGrants object, and
 * gives services one way to check access:
 *
 *   this.access.assert('employee.manage', { companyId, departmentId, employeeId });
 *
 * Note: access control is cross-cutting, so this service reads department_paths
 * (the organization's closure table) directly, read-only, to expand department
 * scopes. This is the one documented exception to "a module owns its tables" (ADR 0005).
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../../../platform/db/database.service.js';
import type {
  FieldGroup,
  ScopeType,
  SystemRoleKey,
} from '../../../platform/db/schema.js';
import { MSG } from '../../../platform/i18n/messages.js';
import { requestContext } from '../../../platform/tenancy/request-context.js';
import {
  AccessGrants,
  type AccessResource,
  type ScopedGrant,
  type ScopeFilter,
} from './access-grants.js';
import { isPermissionKey, type PermissionKey } from './permissions.js';
import { SYSTEM_ROLES } from './roles.js';

/** An active role of a user, as stored in user_roles. */
interface ActiveRole {
  systemRole: SystemRoleKey | null;
  customRoleId: string | null;
  scopeType: ScopeType;
  scopeId: string | null;
}

@Injectable()
export class AccessService {
  constructor(private readonly db: DatabaseService) {}

  // ------------------------------------------------------------ for services

  /** The current user's grants. Throws if none are loaded (fail closed). */
  current(): AccessGrants {
    const access = requestContext.get().access;
    if (!access) throw new ForbiddenException(MSG.FORBIDDEN);
    return access;
  }

  /** Throws 403 unless the current user may use the permission on this resource. */
  assert(permission: PermissionKey, resource: AccessResource): void {
    if (!this.current().allows(permission, resource))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  allows(permission: PermissionKey, resource: AccessResource): boolean {
    return this.current().allows(permission, resource);
  }

  canSeeField(group: FieldGroup, resource: AccessResource): boolean {
    return this.current().canSeeField(group, resource);
  }

  scopeFilter(permission: PermissionKey): ScopeFilter {
    return this.current().scopeFilter(permission);
  }

  // ------------------------------------------------------------ loading

  /** Build the grants of a user. Must run inside a tenant transaction. */
  async load(userId: string): Promise<AccessGrants> {
    const tx = this.db.tx;

    // user and linked employee
    const user = await tx
      .selectFrom('users')
      .select(['employee_id'])
      .where('id', '=', userId)
      .executeTakeFirst();
    const employeeId = user?.employee_id ?? null;

    // active roles (not revoked, not expired)
    const roles: ActiveRole[] = (
      await tx
        .selectFrom('user_roles')
        .select(['system_role', 'custom_role_id', 'scope_type', 'scope_id'])
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb('expires_at', 'is', null),
            eb('expires_at', '>', sql<Date>`now()`),
          ]),
        )
        .execute()
    ).map((r) => ({
      systemRole: r.system_role,
      customRoleId: r.custom_role_id,
      scopeType: r.scope_type,
      scopeId: r.scope_id,
    }));

    // permissions of custom roles
    const customIds = roles
      .map((r) => r.customRoleId)
      .filter((x): x is string => !!x);
    const customRows = customIds.length
      ? await tx
          .selectFrom('custom_roles as r')
          .leftJoin('custom_role_permissions as p', 'p.role_id', 'r.id')
          .select(['r.id', 'r.based_on', 'r.is_active', 'p.permission_key'])
          .where('r.id', 'in', customIds)
          .execute()
      : [];

    // department scopes cover the department and everything below it
    const departmentScopeIds = roles
      .filter((r) => r.scopeType === 'department')
      .map((r) => r.scopeId!);
    const subtrees = new Map<string, Set<string>>();
    if (departmentScopeIds.length) {
      const rows = await tx
        .selectFrom('department_paths')
        .select(['ancestor_id', 'descendant_id'])
        .where('ancestor_id', 'in', departmentScopeIds)
        .execute();
      for (const row of rows) {
        if (!subtrees.has(row.ancestor_id))
          subtrees.set(row.ancestor_id, new Set());
        subtrees.get(row.ancestor_id)!.add(row.descendant_id);
      }
    }

    // explicit field grants
    const fieldRows = await tx
      .selectFrom('field_grants')
      .select('field_group')
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();

    // combine
    const permissions = new Map<PermissionKey, ScopedGrant[]>();
    const roleFields = new Map<FieldGroup, ScopedGrant[]>();
    const labels: string[] = [];
    let privileged = false;

    for (const role of roles) {
      const grant: ScopedGrant = {
        scope: role.scopeType,
        companyId: role.scopeType === 'company' ? role.scopeId! : undefined,
        departmentIds:
          role.scopeType === 'department'
            ? (subtrees.get(role.scopeId!) ?? new Set([role.scopeId!]))
            : undefined,
      };

      let perms: PermissionKey[] = [];
      let fields: FieldGroup[] = [];
      if (role.systemRole) {
        const def = SYSTEM_ROLES[role.systemRole];
        perms = def.permissions;
        fields = def.fieldGroups;
        privileged ||= def.privileged;
        labels.push(`${role.systemRole}:${role.scopeType}`);
      } else {
        const rows = customRows.filter(
          (c) => c.id === role.customRoleId && c.is_active,
        );
        if (rows.length === 0) continue;
        perms = rows
          .map((c) => c.permission_key)
          .filter((k): k is PermissionKey => !!k && isPermissionKey(k));
        const base = SYSTEM_ROLES[rows[0].based_on];
        fields = base.fieldGroups;
        privileged ||= base.privileged;
        labels.push(`custom:${role.customRoleId}:${role.scopeType}`);
      }

      for (const p of perms)
        permissions.set(p, [...(permissions.get(p) ?? []), grant]);
      for (const f of fields)
        roleFields.set(f, [...(roleFields.get(f) ?? []), grant]);
    }

    return new AccessGrants(
      userId,
      employeeId,
      permissions,
      roleFields,
      new Set(fieldRows.map((r) => r.field_group)),
      labels,
      privileged,
    );
  }

  /**
   * Users holding a system role whose scope covers the resource (used by the
   * approval engine for "role:hr" steps). Excludes disabled users.
   */
  async usersWithSystemRole(
    role: SystemRoleKey,
    resource: AccessResource,
  ): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('user_roles as ur')
      .innerJoin('users as u', 'u.id', 'ur.user_id')
      .select(['ur.user_id', 'ur.scope_type', 'ur.scope_id'])
      .where('ur.system_role', '=', role)
      .where('ur.revoked_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('ur.expires_at', 'is', null),
          eb('ur.expires_at', '>', sql<Date>`now()`),
        ]),
      )
      .where('u.status', '=', 'active')
      .execute();

    const result = new Set<string>();
    for (const row of rows) {
      if (row.scope_type === 'group') result.add(row.user_id);
      else if (
        row.scope_type === 'company' &&
        row.scope_id === resource.companyId
      )
        result.add(row.user_id);
      else if (row.scope_type === 'own' && resource.employeeId) {
        const u = await this.db.tx
          .selectFrom('users')
          .select('employee_id')
          .where('id', '=', row.user_id)
          .executeTakeFirst();
        if (u?.employee_id === resource.employeeId) result.add(row.user_id);
      } else if (row.scope_type === 'department' && resource.departmentId) {
        const inside = await this.db.tx
          .selectFrom('department_paths')
          .select('depth')
          .where('ancestor_id', '=', row.scope_id!)
          .where('descendant_id', '=', resource.departmentId)
          .executeTakeFirst();
        if (inside) result.add(row.user_id);
      }
    }
    return [...result];
  }
}
