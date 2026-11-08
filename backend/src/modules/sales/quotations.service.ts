/**
 * Quotations (Phase 3 WP25; spec §6.8 step 4 "quotation from price list; discount limits per
 * role; above the limit -> discount approval chain"; §5 "Discount above limit: Sales head ->
 * Admin").
 *
 *   create          for a customer the salesperson may work; each line priced from the price
 *                   list of the customer's type (the salesperson may type another price) and
 *                   VAT from the product's VAT item for the year
 *   the discount    a line's discount is measured against the list price: a lower typed price
 *                   counts as discount too. Above the limit that applies (CatalogueService.limitFor),
 *                   the quotation needs approval before it can go out
 *   submit          draft -> approved, or -> in_approval (request "quotation_discount":
 *                   the owner's Dept Head (the Sales head), then the Admin)
 *   send            approved -> sent (the opportunity moves to "Quotation sent")
 *   accept          sent and still valid -> accepted, and the order is placed (OrdersService)
 *   reject / cancel / revise   a revision keeps the number with the next revision; the old one
 *                   is superseded. A sent quotation past its validity reads as expired.
 *   pdf             Bangla or English
 *
 * Totals are always added from the lines; nobody types a total.
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
  Customer,
  SalesQuotation,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { CrmAccess } from '../crm/crm-access.js';
import { CustomersService } from '../crm/customers.service.js';
import { OpportunitiesService } from '../crm/opportunities.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { VatService, vatYearOf } from '../vat/vat.service.js';
import { CatalogueService } from './catalogue.service.js';
import type {
  AcceptQuotationDto,
  QuotationDto,
  QuotationQueryDto,
  QuotationStepDto,
  QuoteLineDto,
  ReviseQuotationDto,
} from './dto/sales.dto.js';
import { OrdersService } from './orders.service.js';
import { renderSalesDocumentPdf } from './sales-pdf.js';
import { priceLine, totalsOf } from './sales-rules.js';

export const QUOTATION_DISCOUNT_REQUEST = 'quotation_discount';
const OPEN_STATES = ['draft', 'in_approval', 'approved', 'sent'] as const;

@Injectable()
export class QuotationsService implements OnModuleInit {
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
    private readonly opportunities: OpportunitiesService,
    private readonly catalogue: CatalogueService,
    private readonly vat: VatService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    this.handlers.register(
      QUOTATION_DISCOUNT_REQUEST,
      {
        onApproved: (r) => this.discountApproved(r),
        onClosed: (r) => this.discountClosed(r),
        distinctApprovers: true,
      },
      [
        defaultChain(
          'Discount above the limit (default)',
          step(1, 'dept_head'),
          step(2, 'role:admin'),
        ),
      ],
    );
  }

  // ================================================================ read

  async list(companyId: string, query: QuotationQueryDto) {
    await this.org.assertCompanyExists(companyId);
    await this.expireOld(companyId);
    const scope = await this.scope(companyId);
    let q = this.db.tx
      .selectFrom('sales_quotations as q')
      .innerJoin('customers as c', 'c.id', 'q.customer_id')
      .innerJoin('users as u', 'u.id', 'q.owner_id')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .selectAll('q')
      .select([
        'c.code as customer_code',
        'c.name as customer_name',
        'e.full_name_en as owner_name',
      ])
      .where('q.company_id', '=', companyId);
    if (!scope.all) q = q.where('q.owner_id', 'in', scope.ownerIds);
    if (query.state === 'open') q = q.where('q.state', 'in', [...OPEN_STATES]);
    else if (query.state)
      q = q.where('q.state', '=', query.state as SalesQuotation['state']);
    else q = q.where('q.state', '<>', 'superseded');
    if (query.customerId) q = q.where('q.customer_id', '=', query.customerId);
    if (query.q)
      q = q.where((eb) =>
        eb.or([
          eb('q.number', 'ilike', `%${query.q}%`),
          eb(sql`lower(c.name)`, 'like', `%${query.q!.toLowerCase()}%`),
        ]),
      );
    const rows = await q.orderBy('q.created_at', 'desc').limit(500).execute();
    return rows.map((r) => ({
      ...this.toQuotation(r),
      customer: `${r.customer_code} · ${r.customer_name}`,
      ownerName: r.owner_name,
    }));
  }

  async get(id: string) {
    const q = await this.find(id);
    await this.expireOld(q.company_id);
    const fresh = await this.find(id);
    await this.assertSee(fresh);
    const lines = await this.db.tx
      .selectFrom('sales_quotation_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .selectAll('l')
      .select('p.code as product_code')
      .where('l.quotation_id', '=', id)
      .orderBy('l.line_no')
      .execute();
    const customer = await this.customers.find(fresh.customer_id);
    const revisions = await this.db.tx
      .selectFrom('sales_quotations')
      .select(['id', 'revision', 'state'])
      .where('company_id', '=', fresh.company_id)
      .where('number', '=', fresh.number)
      .orderBy('revision')
      .execute();
    const order = await this.db.tx
      .selectFrom('sales_orders')
      .select(['id', 'number', 'state'])
      .where('quotation_id', '=', id)
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    const opp = fresh.opportunity_id
      ? await this.db.tx
          .selectFrom('opportunities')
          .select(['id', 'number', 'title'])
          .where('id', '=', fresh.opportunity_id)
          .executeTakeFirst()
      : undefined;
    return {
      ...this.toQuotation(fresh),
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        customerType: customer.customer_type,
      },
      opportunity: opp
        ? { id: opp.id, number: opp.number, title: opp.title }
        : null,
      order: order
        ? { id: order.id, number: order.number, state: order.state }
        : null,
      revisions: revisions.map((r) => ({
        id: r.id,
        revision: r.revision,
        state: r.state,
      })),
      canWork: await this.crm.canWork(fresh.company_id, fresh.owner_id),
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        productId: l.product_id,
        productCode: l.product_code,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        listPrice: l.list_price,
        unitPrice: l.unit_price,
        discountPercent: l.discount_percent,
        discountLimit: l.discount_limit,
        gross: l.gross,
        value: l.value,
        rateClass: l.rate_class,
        vatPercent: l.vat_percent,
        sdAmount: l.sd_amount,
        vatAmount: l.vat_amount,
        overLimit: Money.of(this.effectiveDiscount(l)).greaterThan(
          l.discount_limit,
        ),
      })),
    };
  }

  async pdf(id: string, lang?: 'bn' | 'en') {
    const q = await this.get(id);
    const company = await this.db.tx
      .selectFrom('companies')
      .select(['legal_name', 'bin'])
      .where('id', '=', q.companyId)
      .executeTakeFirstOrThrow();
    const customer = await this.customers.find(q.customer.id);
    const buffer = await renderSalesDocumentPdf({
      kind: 'quotation',
      lang: lang ?? q.language,
      company: { name: company.legal_name, bin: company.bin, address: null },
      number: q.revision > 1 ? `${q.number} (rev. ${q.revision})` : q.number,
      date: q.quoteDate,
      secondDate: q.validUntil,
      customer: {
        code: customer.code,
        name: customer.name,
        bin: customer.bin,
        address:
          [customer.address, customer.district].filter(Boolean).join(', ') ||
          null,
      },
      lines: q.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        value: l.value,
        vatPercent: l.vatPercent,
        vatAmount: l.vatAmount,
        sdAmount: l.sdAmount,
      })),
      totals: {
        value: q.value,
        sd: q.sdTotal,
        vat: q.vatTotal,
        total: q.total,
      },
      terms: q.terms,
    });
    return {
      buffer,
      fileName: `${q.number.replace(/\//g, '-')}-r${q.revision}.pdf`,
    };
  }

  // ================================================================ write

  async create(companyId: string, dto: QuotationDto) {
    await this.org.assertCompanyExists(companyId);
    const customer = await this.customers.find(dto.customerId);
    if (customer.company_id !== companyId)
      throw new NotFoundException(MSG.CUSTOMER_NOT_FOUND);
    await this.crm.assertSee(companyId, customer.account_manager_id, {
      customer: true,
    });
    const me = this.access.current();
    const ownerId =
      me.has('crm.own') && me.userId ? me.userId : customer.account_manager_id;
    if (!ownerId) throw new BadRequestException(MSG.CRM_OWNER_INVALID);
    await this.crm.assertWork(companyId, ownerId);
    if (dto.opportunityId) {
      const o = await this.opportunities.find(dto.opportunityId);
      if (o.customer_id !== customer.id || o.state !== 'open')
        throw new BadRequestException(MSG.OPPORTUNITY_WRONG_STATE);
    }
    const quoteDate = businessDate(
      dto.quoteDate ?? todayInDhaka(this.clock.now()),
    );
    this.assertValidity(quoteDate, dto.validUntil);
    const lines = await this.priceLines(
      companyId,
      customer,
      ownerId,
      quoteDate,
      dto.lines,
    );
    const q = await this.insert(
      companyId,
      {
        number: await this.nextNumber(companyId, quoteDate),
        revision: 1,
        customer,
        ownerId,
        opportunityId: dto.opportunityId ?? null,
        quoteDate,
        validUntil: dto.validUntil,
        language: dto.language ?? 'en',
        terms: dto.terms ?? null,
      },
      lines,
    );
    await this.audit.record({
      action: 'quotation.created',
      entity: 'quotation',
      entityId: q.id,
      after: {
        number: q.number,
        total: q.total,
        needsApproval: q.needs_approval,
      },
    });
    return this.get(q.id);
  }

  /** A new version with the same number; the old one is superseded. */
  async revise(id: string, dto: ReviseQuotationDto) {
    const old = await this.workable(id);
    if (
      !['draft', 'approved', 'sent', 'rejected', 'expired'].includes(old.state)
    )
      throw new ConflictException(MSG.QUOTATION_WRONG_STATE);
    const customer = await this.customers.find(old.customer_id);
    const quoteDate = todayInDhaka(this.clock.now());
    this.assertValidity(quoteDate, dto.validUntil);
    const lines = await this.priceLines(
      old.company_id,
      customer,
      old.owner_id,
      quoteDate,
      dto.lines,
    );
    const done = await this.db.tx
      .updateTable('sales_quotations')
      .set({ state: 'superseded' })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returning('id')
      .executeTakeFirst();
    if (!done) throw new ConflictException(MSG.STALE_VERSION);
    const latest = await this.db.tx
      .selectFrom('sales_quotations')
      .select(sql<number>`max(revision)`.as('r'))
      .where('company_id', '=', old.company_id)
      .where('number', '=', old.number)
      .executeTakeFirstOrThrow();
    const q = await this.insert(
      old.company_id,
      {
        number: old.number,
        revision: latest.r + 1,
        customer,
        ownerId: old.owner_id,
        opportunityId: old.opportunity_id,
        quoteDate,
        validUntil: dto.validUntil,
        language: old.language,
        terms: dto.terms ?? old.terms,
      },
      lines,
    );
    await this.audit.record({
      action: 'quotation.revised',
      entity: 'quotation',
      entityId: q.id,
      before: { id: old.id, revision: old.revision, total: old.total },
      after: { revision: q.revision, total: q.total },
    });
    return this.get(q.id);
  }

  /** Draft -> approved, or to the discount chain when a line is above its limit. */
  async submit(id: string, dto: QuotationStepDto) {
    const q = await this.workable(id);
    if (q.state !== 'draft')
      throw new ConflictException(MSG.QUOTATION_WRONG_STATE);
    if (!q.needs_approval) {
      await this.setState(q, dto.version, { state: 'approved' });
      return this.get(id);
    }
    const lines = await this.db.tx
      .selectFrom('sales_quotation_lines')
      .selectAll()
      .where('quotation_id', '=', id)
      .orderBy('line_no')
      .execute();
    const owner = await this.db.tx
      .selectFrom('users')
      .select('employee_id')
      .where('id', '=', q.owner_id)
      .executeTakeFirst();
    const customer = await this.customers.find(q.customer_id);
    const request = await this.approvals.submit({
      requestType: QUOTATION_DISCOUNT_REQUEST,
      sourceId: q.id,
      subjectEmployeeId: owner?.employee_id ?? null,
      companyId: q.company_id,
      amount: q.total,
      summary: `Quotation ${q.number} rev. ${q.revision}: ${customer.name}, Tk ${q.total} (discount Tk ${q.discount_total} above the limit)`,
      snapshot: {
        number: q.number,
        revision: q.revision,
        customer: `${customer.code} ${customer.name}`,
        total: q.total,
        discount: q.discount_total,
        lines: lines
          .map(
            (l) =>
              `${l.quantity} ${l.unit} ${l.description} @ Tk ${l.unit_price} less ${l.discount_percent}% (limit ${l.discount_limit}%, effective ${this.effectiveDiscount(l)}%)`,
          )
          .join('; '),
      },
    });
    await this.setState(q, dto.version, {
      state: 'in_approval',
      approval_request_id: request.id,
    });
    return this.get(id);
  }

  async send(id: string, dto: QuotationStepDto) {
    const q = await this.workable(id);
    if (q.state !== 'approved')
      throw new ConflictException(MSG.QUOTATION_WRONG_STATE);
    if (q.valid_until < todayInDhaka(this.clock.now()))
      throw new ConflictException(MSG.QUOTATION_EXPIRED);
    await this.setState(q, dto.version, { state: 'sent' });
    if (q.opportunity_id)
      await this.opportunities.quotationSent(q.opportunity_id, q.number);
    await this.audit.record({
      action: 'quotation.sent',
      entity: 'quotation',
      entityId: id,
      after: { number: q.number, revision: q.revision },
    });
    return this.get(id);
  }

  /** The customer said yes: the order is placed (and the opportunity won). */
  async accept(id: string, dto: AcceptQuotationDto) {
    const q = await this.workable(id);
    if (q.state !== 'sent')
      throw new ConflictException(MSG.QUOTATION_WRONG_STATE);
    const orderDate = businessDate(
      dto.orderDate ?? todayInDhaka(this.clock.now()),
    );
    if (q.valid_until < orderDate)
      throw new ConflictException(MSG.QUOTATION_EXPIRED);
    await this.setState(q, dto.version, { state: 'accepted' });
    const order = await this.orders.fromQuotation(q, {
      orderDate,
      customerRef: dto.customerRef ?? null,
    });
    if (q.opportunity_id)
      await this.opportunities.wonByOrder(
        q.opportunity_id,
        q.value,
        orderDate,
        order.number,
      );
    await this.audit.record({
      action: 'quotation.accepted',
      entity: 'quotation',
      entityId: id,
      after: { order: order.number },
    });
    return this.get(id);
  }

  async reject(id: string, dto: QuotationStepDto) {
    const q = await this.workable(id);
    if (q.state !== 'sent')
      throw new ConflictException(MSG.QUOTATION_WRONG_STATE);
    await this.setState(q, dto.version, {
      state: 'rejected',
      reject_reason: dto.reason ?? null,
    });
    return this.get(id);
  }

  async cancel(id: string, dto: QuotationStepDto) {
    const q = await this.workable(id);
    if (!['draft', 'in_approval', 'approved'].includes(q.state))
      throw new ConflictException(MSG.QUOTATION_WRONG_STATE);
    if (q.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    if (q.state === 'in_approval' && q.approval_request_id)
      await this.approvals.withdraw(
        q.approval_request_id,
        dto.reason ?? 'Quotation cancelled',
      );
    await this.db.tx
      .updateTable('sales_quotations')
      .set({ state: 'cancelled', reject_reason: dto.reason ?? null })
      .where('id', '=', id)
      .execute();
    return this.get(id);
  }

  async find(id: string): Promise<SalesQuotation> {
    const q = await this.db.tx
      .selectFrom('sales_quotations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!q) throw new NotFoundException(MSG.SALES_QUOTATION_NOT_FOUND);
    return q;
  }

  // ================================================================ approval

  private async discountApproved(r: ApprovalRequest) {
    await this.db.tx
      .updateTable('sales_quotations')
      .set({ state: 'approved' })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  private async discountClosed(r: ApprovalRequest) {
    // back to draft: the salesperson lowers the discount (a revision) or cancels
    await this.db.tx
      .updateTable('sales_quotations')
      .set({ state: 'draft', approval_request_id: null })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  // ================================================================ internals

  private async priceLines(
    companyId: string,
    customer: Customer,
    ownerId: string,
    date: string,
    given: QuoteLineDto[],
  ) {
    const fy = vatYearOf(date);
    const lines = [];
    for (const [i, l] of given.entries()) {
      const product = await this.catalogue.findProduct(l.productId);
      if (product.company_id !== companyId || !product.is_active)
        throw new BadRequestException(MSG.PRODUCT_NOT_FOUND);
      const listPrice = await this.catalogue.priceFor(
        companyId,
        product.id,
        customer.customer_type,
        fy,
      );
      const unitPrice = l.unitPrice ?? listPrice;
      if (unitPrice === null)
        throw new BadRequestException({
          message: MSG.PRICE_MISSING,
          details: { product: product.code, fiscalYear: fy },
        });
      const rate = await this.vat.rateFor(product.vat_item_id, companyId, date);
      const discountPercent = Money.of(l.discountPercent ?? '0').toDb();
      const priced = priceLine(
        { quantity: l.quantity, unitPrice, discountPercent },
        rate,
      );
      lines.push({
        line_no: i + 1,
        product_id: product.id,
        description: l.description ?? product.name,
        quantity: l.quantity,
        unit: product.unit,
        list_price: listPrice,
        unit_price: Money.of(unitPrice).toDb(),
        discount_percent: discountPercent,
        discount_limit: await this.catalogue.limitFor(companyId, {
          userId: ownerId,
          productId: product.id,
          customerType: customer.customer_type,
        }),
        gross: priced.gross,
        value: priced.value,
        vat_item_id: product.vat_item_id,
        rate_class: rate.rateClass,
        vat_percent: rate.vatPercent,
        sd_percent: rate.sdPercent,
        sd_amount: priced.sdAmount,
        vat_amount: priced.vatAmount,
      });
    }
    return lines;
  }

  /** The discount a line really gives: against the list price when there is one (a lower typed price counts). */
  private effectiveDiscount(l: {
    list_price: string | null;
    quantity: string;
    value: string;
    discount_percent: string;
  }) {
    if (!l.list_price || Money.of(l.list_price).isZero())
      return Money.of(l.discount_percent).toDb();
    const atList = Money.of(l.list_price).times(l.quantity);
    return Money.of('100')
      .minus(Money.of(l.value).times(100).dividedBy(atList.toDb()))
      .round()
      .toDb();
  }

  private async insert(
    companyId: string,
    h: {
      number: string;
      revision: number;
      customer: Customer;
      ownerId: string;
      opportunityId: string | null;
      quoteDate: string;
      validUntil: string;
      language: 'en' | 'bn';
      terms: string | null;
    },
    lines: Awaited<ReturnType<QuotationsService['priceLines']>>,
  ) {
    const t = totalsOf(
      lines.map((l) => ({
        gross: l.gross,
        value: l.value,
        sdAmount: l.sd_amount,
        vatAmount: l.vat_amount,
      })),
    );
    const needsApproval = lines.some((l) =>
      Money.of(this.effectiveDiscount(l)).greaterThan(l.discount_limit),
    );
    const q = await this.db.tx
      .insertInto('sales_quotations')
      .values({
        company_id: companyId,
        number: h.number,
        revision: h.revision,
        customer_id: h.customer.id,
        opportunity_id: h.opportunityId,
        owner_id: h.ownerId,
        quote_date: h.quoteDate,
        valid_until: businessDate(h.validUntil),
        language: h.language,
        needs_approval: needsApproval,
        subtotal: t.subtotal,
        discount_total: t.discount,
        value: t.value,
        sd_total: t.sd,
        vat_total: t.vat,
        total: t.total,
        terms: h.terms,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('sales_quotation_lines')
      .values(lines.map((l) => ({ ...l, quotation_id: q.id })))
      .execute();
    return q;
  }

  private assertValidity(quoteDate: string, validUntil: string) {
    if (businessDate(validUntil) < quoteDate)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: ['validUntil cannot be before the quotation date'],
        },
      });
  }

  private async setState(
    q: SalesQuotation,
    version: number,
    set: {
      state: SalesQuotation['state'];
      approval_request_id?: string | null;
      reject_reason?: string | null;
    },
  ) {
    const row = await this.db.tx
      .updateTable('sales_quotations')
      .set(set)
      .where('id', '=', q.id)
      .where('version', '=', version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    return row;
  }

  /** Sent quotations past their validity become expired (read time; no job needed). */
  private async expireOld(companyId: string) {
    await this.db.tx
      .updateTable('sales_quotations')
      .set({ state: 'expired' })
      .where('company_id', '=', companyId)
      .where('state', '=', 'sent')
      .where('valid_until', '<', todayInDhaka(this.clock.now()))
      .execute();
  }

  private async workable(id: string) {
    const q = await this.find(id);
    await this.crm.assertWork(q.company_id, q.owner_id);
    return q;
  }

  /** Salespeople by owner; Accounts (receivables) reads every quotation of the company. */
  private async scope(companyId: string) {
    if (this.access.allows('receivables.view', { companyId }))
      return { all: true, ownerIds: [] as string[] };
    return this.crm.listScope(companyId);
  }

  private async assertSee(q: SalesQuotation) {
    if (this.access.allows('receivables.view', { companyId: q.company_id }))
      return;
    if (!(await this.crm.canSee(q.company_id, q.owner_id)))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private async nextNumber(companyId: string, date: string): Promise<string> {
    const fy = vatYearOf(date);
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'quotation',
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
    return `QT/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  private toQuotation(q: SalesQuotation) {
    return {
      id: q.id,
      companyId: q.company_id,
      number: q.number,
      revision: q.revision,
      customerId: q.customer_id,
      opportunityId: q.opportunity_id,
      ownerId: q.owner_id,
      quoteDate: q.quote_date,
      validUntil: q.valid_until,
      language: q.language,
      state: q.state,
      needsApproval: q.needs_approval,
      approvalRequestId: q.approval_request_id,
      subtotal: q.subtotal,
      discountTotal: q.discount_total,
      value: q.value,
      sdTotal: q.sd_total,
      vatTotal: q.vat_total,
      total: q.total,
      terms: q.terms,
      rejectReason: q.reject_reason,
      version: q.version,
    };
  }
}
