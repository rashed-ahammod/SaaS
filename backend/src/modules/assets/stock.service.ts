/**
 * Consumables (WP19; spec §6.7 "stock ledger per store with issue requests from
 * departments"). By quantity: consumables are expensed when billed, so the stock
 * ledger keeps counts, not values.
 *
 *   stores and items       Admin / Accounts keep them (stock.manage)
 *   moves                  opening, receipt (in), adjustment (+ / - with a reason), issue
 *                          (out, against a request). The ledger is append-only and the
 *                          balance follows it by trigger; a balance below zero is refused
 *                          by the database, whatever the caller.
 *   issue requests         an employee asks a store for items for their department; the
 *                          Dept Head approves (request type stock_issue); the store issues
 *                          all or part.
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
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  fiscalYearOf,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ApprovalRequest } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  IssueStockDto,
  StockItemDto,
  StockMovesDto,
  StockMovesQueryDto,
  StockQueryDto,
  StockRequestDto,
  StockRequestQueryDto,
  StoreDto,
} from './dto/assets.dto.js';

export const STOCK_ISSUE_REQUEST = 'stock_issue';

@Injectable()
export class StockService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
  ) {}

  onModuleInit() {
    this.handlers.register(
      STOCK_ISSUE_REQUEST,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
        distinctApprovers: true,
      },
      [defaultChain('Store request (default)', step(1, 'dept_head'))],
    );
  }

  private today() {
    return todayInDhaka(this.clock.now());
  }

  // ================================================================ stores and items

  async listStores(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertCompany(companyId, true);
    const rows = await this.db.tx
      .selectFrom('stores as s')
      .leftJoin('employees as e', 'e.id', 's.keeper_employee_id')
      .selectAll('s')
      .select('e.full_name_en as keeper_name')
      .where('s.company_id', '=', companyId)
      .orderBy('s.code')
      .execute();
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      branchId: s.branch_id,
      keeperEmployeeId: s.keeper_employee_id,
      keeperName: s.keeper_name,
      isActive: s.is_active,
    }));
  }

  async createStore(companyId: string, dto: StoreDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('stock.manage', { companyId });
    const row = await this.db.tx
      .insertInto('stores')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name,
        branch_id: dto.branchId ?? null,
        keeper_employee_id: dto.keeperEmployeeId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'store.created',
      entity: 'store',
      entityId: row.id,
      after: dto,
    });
    return (await this.listStores(companyId)).find((s) => s.id === row.id);
  }

  async updateStore(id: string, dto: Partial<StoreDto>) {
    const store = await this.findStore(id);
    this.access.assert('stock.manage', { companyId: store.company_id });
    await this.db.tx
      .updateTable('stores')
      .set({
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.branchId !== undefined ? { branch_id: dto.branchId } : {}),
        ...(dto.keeperEmployeeId !== undefined
          ? { keeper_employee_id: dto.keeperEmployeeId }
          : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'store.updated',
      entity: 'store',
      entityId: id,
      after: dto,
    });
    return (await this.listStores(store.company_id)).find((s) => s.id === id);
  }

  async listItems(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertCompany(companyId, true);
    const rows = await this.db.tx
      .selectFrom('stock_items')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    return rows.map(toItem);
  }

  async createItem(companyId: string, dto: StockItemDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('stock.manage', { companyId });
    const row = await this.db.tx
      .insertInto('stock_items')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name,
        name_bn: dto.nameBn ?? null,
        unit: dto.unit,
        reorder_level: dto.reorderLevel ?? '0',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'stock_item.created',
      entity: 'stock_item',
      entityId: row.id,
      after: dto,
    });
    return toItem(row);
  }

  async updateItem(id: string, dto: Partial<StockItemDto>) {
    const item = await this.db.tx
      .selectFrom('stock_items')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!item) throw new NotFoundException(MSG.STOCK_ITEM_NOT_FOUND);
    this.access.assert('stock.manage', { companyId: item.company_id });
    await this.db.tx
      .updateTable('stock_items')
      .set({
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.nameBn !== undefined ? { name_bn: dto.nameBn } : {}),
        ...(dto.unit ? { unit: dto.unit } : {}),
        ...(dto.reorderLevel !== undefined
          ? { reorder_level: dto.reorderLevel }
          : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'stock_item.updated',
      entity: 'stock_item',
      entityId: id,
      after: dto,
    });
    return toItem(
      await this.db.tx
        .selectFrom('stock_items')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
  }

  // ================================================================ moves

  /** Opening, receipt or adjustment (a reason; out only as far as there is stock). */
  async addMoves(storeId: string, dto: StockMovesDto) {
    const store = await this.findStore(storeId);
    this.access.assert('stock.manage', { companyId: store.company_id });
    if (!store.is_active) throw new ConflictException(MSG.STORE_NOT_FOUND);
    await this.assertItems(
      store.company_id,
      dto.lines.map((l) => l.itemId),
    );
    for (const l of dto.lines) {
      const qty = new Decimal(l.quantity);
      if (qty.isZero() || (dto.kind !== 'adjustment' && qty.isNegative()))
        throw new BadRequestException(MSG.VALIDATION_FAILED);
    }
    await this.assertAvailable(
      storeId,
      dto.lines
        .filter((l) => new Decimal(l.quantity).isNegative())
        .map((l) => ({
          itemId: l.itemId,
          quantity: new Decimal(l.quantity).negated(),
        })),
    );
    await this.db.tx
      .insertInto('stock_moves')
      .values(
        dto.lines.map((l) => ({
          store_id: storeId,
          item_id: l.itemId,
          move_date: dto.moveDate,
          kind: dto.kind,
          quantity: l.quantity,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
        })),
      )
      .execute();
    await this.audit.record({
      action: `stock.${dto.kind}`,
      entity: 'store',
      entityId: storeId,
      after: dto,
    });
    return this.balances(store.company_id, { storeId });
  }

  async listMoves(storeId: string, query: StockMovesQueryDto) {
    const store = await this.findStore(storeId);
    this.assertCompany(store.company_id, true);
    let q = this.db.tx
      .selectFrom('stock_moves as m')
      .innerJoin('stock_items as i', 'i.id', 'm.item_id')
      .leftJoin('stock_issue_requests as r', 'r.id', 'm.issue_request_id')
      .select([
        'm.id',
        'm.move_date',
        'm.kind',
        'm.quantity',
        'm.reference',
        'm.note',
        'm.created_at',
        'i.code',
        'i.name',
        'i.unit',
        'r.number as request_number',
      ])
      .where('m.store_id', '=', storeId);
    if (query.itemId) q = q.where('m.item_id', '=', query.itemId);
    if (query.from) q = q.where('m.move_date', '>=', query.from);
    if (query.to) q = q.where('m.move_date', '<=', query.to);
    const rows = await q
      .orderBy('m.move_date', 'desc')
      .orderBy('m.created_at', 'desc')
      .limit(500)
      .execute();
    return rows.map((m) => ({
      id: m.id,
      moveDate: m.move_date,
      kind: m.kind,
      quantity: m.quantity,
      reference: m.reference,
      note: m.note,
      itemCode: m.code,
      itemName: m.name,
      unit: m.unit,
      requestNumber: m.request_number,
      createdAt: m.created_at,
    }));
  }

  /** Stock on hand per store and item (and what is below its reorder level). */
  async balances(companyId: string, query: StockQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.assertCompany(companyId, true);
    let q = this.db.tx
      .selectFrom('stock_items as i')
      .innerJoin('stores as s', (j) =>
        j.onRef('s.company_id', '=', 'i.company_id'),
      )
      .leftJoin('stock_balances as b', (j) =>
        j.onRef('b.store_id', '=', 's.id').onRef('b.item_id', '=', 'i.id'),
      )
      .select([
        's.id as store_id',
        's.code as store_code',
        's.name as store_name',
        'i.id as item_id',
        'i.code',
        'i.name',
        'i.name_bn',
        'i.unit',
        'i.reorder_level',
        sql<string>`coalesce(b.quantity, 0)`.as('quantity'),
      ])
      .where('i.company_id', '=', companyId)
      .where('i.is_active', '=', true)
      .where('s.is_active', '=', true)
      // an item shows in the stores it has been kept in; one never stocked anywhere in every store
      // (it needs its first receipt) - not office paper as "low" in the finished-goods depot (2026-10-31)
      .where((eb) =>
        eb.or([
          eb('b.store_id', 'is not', null),
          eb.not(
            eb.exists(
              eb
                .selectFrom('stock_balances as x')
                .select('x.item_id')
                .whereRef('x.item_id', '=', 'i.id'),
            ),
          ),
        ]),
      );
    if (query.storeId) q = q.where('s.id', '=', query.storeId);
    const rows = await q.orderBy('s.code').orderBy('i.code').execute();
    return rows
      .map((r) => ({
        storeId: r.store_id,
        storeCode: r.store_code,
        storeName: r.store_name,
        itemId: r.item_id,
        itemCode: r.code,
        itemName: r.name,
        itemNameBn: r.name_bn,
        unit: r.unit,
        quantity: new Decimal(r.quantity).toString(),
        reorderLevel: new Decimal(r.reorder_level).toString(),
        belowReorder:
          new Decimal(r.quantity).lessThanOrEqualTo(r.reorder_level) &&
          new Decimal(r.reorder_level).isPositive(),
      }))
      .filter((r) => !query.belowReorder || r.belowReorder);
  }

  // ================================================================ issue requests

  async createRequest(companyId: string, dto: StockRequestDto) {
    await this.org.assertCompanyExists(companyId);
    const me = this.access.current().employeeId;
    if (!me) throw new ForbiddenException(MSG.FORBIDDEN);
    const employee = await this.employeeAccess.find(me);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (employee.company_id !== companyId)
      throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    this.access.assert('stock.request_own', resource);
    const store = await this.findStore(dto.storeId);
    if (store.company_id !== companyId || !store.is_active)
      throw new NotFoundException(MSG.STORE_NOT_FOUND);
    await this.assertItems(
      companyId,
      dto.lines.map((l) => l.itemId),
    );
    if (new Set(dto.lines.map((l) => l.itemId)).size !== dto.lines.length)
      throw new BadRequestException(MSG.VALIDATION_FAILED);

    const number = await this.nextNumber(companyId);
    const request = await this.db.tx
      .insertInto('stock_issue_requests')
      .values({
        company_id: companyId,
        number,
        store_id: store.id,
        requester_id: employee.id,
        department_id: resource.departmentId ?? null,
        note: dto.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('stock_issue_request_lines')
      .values(
        dto.lines.map((l) => ({
          request_id: request.id,
          item_id: l.itemId,
          quantity_requested: l.quantity,
        })),
      )
      .execute();
    const items = await this.db.tx
      .selectFrom('stock_items')
      .select(['id', 'name', 'unit'])
      .where(
        'id',
        'in',
        dto.lines.map((l) => l.itemId),
      )
      .execute();
    const approval = await this.approvals.submit({
      requestType: STOCK_ISSUE_REQUEST,
      sourceId: request.id,
      subjectEmployeeId: employee.id,
      companyId,
      summary: `Store request ${number}: ${employee.full_name_en}, ${dto.lines.length} item(s) from ${store.name}`,
      snapshot: {
        number,
        store: store.name,
        requester: `${employee.employee_code} ${employee.full_name_en}`,
        note: dto.note ?? null,
        items: dto.lines
          .map((l) => {
            const i = items.find((x) => x.id === l.itemId)!;
            return `${l.quantity} ${i.unit} ${i.name}`;
          })
          .join('; '),
      },
    });
    await this.db.tx
      .updateTable('stock_issue_requests')
      .set({ approval_request_id: approval.id })
      .where('id', '=', request.id)
      .execute();
    await this.audit.record({
      action: 'stock_request.created',
      entity: 'stock_issue_request',
      entityId: request.id,
      after: { number, store: store.code, lines: dto.lines },
    });
    return this.getRequest(request.id);
  }

  private async approved(request: ApprovalRequest) {
    await this.db.tx
      .updateTable('stock_issue_requests')
      .set({ state: 'approved' })
      .where('id', '=', request.source_id)
      .execute();
  }

  private async closed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    // a returned store request is simply closed: the employee asks again
    await this.db.tx
      .updateTable('stock_issue_requests')
      .set({ state: outcome === 'rejected' ? 'rejected' : 'cancelled' })
      .where('id', '=', request.source_id)
      .execute();
  }

  /** The store hands over all or part of an approved request; never more than in stock. */
  async issue(requestId: string, dto: IssueStockDto) {
    const r = await this.findRequest(requestId);
    this.access.assert('stock.manage', { companyId: r.company_id });
    if (r.state !== 'approved' && r.state !== 'partially_issued')
      throw new ConflictException(MSG.STOCK_REQUEST_WRONG_STATE);
    const lines = await this.db.tx
      .selectFrom('stock_issue_request_lines')
      .selectAll()
      .where('request_id', '=', requestId)
      .execute();
    const wanted = new Map<string, Decimal>();
    for (const l of dto.lines) {
      const line = lines.find((x) => x.item_id === l.itemId);
      const qty = new Decimal(l.quantity);
      if (
        !line ||
        qty.lessThanOrEqualTo(0) ||
        qty.plus(line.quantity_issued).greaterThan(line.quantity_requested)
      )
        throw new BadRequestException(MSG.VALIDATION_FAILED);
      wanted.set(l.itemId, qty);
    }
    await this.assertAvailable(
      r.store_id,
      [...wanted].map(([itemId, quantity]) => ({ itemId, quantity })),
    );
    await this.db.tx
      .insertInto('stock_moves')
      .values(
        [...wanted].map(([itemId, qty]) => ({
          store_id: r.store_id,
          item_id: itemId,
          move_date: dto.issueDate,
          kind: 'issue' as const,
          quantity: qty.negated().toString(),
          reference: r.number,
          issue_request_id: r.id,
        })),
      )
      .execute();
    for (const [itemId, qty] of wanted) {
      await this.db.tx
        .updateTable('stock_issue_request_lines')
        .set({
          quantity_issued: sql`quantity_issued + ${qty.toString()}::numeric`,
        })
        .where('request_id', '=', requestId)
        .where('item_id', '=', itemId)
        .execute();
    }
    const after = await this.db.tx
      .selectFrom('stock_issue_request_lines')
      .select(['quantity_requested', 'quantity_issued'])
      .where('request_id', '=', requestId)
      .execute();
    const complete = after.every((l) =>
      new Decimal(l.quantity_issued).greaterThanOrEqualTo(l.quantity_requested),
    );
    await this.db.tx
      .updateTable('stock_issue_requests')
      .set({ state: complete ? 'issued' : 'partially_issued' })
      .where('id', '=', requestId)
      .execute();
    await this.audit.record({
      action: 'stock.issued',
      entity: 'stock_issue_request',
      entityId: requestId,
      after: { number: r.number, lines: dto.lines },
    });
    return this.getRequest(requestId);
  }

  async listRequests(companyId: string, query: StockRequestQueryDto) {
    await this.org.assertCompanyExists(companyId);
    let q = this.db.tx
      .selectFrom('stock_issue_requests as r')
      .innerJoin('employees as e', 'e.id', 'r.requester_id')
      .innerJoin('stores as s', 's.id', 'r.store_id')
      .leftJoin('departments as d', 'd.id', 'r.department_id')
      .selectAll('r')
      .select([
        'e.employee_code',
        'e.full_name_en',
        's.name as store_name',
        'd.name as department_name',
      ])
      .where('r.company_id', '=', companyId);
    const scope = this.access.scopeFilter('stock.view');
    if (
      !this.access.allows('stock.manage', { companyId }) &&
      !scope.all &&
      !scope.companyIds.includes(companyId)
    ) {
      if (!scope.departmentIds.length)
        throw new ForbiddenException(MSG.FORBIDDEN);
      q = q.where('r.department_id', 'in', scope.departmentIds);
    }
    if (query.state) q = q.where('r.state', '=', query.state);
    const rows = await q.orderBy('r.created_at', 'desc').limit(300).execute();
    return rows.map((r) => ({
      ...toRequest(r),
      requesterCode: r.employee_code,
      requesterName: r.full_name_en,
      storeName: r.store_name,
      departmentName: r.department_name,
    }));
  }

  async myRequests() {
    const me = this.access.current().employeeId;
    if (!me) return [];
    const rows = await this.db.tx
      .selectFrom('stock_issue_requests as r')
      .innerJoin('stores as s', 's.id', 'r.store_id')
      .selectAll('r')
      .select('s.name as store_name')
      .where('r.requester_id', '=', me)
      .orderBy('r.created_at', 'desc')
      .limit(100)
      .execute();
    const lines = rows.length
      ? await this.requestLines(rows.map((r) => r.id))
      : [];
    return rows.map((r) => ({
      ...toRequest(r),
      storeName: r.store_name,
      lines: lines.filter((l) => l.requestId === r.id),
    }));
  }

  async getRequest(id: string) {
    const r = await this.findRequest(id);
    const own = r.requester_id === this.access.current().employeeId;
    if (
      !own &&
      !this.access.allows('stock.view', {
        companyId: r.company_id,
        departmentId: r.department_id,
      }) &&
      !this.access.allows('stock.manage', { companyId: r.company_id })
    ) {
      throw new ForbiddenException(MSG.FORBIDDEN);
    }
    const requester = await this.employeeAccess.find(r.requester_id);
    const store = await this.findStore(r.store_id);
    const lines = await this.requestLines([id]);
    const stock = await this.db.tx
      .selectFrom('stock_balances')
      .select(['item_id', 'quantity'])
      .where('store_id', '=', r.store_id)
      .where(
        'item_id',
        'in',
        lines.map((l) => l.itemId),
      )
      .execute();
    return {
      ...toRequest(r),
      requester: {
        id: requester.id,
        code: requester.employee_code,
        name: requester.full_name_en,
      },
      storeName: store.name,
      lines: lines.map((l) => ({
        ...l,
        inStock: new Decimal(
          stock.find((s) => s.item_id === l.itemId)?.quantity ?? 0,
        ).toString(),
      })),
    };
  }

  // ================================================================ helpers

  private async requestLines(requestIds: string[]) {
    const rows = await this.db.tx
      .selectFrom('stock_issue_request_lines as l')
      .innerJoin('stock_items as i', 'i.id', 'l.item_id')
      .select([
        'l.request_id',
        'l.item_id',
        'i.code',
        'i.name',
        'i.name_bn',
        'i.unit',
        'l.quantity_requested',
        'l.quantity_issued',
      ])
      .where('l.request_id', 'in', requestIds)
      .orderBy('i.code')
      .execute();
    return rows.map((l) => ({
      requestId: l.request_id,
      itemId: l.item_id,
      itemCode: l.code,
      itemName: l.name,
      itemNameBn: l.name_bn,
      unit: l.unit,
      quantityRequested: new Decimal(l.quantity_requested).toString(),
      quantityIssued: new Decimal(l.quantity_issued).toString(),
    }));
  }

  /**
   * A friendly refusal before the database's own check (stock never below zero). No row
   * lock: the app may only read stock_balances; the trigger's update serialises moves.
   */
  private async assertAvailable(
    storeId: string,
    out: Array<{ itemId: string; quantity: Decimal }>,
  ) {
    if (!out.length) return;
    const rows = await this.db.tx
      .selectFrom('stock_balances')
      .select(['item_id', 'quantity'])
      .where('store_id', '=', storeId)
      .where(
        'item_id',
        'in',
        out.map((o) => o.itemId),
      )
      .execute();
    for (const o of out) {
      const have = new Decimal(
        rows.find((r) => r.item_id === o.itemId)?.quantity ?? 0,
      );
      if (o.quantity.greaterThan(have))
        throw new ConflictException({
          message: MSG.STOCK_NOT_ENOUGH,
          details: {
            itemId: o.itemId,
            inStock: have.toString(),
            asked: o.quantity.toString(),
          },
        });
    }
  }

  private async assertItems(companyId: string, ids: string[]) {
    const rows = await this.db.tx
      .selectFrom('stock_items')
      .select(['id', 'company_id', 'is_active'])
      .where('id', 'in', ids)
      .execute();
    if (
      ids.some(
        (id) =>
          !rows.find(
            (r) => r.id === id && r.company_id === companyId && r.is_active,
          ),
      )
    )
      throw new NotFoundException(MSG.STOCK_ITEM_NOT_FOUND);
  }

  private async findStore(id: string) {
    const s = await this.db.tx
      .selectFrom('stores')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s) throw new NotFoundException(MSG.STORE_NOT_FOUND);
    return s;
  }

  private async findRequest(id: string) {
    const r = await this.db.tx
      .selectFrom('stock_issue_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException(MSG.STOCK_REQUEST_NOT_FOUND);
    return r;
  }

  /** Stores and items are visible to anyone who may ask the store (an employee) or keep it. */
  private assertCompany(companyId: string, readOnly: boolean) {
    if (this.access.allows('stock.manage', { companyId })) return;
    const scope = this.access.scopeFilter('stock.view');
    const viewer =
      scope.all ||
      scope.companyIds.includes(companyId) ||
      scope.departmentIds.length > 0;
    // an employee who may ask the store sees its stores and items
    const ok =
      readOnly &&
      (viewer ||
        this.access.allows('stock.request_own', {
          companyId,
          employeeId: this.access.current().employeeId,
        }));
    if (!ok) throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private async nextNumber(companyId: string): Promise<string> {
    const code = fiscalYearOf(businessDate(this.today()));
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'stock_request',
        fiscal_year_code: code,
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'kind', 'fiscal_year_code'])
          .doUpdateSet({ last_no: sql`payables_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return `SIR/${code}/${String(row.last_no).padStart(5, '0')}`;
  }
}

function toItem(i: {
  id: string;
  code: string;
  name: string;
  name_bn: string | null;
  unit: string;
  reorder_level: string;
  is_active: boolean;
}) {
  return {
    id: i.id,
    code: i.code,
    name: i.name,
    nameBn: i.name_bn,
    unit: i.unit,
    reorderLevel: new Decimal(i.reorder_level).toString(),
    isActive: i.is_active,
  };
}

function toRequest(r: {
  id: string;
  company_id: string;
  number: string;
  store_id: string;
  requester_id: string;
  department_id: string | null;
  note: string | null;
  state: string;
  approval_request_id: string | null;
  created_at: Date;
}) {
  return {
    id: r.id,
    companyId: r.company_id,
    number: r.number,
    storeId: r.store_id,
    requesterId: r.requester_id,
    departmentId: r.department_id,
    note: r.note,
    state: r.state,
    approvalRequestId: r.approval_request_id,
    createdAt: r.created_at,
  };
}
