/**
 * Facts about logins that other modules need (guide §3: identity owns `users`).
 * Used by the approval engine to turn "the line manager" into a user who can act.
 */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../platform/db/database.service.js';

@Injectable()
export class UserDirectory {
  constructor(private readonly db: DatabaseService) {}

  /** The active login linked to an employee, if any. */
  async activeUserOfEmployee(employeeId: string): Promise<string | undefined> {
    const row = await this.db.tx
      .selectFrom('users')
      .select('id')
      .where('employee_id', '=', employeeId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return row?.id;
  }

  async employeeOfUser(userId: string): Promise<string | null> {
    const row = await this.db.tx
      .selectFrom('users')
      .select('employee_id')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row?.employee_id ?? null;
  }

  async isActive(userId: string): Promise<boolean> {
    const row = await this.db.tx
      .selectFrom('users')
      .select('status')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row?.status === 'active';
  }

  /**
   * What to call these logins on a screen: the employee's name, or the e-mail when
   * the login is not an employee (a service account, the first Admin). An approval
   * is a conversation between people, so "Farzana Akter" belongs where a user id
   * would otherwise be printed. No phone, no e-mail beyond that fallback.
   */
  async namesOf(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select(['u.id', 'u.email', 'e.full_name_en'])
      .where('u.id', 'in', ids)
      .execute();
    return new Map(rows.map((r) => [r.id, r.full_name_en ?? r.email]));
  }

  /** Users who delegated their approvals to `userId` and whose delegation covers `date`. */
  async delegatorsFor(userId: string, date: string): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('delegations')
      .select('from_user_id')
      .where('to_user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('starts_on', '<=', date)
      .where('ends_on', '>=', date)
      .execute();
    return rows.map((r) => r.from_user_id);
  }
}
