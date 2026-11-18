/**
 * Customer 360 (WP28; spec §6.8: "contacts, activities, opportunities, quotes, orders,
 * invoices, dues and tickets on one screen").
 *
 * One read, assembled from the modules that own each part. The acceptance criterion is that
 * it "shows only what the viewer may see", so every block is gated on its own permission and
 * a block the viewer may not see is absent (not empty, not masked):
 *
 *   header, contacts         the customer: CRM scope, or Accounts (crm.credit), or support
 *   activities, opportunities  CRM scope only
 *   quotations, orders, invoices, dues   CRM scope or receivables.view (Accounts)
 *   tickets                  support.view / support.manage / support.own on this customer
 *
 * The page refuses to open at all if the viewer may see none of it.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Clock } from '../../platform/clock.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { CrmAccess } from '../crm/crm-access.js';
import { CustomersService } from '../crm/customers.service.js';
import { SupportAccess } from './support-access.js';
import { TicketsService } from './tickets.service.js';

@Injectable()
export class Customer360Service {
  constructor(
    private readonly db: DatabaseService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly crm: CrmAccess,
    private readonly support: SupportAccess,
    private readonly customers: CustomersService,
    private readonly tickets: TicketsService,
  ) {}

  async get(customerId: string) {
    const customer = await this.customers.find(customerId);
    const companyId = customer.company_id;

    const crmSees = await this.crm.canSee(
      companyId,
      customer.account_manager_id,
      { customer: true },
    );
    const money =
      crmSees || this.access.allows('receivables.view', { companyId });
    const supportSees = await this.support.canSee(companyId, {
      assignee_id: null,
      customer_id: customer.id,
    });
    if (!crmSees && !money && !supportSees)
      throw new ForbiddenException(MSG.FORBIDDEN);

    const result: Record<string, unknown> = {
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        nameBn: customer.name_bn,
        kind: customer.kind,
        customerType: customer.customer_type,
        phone: customer.phone,
        email: customer.email,
        district: customer.district,
        address: customer.address,
        accountManagerId: customer.account_manager_id,
        isActive: customer.is_active,
      },
      sees: {
        crm: crmSees,
        money,
        support: supportSees,
      },
    };

    result.contacts = (
      await this.db.tx
        .selectFrom('customer_contacts')
        .select(['id', 'name', 'designation', 'phone', 'email', 'is_primary'])
        .where('customer_id', '=', customerId)
        .where('is_active', '=', true)
        .orderBy('is_primary', 'desc')
        .execute()
    ).map((c) => ({
      id: c.id,
      name: c.name,
      designation: c.designation,
      phone: c.phone,
      email: c.email,
      isPrimary: c.is_primary,
    }));

    if (crmSees) {
      result.activities = (
        await this.db.tx
          .selectFrom('crm_activities')
          .select(['id', 'kind', 'subject', 'due_at', 'done_at', 'created_at'])
          .where('customer_id', '=', customerId)
          .orderBy('created_at', 'desc')
          .limit(20)
          .execute()
      ).map((a) => ({
        id: a.id,
        kind: a.kind,
        subject: a.subject,
        dueAt: a.due_at,
        doneAt: a.done_at,
        at: a.created_at,
      }));

      result.opportunities = (
        await this.db.tx
          .selectFrom('opportunities as o')
          .leftJoin('opportunity_stages as s', 's.id', 'o.stage_id')
          .select([
            'o.id',
            'o.number',
            'o.title',
            'o.value',
            'o.probability',
            'o.state',
            'o.expected_close_on',
            's.name as stage_name',
          ])
          .where('o.customer_id', '=', customerId)
          .orderBy('o.created_at', 'desc')
          .limit(20)
          .execute()
      ).map((o) => ({
        id: o.id,
        number: o.number,
        title: o.title,
        value: o.value,
        probability: o.probability,
        state: o.state,
        stageName: o.stage_name,
        expectedCloseOn: o.expected_close_on,
      }));
    }

    if (money) {
      result.quotations = (
        await this.db.tx
          .selectFrom('sales_quotations')
          .select([
            'id',
            'number',
            'revision',
            'quote_date',
            'valid_until',
            'state',
            'total',
          ])
          .where('customer_id', '=', customerId)
          .orderBy('created_at', 'desc')
          .limit(20)
          .execute()
      ).map((q) => ({
        id: q.id,
        number: q.number,
        revision: q.revision,
        quoteDate: q.quote_date,
        validUntil: q.valid_until,
        state: q.state,
        total: q.total,
      }));

      result.orders = (
        await this.db.tx
          .selectFrom('sales_orders')
          .select(['id', 'number', 'order_date', 'state', 'total'])
          .where('customer_id', '=', customerId)
          .orderBy('created_at', 'desc')
          .limit(20)
          .execute()
      ).map((o) => ({
        id: o.id,
        number: o.number,
        orderDate: o.order_date,
        state: o.state,
        total: o.total,
      }));

      result.invoices = (
        await this.db.tx
          .selectFrom('sales_invoices')
          .select([
            'id',
            'invoice_no',
            'invoice_date',
            'due_date',
            'total',
            'voucher_id',
          ])
          .where('customer_id', '=', customerId)
          .orderBy('invoice_date', 'desc')
          .limit(20)
          .execute()
      ).map((i) => ({
        id: i.id,
        invoiceNo: i.invoice_no,
        invoiceDate: i.invoice_date,
        dueDate: i.due_date,
        total: i.total,
        posted: !!i.voucher_id,
      }));

      const open = await this.db.tx
        .selectFrom('receivable_items')
        .select(['id', 'reference', 'due_date', 'amount', 'received', 'credited'])
        .where('customer_id', '=', customerId)
        .where(sql<boolean>`received + credited < amount`)
        .orderBy('due_date')
        .execute();
      const today = todayInDhaka(this.clock.now());
      result.dues = {
        creditLimit: customer.credit_limit,
        paymentTermsDays: customer.payment_terms_days,
        owed: Money.sum(
          open.map((i) =>
            Money.of(i.amount).minus(i.received).minus(i.credited),
          ),
        ).toString(),
        overdue: Money.sum(
          open
            .filter((i) => i.due_date < today)
            .map((i) =>
              Money.of(i.amount).minus(i.received).minus(i.credited),
            ),
        ).toString(),
        items: open.map((i) => ({
          id: i.id,
          reference: i.reference,
          dueDate: i.due_date,
          outstanding: Money.of(i.amount)
            .minus(i.received)
            .minus(i.credited)
            .toString(),
          overdue: i.due_date < today,
        })),
      };
    }

    if (supportSees) result.tickets = await this.tickets.ofCustomer(customerId);

    return result;
  }
}
