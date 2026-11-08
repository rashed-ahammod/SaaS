/**
 * Granting and revoking roles and sensitive-field access (spec §4).
 *
 * Rules:
 *  - The granter needs "roles.grant" over the scope being granted
 *    (company HR can be granted only by someone with rights over that company).
 *  - Nobody changes their own roles or field access (maker-checker on access).
 *  - The scope must suit the role (Dept Head -> department, Employee -> own ...).
 *  - Auditor access must have an end date.
 *  - High-risk: the routes require a step-up 2FA code (spec §11).
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ScopeType, SystemRoleKey } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import type { AccessResource } from '../identity/access/access-grants.js';
import { AccessService } from '../identity/access/access.service.js';
import { SYSTEM_ROLES } from '../identity/access/roles.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  GrantFieldAccessDto,
  GrantRoleDto,
  RevokeDto,
} from './dto/users.dto.js';
import { UsersService } from './users.service.js';

@Injectable()
export class RoleGrantsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly users: UsersService,
    private readonly org: OrgLookupService,
    private readonly employeeAccess: EmployeeAccess,
  ) {}

  async grantRole(userId: string, dto: GrantRoleDto) {
    // target login; nobody grants to themselves
    const user = await this.users.findUser(userId);
    this.assertNotSelf(userId);

    // which role, and which scopes it allows
    const { baseRole, label } = await this.resolveRole(dto);
    const def = SYSTEM_ROLES[baseRole];
    if (!def.allowedScopes.includes(dto.scopeType))
      throw new BadRequestException(MSG.ROLE_SCOPE_INVALID);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (def.timeLimited && (!expiresAt || expiresAt <= new Date()))
      throw new BadRequestException(MSG.ROLE_EXPIRY_REQUIRED);

    // the scope must exist, and the granter must have rights over it
    const resource = await this.scopeResource(
      dto.scopeType,
      dto.scopeId ?? null,
      user.employee_id,
    );
    this.access.assert('roles.grant', resource);

    // save
    const grant = await this.db.tx
      .insertInto('user_roles')
      .values({
        user_id: userId,
        system_role: dto.role ?? null,
        custom_role_id: dto.customRoleId ?? null,
        scope_type: dto.scopeType,
        scope_id: dto.scopeId ?? null,
        expires_at: expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'user.role_granted',
      entity: 'user',
      entityId: userId,
      after: {
        grantId: grant.id,
        role: label,
        scopeType: dto.scopeType,
        scopeId: dto.scopeId ?? null,
        expiresAt,
      },
    });
    return this.users.getUser(userId);
  }

  async revokeRole(userId: string, grantId: string, dto: RevokeDto) {
    // find the grant; nobody revokes their own
    this.assertNotSelf(userId);
    const grant = await this.db.tx
      .selectFrom('user_roles')
      .selectAll()
      .where('id', '=', grantId)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (!grant) throw new NotFoundException(MSG.ROLE_GRANT_NOT_FOUND);

    // same rights needed as for granting it
    const user = await this.users.findUser(userId);
    this.access.assert(
      'roles.grant',
      await this.scopeResource(
        grant.scope_type,
        grant.scope_id,
        user.employee_id,
      ),
    );

    // revoke (rows are kept for history)
    await this.db.tx
      .updateTable('user_roles')
      .set({
        revoked_at: new Date(),
        revoked_by: requestContext.get().userId ?? null,
        revoke_reason: dto.reason,
      })
      .where('id', '=', grantId)
      .execute();
    await this.audit.record({
      action: 'user.role_revoked',
      entity: 'user',
      entityId: userId,
      before: {
        grantId,
        role: grant.system_role ?? grant.custom_role_id,
        scopeType: grant.scope_type,
        scopeId: grant.scope_id,
      },
      after: { reason: dto.reason },
    });
    return this.users.getUser(userId);
  }

  async grantFieldAccess(userId: string, dto: GrantFieldAccessDto) {
    // target login; nobody grants to themselves; group-wide rights needed
    await this.users.findUser(userId);
    this.assertNotSelf(userId);
    this.access.assert('roles.grant', {});

    // save (a second identical grant is refused by the unique index)
    await this.db.tx
      .insertInto('field_grants')
      .values({ user_id: userId, field_group: dto.fieldGroup })
      .execute();
    await this.audit.record({
      action: 'user.field_access_granted',
      entity: 'user',
      entityId: userId,
      after: { fieldGroup: dto.fieldGroup },
    });
    return this.users.getUser(userId);
  }

  async revokeFieldAccess(userId: string, grantId: string, dto: RevokeDto) {
    this.assertNotSelf(userId);
    this.access.assert('roles.grant', {});

    const result = await this.db.tx
      .updateTable('field_grants')
      .set({
        revoked_at: new Date(),
        revoked_by: requestContext.get().userId ?? null,
        revoke_reason: dto.reason,
      })
      .where('id', '=', grantId)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .returning('field_group')
      .executeTakeFirst();
    if (!result) throw new NotFoundException(MSG.FIELD_GRANT_NOT_FOUND);

    await this.audit.record({
      action: 'user.field_access_revoked',
      entity: 'user',
      entityId: userId,
      before: { fieldGroup: result.field_group },
      after: { reason: dto.reason },
    });
    return this.users.getUser(userId);
  }

  // ------------------------------------------------------------------ helpers

  private assertNotSelf(userId: string): void {
    if (userId === requestContext.get().userId)
      throw new ForbiddenException(MSG.ROLE_SELF_GRANT);
  }

  /** The system role behind the request (custom roles count as their base role). */
  private async resolveRole(
    dto: GrantRoleDto,
  ): Promise<{ baseRole: SystemRoleKey; label: string }> {
    if (dto.role) return { baseRole: dto.role, label: dto.role };
    const custom = await this.db.tx
      .selectFrom('custom_roles')
      .select(['based_on', 'name_en', 'is_active'])
      .where('id', '=', dto.customRoleId!)
      .executeTakeFirst();
    if (!custom || !custom.is_active)
      throw new NotFoundException(MSG.ROLE_NOT_FOUND);
    return { baseRole: custom.based_on, label: `custom:${custom.name_en}` };
  }

  /** Turns a scope into an access resource, checking that it exists. */
  private async scopeResource(
    scopeType: ScopeType,
    scopeId: string | null,
    userEmployeeId: string | null,
  ): Promise<AccessResource> {
    switch (scopeType) {
      case 'group':
        if (scopeId) throw new BadRequestException(MSG.ROLE_SCOPE_INVALID);
        return {};
      case 'company':
        if (!scopeId) throw new BadRequestException(MSG.ROLE_SCOPE_INVALID);
        await this.org.assertCompanyExists(scopeId);
        return { companyId: scopeId };
      case 'department': {
        if (!scopeId) throw new BadRequestException(MSG.ROLE_SCOPE_INVALID);
        const companyId = await this.org.companyOfDepartment(scopeId);
        return { companyId, departmentId: scopeId };
      }
      case 'own': {
        // "own" needs a login linked to an employee
        if (scopeId || !userEmployeeId)
          throw new BadRequestException(MSG.ROLE_SCOPE_INVALID);
        const employee = await this.employeeAccess.find(userEmployeeId);
        return { companyId: employee.company_id };
      }
    }
  }
}
