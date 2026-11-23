/**
 * Purchase requisitions (WP17; spec §6.7 steps 1-2, §5 "Purchase requisition"):
 *
 *   draft --submit--> in_approval: Dept Head -> Accounts (budget check) [-> Admin from the
 *                     company's Admin threshold] --approved--> approved
 *   approved: Accounts records quotations; from the quotation threshold at least the
 *             minimum number, and a comparative statement (the chosen quotation; a reason
 *             when it is not the lowest) that the Admin approves
 *   approved --purchase order--> ordered (PurchaseOrdersService)
 *   returned -> draft; rejected / withdrawn -> rejected / cancelled
 *
 * Any employee raises one for themself (procurement.request_own); Accounts may raise one
 * for any employee. The requisition's department is the requester's department.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  PurchaseRequisition,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { conditionalChain, defaultChain, step } from '../approvals/chains.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  ComparativeStatementDto,
  CreateRequisitionDto,
  QuotationDto,
  RequisitionLineDto,
  RequisitionQueryDto,
  UpdateRequisitionDto,
} from './dto/procurement.dto.js';
import { BudgetPositionService } from '../budgets/budget-position.service.js';
import {
  COMPARATIVE_STATEMENT_REQUEST,
  ProcurementCommon,
  PURCHASE_REQUISITION_REQUEST,
} from './procurement-common.js';

const ABOVE_ADMIN = 'above_admin_threshold';
/** WP18: over the department's budget (or no budget where the company uses budgets) */
const OVER_BUDGET = 'over_budget';

@Injectable()
export class RequisitionsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly common: ProcurementCommon,
    private readonly budgets: BudgetPositionService,
  ) {}

  onModuleInit() {
    this.handlers.register(
      PURCHASE_REQUISITION_REQUEST,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
        distinctApprovers: true,
      },
      [
        conditionalChain(
          'Purchase requisition above the Admin threshold or over budget (default)',
          { kinds: [ABOVE_ADMIN, OVER_BUDGET] },
          step(1, 'dept_head'),
          step(2, 'role:accounts'),
          step(3, 'role:admin'),
        ),
        defaultChain(
          'Purchase requisition (default)',
          step(1, 'dept_head'),
          step(2, 'role:accounts'),
        ),
      ],
    );
    this.handlers.register(
      COMPARATIVE_STATEMENT_REQUEST,
      {
        onApproved: (r) => this.statementApproved(r),
        onClosed: (r) => this.statementClosed(r),
        distinctApprovers: true,
      },
      [defaultChain('Comparative statement (default)', step(1, 'role:admin'))],
    );
  }

  // ================================================================ requester

  async create(companyId: string, dto: CreateRequisitionDto) {
    await this.org.assertCompanyExists(companyId);
    const employeeId = dto.employeeId ?? this.access.current().employeeId;
    if (!employeeId) throw new ForbiddenException(MSG.FORBIDDEN);
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (employee.company_id !== companyId)
      throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    const own = employee.id === this.access.current().employeeId;
    if (
      !(own && this.access.allows('procurement.request_own', resource)) &&
      !this.access.allows('procurement.manage', { companyId })
    ) {
      throw new ForbiddenException(MSG.FORBIDDEN);
    }

    const number = await this.common.nextNumber(
      companyId,
      'purchase_requisition',
      this.common.today(),
    );
    const requisition = await this.db.tx
      .insertInto('purchase_requisitions')
      .values({
        company_id: companyId,
        number,
        requester_id: employee.id,
        department_id: resource.departmentId ?? null,
        title: dto.title,
        justification: dto.justification,
        needed_by: dto.neededBy ?? null,
        estimated_total: estimate(dto.lines),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.insertLines(requisition.id, dto.lines);
    await this.audit.record({
      action: 'purchase_requisition.created',
      entity: 'purchase_requisition',
      entityId: requisition.id,
      after: {
        number,
        title: dto.title,
        estimatedTotal: requisition.estimated_total,
      },
    });
    return this.get(requisition.id);
  }

  async update(id: string, dto: UpdateRequisitionDto) {
    const r = await this.common.findRequisition(id);
    await this.assertCanEdit(r);
    if (r.state !== 'draft')
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);
    if (r.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    if (dto.lines) {
      await this.db.tx
        .deleteFrom('purchase_requisition_lines')
        .where('requisition_id', '=', id)
        .execute();
      await this.insertLines(id, dto.lines);
    }
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.justification ? { justification: dto.justification } : {}),
        ...(dto.neededBy !== undefined ? { needed_by: dto.neededBy } : {}),
        ...(dto.lines ? { estimated_total: estimate(dto.lines) } : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'purchase_requisition.updated',
      entity: 'purchase_requisition',
      entityId: id,
      after: dto,
    });
    return this.get(id);
  }

  async submit(id: string) {
    const r = await this.common.findRequisition(id);
    await this.assertCanEdit(r);
    if (r.state !== 'draft')
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);
    const settings = await this.common.settings(r.company_id);
    const requester = await this.employeeAccess.find(r.requester_id);
    const lines = await this.lines(id);

    // the budget check (spec §5): over the department's budget -> the Admin approves too
    const budget = await this.budgets.departmentCheck(
      r.company_id,
      r.department_id,
      this.common.today(),
      r.estimated_total,
    );
    const after = budget.lines[0]?.after;
    const aboveThreshold =
      Money.of(r.estimated_total).compare(settings.adminThreshold) >= 0;
    const kind = budget.needsAdmin
      ? OVER_BUDGET
      : aboveThreshold
        ? ABOVE_ADMIN
        : budget.status === 'warning'
          ? 'budget_warning'
          : 'normal';

    const request = await this.approvals.submit({
      requestType: PURCHASE_REQUISITION_REQUEST,
      sourceId: id,
      subjectEmployeeId: r.requester_id,
      companyId: r.company_id,
      amount: r.estimated_total,
      kind,
      summary: `Purchase requisition ${r.number}: ${r.title} (${requester.full_name_en}), est. Tk ${r.estimated_total}${budget.status === 'over' ? ' - OVER BUDGET' : ''}`,
      snapshot: {
        number: r.number,
        title: r.title,
        justification: r.justification,
        neededBy: r.needed_by,
        requester: `${requester.employee_code} ${requester.full_name_en}`,
        estimatedTotal: r.estimated_total,
        lines: lines
          .map(
            (l) =>
              `${l.quantity} ${l.unit} ${l.description} @ Tk ${l.estimated_unit_price}`,
          )
          .join('; '),
        budget:
          budget.status === 'not_used'
            ? null
            : budget.status === 'no_budget'
              ? `No ${budget.fiscalYear} budget for this department`
              : `${budget.fiscalYear}: Tk ${after!.used} of Tk ${after!.budget} after this (${after!.percent ?? '-'}%) - ${budget.status}`,
      },
    });
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({
        state: 'in_approval',
        approval_request_id: request.id,
        budget_status: budget.status,
        budget_snapshot: JSON.stringify(budget),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'purchase_requisition.submitted',
      entity: 'purchase_requisition',
      entityId: id,
      after: { approvalRequestId: request.id },
    });
    return this.get(id);
  }

  /** A draft is cancelled here; one in approval is withdrawn through the approvals inbox. */
  async cancel(id: string, reason: string) {
    const r = await this.common.findRequisition(id);
    await this.assertCanEdit(r);
    if (r.state === 'approved') {
      // an approved one Accounts may close while nothing is ordered
      this.access.assert('procurement.manage', { companyId: r.company_id });
    } else if (r.state !== 'draft') {
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);
    }
    if (r.cs_state === 'in_approval')
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({ state: 'cancelled', cancel_reason: reason })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'purchase_requisition.cancelled',
      entity: 'purchase_requisition',
      entityId: id,
      after: { reason },
    });
    return this.get(id);
  }

  private async approved(request: ApprovalRequest) {
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({ state: 'approved' })
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: 'purchase_requisition.approved',
      entity: 'purchase_requisition',
      entityId: request.source_id,
      after: { approvalRequestId: request.id },
    });
  }

  private async closed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    const state =
      outcome === 'returned'
        ? 'draft'
        : outcome === 'rejected'
          ? 'rejected'
          : 'cancelled';
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({
        state,
        ...(outcome === 'returned' ? { approval_request_id: null } : {}),
      })
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: `purchase_requisition.${outcome}`,
      entity: 'purchase_requisition',
      entityId: request.source_id,
      after: { approvalRequestId: request.id },
    });
  }

  // ================================================================ quotations (Accounts)

  async addQuotation(requisitionId: string, dto: QuotationDto) {
    const r = await this.common.findRequisition(requisitionId);
    this.access.assert('procurement.manage', { companyId: r.company_id });
    if (r.state !== 'approved' || r.cs_state !== 'none')
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);
    const vendor = await this.db.tx
      .selectFrom('vendors')
      .select(['id', 'company_id', 'is_active'])
      .where('id', '=', dto.vendorId)
      .executeTakeFirst();
    if (!vendor || vendor.company_id !== r.company_id)
      throw new NotFoundException(MSG.VENDOR_NOT_FOUND);
    if (!vendor.is_active) throw new BadRequestException(MSG.VENDOR_INACTIVE);

    // a price for every line of the requisition, once
    const lines = await this.lines(requisitionId);
    const priced = new Map(dto.lines.map((l) => [l.requisitionLineId, l]));
    if (
      priced.size !== dto.lines.length ||
      lines.length !== priced.size ||
      lines.some((l) => !priced.has(l.id))
    )
      throw new BadRequestException(MSG.QUOTATION_INCOMPLETE);
    let base = Money.zero();
    let vat = Money.zero();
    for (const l of lines) {
      const p = priced.get(l.id)!;
      const amount = Money.of(p.unitPrice).times(l.quantity).round();
      base = base.plus(amount);
      vat = vat.plus(
        amount
          .times(p.vatPercent ?? '0')
          .dividedBy(100)
          .round(),
      );
    }

    const quotation = await this.db.tx
      .insertInto('quotations')
      .values({
        requisition_id: requisitionId,
        vendor_id: vendor.id,
        reference: dto.reference,
        quotation_date: dto.quotationDate,
        valid_until: dto.validUntil ?? null,
        delivery_days: dto.deliveryDays ?? null,
        note: dto.note ?? null,
        base_total: base.toDb(),
        vat_total: vat.toDb(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('quotation_lines')
      .values(
        dto.lines.map((l) => ({
          quotation_id: quotation.id,
          requisition_line_id: l.requisitionLineId,
          unit_price: Money.of(l.unitPrice).toDb(),
          vat_percent: l.vatPercent ?? '0',
        })),
      )
      .execute();
    await this.audit.record({
      action: 'quotation.recorded',
      entity: 'purchase_requisition',
      entityId: requisitionId,
      after: {
        quotationId: quotation.id,
        vendorId: vendor.id,
        reference: dto.reference,
        total: base.plus(vat).toDb(),
      },
    });
    return this.get(requisitionId);
  }

  async withdrawQuotation(quotationId: string, reason: string) {
    const q = await this.db.tx
      .selectFrom('quotations')
      .selectAll()
      .where('id', '=', quotationId)
      .executeTakeFirst();
    if (!q || q.state !== 'active')
      throw new NotFoundException(MSG.QUOTATION_NOT_FOUND);
    const r = await this.common.findRequisition(q.requisition_id);
    this.access.assert('procurement.manage', { companyId: r.company_id });
    if (r.state !== 'approved' || r.cs_state !== 'none')
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);
    await this.db.tx
      .updateTable('quotations')
      .set({ state: 'withdrawn' })
      .where('id', '=', quotationId)
      .execute();
    await this.audit.record({
      action: 'quotation.withdrawn',
      entity: 'purchase_requisition',
      entityId: r.id,
      after: { quotationId, reason },
    });
    return this.get(r.id);
  }

  /**
   * The comparative statement: the chosen quotation. From the quotation threshold the
   * minimum number of quotations is needed and the Admin approves; below it the
   * choice stands at once.
   */
  async submitStatement(requisitionId: string, dto: ComparativeStatementDto) {
    const r = await this.common.findRequisition(requisitionId);
    this.access.assert('procurement.manage', { companyId: r.company_id });
    if (r.state !== 'approved' || r.cs_state !== 'none')
      throw new ConflictException(MSG.REQUISITION_WRONG_STATE);
    const quotations = await this.db.tx
      .selectFrom('quotations')
      .selectAll()
      .where('requisition_id', '=', requisitionId)
      .where('state', '=', 'active')
      .execute();
    const chosen = quotations.find((q) => q.id === dto.quotationId);
    if (!chosen) throw new NotFoundException(MSG.QUOTATION_NOT_FOUND);

    const settings = await this.common.settings(r.company_id);
    const needsStatement =
      Money.of(r.estimated_total).compare(settings.quotationThreshold) >= 0;
    if (needsStatement && quotations.length < settings.minQuotations) {
      throw new BadRequestException({
        message: MSG.QUOTATIONS_TOO_FEW,
        details: { have: quotations.length, need: settings.minQuotations },
      });
    }
    const total = (q: { base_total: string; vat_total: string }) =>
      Money.of(q.base_total).plus(q.vat_total);
    const lowest = quotations.reduce((a, b) =>
      total(b).compare(total(a)) < 0 ? b : a,
    );
    const isLowest = total(chosen).compare(total(lowest)) <= 0;
    if (!isLowest && !dto.reason?.trim())
      throw new BadRequestException(MSG.SELECTION_REASON_REQUIRED);

    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({
        selected_quotation_id: chosen.id,
        selection_reason: dto.reason ?? null,
        cs_state: needsStatement ? 'in_approval' : 'approved',
      })
      .where('id', '=', requisitionId)
      .execute();
    if (needsStatement) {
      const vendors = await this.db.tx
        .selectFrom('vendors')
        .select(['id', 'name'])
        .where(
          'id',
          'in',
          quotations.map((q) => q.vendor_id),
        )
        .execute();
      const name = (id: string) => vendors.find((v) => v.id === id)?.name ?? id;
      const request = await this.approvals.submit({
        requestType: COMPARATIVE_STATEMENT_REQUEST,
        sourceId: requisitionId,
        subjectEmployeeId: r.requester_id,
        companyId: r.company_id,
        amount: total(chosen).toDb(),
        summary: `Comparative statement ${r.number}: ${name(chosen.vendor_id)}, Tk ${total(chosen).toDb()} (${quotations.length} quotations)`,
        snapshot: {
          requisition: `${r.number} ${r.title}`,
          quotations: quotations
            .sort((a, b) => total(a).compare(total(b)))
            .map(
              (q) =>
                `${name(q.vendor_id)}: Tk ${total(q).toDb()}${q.delivery_days !== null ? `, ${q.delivery_days} days` : ''}`,
            )
            .join('; '),
          chosen: name(chosen.vendor_id),
          lowest: isLowest ? 'yes' : 'no',
          reason: dto.reason ?? null,
        },
      });
      await this.db.tx
        .updateTable('purchase_requisitions')
        .set({ cs_approval_request_id: request.id })
        .where('id', '=', requisitionId)
        .execute();
    }
    await this.audit.record({
      action: 'comparative_statement.submitted',
      entity: 'purchase_requisition',
      entityId: requisitionId,
      after: {
        quotationId: chosen.id,
        lowest: isLowest,
        reason: dto.reason,
        needsApproval: needsStatement,
      },
    });
    return this.get(requisitionId);
  }

  private async statementApproved(request: ApprovalRequest) {
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({ cs_state: 'approved' })
      .where('id', '=', request.source_id)
      .execute();
    await this.audit.record({
      action: 'comparative_statement.approved',
      entity: 'purchase_requisition',
      entityId: request.source_id,
      after: { approvalRequestId: request.id },
    });
  }

  /** Returned, rejected or withdrawn: Accounts chooses again (more quotations, another vendor). */
  private async statementClosed(request: ApprovalRequest) {
    await this.db.tx
      .updateTable('purchase_requisitions')
      .set({
        cs_state: 'none',
        selected_quotation_id: null,
        selection_reason: null,
        cs_approval_request_id: null,
      })
      .where('id', '=', request.source_id)
      .execute();
  }

  // ================================================================ read

  async list(companyId: string, query: RequisitionQueryDto) {
    await this.org.assertCompanyExists(companyId);
    let q = this.db.tx
      .selectFrom('purchase_requisitions as r')
      .innerJoin('employees as e', 'e.id', 'r.requester_id')
      .leftJoin('departments as d', 'd.id', 'r.department_id')
      .selectAll('r')
      .select([
        'e.employee_code',
        'e.full_name_en',
        'd.name as department_name',
      ])
      .where('r.company_id', '=', companyId);
    // whole company, or the departments in the user's scope (a Dept Head)
    const scope = this.access.scopeFilter('procurement.view');
    if (!scope.all && !scope.companyIds.includes(companyId)) {
      if (!scope.departmentIds.length)
        throw new ForbiddenException(MSG.FORBIDDEN);
      q = q.where(
        'r.department_id',
        'in',
        await this.withSubDepartments(scope.departmentIds),
      );
    }
    if (query.state) q = q.where('r.state', '=', query.state);
    const rows = await q.orderBy('r.created_at', 'desc').limit(300).execute();
    return rows.map((r) => ({
      ...summary(r),
      requesterCode: r.employee_code,
      requesterName: r.full_name_en,
      departmentName: r.department_name,
    }));
  }

  /** The signed-in employee's own requisitions (app). */
  async mine() {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) return [];
    const rows = await this.db.tx
      .selectFrom('purchase_requisitions')
      .selectAll()
      .where('requester_id', '=', employeeId)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    const orders = rows.length
      ? await this.db.tx
          .selectFrom('purchase_orders')
          .select(['requisition_id', 'number', 'state'])
          .where(
            'requisition_id',
            'in',
            rows.map((r) => r.id),
          )
          .where('state', '<>', 'cancelled')
          .execute()
      : [];
    return rows.map((r) => {
      const po = orders.find((o) => o.requisition_id === r.id);
      return {
        ...summary(r),
        purchaseOrder: po ? { number: po.number, state: po.state } : null,
      };
    });
  }

  async get(id: string) {
    const r = await this.common.findRequisition(id);
    await this.assertCanSee(r);
    const requester = await this.employeeAccess.find(r.requester_id);
    const lines = await this.lines(id);
    const quotations = await this.db.tx
      .selectFrom('quotations as q')
      .innerJoin('vendors as v', 'v.id', 'q.vendor_id')
      .selectAll('q')
      .select(['v.code as vendor_code', 'v.name as vendor_name'])
      .where('q.requisition_id', '=', id)
      .orderBy('q.created_at')
      .execute();
    const qLines = quotations.length
      ? await this.db.tx
          .selectFrom('quotation_lines')
          .selectAll()
          .where(
            'quotation_id',
            'in',
            quotations.map((q) => q.id),
          )
          .execute()
      : [];
    const active = quotations.filter((q) => q.state === 'active');
    const total = (q: { base_total: string; vat_total: string }) =>
      Money.of(q.base_total).plus(q.vat_total);
    const lowest = active.length
      ? active.reduce((a, b) => (total(b).compare(total(a)) < 0 ? b : a)).id
      : null;
    const order = await this.db.tx
      .selectFrom('purchase_orders')
      .select(['id', 'number', 'state'])
      .where('requisition_id', '=', id)
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    const settings = await this.common.settings(r.company_id);
    const department = r.department_id
      ? await this.db.tx
          .selectFrom('departments')
          .select('name')
          .where('id', '=', r.department_id)
          .executeTakeFirst()
      : undefined;
    return {
      ...summary(r),
      justification: r.justification,
      requester: {
        id: requester.id,
        code: requester.employee_code,
        name: requester.full_name_en,
      },
      departmentName: department?.name ?? null,
      approvalRequestId: r.approval_request_id,
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        estimatedUnitPrice: l.estimated_unit_price,
      })),
      quotations: quotations.map((q) => ({
        id: q.id,
        vendorId: q.vendor_id,
        vendorCode: q.vendor_code,
        vendorName: q.vendor_name,
        reference: q.reference,
        quotationDate: q.quotation_date,
        validUntil: q.valid_until,
        deliveryDays: q.delivery_days,
        note: q.note,
        baseTotal: q.base_total,
        vatTotal: q.vat_total,
        total: total(q).toDb(),
        state: q.state,
        lowest: q.id === lowest,
        selected: q.id === r.selected_quotation_id,
        lines: qLines
          .filter((l) => l.quotation_id === q.id)
          .map((l) => ({
            requisitionLineId: l.requisition_line_id,
            unitPrice: l.unit_price,
            vatPercent: l.vat_percent,
          })),
      })),
      budget: r.budget_status
        ? { status: r.budget_status, check: r.budget_snapshot }
        : null,
      comparativeStatement: {
        needed:
          Money.of(r.estimated_total).compare(settings.quotationThreshold) >= 0,
        minQuotations: settings.minQuotations,
        state: r.cs_state,
        selectedQuotationId: r.selected_quotation_id,
        reason: r.selection_reason,
        approvalRequestId: r.cs_approval_request_id,
      },
      purchaseOrder: order
        ? { id: order.id, number: order.number, state: order.state }
        : null,
    };
  }

  // ================================================================ helpers

  async lines(requisitionId: string) {
    return this.db.tx
      .selectFrom('purchase_requisition_lines')
      .selectAll()
      .where('requisition_id', '=', requisitionId)
      .orderBy('line_no')
      .execute();
  }

  private async insertLines(
    requisitionId: string,
    lines: RequisitionLineDto[],
  ) {
    await this.db.tx
      .insertInto('purchase_requisition_lines')
      .values(
        lines.map((l, i) => ({
          requisition_id: requisitionId,
          line_no: i + 1,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          estimated_unit_price: Money.of(l.estimatedUnitPrice).toDb(),
        })),
      )
      .execute();
  }

  /** The requester (own, while a draft) or Accounts. */
  private async assertCanEdit(r: PurchaseRequisition) {
    if (r.requester_id === this.access.current().employeeId) return;
    this.access.assert('procurement.manage', { companyId: r.company_id });
  }

  /** The requester, or anyone with procurement.view over its department. */
  async assertCanSee(r: PurchaseRequisition) {
    if (r.requester_id === this.access.current().employeeId) return;
    if (this.access.allows('procurement.view', this.common.resourceOf(r)))
      return;
    throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private async withSubDepartments(ids: string[]): Promise<string[]> {
    const all = await this.db.tx
      .selectFrom('departments')
      .select(['id', 'parent_id'])
      .execute();
    const out = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of all)
        if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) {
          out.add(d.id);
          grew = true;
        }
    }
    return [...out];
  }
}

function estimate(lines: RequisitionLineDto[]): string {
  return lines
    .reduce(
      (sum, l) =>
        sum.plus(Money.of(l.estimatedUnitPrice).times(l.quantity).round()),
      Money.zero(),
    )
    .toDb();
}

function summary(r: PurchaseRequisition) {
  return {
    id: r.id,
    companyId: r.company_id,
    number: r.number,
    title: r.title,
    neededBy: r.needed_by,
    estimatedTotal: r.estimated_total,
    state: r.state,
    csState: r.cs_state,
    departmentId: r.department_id,
    requesterId: r.requester_id,
    createdAt: r.created_at,
    version: r.version,
  };
}
