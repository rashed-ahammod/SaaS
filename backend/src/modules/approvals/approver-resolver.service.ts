/**
 * Turns an approver rule into the users who must approve, using the org data
 * as it is when the step starts (guide §9 rule 2).
 *
 *   line_manager  the subject employee's line manager
 *   dept_head     the head of the subject's department
 *   role:hr       every user with the HR role whose scope covers the subject
 *   user:<id>     that user
 *
 * Nobody approves their own request: the requester and the subject employee's
 * own login are never chosen. If the person found is the requester, has no
 * login, or the position is vacant, the search moves up (spec §3: "approvals
 * route to that manager's own manager"). If nobody is found, Admins of the
 * company are the fallback.
 */
import { Injectable } from '@nestjs/common';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { isSystemRoleKey } from '../identity/access/roles.js';
import { UserDirectory } from '../identity/user-directory.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { ApproverRule } from './chains.js';

export interface RoutingContext {
  requesterUserId: string;
  subjectEmployeeId: string | null;
  companyId: string;
  departmentId: string | null;
}

export interface ResolvedApprovers {
  userIds: string[];
  /** How they were found, stored on the assignment (e.g. "line_manager", "fallback_admin"). */
  reason: string;
}

const MAX_HOPS = 10; // guards against loops such as A manages B and B manages A

@Injectable()
export class ApproverResolver {
  constructor(
    private readonly employees: EmployeeDirectory,
    private readonly users: UserDirectory,
    private readonly org: OrgLookupService,
    private readonly access: AccessService,
  ) {}

  async resolve(
    rule: ApproverRule,
    ctx: RoutingContext,
  ): Promise<ResolvedApprovers> {
    const excluded = await this.excludedUsers(ctx);
    let found: string[] = [];

    if (rule === 'line_manager') {
      const start = ctx.subjectEmployeeId
        ? (await this.employees.currentOrFirstPlacement(ctx.subjectEmployeeId))
            ?.lineManagerId
        : null;
      found = await this.walkUpManagers(start ?? null, excluded);
    } else if (rule === 'dept_head') {
      found = await this.departmentHead(ctx, excluded);
    } else if (rule.startsWith('role:')) {
      const role = rule.slice(5);
      if (isSystemRoleKey(role)) {
        const users = await this.access.usersWithSystemRole(role, {
          companyId: ctx.companyId,
          departmentId: ctx.departmentId,
          employeeId: ctx.subjectEmployeeId,
        });
        found = users.filter((u) => !excluded.has(u));
      }
    } else if (rule.startsWith('user:')) {
      const userId = rule.slice(5);
      if (!excluded.has(userId) && (await this.users.isActive(userId)))
        found = [userId];
    }

    if (found.length > 0) return { userIds: found, reason: rule };
    return {
      userIds: await this.admins(ctx, excluded),
      reason: 'fallback_admin',
    };
  }

  /**
   * Who takes over when an approver misses the escalation deadline: their line
   * manager (moving up as usual), else the company's Admins.
   */
  async escalationTarget(
    approverUserId: string,
    ctx: RoutingContext,
    alreadyAssigned: Set<string>,
  ): Promise<string | undefined> {
    const excluded = new Set([
      ...(await this.excludedUsers(ctx)),
      ...alreadyAssigned,
    ]);
    const approverEmployee = await this.users.employeeOfUser(approverUserId);
    const manager = approverEmployee
      ? (await this.employees.currentOrFirstPlacement(approverEmployee))
          ?.lineManagerId
      : null;
    const [up] = await this.walkUpManagers(manager ?? null, excluded);
    if (up) return up;
    const [admin] = await this.admins(ctx, excluded);
    return admin;
  }

  // ------------------------------------------------------------------ helpers

  /** The requester and the subject's own login can never approve. */
  private async excludedUsers(ctx: RoutingContext): Promise<Set<string>> {
    const excluded = new Set([ctx.requesterUserId]);
    if (ctx.subjectEmployeeId) {
      const subjectUser = await this.users.activeUserOfEmployee(
        ctx.subjectEmployeeId,
      );
      if (subjectUser) excluded.add(subjectUser);
    }
    return excluded;
  }

  /** Start at an employee and go up the line-manager chain until someone can act. */
  private async walkUpManagers(
    employeeId: string | null,
    excluded: Set<string>,
  ): Promise<string[]> {
    const seen = new Set<string>();
    let current = employeeId;
    for (let hop = 0; current && hop < MAX_HOPS && !seen.has(current); hop++) {
      seen.add(current);
      const user = await this.users.activeUserOfEmployee(current);
      if (user && !excluded.has(user)) return [user];
      current =
        (await this.employees.currentOrFirstPlacement(current))
          ?.lineManagerId ?? null;
    }
    return [];
  }

  /**
   * Head of the subject's department. A vacant head moves to the parent
   * department; a head who is the subject or the requester (or has no login)
   * moves to that head's own line manager.
   */
  private async departmentHead(
    ctx: RoutingContext,
    excluded: Set<string>,
  ): Promise<string[]> {
    let departmentId = ctx.departmentId;
    for (let hop = 0; departmentId && hop < MAX_HOPS; hop++) {
      const { headEmployeeId, parentId } =
        await this.org.departmentHeadInfo(departmentId);
      if (headEmployeeId) {
        const user =
          headEmployeeId !== ctx.subjectEmployeeId
            ? await this.users.activeUserOfEmployee(headEmployeeId)
            : undefined;
        if (user && !excluded.has(user)) return [user];
        const headsManager =
          (await this.employees.currentOrFirstPlacement(headEmployeeId))
            ?.lineManagerId ?? null;
        return this.walkUpManagers(headsManager, excluded);
      }
      departmentId = parentId;
    }
    return [];
  }

  private async admins(
    ctx: RoutingContext,
    excluded: Set<string>,
  ): Promise<string[]> {
    const admins = await this.access.usersWithSystemRole('admin', {
      companyId: ctx.companyId,
    });
    return admins.filter((u) => !excluded.has(u));
  }
}
