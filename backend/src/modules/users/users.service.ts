/**
 * User logins (spec §3: users are managed by Admin / System Admin).
 *
 * A login is not an employee: an external auditor has a login without an
 * employee record, and a new joiner has an employee record before a login.
 * Link them with employeeId so "own" scope and approval routing work.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { User } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { hashPassword } from '../identity/password.js';
import type {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
} from './dto/users.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
  ) {}

  async createUser(dto: CreateUserDto) {
    // may manage logins here? (the employee's company, or the whole group)
    await this.assertCanManage(dto.employeeId ?? null);

    // save
    const user = await this.db.tx
      .insertInto('users')
      .values({
        email: dto.email,
        phone: dto.phone ?? null,
        password_hash: await hashPassword(dto.password),
        preferred_language: dto.preferredLanguage,
        employee_id: dto.employeeId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'user.created',
      entity: 'user',
      entityId: user.id,
      after: toUserResponse(user),
    });
    return this.getUser(user.id);
  }

  async listUsers(q?: string) {
    let query = this.db.tx.selectFrom('users').selectAll().orderBy('email');
    if (q)
      query = query.where(
        'email',
        'ilike',
        `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
      );
    const users = await query.limit(200).execute();
    return users.map(toUserResponse);
  }

  /** A login with its active roles and field grants. */
  async getUser(id: string) {
    const user = await this.findUser(id);
    const roles = await this.db.tx
      .selectFrom('user_roles')
      .selectAll()
      .where('user_id', '=', id)
      .where('revoked_at', 'is', null)
      .orderBy('granted_at')
      .execute();
    const fields = await this.db.tx
      .selectFrom('field_grants')
      .select(['id', 'field_group', 'granted_at', 'granted_by'])
      .where('user_id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();

    return {
      ...toUserResponse(user),
      roles: roles.map((r) => ({
        id: r.id,
        role: r.system_role,
        customRoleId: r.custom_role_id,
        scopeType: r.scope_type,
        scopeId: r.scope_id,
        expiresAt: r.expires_at,
        grantedAt: r.granted_at,
        grantedBy: r.granted_by,
      })),
      fieldGrants: fields.map((f) => ({
        id: f.id,
        fieldGroup: f.field_group,
        grantedAt: f.granted_at,
        grantedBy: f.granted_by,
      })),
    };
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    // find, check access and version
    const before = await this.findUser(id);
    await this.assertCanManage(before.employee_id);
    if (dto.employeeId) await this.assertCanManage(dto.employeeId);
    assertVersion(before, dto.version);

    // nobody disables their own login
    if (dto.status === 'disabled' && id === requestContext.get().userId) {
      throw new BadRequestException(MSG.ROLE_SELF_GRANT);
    }

    // collect the fields that were sent
    const changes = changesOnly({
      status: dto.status,
      preferred_language: dto.preferredLanguage,
      phone: dto.phone,
      employee_id: dto.employeeId,
    });
    if (!changes) return this.getUser(id);

    // save
    const result = await this.db.tx
      .updateTable('users')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);

    const after = await this.findUser(id);
    await this.audit.record({
      action: 'user.updated',
      entity: 'user',
      entityId: id,
      ...auditDiff(before, after),
    });
    return this.getUser(id);
  }

  /** Admin sets a new password and lifts any lockout (high-risk: step-up code required). */
  async resetPassword(id: string, dto: ResetPasswordDto) {
    const user = await this.findUser(id);
    await this.assertCanManage(user.employee_id);

    await this.db.tx
      .updateTable('users')
      .set({
        password_hash: await hashPassword(dto.newPassword),
        failed_login_count: 0,
        locked_until: null,
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'user.password_reset',
      entity: 'user',
      entityId: id,
    });
    return { passwordReset: true };
  }

  async findUser(id: string): Promise<User> {
    const user = await this.db.tx
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!user) throw new NotFoundException(MSG.USER_NOT_FOUND);
    return user;
  }

  /** users.manage over the employee's company, or group-wide for logins without an employee. */
  private async assertCanManage(employeeId: string | null): Promise<void> {
    if (!employeeId) return this.access.assert('users.manage', {});
    const employee = await this.employeeAccess.find(employeeId);
    this.access.assert('users.manage', { companyId: employee.company_id });
  }
}

export function toUserResponse(u: User) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    status: u.status,
    preferredLanguage: u.preferred_language,
    employeeId: u.employee_id,
    mfaEnabled: u.mfa_enabled,
    lockedUntil: u.locked_until,
    lastLoginAt: u.last_login_at,
    version: u.version,
  };
}
