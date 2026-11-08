/**
 * Leads (Phase 3 WP23; spec §6.8 step 1: "from website forms, Facebook lead ads, referrals,
 * calls, walk-ins; auto-assigned by round robin or territory; duplicate check on phone and
 * e-mail").
 *
 *   create(company, dto)      by a salesperson (their own lead), or the Sales head / Admin for
 *                             someone; checked for duplicates; given an owner at once
 *   capture(company, dto)     from outside (n8n: website form, Facebook lead ads): the same
 *                             external id twice is one lead; a phone / e-mail already known
 *                             adds an "enquired again" note to the existing lead or customer
 *                             (a disqualified lead opens again) instead of a new lead
 *   owner (assignment)        the lead's district -> its territory's members in turn; else
 *                             every Sales user of the company in turn; else the company's Admin
 *   assign / disqualify / qualify   the owner's work; qualify makes (or links) the customer and
 *                             moves the phone / e-mail to it, and may open an opportunity (WP24)
 *   activities                calls, meetings, notes, tasks, messages; the owner's first call /
 *                             meeting / message marks a new lead "contacted"
 *
 * What the enquirer wrote (message) is outside content: stored and shown as text, never acted
 * on (spec §8 guardrail 9).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import type { Lead, LeadSource } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { CrmAccess } from './crm-access.js';
import { CrmKeys, keysOf } from './crm-keys.js';
import {
  districtOf,
  nextInTurn,
  normalizeEmail,
  normalizePhone,
} from './crm-rules.js';
import { activitiesOf, toActivity } from './crm-activities.js';
import { CustomersService } from './customers.service.js';
import { OpportunitiesService } from './opportunities.service.js';
import { opportunitiesOf } from './opportunity-brief.js';
import type {
  ActivityDto,
  AssignDto,
  CaptureLeadDto,
  LeadDto,
  LeadQueryDto,
  QualifyDto,
  UpdateLeadDto,
} from './dto/crm.dto.js';

@Injectable()
export class LeadsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly crm: CrmAccess,
    private readonly keys: CrmKeys,
    private readonly customers: CustomersService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  // ================================================================ new leads

  async create(companyId: string, dto: LeadDto) {
    await this.org.assertCompanyExists(companyId);
    const me = this.access.current();
    const company = { companyId };
    const assignScope = this.access.scopeFilter('crm.assign');
    const mayAssign =
      this.access.allows('crm.manage', company) ||
      assignScope.all ||
      assignScope.companyIds.includes(companyId) ||
      assignScope.departmentIds.length > 0;
    if (!me.has('crm.own') && !mayAssign)
      throw new ForbiddenException(MSG.FORBIDDEN);
    const contact = this.contactOf(dto);
    const existing = await this.keys.lockAndFind(
      companyId,
      keysOf(contact.phone, contact.email),
    );
    if (existing.length)
      throw new ConflictException({
        message: MSG.CRM_DUPLICATE,
        details: { existing: await this.describe(existing[0]) },
      });

    // the owner: someone named (Sales head / Admin), else a salesperson's own lead, else the rules
    let ownerId: string;
    if (dto.ownerId) {
      await this.assertSalesperson(companyId, dto.ownerId);
      await this.crm.assertAssign(companyId, dto.ownerId);
      ownerId = dto.ownerId;
    } else if (me.has('crm.own') && me.userId) ownerId = me.userId;
    else ownerId = (await this.pickOwner(companyId, contact.district)).ownerId;
    const lead = await this.insert(companyId, { ...dto, ...contact }, ownerId);
    return this.get(lead.id);
  }

  async capture(companyId: string, dto: CaptureLeadDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('crm.capture', { companyId });
    // the same submission sent twice
    if (dto.externalRef) {
      const same = await this.db.tx
        .selectFrom('leads')
        .select(['id', 'number'])
        .where('company_id', '=', companyId)
        .where('source', '=', dto.source)
        .where('external_ref', '=', dto.externalRef)
        .executeTakeFirst();
      if (same)
        return {
          created: false,
          repeated: true,
          leadId: same.id,
          number: same.number,
        };
    }
    const contact = this.contactOf(dto);
    const existing = await this.keys.lockAndFind(
      companyId,
      keysOf(contact.phone, contact.email),
    );
    if (existing.length) {
      // known already: the enquiry goes on the existing record
      const e = existing[0];
      const body =
        [dto.message, dto.sourceDetail && `(${dto.sourceDetail})`]
          .filter(Boolean)
          .join(' ') || null;
      await this.db.tx
        .insertInto('crm_activities')
        .values({
          company_id: companyId,
          lead_id: e.lead_id,
          customer_id: e.customer_id,
          kind: 'enquiry',
          subject: `Enquired again (${dto.source})`,
          body,
        })
        .execute();
      if (e.lead_id) {
        const lead = await this.find(e.lead_id);
        if (lead.state === 'disqualified') {
          await this.db.tx
            .updateTable('leads')
            .set({ state: 'new', disqualify_reason: null })
            .where('id', '=', lead.id)
            .execute();
          await this.outbox.add({
            type: 'lead.created',
            entityId: lead.id,
            payload: {
              leadId: lead.id,
              companyId,
              ownerId: lead.owner_id,
              source: dto.source,
              reopened: true,
            },
          });
        }
      }
      return { created: false, duplicateOf: await this.describe(e) };
    }
    const { ownerId } = await this.pickOwner(companyId, contact.district);
    const lead = await this.insert(companyId, { ...dto, ...contact }, ownerId);
    return { created: true, leadId: lead.id, number: lead.number, ownerId };
  }

  // ================================================================ work on a lead

  async list(companyId: string, query: LeadQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const scope = await this.crm.listScope(companyId);
    let q = this.db.tx
      .selectFrom('leads as l')
      .innerJoin('users as u', 'u.id', 'l.owner_id')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .selectAll('l')
      .select(['u.email as owner_email', 'e.full_name_en as owner_name'])
      .select((eb) => [
        eb
          .selectFrom('crm_activities as a')
          .select(sql<Date | null>`max(a.created_at)`.as('x'))
          .whereRef('a.lead_id', '=', 'l.id')
          .as('last_activity_at'),
      ])
      .where('l.company_id', '=', companyId);
    if (!scope.all) q = q.where('l.owner_id', 'in', scope.ownerIds);
    if (query.state === 'open')
      q = q.where('l.state', 'in', ['new', 'contacted']);
    else if (query.state) q = q.where('l.state', '=', query.state);
    if (query.ownerId) q = q.where('l.owner_id', '=', query.ownerId);
    if (query.source) q = q.where('l.source', '=', query.source);
    if (query.q) {
      const like = `%${query.q.toLowerCase()}%`;
      const phone = normalizePhone(query.q);
      q = q.where((eb) =>
        eb.or([
          eb(sql`lower(l.name)`, 'like', like),
          eb(sql`lower(coalesce(l.organisation, ''))`, 'like', like),
          eb('l.number', 'ilike', like),
          ...(phone ? [eb('l.phone', '=', phone)] : []),
          eb('l.email', 'like', like),
        ]),
      );
    }
    const rows = await q.orderBy('l.created_at', 'desc').limit(500).execute();
    return rows.map((r) => ({
      ...this.toLead(r),
      ownerName: r.owner_name ?? r.owner_email,
      lastActivityAt: r.last_activity_at,
    }));
  }

  async get(id: string) {
    const lead = await this.find(id);
    await this.crm.assertSee(lead.company_id, lead.owner_id);
    const owner = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select(['u.email', 'e.full_name_en'])
      .where('u.id', '=', lead.owner_id)
      .executeTakeFirst();
    const territory = lead.territory_id
      ? await this.db.tx
          .selectFrom('sales_territories')
          .select(['code', 'name'])
          .where('id', '=', lead.territory_id)
          .executeTakeFirst()
      : undefined;
    return {
      ...this.toLead(lead),
      ownerName: owner?.full_name_en ?? owner?.email ?? null,
      territory: territory ? `${territory.code} · ${territory.name}` : null,
      canWork: await this.crm.canWork(lead.company_id, lead.owner_id),
      activities: await this.activitiesOf({ leadId: lead.id }),
      opportunities: await opportunitiesOf(this.db, { leadId: lead.id }),
    };
  }

  async update(id: string, dto: UpdateLeadDto) {
    const lead = await this.find(id);
    await this.crm.assertWork(lead.company_id, lead.owner_id);
    if (lead.state === 'qualified')
      throw new ConflictException(MSG.LEAD_WRONG_STATE);
    const contact = this.contactOf({
      phone: dto.phone ?? lead.phone ?? undefined,
      email: dto.email ?? lead.email ?? undefined,
      district: dto.district ?? lead.district ?? undefined,
    });
    await this.rekey(
      lead.company_id,
      { phone: lead.phone, email: lead.email },
      contact,
      { leadId: lead.id },
    );
    const row = await this.db.tx
      .updateTable('leads')
      .set({
        name: dto.name ?? lead.name,
        organisation: dto.organisation ?? lead.organisation,
        phone: contact.phone,
        email: contact.email,
        district: contact.district,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'lead.updated',
      entity: 'lead',
      entityId: id,
      before: this.toLead(lead),
      after: this.toLead(row),
    });
    return this.get(id);
  }

  async assign(id: string, dto: AssignDto) {
    const lead = await this.find(id);
    await this.crm.assertAssign(lead.company_id, lead.owner_id);
    await this.assertSalesperson(lead.company_id, dto.ownerId);
    await this.crm.assertAssign(lead.company_id, dto.ownerId);
    if (lead.owner_id === dto.ownerId) return this.get(id);
    await this.db.tx
      .updateTable('leads')
      .set({ owner_id: dto.ownerId })
      .where('id', '=', id)
      .execute();
    await this.db.tx
      .insertInto('crm_activities')
      .values({
        company_id: lead.company_id,
        lead_id: id,
        kind: 'system',
        subject: 'Handed to another salesperson',
        body: dto.note ?? null,
      })
      .execute();
    await this.audit.record({
      action: 'lead.assigned',
      entity: 'lead',
      entityId: id,
      before: { ownerId: lead.owner_id },
      after: { ownerId: dto.ownerId, note: dto.note },
    });
    await this.outbox.add({
      type: 'lead.assigned',
      entityId: id,
      payload: { leadId: id, companyId: lead.company_id, ownerId: dto.ownerId },
    });
    return this.get(id);
  }

  async disqualify(id: string, reason: string) {
    const lead = await this.find(id);
    await this.crm.assertWork(lead.company_id, lead.owner_id);
    if (!['new', 'contacted'].includes(lead.state))
      throw new ConflictException(MSG.LEAD_WRONG_STATE);
    await this.db.tx
      .updateTable('leads')
      .set({ state: 'disqualified', disqualify_reason: reason })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'lead.disqualified',
      entity: 'lead',
      entityId: id,
      after: { reason },
    });
    return this.get(id);
  }

  /** The lead becomes a customer: a new one from the lead, or one that exists. */
  async qualify(id: string, dto: QualifyDto) {
    const lead = await this.find(id);
    await this.crm.assertWork(lead.company_id, lead.owner_id);
    if (!['new', 'contacted'].includes(lead.state))
      throw new ConflictException(MSG.LEAD_WRONG_STATE);
    if (!!dto.customerId === !!dto.customer)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['Give either customerId or customer'] },
      });
    let customerId: string;
    if (dto.customerId) {
      const c = await this.customers.find(dto.customerId);
      if (c.company_id !== lead.company_id)
        throw new NotFoundException(MSG.CUSTOMER_NOT_FOUND);
      await this.crm.assertSee(c.company_id, c.account_manager_id, {
        customer: true,
      });
      customerId = c.id;
      // the lead's phone / e-mail go with it, as a contact of the customer
      await this.keys.moveToCustomer(lead.id, customerId);
      if (lead.phone || lead.email) {
        const contact = await this.db.tx
          .insertInto('customer_contacts')
          .values({
            customer_id: customerId,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.db.tx
          .updateTable('crm_contact_keys')
          .set({ contact_id: contact.id })
          .where('customer_id', '=', customerId)
          .where((eb) =>
            eb.or([
              eb.and([
                eb('kind', '=', 'phone'),
                eb('value', '=', lead.phone ?? ''),
              ]),
              eb.and([
                eb('kind', '=', 'email'),
                eb('value', '=', lead.email ?? ''),
              ]),
            ]),
          )
          .execute();
      }
    } else {
      // a new customer: the lead's phone / e-mail move to it
      customerId = await this.customers.createFromLead(lead, dto.customer!);
    }
    await this.db.tx
      .updateTable('leads')
      .set({ state: 'qualified', customer_id: customerId })
      .where('id', '=', id)
      .execute();
    // WP24: and an opportunity at once, if the owner gives one
    const opportunityId = dto.opportunity
      ? await this.opportunities.createFromLead(
          lead,
          customerId,
          dto.opportunity,
        )
      : null;
    await this.audit.record({
      action: 'lead.qualified',
      entity: 'lead',
      entityId: id,
      after: { customerId, newCustomer: !dto.customerId, opportunityId },
    });
    return this.get(id);
  }

  // ================================================================ activities

  async addActivity(
    target: { leadId?: string; customerId?: string },
    dto: ActivityDto,
  ) {
    const { companyId, ownerId, lead } = await this.targetOf(target);
    await this.crm.assertWork(companyId, ownerId);
    const me = this.access.current();
    if (dto.kind === 'task' && dto.ownerId)
      await this.assertSalesperson(companyId, dto.ownerId);
    const row = await this.db.tx
      .insertInto('crm_activities')
      .values({
        company_id: companyId,
        lead_id: target.leadId ?? null,
        customer_id: target.customerId ?? lead?.customer_id ?? null,
        kind: dto.kind,
        subject: dto.subject,
        body: dto.body ?? null,
        due_at:
          dto.kind === 'task' && dto.dueOn
            ? new Date(`${businessDate(dto.dueOn)}T17:00:00+06:00`)
            : null,
        owner_id:
          dto.kind === 'task'
            ? (dto.ownerId ?? me.userId ?? null)
            : (me.userId ?? null),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    // the first real contact with a new lead
    if (
      lead &&
      lead.state === 'new' &&
      ['call', 'meeting', 'email', 'sms'].includes(dto.kind)
    ) {
      await this.db.tx
        .updateTable('leads')
        .set({ state: 'contacted' })
        .where('id', '=', lead.id)
        .execute();
    }
    return toActivity(row);
  }

  async completeTask(activityId: string) {
    const a = await this.db.tx
      .selectFrom('crm_activities')
      .selectAll()
      .where('id', '=', activityId)
      .executeTakeFirst();
    if (!a || a.kind !== 'task')
      throw new NotFoundException(MSG.ACTIVITY_NOT_FOUND);
    const { companyId, ownerId } = await this.targetOf({
      leadId: a.lead_id ?? undefined,
      customerId: a.lead_id ? undefined : (a.customer_id ?? undefined),
    });
    if (a.owner_id !== this.access.current().userId)
      await this.crm.assertWork(companyId, ownerId);
    if (!a.done_at)
      await this.db.tx
        .updateTable('crm_activities')
        .set({ done_at: this.clock.now() })
        .where('id', '=', activityId)
        .execute();
    return toActivity({ ...a, done_at: a.done_at ?? this.clock.now() });
  }

  /** My open tasks (and, for a Sales head, the team's): what is due today or late first. */
  async myTasks(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const me = this.access.current();
    const rows = await this.db.tx
      .selectFrom('crm_activities as a')
      .leftJoin('leads as l', 'l.id', 'a.lead_id')
      .leftJoin('customers as c', 'c.id', 'a.customer_id')
      .selectAll('a')
      .select([
        'l.number as lead_number',
        'l.name as lead_name',
        'c.code as customer_code',
        'c.name as customer_name',
      ])
      .where('a.company_id', '=', companyId)
      .where('a.kind', '=', 'task')
      .where('a.done_at', 'is', null)
      .where(
        'a.owner_id',
        '=',
        me.userId ?? '00000000-0000-0000-0000-000000000000',
      )
      .orderBy('a.due_at')
      .limit(200)
      .execute();
    return rows.map((r) => ({
      ...toActivity(r),
      lead: r.lead_number ? `${r.lead_number} · ${r.lead_name}` : null,
      customer: r.customer_code
        ? `${r.customer_code} · ${r.customer_name}`
        : null,
    }));
  }

  activitiesOf(target: {
    leadId?: string;
    customerId?: string;
    leadIds?: string[];
  }) {
    return activitiesOf(this.db, target);
  }

  // ================================================================ internals

  /** Territory of the district -> its members in turn; else all Sales users in turn; else an Admin. */
  async pickOwner(
    companyId: string,
    district: string | null,
  ): Promise<{ ownerId: string; territoryId: string | null }> {
    const territories = await this.db.tx
      .selectFrom('sales_territories')
      .select(['id', 'districts'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .orderBy('code')
      .execute();
    const territory = district
      ? territories.find((t) => t.districts.includes(district))
      : undefined;
    const active = await this.salespeople(companyId);
    if (territory) {
      const members = (
        await this.db.tx
          .selectFrom('sales_territory_members')
          .select('user_id')
          .where('territory_id', '=', territory.id)
          .execute()
      )
        .map((m) => m.user_id)
        .filter((u) => active.includes(u));
      const owner = await this.inTurn(companyId, territory.id, members);
      if (owner) return { ownerId: owner, territoryId: territory.id };
    }
    const owner = await this.inTurn(companyId, 'company', active);
    if (owner) return { ownerId: owner, territoryId: territory?.id ?? null };
    const admins = (
      await this.access.usersWithSystemRole('admin', { companyId })
    ).sort();
    if (!admins.length) throw new BadRequestException(MSG.CRM_NO_SALESPERSON);
    return { ownerId: admins[0], territoryId: territory?.id ?? null };
  }

  /** The company's active Sales users (role "sales", employee of the company). */
  salespeople(companyId: string): Promise<string[]> {
    return this.crm.salespeople(companyId);
  }

  private async inTurn(
    companyId: string,
    pool: string,
    users: string[],
  ): Promise<string | null> {
    if (!users.length) return null;
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-turn:${companyId}:${pool}`}, 0))`.execute(
      this.db.tx,
    );
    const cursor = await this.db.tx
      .selectFrom('crm_assignment_cursors')
      .select('last_user_id')
      .where('company_id', '=', companyId)
      .where('pool', '=', pool)
      .executeTakeFirst();
    const next = nextInTurn(users, cursor?.last_user_id)!;
    await this.db.tx
      .insertInto('crm_assignment_cursors')
      .values({ company_id: companyId, pool, last_user_id: next })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'pool'])
          .doUpdateSet({ last_user_id: next, updated_at: this.clock.now() }),
      )
      .execute();
    return next;
  }

  private assertSalesperson(companyId: string, userId: string) {
    return this.crm.assertSalesperson(companyId, userId);
  }

  private async insert(
    companyId: string,
    dto: Omit<LeadDto | CaptureLeadDto, 'phone' | 'email' | 'district'> & {
      phone: string | null;
      email: string | null;
      district: string | null;
    },
    ownerId: string,
  ) {
    const { territoryId } = dto.district
      ? await this.territoryOf(companyId, dto.district)
      : { territoryId: null };
    const lead = await this.db.tx
      .insertInto('leads')
      .values({
        company_id: companyId,
        number: await this.nextNumber(companyId),
        name: dto.name,
        organisation: dto.organisation ?? null,
        phone: dto.phone,
        email: dto.email,
        district: dto.district,
        source: dto.source as LeadSource,
        source_detail: dto.sourceDetail ?? null,
        message: dto.message ?? null,
        external_ref:
          'externalRef' in dto && typeof dto.externalRef === 'string'
            ? dto.externalRef
            : null,
        owner_id: ownerId,
        territory_id: territoryId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.keys.claim(companyId, keysOf(lead.phone, lead.email), {
      leadId: lead.id,
    });
    await this.audit.record({
      action: 'lead.created',
      entity: 'lead',
      entityId: lead.id,
      after: { number: lead.number, source: lead.source, ownerId },
    });
    await this.outbox.add({
      type: 'lead.created',
      entityId: lead.id,
      payload: {
        leadId: lead.id,
        companyId,
        ownerId,
        source: lead.source,
        createdBy: this.access.current().userId ?? null,
      },
    });
    return lead;
  }

  private async territoryOf(companyId: string, district: string) {
    const t = await this.db.tx
      .selectFrom('sales_territories')
      .select('id')
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .where(sql<boolean>`${district} = ANY(districts)`)
      .orderBy('code')
      .executeTakeFirst();
    return { territoryId: t?.id ?? null };
  }

  /** Phone / e-mail normalised (at least one must be good); the district from the list. */
  private contactOf(dto: {
    phone?: string;
    email?: string;
    district?: string;
  }) {
    const phone = normalizePhone(dto.phone);
    const email = normalizeEmail(dto.email);
    if (dto.phone && !phone)
      throw new BadRequestException({
        message: MSG.CRM_CONTACT_INVALID,
        details: { problems: [`Not a Bangladesh phone number: ${dto.phone}`] },
      });
    if (dto.email && !email)
      throw new BadRequestException({
        message: MSG.CRM_CONTACT_INVALID,
        details: { problems: [`Not an e-mail address: ${dto.email}`] },
      });
    if (!phone && !email)
      throw new BadRequestException(MSG.CRM_CONTACT_INVALID);
    const district = dto.district ? districtOf(dto.district) : null;
    if (dto.district && !district)
      throw new BadRequestException({
        message: MSG.CRM_CONTACT_INVALID,
        details: {
          problems: [`Not a district of Bangladesh: ${dto.district}`],
        },
      });
    return { phone, email, district };
  }

  /** A changed phone / e-mail: the new one is checked and claimed, the old one released. */
  private async rekey(
    companyId: string,
    before: { phone: string | null; email: string | null },
    after: { phone: string | null; email: string | null },
    owner: { leadId?: string; customerId?: string; contactId?: string },
  ) {
    const changed = keysOf(after.phone, after.email).filter(
      (k) => (k.kind === 'phone' ? before.phone : before.email) !== k.value,
    );
    await this.keys.claim(companyId, changed, owner);
    for (const k of keysOf(before.phone, before.email)) {
      if ((k.kind === 'phone' ? after.phone : after.email) !== k.value)
        await this.keys.release(companyId, k);
    }
  }

  private async describe(k: {
    lead_id: string | null;
    customer_id: string | null;
  }) {
    if (k.lead_id) {
      const l = await this.find(k.lead_id);
      const visible = await this.crm
        .canSee(l.company_id, l.owner_id)
        .catch(() => false);
      return {
        type: 'lead' as const,
        id: l.id,
        number: l.number,
        ...(visible ? { name: l.name, state: l.state } : {}),
      };
    }
    const c = await this.customers.find(k.customer_id!);
    const visible = await this.crm
      .canSee(c.company_id, c.account_manager_id, { customer: true })
      .catch(() => false);
    return {
      type: 'customer' as const,
      id: c.id,
      code: c.code,
      ...(visible ? { name: c.name } : {}),
    };
  }

  private async targetOf(t: { leadId?: string; customerId?: string }) {
    if (t.leadId) {
      const lead = await this.find(t.leadId);
      return { companyId: lead.company_id, ownerId: lead.owner_id, lead };
    }
    const c = await this.customers.find(t.customerId!);
    return {
      companyId: c.company_id,
      ownerId: c.account_manager_id,
      lead: null,
    };
  }

  private async nextNumber(companyId: string): Promise<string> {
    const fy = fiscalYearOf(todayInDhaka(this.clock.now()), '07-01');
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'lead',
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
    return `L/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  async find(id: string): Promise<Lead> {
    const lead = await this.db.tx
      .selectFrom('leads')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!lead) throw new NotFoundException(MSG.LEAD_NOT_FOUND);
    return lead;
  }

  private toLead(l: Lead) {
    return {
      id: l.id,
      companyId: l.company_id,
      number: l.number,
      name: l.name,
      organisation: l.organisation,
      phone: l.phone,
      email: l.email,
      district: l.district,
      source: l.source,
      sourceDetail: l.source_detail,
      message: l.message,
      ownerId: l.owner_id,
      territoryId: l.territory_id,
      state: l.state,
      disqualifyReason: l.disqualify_reason,
      customerId: l.customer_id,
      createdAt: l.created_at,
      version: l.version,
    };
  }
}
