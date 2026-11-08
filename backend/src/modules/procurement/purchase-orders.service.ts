/**
 * Purchase orders, goods / service received notes and the three-way match
 * (WP17; spec §6.7 steps 3-4).
 *
 *   approved requisition --purchase order (from a quotation)--> draft --issue--> issued
 *   issued --received notes--> partially_received --> received
 *   a draft or issued order without receipts or bills can be cancelled
 *
 * From the quotation threshold the order must use the quotation of the approved
 * comparative statement. Bills against the order are three-way matched here
 * (PurchaseOrderLink, registered with the vendor bills): billed <= received, billed <=
 * ordered, unit price within the tolerance. The match is worked out again whenever a
 * receipt or a bill of the order changes; a mismatch blocks payment. The Admin may
 * accept a variance with a reason.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  PurchaseOrder,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { BudgetPositionService } from '../budgets/budget-position.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { BillLineDto } from '../payables/dto/payables.dto.js';
import {
  VendorBillsService,
  type PurchaseOrderLink,
} from '../payables/vendor-bills.service.js';
import type {
  CreatePurchaseOrderDto,
  GoodsReceiptDto,
  PurchaseOrderQueryDto,
} from './dto/procurement.dto.js';
import { ProcurementCommon } from './procurement-common.js';
import { threeWayMatch, type MatchInputLine } from './three-way-match.js';

export const PURCHASE_ORDER_REQUEST = 'purchase_order';

@Injectable()
export class PurchaseOrdersService implements OnModuleInit, PurchaseOrderLink {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly common: ProcurementCommon,
    private readonly bills: VendorBillsService,
    private readonly budgets: BudgetPositionService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
  ) {}

  onModuleInit() {
    this.bills.registerPurchaseOrderLink(this);
    // WP18: an order that takes a budget line over 100 % waits for the Admin
    this.handlers.register(
      PURCHASE_ORDER_REQUEST,
      {
        onApproved: (r) => this.issuedOnApproval(r),
        onClosed: (r, outcome) => this.approvalClosed(r, outcome),
        distinctApprovers: true,
      },
      [
        defaultChain(
          'Purchase order over budget (default)',
          step(1, 'role:admin'),
        ),
      ],
    );
  }

  // ================================================================ order

  async create(requisitionId: string, dto: CreatePurchaseOrderDto) {
    const r = await this.common.findRequisition(requisitionId);
    this.access.assert('procurement.manage', { companyId: r.company_id });
    if (r.state !== 'approved')
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);
    const quotation = await this.db.tx
      .selectFrom('quotations')
      .selectAll()
      .where('id', '=', dto.quotationId)
      .where('requisition_id', '=', r.id)
      .where('state', '=', 'active')
      .executeTakeFirst();
    if (!quotation) throw new NotFoundException(MSG.QUOTATION_NOT_FOUND);
    const settings = await this.common.settings(r.company_id);
    const needsStatement =
      Money.of(r.estimated_total).compare(settings.quotationThreshold) >= 0;
    if (
      needsStatement &&
      (r.cs_state !== 'approved' || r.selected_quotation_id !== quotation.id)
    )
      throw new ConflictException(MSG.COMPARATIVE_STATEMENT_REQUIRED);
    if (!needsStatement && r.cs_state === 'in_approval')
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);

    // every requisition line, with the account its bill line will post to
    const lines = await this.db.tx
      .selectFrom('purchase_requisition_lines')
      .selectAll()
      .where('requisition_id', '=', r.id)
      .orderBy('line_no')
      .execute();
    const prices = await this.db.tx
      .selectFrom('quotation_lines')
      .selectAll()
      .where('quotation_id', '=', quotation.id)
      .execute();
    const accountOf = new Map(
      dto.lines.map((l) => [l.requisitionLineId, l.accountId]),
    );
    if (
      lines.some((l) => !accountOf.has(l.id)) ||
      accountOf.size !== lines.length
    )
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    await this.common.assertExpenseAccounts(r.company_id, [
      ...accountOf.values(),
    ]);

    const number = await this.common.nextNumber(
      r.company_id,
      'purchase_order',
      dto.orderDate,
    );
    const order = await this.db.tx
      .insertInto('purchase_orders')
      .values({
        company_id: r.company_id,
        number,
        requisition_id: r.id,
        quotation_id: quotation.id,
        vendor_id: quotation.vendor_id,
        department_id: r.department_id,
        order_date: dto.orderDate,
        delivery_date: dto.deliveryDate ?? null,
        deliver_to: dto.deliverTo ?? null,
        terms: dto.terms ?? null,
        base_total: quotation.base_total,
        vat_total: quotation.vat_total,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('purchase_order_lines')
      .values(
        lines.map((l) => {
          const price = prices.find((p) => p.requisition_line_id === l.id)!;
          return {
            purchase_order_id: order.id,
            requisition_line_id: l.id,
            line_no: l.line_no,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unit_price: price.unit_price,
            vat_percent: price.vat_percent,
            account_id: accountOf.get(l.id)!,
          };
        }),
      )
      .execute();
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({ state: 'ordered' })
      .where('id', '=', r.id)
      .execute();
    await this.audit.record({
      action: 'purchase_order.created',
      entity: 'purchase_order',
      entityId: order.id,
      after: {
        number,
        requisition: r.number,
        quotationId: quotation.id,
        total: Money.of(order.base_total).plus(order.vat_total).toDb(),
      },
    });
    return this.get(order.id);
  }

  /**
   * Issue to the vendor: this commits the budget (spec §6.6). If any department x
   * account line would go over its budget, the Admin approves first.
   */
  async issue(id: string) {
    const o = await this.common.findOrder(id);
    this.access.assert('procurement.manage', { companyId: o.company_id });
    if (o.state !== 'draft')
      throw new ConflictException(MSG.PURCHASE_ORDER_WRONG_STATE);
    const lines = await this.db.tx
      .selectFrom('purchase_order_lines')
      .select(['account_id', 'quantity', 'unit_price'])
      .where('purchase_order_id', '=', id)
      .execute();
    const check = await this.budgets.linesCheck(
      o.company_id,
      o.department_id,
      o.order_date,
      lines.map((l) => ({
        accountId: l.account_id,
        amount: Money.of(l.unit_price).times(l.quantity).round().toDb(),
      })),
    );

    if (!check.needsAdmin) {
      await this.db.tx
        .updateTable('purchase_orders')
        .set({
          state: 'issued',
          issued_at: new Date(),
          budget_snapshot: JSON.stringify(check),
        })
        .where('id', '=', id)
        .execute();
      await this.audit.record({
        action: 'purchase_order.issued',
        entity: 'purchase_order',
        entityId: id,
        after: { number: o.number, budget: check.status },
      });
      return this.get(id);
    }

    const vendor = await this.db.tx
      .selectFrom('vendors')
      .select('name')
      .where('id', '=', o.vendor_id)
      .executeTakeFirstOrThrow();
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code', 'name_en'])
      .where(
        'id',
        'in',
        lines.map((l) => l.account_id),
      )
      .execute();
    const name = (accountId: string | null) =>
      accounts.find((a) => a.id === accountId);
    const request = await this.approvals.submit({
      requestType: PURCHASE_ORDER_REQUEST,
      sourceId: id,
      subjectEmployeeId: null,
      companyId: o.company_id,
      amount: Money.of(o.base_total).plus(o.vat_total).toDb(),
      kind: check.status,
      summary: `Purchase order ${o.number} over budget: ${vendor.name}, Tk ${Money.of(o.base_total).plus(o.vat_total).toDb()}`,
      snapshot: {
        order: o.number,
        vendor: vendor.name,
        fiscalYear: check.fiscalYear,
        budget:
          check.status === 'no_budget'
            ? 'The department has no budget this year'
            : check.lines
                .map(
                  (l) =>
                    `${name(l.accountId)?.code} ${name(l.accountId)?.name_en}: Tk ${l.after!.used} of Tk ${l.after!.budget} after this order (${l.after!.status})`,
                )
                .join('; '),
      },
    });
    await this.db.tx
      .updateTable('purchase_orders')
      .set({
        state: 'in_approval',
        approval_request_id: request.id,
        budget_snapshot: JSON.stringify(check),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'purchase_order.sent_for_budget_approval',
      entity: 'purchase_order',
      entityId: id,
      after: {
        number: o.number,
        budget: check.status,
        approvalRequestId: request.id,
      },
    });
    return this.get(id);
  }

  private async issuedOnApproval(request: ApprovalRequest) {
    await this.db.tx
      .updateTable('purchase_orders')
      .set({ state: 'issued', issued_at: new Date() })
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: 'purchase_order.issued',
      entity: 'purchase_order',
      entityId: request.source_id,
      after: { approvedOverBudget: request.id },
    });
  }

  /** Returned, rejected or withdrawn: back to draft (Accounts may ask for a budget change, or cancel). */
  private async approvalClosed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    await this.db.tx
      .updateTable('purchase_orders')
      .set({ state: 'draft', approval_request_id: null })
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: `purchase_order.budget_${outcome}`,
      entity: 'purchase_order',
      entityId: request.source_id,
      after: { approvalRequestId: request.id },
    });
  }

  /** Nothing received or billed yet: the order is cancelled and the requisition can be ordered again. */
  async cancel(id: string, reason: string) {
    const o = await this.common.findOrder(id);
    this.access.assert('procurement.manage', { companyId: o.company_id });
    if (o.state !== 'draft' && o.state !== 'issued')
      throw new ConflictException(MSG.PURCHASE_ORDER_WRONG_STATE);
    const receipt = await this.db.tx
      .selectFrom('goods_receipts')
      .select('id')
      .where('purchase_order_id', '=', id)
      .where('state', '=', 'active')
      .executeTakeFirst();
    const bill = await this.db.tx
      .selectFrom('vendor_bills')
      .select('id')
      .where('purchase_order_id', '=', id)
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    if (receipt || bill)
      throw new ConflictException(MSG.PURCHASE_ORDER_WRONG_STATE);
    await this.db.tx
      .updateTable('purchase_orders')
      .set({ state: 'cancelled', cancel_reason: reason })
      .where('id', '=', id)
      .execute();
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({ state: 'approved' })
      .where('id', '=', o.requisition_id)
      .execute();
    await this.audit.record({
      action: 'purchase_order.cancelled',
      entity: 'purchase_order',
      entityId: id,
      after: { number: o.number, reason },
    });
    return this.get(id);
  }

  // ================================================================ goods / services received

  async receive(id: string, dto: GoodsReceiptDto) {
    const o = await this.common.findOrder(id);
    this.access.assert('procurement.receive', this.common.resourceOf(o));
    if (o.state !== 'issued' && o.state !== 'partially_received')
      throw new ConflictException(MSG.PURCHASE_ORDER_WRONG_STATE);
    const quantities = await this.lineQuantities(id);
    const asked = new Map<string, Decimal>();
    for (const l of dto.lines)
      asked.set(
        l.poLineId,
        (asked.get(l.poLineId) ?? new Decimal(0)).plus(l.quantity),
      );
    for (const [lineId, qty] of asked) {
      const q = quantities.get(lineId);
      if (!q) throw new NotFoundException(MSG.PURCHASE_ORDER_NOT_FOUND);
      if (
        qty.lessThanOrEqualTo(0) ||
        q.received.plus(qty).greaterThan(q.ordered)
      ) {
        throw new BadRequestException({
          message: MSG.RECEIPT_EXCEEDS_ORDER,
          details: {
            line: q.description,
            ordered: q.ordered.toString(),
            received: q.received.toString(),
          },
        });
      }
    }

    const number = await this.common.nextNumber(
      o.company_id,
      'goods_receipt',
      dto.receivedDate,
    );
    const receipt = await this.db.tx
      .insertInto('goods_receipts')
      .values({
        company_id: o.company_id,
        number,
        purchase_order_id: id,
        received_date: dto.receivedDate,
        note: dto.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('goods_receipt_lines')
      .values(
        [...asked].map(([poLineId, qty]) => ({
          receipt_id: receipt.id,
          po_line_id: poLineId,
          quantity: qty.toString(),
        })),
      )
      .execute();
    await this.refreshState(id);
    await this.rematchOrder(id);
    await this.audit.record({
      action: 'goods_receipt.recorded',
      entity: 'purchase_order',
      entityId: id,
      after: { number, receivedDate: dto.receivedDate, lines: dto.lines },
    });
    return this.get(id);
  }

  /** A note entered by mistake: cancelled, as long as the bills still fit what stays received. */
  async cancelReceipt(receiptId: string, reason: string) {
    const receipt = await this.db.tx
      .selectFrom('goods_receipts')
      .selectAll()
      .where('id', '=', receiptId)
      .executeTakeFirst();
    if (!receipt || receipt.state !== 'active')
      throw new NotFoundException(MSG.GOODS_RECEIPT_NOT_FOUND);
    const o = await this.common.findOrder(receipt.purchase_order_id);
    this.access.assert('procurement.manage', { companyId: o.company_id });
    const lines = await this.db.tx
      .selectFrom('goods_receipt_lines')
      .selectAll()
      .where('receipt_id', '=', receiptId)
      .execute();
    const quantities = await this.lineQuantities(o.id);
    for (const l of lines) {
      const q = quantities.get(l.po_line_id)!;
      if (q.billed.greaterThan(q.received.minus(l.quantity)))
        throw new ConflictException(MSG.RECEIPT_ALREADY_BILLED);
    }
    await this.db.tx
      .updateTable('goods_receipts')
      .set({ state: 'cancelled', cancel_reason: reason })
      .where('id', '=', receiptId)
      .execute();
    await this.refreshState(o.id);
    await this.rematchOrder(o.id);
    await this.audit.record({
      action: 'goods_receipt.cancelled',
      entity: 'purchase_order',
      entityId: o.id,
      after: { number: receipt.number, reason },
    });
    return this.get(o.id);
  }

  private async refreshState(id: string) {
    const quantities = [...(await this.lineQuantities(id)).values()];
    const none = quantities.every((q) => q.received.isZero());
    const all = quantities.every((q) =>
      q.received.greaterThanOrEqualTo(q.ordered),
    );
    await this.db.tx
      .updateTable('purchase_orders')
      .set({ state: none ? 'issued' : all ? 'received' : 'partially_received' })
      .where('id', '=', id)
      .execute();
  }

  /** Per PO line: ordered, received (active notes) and billed (bills not cancelled). */
  private async lineQuantities(orderId: string, exceptBillId?: string) {
    const lines = await this.db.tx
      .selectFrom('purchase_order_lines')
      .selectAll()
      .where('purchase_order_id', '=', orderId)
      .orderBy('line_no')
      .execute();
    const received = await this.db.tx
      .selectFrom('goods_receipt_lines as l')
      .innerJoin('goods_receipts as g', 'g.id', 'l.receipt_id')
      .select(['l.po_line_id', 'l.quantity'])
      .where('g.purchase_order_id', '=', orderId)
      .where('g.state', '=', 'active')
      .execute();
    let billedQ = this.db.tx
      .selectFrom('vendor_bill_lines as l')
      .innerJoin('vendor_bills as b', 'b.id', 'l.bill_id')
      .select(['l.po_line_id', 'l.quantity', 'l.amount', 'l.bill_id'])
      .where('b.purchase_order_id', '=', orderId)
      .where('b.state', '<>', 'cancelled');
    if (exceptBillId) billedQ = billedQ.where('b.id', '<>', exceptBillId);
    const billed = await billedQ.execute();
    const sum = (
      rows: Array<{ po_line_id: string | null; quantity: string | null }>,
      id: string,
    ) =>
      rows
        .filter((r) => r.po_line_id === id)
        .reduce((a, r) => a.plus(r.quantity ?? 0), new Decimal(0));
    return new Map(
      lines.map((l) => [
        l.id,
        {
          line: l,
          description: l.description,
          ordered: new Decimal(l.quantity),
          received: sum(received, l.id),
          billed: sum(billed, l.id),
        },
      ]),
    );
  }

  // ================================================================ three-way match (PurchaseOrderLink)

  /** A bill against this order: same company and vendor, an open order, every line a PO line with a quantity. */
  async validate(input: {
    companyId: string;
    vendorId: string;
    purchaseOrderId: string;
    lines: BillLineDto[];
  }) {
    const o = await this.db.tx
      .selectFrom('purchase_orders')
      .selectAll()
      .where('id', '=', input.purchaseOrderId)
      .executeTakeFirst();
    const open =
      o && ['issued', 'partially_received', 'received'].includes(o.state);
    if (
      !o ||
      o.company_id !== input.companyId ||
      o.vendor_id !== input.vendorId ||
      !open
    )
      throw new BadRequestException(MSG.BILL_PO_INVALID);
    const lineIds = new Set(
      (
        await this.db.tx
          .selectFrom('purchase_order_lines')
          .select('id')
          .where('purchase_order_id', '=', o.id)
          .execute()
      ).map((l) => l.id),
    );
    if (
      input.lines.some(
        (l) =>
          !l.poLineId ||
          !l.quantity ||
          !lineIds.has(l.poLineId) ||
          new Decimal(l.quantity).lessThanOrEqualTo(0),
      )
    ) {
      throw new BadRequestException(MSG.BILL_PO_INVALID);
    }
  }

  async match(billId: string) {
    const bill = await this.db.tx
      .selectFrom('vendor_bills')
      .selectAll()
      .where('id', '=', billId)
      .executeTakeFirstOrThrow();
    if (!bill.purchase_order_id || bill.state === 'cancelled') return;
    const settings = await this.common.settings(bill.company_id);
    const quantities = await this.lineQuantities(
      bill.purchase_order_id,
      bill.id,
    );
    const billLines = await this.db.tx
      .selectFrom('vendor_bill_lines')
      .selectAll()
      .where('bill_id', '=', bill.id)
      .execute();

    // one match line per PO line the bill charges (several bill lines may share one)
    const byPoLine = new Map<string, { qty: Decimal; amount: Decimal }>();
    for (const l of billLines) {
      if (!l.po_line_id) continue;
      const cur = byPoLine.get(l.po_line_id) ?? {
        qty: new Decimal(0),
        amount: new Decimal(0),
      };
      byPoLine.set(l.po_line_id, {
        qty: cur.qty.plus(l.quantity ?? 0),
        amount: cur.amount.plus(l.amount),
      });
    }
    const input: MatchInputLine[] = [...byPoLine].map(([poLineId, b]) => {
      const q = quantities.get(poLineId)!;
      return {
        poLineId,
        description: q.description,
        orderedQty: q.ordered.toString(),
        receivedQty: q.received.toString(),
        billedElsewhereQty: q.billed.toString(),
        billQty: b.qty.toString(),
        poUnitPrice: q.line.unit_price,
        billUnitPrice: b.amount.dividedBy(b.qty).toFixed(2),
      };
    });
    const result = threeWayMatch(input, settings.matchTolerancePercent);
    // an accepted variance stays accepted; a bill that now matches is simply matched
    const status =
      result.status === 'matched'
        ? 'matched'
        : bill.match_status === 'overridden'
          ? 'overridden'
          : 'mismatch';
    await this.db.tx
      .updateTable('vendor_bills')
      .set({ match_status: status, match_details: JSON.stringify(result) })
      .where('id', '=', bill.id)
      .execute();
  }

  async rematchOrder(purchaseOrderId: string) {
    const bills = await this.db.tx
      .selectFrom('vendor_bills')
      .select('id')
      .where('purchase_order_id', '=', purchaseOrderId)
      .where('state', '<>', 'cancelled')
      .execute();
    for (const b of bills) await this.match(b.id);
  }

  /** The Admin accepts the variance of a mismatched bill (e.g. a price rise agreed by phone). */
  async overrideMatch(billId: string, reason: string) {
    const bill = await this.db.tx
      .selectFrom('vendor_bills')
      .selectAll()
      .where('id', '=', billId)
      .executeTakeFirst();
    if (!bill) throw new NotFoundException(MSG.BILL_NOT_FOUND);
    this.access.assert('procurement.override_match', {
      companyId: bill.company_id,
    });
    if (bill.match_status !== 'mismatch')
      throw new ConflictException(MSG.BILL_WRONG_STATE);
    if (bill.created_by && bill.created_by === this.access.current().userId)
      throw new ForbiddenException(MSG.FORBIDDEN);
    await this.db.tx
      .updateTable('vendor_bills')
      .set({
        match_status: 'overridden',
        match_override_reason: reason,
        match_overridden_by: this.access.current().userId,
      })
      .where('id', '=', billId)
      .execute();
    await this.audit.record({
      action: 'vendor_bill.match_overridden',
      entity: 'vendor_bill',
      entityId: billId,
      before: { matchStatus: 'mismatch' },
      after: { matchStatus: 'overridden', reason },
    });
    return this.bills.get(billId);
  }

  // ================================================================ read

  async list(companyId: string, query: PurchaseOrderQueryDto) {
    await this.org.assertCompanyExists(companyId);
    let q = this.db.tx
      .selectFrom('purchase_orders as o')
      .innerJoin('vendors as v', 'v.id', 'o.vendor_id')
      .innerJoin('purchase_requisitions as r', 'r.id', 'o.requisition_id')
      .selectAll('o')
      .select([
        'v.code as vendor_code',
        'v.name as vendor_name',
        'r.number as requisition_number',
        'r.title',
      ])
      .where('o.company_id', '=', companyId);
    const scope = this.access.scopeFilter('procurement.view');
    if (!scope.all && !scope.companyIds.includes(companyId)) {
      if (!scope.departmentIds.length)
        throw new ForbiddenException(MSG.FORBIDDEN);
      q = q.where('o.department_id', 'in', scope.departmentIds);
    }
    if (query.state) q = q.where('o.state', '=', query.state);
    if (query.vendorId) q = q.where('o.vendor_id', '=', query.vendorId);
    if (query.billable)
      q = q.where('o.state', 'in', [
        'issued',
        'partially_received',
        'received',
      ]);
    const rows = await q.orderBy('o.created_at', 'desc').limit(300).execute();
    return rows.map((o) => ({
      ...summary(o),
      vendorCode: o.vendor_code,
      vendorName: o.vendor_name,
      requisitionNumber: o.requisition_number,
      title: o.title,
    }));
  }

  async get(id: string) {
    const o = await this.common.findOrder(id);
    if (!this.access.allows('procurement.view', this.common.resourceOf(o)))
      throw new ForbiddenException(MSG.FORBIDDEN);
    const vendor = await this.db.tx
      .selectFrom('vendors')
      .select(['id', 'code', 'name', 'tin', 'bin', 'address'])
      .where('id', '=', o.vendor_id)
      .executeTakeFirstOrThrow();
    const r = await this.common.findRequisition(o.requisition_id);
    const quantities = await this.lineQuantities(id);
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code', 'name_en'])
      .where(
        'id',
        'in',
        [...quantities.values()].map((q) => q.line.account_id),
      )
      .execute();
    const receipts = await this.db.tx
      .selectFrom('goods_receipts')
      .selectAll()
      .where('purchase_order_id', '=', id)
      .orderBy('created_at')
      .execute();
    const receiptLines = receipts.length
      ? await this.db.tx
          .selectFrom('goods_receipt_lines')
          .selectAll()
          .where(
            'receipt_id',
            'in',
            receipts.map((g) => g.id),
          )
          .execute()
      : [];
    const names = await this.common.userNames(
      receipts.map((g) => g.created_by),
    );
    const bills = await this.db.tx
      .selectFrom('vendor_bills')
      .select([
        'id',
        'bill_no',
        'bill_date',
        'state',
        'base_amount',
        'vat_amount',
        'net_payable',
        'paid_amount',
        'match_status',
      ])
      .where('purchase_order_id', '=', id)
      .orderBy('created_at')
      .execute();
    const department = o.department_id
      ? await this.db.tx
          .selectFrom('departments')
          .select('name')
          .where('id', '=', o.department_id)
          .executeTakeFirst()
      : undefined;
    return {
      ...summary(o),
      vendor,
      requisition: { id: r.id, number: r.number, title: r.title },
      departmentName: department?.name ?? null,
      deliverTo: o.deliver_to,
      terms: o.terms,
      cancelReason: o.cancel_reason,
      approvalRequestId: o.approval_request_id,
      budget: o.budget_snapshot,
      lines: [...quantities.values()].map((q) => {
        const account = accounts.find((a) => a.id === q.line.account_id);
        return {
          id: q.line.id,
          lineNo: q.line.line_no,
          description: q.line.description,
          quantity: q.line.quantity,
          unit: q.line.unit,
          unitPrice: q.line.unit_price,
          vatPercent: q.line.vat_percent,
          amount: Money.of(q.line.unit_price)
            .times(q.line.quantity)
            .round()
            .toDb(),
          accountId: q.line.account_id,
          accountCode: account?.code ?? null,
          accountName: account?.name_en ?? null,
          received: q.received.toString(),
          billed: q.billed.toString(),
          toReceive: q.ordered.minus(q.received).toString(),
        };
      }),
      receipts: receipts.map((g) => ({
        id: g.id,
        number: g.number,
        receivedDate: g.received_date,
        note: g.note,
        state: g.state,
        cancelReason: g.cancel_reason,
        recordedBy: g.created_by ? (names.get(g.created_by) ?? null) : null,
        lines: receiptLines
          .filter((l) => l.receipt_id === g.id)
          .map((l) => ({ poLineId: l.po_line_id, quantity: l.quantity })),
      })),
      bills: bills.map((b) => ({
        id: b.id,
        billNo: b.bill_no,
        billDate: b.bill_date,
        state: b.state,
        total: Money.of(b.base_amount).plus(b.vat_amount).toDb(),
        netPayable: b.net_payable,
        paidAmount: b.paid_amount,
        matchStatus: b.match_status,
      })),
    };
  }
}

function summary(o: PurchaseOrder) {
  return {
    id: o.id,
    companyId: o.company_id,
    number: o.number,
    requisitionId: o.requisition_id,
    quotationId: o.quotation_id,
    vendorId: o.vendor_id,
    departmentId: o.department_id,
    orderDate: o.order_date,
    deliveryDate: o.delivery_date,
    baseTotal: o.base_total,
    vatTotal: o.vat_total,
    total: Money.of(o.base_total).plus(o.vat_total).toDb(),
    state: o.state,
    issuedAt: o.issued_at,
    version: o.version,
  };
}
