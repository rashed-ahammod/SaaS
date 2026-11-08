/**
 * Opportunities (Phase 3 WP24; spec §6.8 step 3: "opportunity with stage, value, probability,
 * expected close date; pipeline board; weighted forecast"; §9 opportunity.won).
 *
 *   stages                the company's open stages in order, each with a default probability;
 *                         five defaults on first use; the Admin adds, renames, re-orders or
 *                         retires them (not while open opportunities sit in one)
 *   create                for a customer the user may see; the owner is the salesperson, or the
 *                         one the Sales head / Admin names, or the customer's account manager
 *   createFromLead        on qualification (LeadsService): the lead's owner owns it
 *   moveStage             the stage's probability, unless the owner gives another
 *   won / lost            closed with the date; lost needs a reason; won raises opportunity.won
 *   reopen                a closed one opens again, with a note
 *   assign                to another salesperson (Sales head / Admin); the department follows
 *
 * Every change of stage or state is written to opportunity_stage_history by the database itself
 * (trigger), with the value and probability of that moment and the note given.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  fiscalYearOf,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  Lead,
  Opportunity,
  OpportunityStage,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { CrmAccess } from './crm-access.js';
import { CustomersService } from './customers.service.js';
import type { AssignDto } from './dto/crm.dto.js';
import type {
  LostDto,
  MoveStageDto,
  OpportunityDto,
  OpportunityFieldsDto,
  OpportunityQueryDto,
  ReopenDto,
  StageDto,
  UpdateOpportunityDto,
  UpdateStageDto,
  WonDto,
} from './dto/opportunities.dto.js';

/** The stages a company starts with (spec §6.8; the Admin changes them). */
export const DEFAULT_STAGES = [
  { name: 'Prospecting', nameBn: 'প্রাথমিক যোগাযোগ', probability: 10 },
  { name: 'Needs identified', nameBn: 'চাহিদা নির্ণয়', probability: 25 },
  { name: 'Quotation sent', nameBn: 'কোটেশন পাঠানো', probability: 50 },
  { name: 'Negotiation', nameBn: 'দরকষাকষি', probability: 70 },
  { name: 'Verbal yes', nameBn: 'মৌখিক সম্মতি', probability: 90 },
];

/** value × probability, unrounded (totals add these and round once). */
export const weightOf = (o: { value: string; probability: number }) =>
  Money.of(o.value).times(o.probability).times('0.01');

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly crm: CrmAccess,
    private readonly customers: CustomersService,
  ) {}

  // ================================================================ stages

  async stages(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    await this.ensureStages(companyId);
    const rows = await this.db.tx
      .selectFrom('opportunity_stages as s')
      .selectAll('s')
      .select((eb) => [
        eb
          .selectFrom('opportunities as o')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('o.stage_id', '=', 's.id')
          .where('o.state', '=', 'open')
          .as('open_count'),
      ])
      .where('s.company_id', '=', companyId)
      .orderBy('s.sort_order')
      .orderBy('s.name')
      .execute();
    return rows.map((s) => ({
      ...this.toStage(s),
      openCount: s.open_count ?? 0,
      canManage: this.access.allows('crm.manage', { companyId }),
    }));
  }

  async createStage(companyId: string, dto: StageDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('crm.manage', { companyId });
    await this.ensureStages(companyId);
    const s = await this.db.tx
      .insertInto('opportunity_stages')
      .values({
        company_id: companyId,
        name: dto.name,
        name_bn: dto.nameBn ?? null,
        probability: dto.probability,
        sort_order: dto.sortOrder,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'opportunity_stage.created',
      entity: 'opportunity_stage',
      entityId: s.id,
      after: this.toStage(s),
    });
    return this.toStage(s);
  }

  async updateStage(id: string, dto: UpdateStageDto) {
    const s = await this.db.tx
      .selectFrom('opportunity_stages')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s) throw new NotFoundException(MSG.STAGE_NOT_FOUND);
    this.access.assert('crm.manage', { companyId: s.company_id });
    if (dto.isActive === false && s.is_active) {
      const open = await this.db.tx
        .selectFrom('opportunities')
        .select('id')
        .where('stage_id', '=', id)
        .where('state', '=', 'open')
        .executeTakeFirst();
      if (open) throw new ConflictException(MSG.STAGE_IN_USE);
    }
    const row = await this.db.tx
      .updateTable('opportunity_stages')
      .set({
        name: dto.name,
        name_bn: dto.nameBn ?? null,
        probability: dto.probability,
        sort_order: dto.sortOrder,
        is_active: dto.isActive ?? s.is_active,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'opportunity_stage.updated',
      entity: 'opportunity_stage',
      entityId: id,
      before: this.toStage(s),
      after: this.toStage(row),
    });
    return this.toStage(row);
  }

  /** The five default stages, the first time a company needs them. */
  async ensureStages(companyId: string) {
    const any = await this.db.tx
      .selectFrom('opportunity_stages')
      .select('id')
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    if (any) return;
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-stages:${companyId}`}, 0))`.execute(
      this.db.tx,
    );
    const again = await this.db.tx
      .selectFrom('opportunity_stages')
      .select('id')
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    if (again) return;
    await this.db.tx
      .insertInto('opportunity_stages')
      .values(
        DEFAULT_STAGES.map((s, i) => ({
          company_id: companyId,
          name: s.name,
          name_bn: s.nameBn,
          probability: s.probability,
          sort_order: i + 1,
        })),
      )
      .execute();
  }

  // ================================================================ opportunities

  async list(companyId: string, query: OpportunityQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const scope = await this.crm.listScope(companyId);
    let q = this.db.tx
      .selectFrom('opportunities as o')
      .innerJoin('customers as c', 'c.id', 'o.customer_id')
      .innerJoin('opportunity_stages as s', 's.id', 'o.stage_id')
      .innerJoin('users as u', 'u.id', 'o.owner_id')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .selectAll('o')
      .select([
        'c.code as customer_code',
        'c.name as customer_name',
        's.name as stage_name',
        's.name_bn as stage_name_bn',
        'e.full_name_en as owner_name',
        'u.email as owner_email',
      ])
      .where('o.company_id', '=', companyId);
    if (!scope.all) q = q.where('o.owner_id', 'in', scope.ownerIds);
    if (query.state) q = q.where('o.state', '=', query.state);
    if (query.ownerId) q = q.where('o.owner_id', '=', query.ownerId);
    if (query.stageId) q = q.where('o.stage_id', '=', query.stageId);
    if (query.customerId) q = q.where('o.customer_id', '=', query.customerId);
    if (query.q) {
      const like = `%${query.q.toLowerCase()}%`;
      q = q.where((eb) =>
        eb.or([
          eb(sql`lower(o.title)`, 'like', like),
          eb('o.number', 'ilike', like),
          eb(sql`lower(c.name)`, 'like', like),
          eb('c.code', 'ilike', like),
        ]),
      );
    }
    const rows = await q
      .orderBy('o.state')
      .orderBy('o.expected_close_on')
      .orderBy('o.number')
      .limit(1000)
      .execute();
    return rows.map((r) => ({
      ...this.toOpportunity(r),
      customer: `${r.customer_code} · ${r.customer_name}`,
      stageName: r.stage_name,
      stageNameBn: r.stage_name_bn,
      ownerName: r.owner_name ?? r.owner_email,
    }));
  }

  async get(id: string) {
    const o = await this.find(id);
    await this.crm.assertSee(o.company_id, o.owner_id);
    const customer = await this.customers.find(o.customer_id);
    const stage = await this.db.tx
      .selectFrom('opportunity_stages')
      .selectAll()
      .where('id', '=', o.stage_id)
      .executeTakeFirstOrThrow();
    const owner = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select(['u.email', 'e.full_name_en'])
      .where('u.id', '=', o.owner_id)
      .executeTakeFirst();
    const lead = o.lead_id
      ? await this.db.tx
          .selectFrom('leads')
          .select(['id', 'number'])
          .where('id', '=', o.lead_id)
          .executeTakeFirst()
      : undefined;
    const history = await this.db.tx
      .selectFrom('opportunity_stage_history as h')
      .leftJoin('opportunity_stages as f', 'f.id', 'h.from_stage_id')
      .innerJoin('opportunity_stages as t', 't.id', 'h.to_stage_id')
      .leftJoin('users as u', 'u.id', 'h.changed_by')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select([
        'h.id',
        'h.from_state',
        'h.to_state',
        'h.value',
        'h.probability',
        'h.note',
        'h.changed_at',
        'f.name as from_stage',
        't.name as to_stage',
        'e.full_name_en as by_name',
        'u.email as by_email',
      ])
      .where('h.opportunity_id', '=', id)
      .orderBy('h.changed_at')
      .execute();
    return {
      ...this.toOpportunity(o),
      customer: { id: customer.id, code: customer.code, name: customer.name },
      lead: lead ? { id: lead.id, number: lead.number } : null,
      stageName: stage.name,
      stageNameBn: stage.name_bn,
      ownerName: owner?.full_name_en ?? owner?.email ?? null,
      canWork: await this.crm.canWork(o.company_id, o.owner_id),
      history: history.map((h) => ({
        id: h.id,
        fromStage: h.from_stage,
        toStage: h.to_stage,
        fromState: h.from_state,
        toState: h.to_state,
        value: h.value,
        probability: h.probability,
        note: h.note,
        changedAt: h.changed_at,
        byName: h.by_name ?? h.by_email,
      })),
    };
  }

  async create(companyId: string, dto: OpportunityDto) {
    await this.org.assertCompanyExists(companyId);
    const customer = await this.customers.find(dto.customerId);
    if (customer.company_id !== companyId)
      throw new NotFoundException(MSG.CUSTOMER_NOT_FOUND);
    await this.crm.assertSee(companyId, customer.account_manager_id, {
      customer: true,
    });
    const me = this.access.current();
    let ownerId: string;
    if (dto.ownerId) {
      await this.crm.assertSalesperson(companyId, dto.ownerId);
      await this.crm.assertAssign(companyId, dto.ownerId);
      ownerId = dto.ownerId;
    } else if (me.has('crm.own') && me.userId) ownerId = me.userId;
    else if (customer.account_manager_id) ownerId = customer.account_manager_id;
    else throw new BadRequestException(MSG.CRM_OWNER_INVALID);
    await this.crm.assertWork(companyId, ownerId);
    const o = await this.insert(companyId, dto, {
      customerId: customer.id,
      ownerId,
      lead: null,
    });
    return this.get(o.id);
  }

  /** On qualification (LeadsService): the opportunity goes to the lead's owner. */
  async createFromLead(
    lead: Lead,
    customerId: string,
    dto: OpportunityFieldsDto,
  ): Promise<string> {
    const o = await this.insert(lead.company_id, dto, {
      customerId,
      ownerId: lead.owner_id,
      lead,
    });
    return o.id;
  }

  async update(id: string, dto: UpdateOpportunityDto) {
    const o = await this.openOne(id);
    const row = await this.db.tx
      .updateTable('opportunities')
      .set({
        title: dto.title ?? o.title,
        value: dto.value ? Money.of(dto.value).toDb() : o.value,
        probability: dto.probability ?? o.probability,
        expected_close_on: dto.expectedCloseOn
          ? businessDate(dto.expectedCloseOn)
          : o.expected_close_on,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'opportunity.updated',
      entity: 'opportunity',
      entityId: id,
      before: this.toOpportunity(o),
      after: this.toOpportunity(row),
    });
    return this.get(id);
  }

  async moveStage(id: string, dto: MoveStageDto) {
    const o = await this.openOne(id);
    const stage = await this.activeStage(o.company_id, dto.stageId);
    const row = await this.db.tx
      .updateTable('opportunities')
      .set({
        stage_id: stage.id,
        probability: dto.probability ?? stage.probability,
        change_note: dto.note ?? null,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'opportunity.stage_changed',
      entity: 'opportunity',
      entityId: id,
      before: { stageId: o.stage_id, probability: o.probability },
      after: {
        stageId: stage.id,
        probability: row.probability,
        note: dto.note,
      },
    });
    return this.get(id);
  }

  async won(id: string, dto: WonDto) {
    const o = await this.openOne(id);
    const closedOn = this.closingDate(dto.closedOn);
    const row = await this.db.tx
      .updateTable('opportunities')
      .set({
        state: 'won',
        probability: 100,
        closed_on: closedOn,
        value: dto.value ? Money.of(dto.value).toDb() : o.value,
        close_note: dto.note ?? null,
        change_note: dto.note ?? null,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'opportunity.won',
      entity: 'opportunity',
      entityId: id,
      before: { value: o.value },
      after: { value: row.value, closedOn },
    });
    await this.outbox.add({
      type: 'opportunity.won',
      entityId: id,
      payload: {
        opportunityId: id,
        companyId: o.company_id,
        number: o.number,
        customerId: o.customer_id,
        ownerId: o.owner_id,
        departmentId: o.department_id,
        value: row.value,
        closedOn,
      },
    });
    return this.get(id);
  }

  async lost(id: string, dto: LostDto) {
    await this.openOne(id);
    const closedOn = this.closingDate(dto.closedOn);
    const row = await this.db.tx
      .updateTable('opportunities')
      .set({
        state: 'lost',
        probability: 0,
        closed_on: closedOn,
        lost_reason: dto.reason,
        close_note: dto.note ?? null,
        change_note: dto.note ?? null,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'opportunity.lost',
      entity: 'opportunity',
      entityId: id,
      after: { reason: dto.reason, note: dto.note, closedOn },
    });
    return this.get(id);
  }

  async reopen(id: string, dto: ReopenDto) {
    const o = await this.find(id);
    await this.crm.assertWork(o.company_id, o.owner_id);
    if (o.state === 'open')
      throw new ConflictException(MSG.OPPORTUNITY_WRONG_STATE);
    const stage = await this.activeStage(o.company_id, dto.stageId);
    const row = await this.db.tx
      .updateTable('opportunities')
      .set({
        state: 'open',
        stage_id: stage.id,
        probability: stage.probability,
        closed_on: null,
        lost_reason: null,
        close_note: null,
        expected_close_on: businessDate(dto.expectedCloseOn),
        change_note: dto.note,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'opportunity.reopened',
      entity: 'opportunity',
      entityId: id,
      before: { state: o.state, closedOn: o.closed_on },
      after: { stageId: stage.id, note: dto.note },
    });
    return this.get(id);
  }

  async assign(id: string, dto: AssignDto) {
    const o = await this.find(id);
    if (o.state !== 'open')
      throw new ConflictException(MSG.OPPORTUNITY_WRONG_STATE);
    await this.crm.assertAssign(o.company_id, o.owner_id);
    await this.crm.assertSalesperson(o.company_id, dto.ownerId);
    await this.crm.assertAssign(o.company_id, dto.ownerId);
    if (o.owner_id === dto.ownerId) return this.get(id);
    const r = await this.crm.resourceOf(o.company_id, dto.ownerId);
    await this.db.tx
      .updateTable('opportunities')
      .set({ owner_id: dto.ownerId, department_id: r.departmentId ?? null })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'opportunity.assigned',
      entity: 'opportunity',
      entityId: id,
      before: { ownerId: o.owner_id },
      after: { ownerId: dto.ownerId, note: dto.note },
    });
    return this.get(id);
  }

  /** WP25: a quotation went out: an open opportunity in an earlier stage moves to "Quotation sent" (if the company has that stage). */
  async quotationSent(id: string, quotationNo: string) {
    const o = await this.find(id);
    if (o.state !== 'open') return;
    const stages = await this.db.tx
      .selectFrom('opportunity_stages')
      .selectAll()
      .where('company_id', '=', o.company_id)
      .where('is_active', '=', true)
      .execute();
    const target = stages.find((s) => s.name === 'Quotation sent');
    const current = stages.find((s) => s.id === o.stage_id);
    if (!target || (current && current.sort_order >= target.sort_order)) return;
    await this.db.tx
      .updateTable('opportunities')
      .set({
        stage_id: target.id,
        probability: Math.max(o.probability, target.probability),
        change_note: `Quotation ${quotationNo} sent`,
      })
      .where('id', '=', id)
      .execute();
  }

  /** WP26: the customer accepted a quotation and the order is placed: the opportunity is won at the order's value. */
  async wonByOrder(id: string, value: string, date: string, orderNo: string) {
    const o = await this.find(id);
    if (o.state !== 'open') return;
    await this.db.tx
      .updateTable('opportunities')
      .set({
        state: 'won',
        probability: 100,
        closed_on: date,
        value: Money.of(value).toDb(),
        close_note: `Order ${orderNo}`,
        change_note: `Order ${orderNo}`,
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'opportunity.won',
      entity: 'opportunity',
      entityId: id,
      before: { value: o.value },
      after: { value, closedOn: date, order: orderNo },
    });
    await this.outbox.add({
      type: 'opportunity.won',
      entityId: id,
      payload: {
        opportunityId: id,
        companyId: o.company_id,
        number: o.number,
        customerId: o.customer_id,
        ownerId: o.owner_id,
        departmentId: o.department_id,
        value: Money.of(value).toDb(),
        closedOn: date,
        order: orderNo,
      },
    });
  }

  async find(id: string): Promise<Opportunity> {
    const o = await this.db.tx
      .selectFrom('opportunities')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!o) throw new NotFoundException(MSG.OPPORTUNITY_NOT_FOUND);
    return o;
  }

  // ================================================================ internals

  private async insert(
    companyId: string,
    dto: OpportunityFieldsDto,
    who: { customerId: string; ownerId: string; lead: Lead | null },
  ) {
    await this.ensureStages(companyId);
    const stage = dto.stageId
      ? await this.activeStage(companyId, dto.stageId)
      : await this.firstStage(companyId);
    const owner = await this.crm.resourceOf(companyId, who.ownerId);
    const o = await this.db.tx
      .insertInto('opportunities')
      .values({
        company_id: companyId,
        number: await this.nextNumber(companyId),
        title: dto.title,
        customer_id: who.customerId,
        lead_id: who.lead?.id ?? null,
        owner_id: who.ownerId,
        department_id: owner.departmentId ?? null,
        stage_id: stage.id,
        value: Money.of(dto.value).toDb(),
        probability: dto.probability ?? stage.probability,
        expected_close_on: businessDate(dto.expectedCloseOn),
        change_note: who.lead ? `From lead ${who.lead.number}` : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'opportunity.created',
      entity: 'opportunity',
      entityId: o.id,
      after: this.toOpportunity(o),
    });
    return o;
  }

  /** An open opportunity the user may work. */
  private async openOne(id: string) {
    const o = await this.find(id);
    await this.crm.assertWork(o.company_id, o.owner_id);
    if (o.state !== 'open')
      throw new ConflictException(MSG.OPPORTUNITY_WRONG_STATE);
    return o;
  }

  private async activeStage(
    companyId: string,
    stageId: string,
  ): Promise<OpportunityStage> {
    const s = await this.db.tx
      .selectFrom('opportunity_stages')
      .selectAll()
      .where('id', '=', stageId)
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!s) throw new BadRequestException(MSG.STAGE_NOT_FOUND);
    return s;
  }

  private async firstStage(companyId: string): Promise<OpportunityStage> {
    const s = await this.db.tx
      .selectFrom('opportunity_stages')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .orderBy('name')
      .executeTakeFirst();
    if (!s) throw new BadRequestException(MSG.STAGE_NOT_FOUND);
    return s;
  }

  /** The day it closed: given, or today; never in the future. */
  private closingDate(given?: string) {
    const today = todayInDhaka(this.clock.now());
    const day = given ? businessDate(given) : today;
    if (day > today)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['closedOn cannot be in the future'] },
      });
    return day;
  }

  private async nextNumber(companyId: string): Promise<string> {
    const fy = fiscalYearOf(todayInDhaka(this.clock.now()), '07-01');
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'opportunity',
        fiscal_year_code: fy,
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'kind', 'fiscal_year_code'])
          .doUpdateSet({ last_no: sql`payables_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return `O/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  private toStage(s: OpportunityStage) {
    return {
      id: s.id,
      companyId: s.company_id,
      name: s.name,
      nameBn: s.name_bn,
      sortOrder: s.sort_order,
      probability: s.probability,
      isActive: s.is_active,
      version: s.version,
    };
  }

  toOpportunity(o: Opportunity) {
    return {
      id: o.id,
      companyId: o.company_id,
      number: o.number,
      title: o.title,
      customerId: o.customer_id,
      leadId: o.lead_id,
      ownerId: o.owner_id,
      departmentId: o.department_id,
      stageId: o.stage_id,
      state: o.state,
      value: o.value,
      probability: o.probability,
      weighted: weightOf(o).round().toDb(),
      expectedCloseOn: o.expected_close_on,
      closedOn: o.closed_on,
      lostReason: o.lost_reason,
      closeNote: o.close_note,
      createdAt: o.created_at,
      version: o.version,
    };
  }
}
