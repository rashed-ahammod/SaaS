/**
 * What one user may do, loaded once per request (guide §8 "Authorization check"):
 *
 *   can(user, permission, resource) =
 *     any role of the user that has the permission
 *       AND the resource is inside that role's scope:
 *           own        -> resource.employeeId == user's employee
 *           department -> resource.departmentId is the department or below it
 *           company    -> resource.companyId == the company
 *           group      -> any resource of the tenant (RLS already limits it to the tenant)
 *
 * Pure class: no database. AccessService builds it; services call
 * this.access.assert(...) which uses it.
 */
import type { FieldGroup, ScopeType } from '../../../platform/db/schema.js';
import type { PermissionKey } from './permissions.js';

/** The record being accessed, described by where it sits in the organization. */
export interface AccessResource {
  companyId?: string | null;
  departmentId?: string | null;
  employeeId?: string | null;
}

/** One permission (or field group) granted within one scope. */
export interface ScopedGrant {
  scope: ScopeType;
  companyId?: string;
  /** For department scope: the department and every department below it. */
  departmentIds?: ReadonlySet<string>;
}

/** Result of scopeFilter(): which records a list query may return. */
export type ScopeFilter =
  | { all: true }
  | {
      all: false;
      companyIds: string[];
      departmentIds: string[];
      employeeIds: string[];
    };

export class AccessGrants {
  constructor(
    readonly userId: string | null,
    /** The employee record linked to this login, if any. */
    readonly employeeId: string | null,
    private readonly permissions: ReadonlyMap<PermissionKey, ScopedGrant[]>,
    /** Sensitive fields visible through roles (e.g. HR: salary, bank, identity), per scope. */
    private readonly roleFieldGroups: ReadonlyMap<FieldGroup, ScopedGrant[]>,
    /** Sensitive fields granted to this user explicitly (field_grants table). */
    private readonly explicitFieldGroups: ReadonlySet<FieldGroup>,
    /** Role names for display, e.g. ["hr:company", "employee:own"]. */
    readonly roleLabels: string[],
    /** Holds a role that requires two-factor login. */
    readonly privileged: boolean,
    /** System jobs and the seed script: everything allowed. Never used for HTTP requests. */
    readonly isSystem = false,
  ) {}

  static system(): AccessGrants {
    return new AccessGrants(
      null,
      null,
      new Map(),
      new Map(),
      new Set(),
      ['system'],
      false,
      true,
    );
  }

  /** Every permission held in at least one scope: the screens the apps may show (the API still checks each request). */
  permissionKeys(): PermissionKey[] {
    return [...this.permissions.keys()]
      .filter((p) => (this.permissions.get(p)?.length ?? 0) > 0)
      .sort();
  }

  /** Holds the permission in at least one scope (the coarse check done by AuthGuard). */
  has(permission: PermissionKey): boolean {
    return this.isSystem || (this.permissions.get(permission)?.length ?? 0) > 0;
  }

  /** May use the permission on this particular resource. */
  allows(permission: PermissionKey, resource: AccessResource): boolean {
    if (this.isSystem) return true;
    return (this.permissions.get(permission) ?? []).some((g) =>
      this.covers(g, resource),
    );
  }

  /**
   * May see a sensitive field group (salary, bank, identity, complaint) of this resource:
   *  - always for one's own record;
   *  - through a role that includes the group, within that role's scope;
   *  - through an explicit field grant, wherever the user may view the employee.
   */
  canSeeField(group: FieldGroup, resource: AccessResource): boolean {
    if (this.isSystem) return true;
    if (this.employeeId && resource.employeeId === this.employeeId) return true;
    if (
      (this.roleFieldGroups.get(group) ?? []).some((g) =>
        this.covers(g, resource),
      )
    )
      return true;
    return (
      this.explicitFieldGroups.has(group) &&
      this.allows('employee.view', resource)
    );
  }

  /** For list queries: which companies / departments / employees the permission reaches. */
  scopeFilter(permission: PermissionKey): ScopeFilter {
    if (this.isSystem) return { all: true };
    const grants = this.permissions.get(permission) ?? [];
    if (grants.some((g) => g.scope === 'group')) return { all: true };

    const companyIds = new Set<string>();
    const departmentIds = new Set<string>();
    const employeeIds = new Set<string>();
    for (const g of grants) {
      if (g.scope === 'company' && g.companyId) companyIds.add(g.companyId);
      if (g.scope === 'department')
        g.departmentIds?.forEach((d) => departmentIds.add(d));
      if (g.scope === 'own' && this.employeeId)
        employeeIds.add(this.employeeId);
    }
    return {
      all: false,
      companyIds: [...companyIds],
      departmentIds: [...departmentIds],
      employeeIds: [...employeeIds],
    };
  }

  private covers(grant: ScopedGrant, r: AccessResource): boolean {
    switch (grant.scope) {
      case 'group':
        return true;
      case 'company':
        return !!r.companyId && r.companyId === grant.companyId;
      case 'department':
        return !!r.departmentId && !!grant.departmentIds?.has(r.departmentId);
      case 'own':
        return !!r.employeeId && r.employeeId === this.employeeId;
    }
  }
}
