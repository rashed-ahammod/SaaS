/**
 * Delegation (spec §4): an approver hands their approvals to someone else for a
 * date range, e.g. while on leave. During that time the delegate sees the
 * approver's pending approvals and can act on them; every action records both
 * names (approval_actions.on_behalf_of_user_id).
 *
 * Users delegate their own approvals; someone with users.manage may set up a
 * delegation for another person (e.g. a manager who left suddenly).
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Delegation } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AccessService } from '../identity/access/access.service.js';
import type { CreateDelegationDto } from './dto/users.dto.js';
import { UsersService } from './users.service.js';

@Injectable()
export class DelegationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly users: UsersService,
  ) {}

  async createDelegation(dto: CreateDelegationDto) {
    const me = requestContext.get().userId!;
    const fromUserId = dto.fromUserId ?? me;

    // for someone else: needs users.manage
    if (fromUserId !== me) this.access.assert('users.manage', {});

    // check people and dates
    if (fromUserId === dto.toUserId)
      throw new BadRequestException('A user cannot delegate to themselves');
    if (dto.endsOn < dto.startsOn)
      throw new BadRequestException('endsOn must not be before startsOn');
    if (dto.endsOn < todayInDhaka())
      throw new BadRequestException('The delegation would already be over');
    await this.users.findUser(fromUserId);
    const delegate = await this.users.findUser(dto.toUserId);
    if (delegate.status !== 'active')
      throw new BadRequestException('The delegate login is not active');

    // save
    const delegation = await this.db.tx
      .insertInto('delegations')
      .values({
        from_user_id: fromUserId,
        to_user_id: dto.toUserId,
        starts_on: dto.startsOn,
        ends_on: dto.endsOn,
        reason: dto.reason ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'delegation.created',
      entity: 'delegation',
      entityId: delegation.id,
      after: toDelegationResponse(delegation),
    });
    return toDelegationResponse(delegation);
  }

  /**
   * Who I can hand my approvals to (audit 2026-10-30: a Dept Head cannot list users): the active
   * users of my workspace with a role beyond Employee, by name. No e-mail or phone.
   */
  async candidates() {
    const me = requestContext.get().userId!;
    const rows = await this.db.tx
      .selectFrom('users as u')
      .innerJoin('user_roles as r', 'r.user_id', 'u.id')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select(['u.id', 'u.email', 'e.full_name_en'])
      .where('u.status', '=', 'active')
      .where('u.id', '<>', me)
      .where('r.revoked_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('r.system_role', 'is', null),
          eb('r.system_role', 'not in', ['employee', 'sales']),
        ]),
      )
      .distinct()
      .execute();
    return rows
      .map((r) => ({ userId: r.id, name: r.full_name_en ?? r.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Delegations I gave and received (not revoked). */
  async listMyDelegations() {
    const me = requestContext.get().userId!;
    const rows = await this.db.tx
      .selectFrom('delegations')
      .selectAll()
      .where((eb) =>
        eb.or([eb('from_user_id', '=', me), eb('to_user_id', '=', me)]),
      )
      .where('revoked_at', 'is', null)
      .orderBy('starts_on', 'desc')
      .execute();
    return rows.map(toDelegationResponse);
  }

  async revokeDelegation(id: string) {
    const me = requestContext.get().userId!;
    const delegation = await this.db.tx
      .selectFrom('delegations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!delegation || delegation.revoked_at)
      throw new NotFoundException(MSG.DELEGATION_NOT_FOUND);

    // the person who delegated, or an admin
    if (
      delegation.from_user_id !== me &&
      !this.access.allows('users.manage', {})
    )
      throw new ForbiddenException(MSG.FORBIDDEN);

    const updated = await this.db.tx
      .updateTable('delegations')
      .set({ revoked_at: new Date(), revoked_by: me })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'delegation.revoked',
      entity: 'delegation',
      entityId: id,
    });
    return toDelegationResponse(updated);
  }
}

function toDelegationResponse(d: Delegation) {
  return {
    id: d.id,
    fromUserId: d.from_user_id,
    toUserId: d.to_user_id,
    startsOn: d.starts_on,
    endsOn: d.ends_on,
    reason: d.reason,
    createdAt: d.created_at,
    revokedAt: d.revoked_at,
  };
}
