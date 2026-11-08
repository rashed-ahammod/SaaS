/**
 * Customers (Phase 3 WP23; spec §6.8 "Customer 360", §10 migration "customers").
 *
 *   list / get        within the viewer's scope (own as account manager; the Sales head's
 *                     department; the company for Admin and Accounts); a customer shows its
 *                     contacts, the leads that became it, every activity and (for sales)
 *                     its opportunities
 *   create            a salesperson's own customer (or the Sales head / Admin for someone);
 *                     its phone / e-mail cannot belong to another lead or customer
 *   createFromLead    on qualification: the lead's phone / e-mail move to the customer
 *   update            details; a changed phone / e-mail is checked again
 *   credit            the credit limit and payment terms: Accounts only (spec §6.8 step 4)
 *   contacts          the people to deal with; one primary
 *   assign            to another account manager (Sales head / Admin)
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Customer, Lead } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { activitiesOf } from './crm-activities.js';
import { CrmAccess } from './crm-access.js';
import { CrmKeys, keysOf } from './crm-keys.js';
import { districtOf, normalizeEmail, normalizePhone } from './crm-rules.js';
import { opportunitiesOf } from './opportunity-brief.js';
import type {
  AssignDto,
  ContactDto,
  CreditDto,
  CustomerDto,
  CustomerFieldsDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/crm.dto.js';

const normalBin = (bin?: string) =>
  bin ? (bin.includes('-') ? bin : `${bin.slice(0, 9)}-${bin.slice(9)}`) : null;

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly crm: CrmAccess,
    private readonly keys: CrmKeys,
  ) {}

  async list(companyId: string, query: CustomerQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const scope = await this.crm.listScope(companyId, { customer: true });
    let q = this.db.tx
      .selectFrom('customers as c')
      .leftJoin('users as u', 'u.id', 'c.account_manager_id')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .selectAll('c')
      .select(['e.full_name_en as manager_name'])
      .where('c.company_id', '=', companyId);
    if (!scope.all) q = q.where('c.account_manager_id', 'in', scope.ownerIds);
    if (query.type) q = q.where('c.customer_type', '=', query.type);
    if (query.managerId)
      q = q.where('c.account_manager_id', '=', query.managerId);
    if (query.q) {
      const like = `%${query.q.toLowerCase()}%`;
      const phone = normalizePhone(query.q);
      q = q.where((eb) =>
        eb.or([
          eb(sql`lower(c.name)`, 'like', like),
          eb('c.code', 'ilike', like),
          eb('c.bin', 'like', like),
          ...(phone ? [eb('c.phone', '=', phone)] : []),
          eb('c.email', 'like', like),
        ]),
      );
    }
    const rows = await q.orderBy('c.name').limit(1000).execute();
    return rows.map((c) => ({
      ...this.toCustomer(c),
      managerName: c.manager_name,
    }));
  }

  async get(id: string) {
    const c = await this.find(id);
    await this.crm.assertSee(c.company_id, c.account_manager_id, {
      customer: true,
    });
    const contacts = await this.db.tx
      .selectFrom('customer_contacts')
      .selectAll()
      .where('customer_id', '=', id)
      .where('is_active', '=', true)
      .orderBy('is_primary', 'desc')
      .orderBy('name')
      .execute();
    const leads = await this.db.tx
      .selectFrom('leads')
      .select(['id', 'number', 'source', 'created_at'])
      .where('customer_id', '=', id)
      .orderBy('created_at')
      .execute();
    const manager = c.account_manager_id
      ? await this.db.tx
          .selectFrom('users as u')
          .leftJoin('employees as e', 'e.id', 'u.employee_id')
          .select(['u.email', 'e.full_name_en'])
          .where('u.id', '=', c.account_manager_id)
          .executeTakeFirst()
      : undefined;
    const sales =
      this.access.current().has('crm.own') ||
      this.access.current().has('crm.view') ||
      this.access.current().has('crm.manage');
    return {
      ...this.toCustomer(c),
      managerName: manager?.full_name_en ?? manager?.email ?? null,
      canWork: await this.crm.canWork(c.company_id, c.account_manager_id),
      canSetCredit: this.access.allows('crm.credit', {
        companyId: c.company_id,
      }),
      contacts: contacts.map((x) => ({
        id: x.id,
        name: x.name,
        designation: x.designation,
        phone: x.phone,
        email: x.email,
        isPrimary: x.is_primary,
      })),
      leads: leads.map((l) => ({
        id: l.id,
        number: l.number,
        source: l.source,
        createdAt: l.created_at,
      })),
      // Accounts reads the customer for credit, not the sales conversations
      activities: sales
        ? await activitiesOf(this.db, {
            customerId: id,
            leadIds: leads.map((l) => l.id),
          })
        : [],
      opportunities: sales
        ? await opportunitiesOf(this.db, { customerId: id })
        : [],
    };
  }

  async create(companyId: string, dto: CustomerDto) {
    await this.org.assertCompanyExists(companyId);
    const me = this.access.current();
    const managerId =
      dto.accountManagerId ?? (me.has('crm.own') ? me.userId! : null);
    if (dto.accountManagerId)
      await this.crm.assertAssign(companyId, dto.accountManagerId);
    else if (
      !me.has('crm.own') &&
      !this.access.allows('crm.manage', { companyId })
    )
      await this.crm.assertWork(companyId, null);
    const c = await this.insert(companyId, dto, managerId, null);
    return this.get(c.id);
  }

  /** On qualification (LeadsService): the lead's phone / e-mail move to the new customer. */
  async createFromLead(lead: Lead, dto: CustomerFieldsDto): Promise<string> {
    const managerId = dto.accountManagerId ?? lead.owner_id;
    if (dto.accountManagerId && dto.accountManagerId !== lead.owner_id)
      await this.crm.assertAssign(lead.company_id, dto.accountManagerId);
    const c = await this.insert(
      lead.company_id,
      {
        ...dto,
        phone: dto.phone ?? lead.phone ?? undefined,
        email: dto.email ?? lead.email ?? undefined,
        district: dto.district ?? lead.district ?? undefined,
      },
      managerId,
      lead,
    );
    return c.id;
  }

  /** The migration tool (data import): a customer from the old system, with the credit terms Accounts agreed. */
  async importCustomer(
    companyId: string,
    row: CustomerFieldsDto & { creditLimit: string; paymentTermsDays: number },
  ): Promise<string> {
    const c = await this.insert(
      companyId,
      row,
      row.accountManagerId ?? null,
      null,
    );
    if (Money.of(row.creditLimit).isPositive() || row.paymentTermsDays > 0) {
      await this.db.tx
        .updateTable('customers')
        .set({
          credit_limit: Money.of(row.creditLimit).toDb(),
          payment_terms_days: row.paymentTermsDays,
        })
        .where('id', '=', c.id)
        .execute();
    }
    return c.id;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const c = await this.find(id);
    await this.crm.assertWork(c.company_id, c.account_manager_id);
    const contact = this.contactOf(
      {
        phone: dto.phone ?? c.phone ?? undefined,
        email: dto.email ?? c.email ?? undefined,
        district: dto.district ?? c.district ?? undefined,
      },
      false,
    );
    const changed = keysOf(contact.phone, contact.email).filter(
      (k) => (k.kind === 'phone' ? c.phone : c.email) !== k.value,
    );
    await this.keys.claim(c.company_id, changed, { customerId: id });
    for (const k of keysOf(c.phone, c.email))
      if ((k.kind === 'phone' ? contact.phone : contact.email) !== k.value)
        await this.keys.release(c.company_id, k);
    const row = await this.db.tx
      .updateTable('customers')
      .set({
        name: dto.name ?? c.name,
        name_bn: dto.nameBn ?? c.name_bn,
        customer_type: dto.customerType ?? c.customer_type,
        bin: dto.bin ? normalBin(dto.bin) : c.bin,
        tin: dto.tin ?? c.tin,
        phone: contact.phone,
        email: contact.email,
        address: dto.address ?? c.address,
        district: contact.district,
        is_active: dto.isActive ?? c.is_active,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'customer.updated',
      entity: 'customer',
      entityId: id,
      before: this.toCustomer(c),
      after: this.toCustomer(row),
    });
    return this.get(id);
  }

  async credit(id: string, dto: CreditDto) {
    const c = await this.find(id);
    this.access.assert('crm.credit', { companyId: c.company_id });
    const row = await this.db.tx
      .updateTable('customers')
      .set({
        credit_limit: Money.of(dto.creditLimit).toDb(),
        payment_terms_days: dto.paymentTermsDays,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'customer.credit_set',
      entity: 'customer',
      entityId: id,
      before: {
        creditLimit: c.credit_limit,
        paymentTermsDays: c.payment_terms_days,
      },
      after: {
        creditLimit: row.credit_limit,
        paymentTermsDays: row.payment_terms_days,
      },
    });
    return this.get(id);
  }

  async assign(id: string, dto: AssignDto) {
    const c = await this.find(id);
    await this.crm.assertAssign(c.company_id, c.account_manager_id);
    await this.crm.assertAssign(c.company_id, dto.ownerId);
    await this.db.tx
      .updateTable('customers')
      .set({ account_manager_id: dto.ownerId })
      .where('id', '=', id)
      .execute();
    await this.db.tx
      .insertInto('crm_activities')
      .values({
        company_id: c.company_id,
        customer_id: id,
        kind: 'system',
        subject: 'Handed to another account manager',
        body: dto.note ?? null,
      })
      .execute();
    await this.audit.record({
      action: 'customer.assigned',
      entity: 'customer',
      entityId: id,
      before: { accountManagerId: c.account_manager_id },
      after: { accountManagerId: dto.ownerId, note: dto.note },
    });
    return this.get(id);
  }

  async addContact(id: string, dto: ContactDto) {
    const c = await this.find(id);
    await this.crm.assertWork(c.company_id, c.account_manager_id);
    const phone = normalizePhone(dto.phone);
    const email = normalizeEmail(dto.email);
    if ((dto.phone && !phone) || (dto.email && !email))
      throw new BadRequestException(MSG.CRM_CONTACT_INVALID);
    if (dto.isPrimary)
      await this.db.tx
        .updateTable('customer_contacts')
        .set({ is_primary: false })
        .where('customer_id', '=', id)
        .execute();
    const contact = await this.db.tx
      .insertInto('customer_contacts')
      .values({
        customer_id: id,
        name: dto.name,
        designation: dto.designation ?? null,
        phone,
        email,
        is_primary: dto.isPrimary ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.keys.claim(c.company_id, keysOf(phone, email), {
      customerId: id,
      contactId: contact.id,
    });
    await this.audit.record({
      action: 'customer.contact_added',
      entity: 'customer',
      entityId: id,
      after: { name: dto.name, phone, email },
    });
    return this.get(id);
  }

  async find(id: string): Promise<Customer> {
    const c = await this.db.tx
      .selectFrom('customers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!c) throw new NotFoundException(MSG.CUSTOMER_NOT_FOUND);
    return c;
  }

  // ================================================================ internals

  private async insert(
    companyId: string,
    dto: CustomerFieldsDto,
    managerId: string | null,
    lead: Lead | null,
  ) {
    const contact = this.contactOf(dto, false);
    const territory = contact.district
      ? await this.db.tx
          .selectFrom('sales_territories')
          .select('id')
          .where('company_id', '=', companyId)
          .where('is_active', '=', true)
          .where(sql<boolean>`${contact.district} = ANY(districts)`)
          .orderBy('code')
          .executeTakeFirst()
      : undefined;
    const c = await this.db.tx
      .insertInto('customers')
      .values({
        company_id: companyId,
        code: await this.nextCode(companyId),
        kind: dto.kind,
        name: dto.name,
        name_bn: dto.nameBn ?? null,
        customer_type: dto.customerType ?? 'retail',
        bin: normalBin(dto.bin),
        tin: dto.tin ?? null,
        phone: contact.phone,
        email: contact.email,
        address: dto.address ?? null,
        district: contact.district,
        territory_id: territory?.id ?? null,
        account_manager_id: managerId,
        from_lead_id: lead?.id ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    // the lead's keys move over; anything new is checked
    if (lead) await this.keys.moveToCustomer(lead.id, c.id);
    const own = keysOf(c.phone, c.email).filter(
      (k) =>
        !lead || (k.kind === 'phone' ? lead.phone : lead.email) !== k.value,
    );
    await this.keys.claim(companyId, own, { customerId: c.id });
    await this.audit.record({
      action: 'customer.created',
      entity: 'customer',
      entityId: c.id,
      after: {
        code: c.code,
        name: c.name,
        fromLead: lead?.number ?? null,
        accountManagerId: managerId,
      },
    });
    return c;
  }

  private contactOf(
    dto: { phone?: string; email?: string; district?: string },
    required: boolean,
  ) {
    const phone = normalizePhone(dto.phone);
    const email = normalizeEmail(dto.email);
    if (
      (dto.phone && !phone) ||
      (dto.email && !email) ||
      (required && !phone && !email)
    )
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

  private async nextCode(companyId: string): Promise<string> {
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'customer_code',
        fiscal_year_code: 'ALL',
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'kind', 'fiscal_year_code'])
          .doUpdateSet({ last_no: sql`payables_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return `C-${String(row.last_no).padStart(5, '0')}`;
  }

  private toCustomer(c: Customer) {
    return {
      id: c.id,
      companyId: c.company_id,
      code: c.code,
      kind: c.kind,
      name: c.name,
      nameBn: c.name_bn,
      customerType: c.customer_type,
      bin: c.bin,
      tin: c.tin,
      phone: c.phone,
      email: c.email,
      address: c.address,
      district: c.district,
      territoryId: c.territory_id,
      accountManagerId: c.account_manager_id,
      paymentTermsDays: c.payment_terms_days,
      creditLimit: c.credit_limit,
      fromLeadId: c.from_lead_id,
      isActive: c.is_active,
      version: c.version,
    };
  }
}
