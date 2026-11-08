/**
 * SLA job (guide §9 rule 4): finds pending approvals whose reminder or
 * escalation time has passed, across all tenants, and handles each one inside
 * its own tenant transaction. Run by the worker every minute.
 *
 * The scan uses the erp_worker role (it may only SELECT pending assignments);
 * the actual change runs as erp_app with the tenant set, like any request.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../platform/clock.js';
import {
  DatabaseService,
  WORKER_DB,
} from '../../platform/db/database.service.js';
import { AccessGrants } from '../identity/access/access-grants.js';
import { ApprovalsService } from './approvals.service.js';

export interface SlaRunSummary {
  checked: number;
  reminded: number;
  escalated: number;
}

@Injectable()
export class ApprovalSlaService {
  private readonly logger = new Logger('ApprovalSla');

  constructor(
    private readonly db: DatabaseService,
    @Inject(WORKER_DB) private readonly workerDb: DatabaseService,
    private readonly approvals: ApprovalsService,
    private readonly clock: Clock,
  ) {}

  /** Handle everything due at `now`. `onlyTenantId` limits the run to one tenant (support, tests). */
  async processDue(
    now: Date = this.clock.now(),
    onlyTenantId?: string,
  ): Promise<SlaRunSummary> {
    // which assignments are due (all tenants, or one)
    let scan = this.workerDb.kysely
      .selectFrom('approval_step_assignments')
      .select(['id', 'tenant_id'])
      .where('status', '=', 'pending');
    if (onlyTenantId) scan = scan.where('tenant_id', '=', onlyTenantId);
    const due = await scan
      .where((eb) =>
        eb.or([
          eb.and([eb('reminded_at', 'is', null), eb('remind_at', '<=', now)]),
          eb.and([
            eb('escalated_at', 'is', null),
            eb('escalate_at', '<=', now),
          ]),
        ]),
      )
      .orderBy('escalate_at')
      .limit(200)
      .execute();

    // handle each in its own tenant transaction; one failure does not stop the rest
    const summary: SlaRunSummary = {
      checked: due.length,
      reminded: 0,
      escalated: 0,
    };
    for (const item of due) {
      try {
        const result = await this.db.withTenant(
          { tenantId: item.tenant_id, access: AccessGrants.system() },
          () => this.approvals.handleSla(item.id, now),
        );
        if (result.reminded) summary.reminded++;
        if (result.escalatedTo) summary.escalated++;
      } catch (err) {
        this.logger.error(
          `SLA handling failed for assignment ${item.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return summary;
  }
}
