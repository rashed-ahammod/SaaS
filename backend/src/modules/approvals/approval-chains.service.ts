/**
 * Configuring approval chains (spec §5 "Default chains (customer can edit)").
 * Built-in defaults always exist; a configured chain for the same request type
 * takes precedence when its conditions match.
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
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { ApprovalHandlers } from './approval-handlers.js';
import type { ChainConditions } from './chains.js';
import type { CreateChainDto, UpdateChainDto } from './dto/approvals.dto.js';

@Injectable()
export class ApprovalChainsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly handlers: ApprovalHandlers,
  ) {}

  async listChains() {
    const chains = await this.db.tx
      .selectFrom('approval_chains')
      .selectAll()
      .orderBy('request_type')
      .orderBy('priority')
      .execute();
    const steps = chains.length
      ? await this.db.tx
          .selectFrom('approval_chain_steps')
          .selectAll()
          .where(
            'chain_id',
            'in',
            chains.map((c) => c.id),
          )
          .orderBy('step_no')
          .execute()
      : [];
    return {
      requestTypes: this.handlers.knownTypes(),
      configured: chains.map((c) => ({
        id: c.id,
        requestType: c.request_type,
        name: c.name,
        priority: c.priority,
        conditions: c.conditions,
        isActive: c.is_active,
        version: c.version,
        steps: steps
          .filter((s) => s.chain_id === c.id)
          .map((s) => ({
            stepNo: s.step_no,
            approverRule: s.approver_rule,
            mode: s.mode,
            reminderHours: s.reminder_hours,
            escalationHours: s.escalation_hours,
          })),
      })),
      builtIn: this.handlers
        .knownTypes()
        .flatMap((requestType) =>
          this.handlers
            .defaultChains(requestType)
            .map((c) => ({ requestType, ...c })),
        ),
    };
  }

  async createChain(dto: CreateChainDto) {
    // tenant-wide setting
    this.access.assert('approvals.configure', {});
    if (!this.handlers.knownTypes().includes(dto.requestType))
      throw new BadRequestException(`Unknown request type ${dto.requestType}`);
    const conditions = checkConditions(dto.conditions ?? {});

    // save chain and steps
    const chain = await this.db.tx
      .insertInto('approval_chains')
      .values({
        request_type: dto.requestType,
        name: dto.name.trim(),
        priority: dto.priority,
        conditions: JSON.stringify(conditions),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('approval_chain_steps')
      .values(
        dto.steps.map((s, i) => ({
          chain_id: chain.id,
          step_no: i + 1,
          approver_rule: s.approverRule,
          mode: s.mode,
          reminder_hours: s.reminderHours,
          escalation_hours: s.escalationHours,
        })),
      )
      .execute();

    await this.audit.record({
      action: 'approval_chain.created',
      entity: 'approval_chain',
      entityId: chain.id,
      after: { ...dto, conditions },
    });
    return (await this.listChains()).configured.find((c) => c.id === chain.id);
  }

  async updateChain(id: string, dto: UpdateChainDto) {
    this.access.assert('approvals.configure', {});
    const before = await this.db.tx
      .selectFrom('approval_chains')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!before) throw new NotFoundException(MSG.NOT_FOUND);
    assertVersion(before, dto.version);

    const changes = changesOnly({
      name: dto.name?.trim(),
      priority: dto.priority,
      is_active: dto.isActive,
    });
    if (changes) {
      const result = await this.db.tx
        .updateTable('approval_chains')
        .set(changes)
        .where('id', '=', id)
        .where('version', '=', dto.version)
        .executeTakeFirst();
      assertUpdated(result);
      await this.audit.record({
        action: 'approval_chain.updated',
        entity: 'approval_chain',
        entityId: id,
        before: {
          name: before.name,
          priority: before.priority,
          isActive: before.is_active,
        },
        after: changes,
      });
    }
    return (await this.listChains()).configured.find((c) => c.id === id);
  }
}

/** Only known condition keys, with valid values. */
function checkConditions(raw: Record<string, unknown>): ChainConditions {
  const allowed = [
    'minAmount',
    'maxAmount',
    'minDays',
    'maxDays',
    'companyIds',
    'departmentIds',
    'kinds',
  ];
  for (const key of Object.keys(raw))
    if (!allowed.includes(key))
      throw new BadRequestException(`Unknown condition ${key}`);
  const c = raw as ChainConditions;
  for (const k of ['minAmount', 'maxAmount'] as const)
    if (c[k] !== undefined) Money.of(String(c[k]));
  for (const k of ['minDays', 'maxDays'] as const)
    if (c[k] !== undefined && typeof c[k] !== 'number')
      throw new BadRequestException(`${k} must be a number`);
  for (const k of ['companyIds', 'departmentIds', 'kinds'] as const)
    if (c[k] !== undefined && !Array.isArray(c[k]))
      throw new BadRequestException(`${k} must be a list`);
  return c;
}
