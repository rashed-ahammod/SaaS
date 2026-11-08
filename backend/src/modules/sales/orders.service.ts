/**
 * Sales orders (Phase 3 WP26; spec §6.8 step 5 "order -> credit limit check (over limit needs
 * Accounts approval) -> delivery").
 *
 *   fromQuotation   an accepted quotation becomes the order, line for line. The credit check:
 *                   what the customer owes (open invoices) + open orders + this order against
 *                   the credit limit set by Accounts. Over it: the order waits for Accounts
 *                   (request "sales_order_credit"); within it: confirmed at once
 *   deliver         confirmed -> delivered, with the delivery challan number; goods kept in a
 *                   store leave the store named (stock_moves "sales_issue"; never below zero)
 *   cancel          in approval or confirmed (not once delivered)
 *   invoicing       InvoicesService (Accounts) turns a delivered order into the invoice
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  SalesOrder,
  SalesQuotation,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Decimal } from 'decimal.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { CrmAccess } from '../crm/crm-access.js';
import { CustomersService } from '../crm/customers.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { vatYearOf } from '../vat/vat.service.js';
import type {
  CancelOrderDto,
  DeliverDto,
  OrderQueryDto,
} from './dto/sales.dto.js';
import { creditCheck } from './sales-rules.js';

export const SALES_ORDER_CREDIT_REQUEST = 'sales_order_credit';

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly crm: CrmAccess,
    private readonly customers: CustomersService,
  ) {}

  onModuleInit() {
    this.handlers.register(
      SALES_ORDER_CREDIT_REQUEST,
      {
        onApproved: (r) => this.creditApproved(r),
        onClosed: (r, outcome) => this.creditClosed(r, outcome),
      },
      [
        defaultChain(
          'Order over the credit limit (default)',
          step(1, 'role:accounts'),
        ),
      ],
    );
  }

  async list(companyId: string, query: OrderQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const scope = await this.scope(companyId);
    let q = this.db.tx
      .selectFrom('sales_orders as o')
      .innerJoin('customers as c', 'c.id', 'o.customer_id')
      .leftJoin('sales_invoices as i', 'i.order_id', 'o.id')
      .selectAll('o')
      .select([
        'c.code as customer_code',
        'c.name as customer_name',
        'i.id as invoice_id',
        'i.invoice_no',
      ])
      .where('o.company_id', '=', companyId);
    if (!scope.all) q = q.where('o.owner_id', 'in', scope.ownerIds);
    if (query.state)
      q = q.where('o.state', '=', query.state as SalesOrder['state']);
    if (query.customerId) q = q.where('o.customer_id', '=', query.customerId);
    const rows = await q.orderBy('o.created_at', 'desc').limit(500).execute();
    return rows.map((r) => ({
      ...this.toOrder(r),
      customer: `${r.customer_code} · ${r.customer_name}`,
      invoice: r.invoice_id
        ? { id: r.invoice_id, invoiceNo: r.invoice_no }
        : null,
    }));
  }

  async get(id: string) {
    const o = await this.find(id);
    await this.assertSee(o);
    const lines = await this.db.tx
      .selectFrom('sales_order_lines')
      .selectAll()
      .where('order_id', '=', id)
      .orderBy('line_no')
      .execute();
    const customer = await this.customers.find(o.customer_id);
    const quotation = o.quotation_id
      ? await this.db.tx
          .selectFrom('sales_quotations')
          .select(['id', 'number', 'revision'])
          .where('id', '=', o.quotation_id)
          .executeTakeFirst()
      : undefined;
    const invoice = await this.db.tx
      .selectFrom('sales_invoices')
      .select(['id', 'invoice_no'])
      .where('order_id', '=', id)
      .executeTakeFirst();
    return {
      ...this.toOrder(o),
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        creditLimit: customer.credit_limit,
        paymentTermsDays: customer.payment_terms_days,
      },
      store: o.store_id
        ? ((await this.db.tx
            .selectFrom('stores')
            .select(['id', 'code', 'name'])
            .where('id', '=', o.store_id)
            .executeTakeFirst()) ?? null)
        : null,
      needsStore: !!(await this.db.tx
        .selectFrom('sales_order_lines as l')
        .innerJoin('products as p', 'p.id', 'l.product_id')
        .select('l.id')
        .where('l.order_id', '=', o.id)
        .where('p.stock_item_id', 'is not', null)
        .executeTakeFirst()),
      quotation: quotation
        ? {
            id: quotation.id,
            number: quotation.number,
            revision: quotation.revision,
          }
        : null,
      invoice: invoice
        ? { id: invoice.id, invoiceNo: invoice.invoice_no }
        : null,
      canWork: await this.crm.canWork(o.company_id, o.owner_id),
      canInvoice: this.access.allows('receivables.manage', {
        companyId: o.company_id,
      }),
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unit_price,
        discountPercent: l.discount_percent,
        value: l.value,
        vatPercent: l.vat_percent,
        sdAmount: l.sd_amount,
        vatAmount: l.vat_amount,
      })),
    };
  }

  /** The accepted quotation becomes the order (called by QuotationsService.accept, in its transaction). */
  async fromQuotation(
    q: SalesQuotation,
    h: { orderDate: string; customerRef: string | null },
  ) {
    const customer = await this.customers.find(q.customer_id);
    const check = creditCheck({
      creditLimit: customer.credit_limit,
      openInvoices: await this.openInvoices(customer.id),
      openOrders: await this.openOrders(customer.id),
      order: q.total,
    });
    const o = await this.db.tx
      .insertInto('sales_orders')
      .values({
        company_id: q.company_id,
        number: await this.nextNumber(q.company_id, h.orderDate),
        customer_id: q.customer_id,
        quotation_id: q.id,
        owner_id: q.owner_id,
        order_date: h.orderDate,
        customer_ref: h.customerRef,
        state: check.over ? 'in_approval' : 'confirmed',
        credit_check: JSON.stringify(check),
        value: q.value,
        sd_total: q.sd_total,
        vat_total: q.vat_total,
        total: q.total,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const lines = await this.db.tx
      .selectFrom('sales_quotation_lines')
      .selectAll()
      .where('quotation_id', '=', q.id)
      .orderBy('line_no')
      .execute();
    await this.db.tx
      .insertInto('sales_order_lines')
      .values(
        lines.map((l) => ({
          order_id: o.id,
          line_no: l.line_no,
          product_id: l.product_id,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unit_price: l.unit_price,
          discount_percent: l.discount_percent,
          value: l.value,
          vat_item_id: l.vat_item_id,
          rate_class: l.rate_class,
          vat_percent: l.vat_percent,
          sd_percent: l.sd_percent,
          sd_amount: l.sd_amount,
          vat_amount: l.vat_amount,
        })),
      )
      .execute();
    if (check.over) {
      const owner = await this.db.tx
        .selectFrom('users')
        .select('employee_id')
        .where('id', '=', q.owner_id)
        .executeTakeFirst();
      const request = await this.approvals.submit({
        requestType: SALES_ORDER_CREDIT_REQUEST,
        sourceId: o.id,
        subjectEmployeeId: owner?.employee_id ?? null,
        companyId: q.company_id,
        amount: o.total,
        summary: `Sales order ${o.number}: ${customer.name}, Tk ${o.total} - over the credit limit by Tk ${check.overBy}`,
        snapshot: {
          number: o.number,
          customer: `${customer.code} ${customer.name}`,
          ...check,
        },
      });
      await this.db.tx
        .updateTable('sales_orders')
        .set({ approval_request_id: request.id })
        .where('id', '=', o.id)
        .execute();
    }
    await this.audit.record({
      action: 'sales_order.created',
      entity: 'sales_order',
      entityId: o.id,
      after: {
        number: o.number,
        quotation: `${q.number} r${q.revision}`,
        total: o.total,
        creditCheck: check,
      },
    });
    return o;
  }

  async deliver(id: string, dto: DeliverDto) {
    const o = await this.find(id);
    await this.assertWorkOrAccounts(o);
    if (o.state !== 'confirmed')
      throw new ConflictException(MSG.ORDER_WRONG_STATE);
    const deliveredOn = businessDate(
      dto.deliveredOn ?? todayInDhaka(this.clock.now()),
    );
    const storeId = await this.takeStock(o, dto, deliveredOn);
    const row = await this.db.tx
      .updateTable('sales_orders')
      .set({
        state: 'delivered',
        delivered_on: deliveredOn,
        delivery_challan_no: dto.challanNo,
        store_id: storeId,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'sales_order.delivered',
      entity: 'sales_order',
      entityId: id,
      after: {
        challanNo: dto.challanNo,
        deliveredOn: row.delivered_on,
        storeId,
      },
    });
    return this.get(id);
  }

  async cancel(id: string, dto: CancelOrderDto) {
    const o = await this.find(id);
    await this.assertWorkOrAccounts(o);
    if (!['in_approval', 'confirmed'].includes(o.state))
      throw new ConflictException(MSG.ORDER_WRONG_STATE);
    if (o.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    if (o.state === 'in_approval' && o.approval_request_id)
      await this.approvals.withdraw(o.approval_request_id, dto.reason);
    await this.db.tx
      .updateTable('sales_orders')
      .set({ state: 'cancelled', cancel_reason: dto.reason })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'sales_order.cancelled',
      entity: 'sales_order',
      entityId: id,
      after: { reason: dto.reason },
    });
    return this.get(id);
  }

  async find(id: string): Promise<SalesOrder> {
    const o = await this.db.tx
      .selectFrom('sales_orders')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!o) throw new NotFoundException(MSG.ORDER_NOT_FOUND);
    return o;
  }

  /** What a customer owes on open invoices (for the credit check and the customer page). */
  async openInvoices(customerId: string): Promise<string> {
    const row = await this.db.tx
      .selectFrom('receivable_items')
      .select(
        sql<string>`coalesce(sum(amount - received - credited), 0)::text`.as(
          's',
        ),
      )
      .where('customer_id', '=', customerId)
      .executeTakeFirstOrThrow();
    return row.s;
  }

  // ================================================================ internals

  /** Goods kept in a store leave it: one move per stock item, refused when the store has less. */
  private async takeStock(
    o: SalesOrder,
    dto: DeliverDto,
    on: string,
  ): Promise<string | null> {
    const lines = await this.db.tx
      .selectFrom('sales_order_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['p.stock_item_id', 'p.code', 'l.quantity'])
      .where('l.order_id', '=', o.id)
      .where('p.stock_item_id', 'is not', null)
      .execute();
    if (!lines.length) return dto.storeId ?? null;
    if (!dto.storeId) throw new BadRequestException(MSG.SALES_STORE_NEEDED);
    const store = await this.db.tx
      .selectFrom('stores')
      .select(['id', 'company_id', 'is_active'])
      .where('id', '=', dto.storeId)
      .executeTakeFirst();
    if (!store || store.company_id !== o.company_id || !store.is_active)
      throw new BadRequestException(MSG.STORE_NOT_FOUND);
    // quantities, not money: up to three decimals (12.5 kg)
    const out = new Map<string, Decimal>();
    for (const l of lines)
      out.set(
        l.stock_item_id!,
        (out.get(l.stock_item_id!) ?? new Decimal(0)).plus(l.quantity),
      );
    const have = await this.db.tx
      .selectFrom('stock_balances')
      .select(['item_id', 'quantity'])
      .where('store_id', '=', store.id)
      .where('item_id', 'in', [...out.keys()])
      .execute();
    for (const [itemId, qty] of out) {
      const inStock = have.find((h) => h.item_id === itemId)?.quantity ?? '0';
      if (qty.greaterThan(new Decimal(inStock)))
        throw new ConflictException({
          message: MSG.STOCK_NOT_ENOUGH,
          details: {
            itemId,
            product: lines.find((l) => l.stock_item_id === itemId)!.code,
            inStock: new Decimal(inStock).toString(),
            asked: qty.toString(),
          },
        });
    }
    await this.db.tx
      .insertInto('stock_moves')
      .values(
        [...out].map(([itemId, qty]) => ({
          store_id: store.id,
          item_id: itemId,
          move_date: on,
          kind: 'sales_issue' as const,
          quantity: qty.negated().toString(),
          reference: `${o.number} · ${dto.challanNo}`,
          sales_order_id: o.id,
        })),
      )
      .execute();
    return store.id;
  }

  private async openOrders(customerId: string): Promise<string> {
    const row = await this.db.tx
      .selectFrom('sales_orders')
      .select(sql<string>`coalesce(sum(total), 0)::text`.as('s'))
      .where('customer_id', '=', customerId)
      .where('state', 'in', ['in_approval', 'confirmed', 'delivered'])
      .executeTakeFirstOrThrow();
    return row.s;
  }

  private async creditApproved(r: ApprovalRequest) {
    await this.db.tx
      .updateTable('sales_orders')
      .set({ state: 'confirmed' })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  private async creditClosed(
    r: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    await this.db.tx
      .updateTable('sales_orders')
      .set({
        state: 'cancelled',
        cancel_reason: `Credit ${outcome} by Accounts`,
      })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  private async scope(companyId: string) {
    if (this.access.allows('receivables.view', { companyId }))
      return { all: true, ownerIds: [] as string[] };
    return this.crm.listScope(companyId);
  }

  private async assertSee(o: SalesOrder) {
    if (this.access.allows('receivables.view', { companyId: o.company_id }))
      return;
    if (!(await this.crm.canSee(o.company_id, o.owner_id)))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  /** The salesperson (and Sales head / Admin), or Accounts (who dispatch and invoice). */
  private async assertWorkOrAccounts(o: SalesOrder) {
    if (this.access.allows('receivables.manage', { companyId: o.company_id }))
      return;
    await this.crm.assertWork(o.company_id, o.owner_id);
  }

  private async nextNumber(companyId: string, date: string): Promise<string> {
    const fy = vatYearOf(date);
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'sales_order',
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
    return `SO/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  toOrder(o: SalesOrder) {
    return {
      id: o.id,
      companyId: o.company_id,
      number: o.number,
      customerId: o.customer_id,
      quotationId: o.quotation_id,
      ownerId: o.owner_id,
      orderDate: o.order_date,
      customerRef: o.customer_ref,
      state: o.state,
      creditCheck: o.credit_check,
      approvalRequestId: o.approval_request_id,
      deliveredOn: o.delivered_on,
      deliveryChallanNo: o.delivery_challan_no,
      value: o.value,
      sdTotal: o.sd_total,
      vatTotal: o.vat_total,
      total: o.total,
      cancelReason: o.cancel_reason,
      version: o.version,
    };
  }
}
