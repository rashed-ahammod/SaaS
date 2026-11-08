/**
 * Shared by the procurement services: company settings, document numbers, lookups.
 */
import {
  BadRequestException,
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
  PurchaseOrder,
  PurchaseRequisition,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { ProcurementSettingsDto } from './dto/procurement.dto.js';

export const PURCHASE_REQUISITION_REQUEST = 'purchase_requisition';
export const COMPARATIVE_STATEMENT_REQUEST = 'comparative_statement';

/** Placeholder defaults until the customer sets them (Tk). */
export const DEFAULT_SETTINGS = {
  quotationThreshold: '50000.00',
  minQuotations: 3,
  adminThreshold: '500000.00',
  matchTolerancePercent: '2.00',
};

type NumberKind = 'purchase_requisition' | 'purchase_order' | 'goods_receipt';
const PREFIX: Record<NumberKind, string> = {
  purchase_requisition: 'PR',
  purchase_order: 'PO',
  goods_receipt: 'GRN',
};

@Injectable()
export class ProcurementCommon {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  today() {
    return todayInDhaka(this.clock.now());
  }

  async settings(companyId: string) {
    const row = await this.db.tx
      .selectFrom('procurement_settings')
      .selectAll()
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    return row
      ? {
          quotationThreshold: row.quotation_threshold,
          minQuotations: row.min_quotations,
          adminThreshold: row.admin_threshold,
          matchTolerancePercent: row.match_tolerance_percent,
        }
      : DEFAULT_SETTINGS;
  }

  async getSettings(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    if (
      !this.access.allows('procurement.view', { companyId }) &&
      !this.access.allows('procurement.manage', { companyId })
    ) {
      this.access.assert('procurement.request_own', { companyId });
    }
    return this.settings(companyId);
  }

  async saveSettings(companyId: string, dto: ProcurementSettingsDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('procurement.manage', { companyId });
    const before = await this.settings(companyId);
    const values = {
      quotation_threshold: dto.quotationThreshold ?? before.quotationThreshold,
      min_quotations: dto.minQuotations ?? before.minQuotations,
      admin_threshold: dto.adminThreshold ?? before.adminThreshold,
      match_tolerance_percent:
        dto.matchTolerancePercent ?? before.matchTolerancePercent,
    };
    await this.db.tx
      .insertInto('procurement_settings')
      .values({ company_id: companyId, ...values })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id'])
          .doUpdateSet({ ...values, updated_at: new Date() }),
      )
      .execute();
    await this.audit.record({
      action: 'procurement.settings_saved',
      entity: 'company',
      entityId: companyId,
      before,
      after: dto,
    });
    return this.settings(companyId);
  }

  /** PR/2026-27/00001, PO/..., GRN/...: gapless per company and fiscal year. */
  async nextNumber(
    companyId: string,
    kind: NumberKind,
    onDate: string,
  ): Promise<string> {
    const year = await this.db.tx
      .selectFrom('fiscal_years')
      .select('code')
      .where('company_id', '=', companyId)
      .where('starts_on', '<=', onDate)
      .where('ends_on', '>=', onDate)
      .executeTakeFirst();
    const code = year?.code ?? fiscalYearOf(businessDate(onDate));
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind,
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
    return `${PREFIX[kind]}/${code}/${String(row.last_no).padStart(5, '0')}`;
  }

  async findRequisition(id: string): Promise<PurchaseRequisition> {
    const r = await this.db.tx
      .selectFrom('purchase_requisitions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException(MSG.REQUISITION_NOT_FOUND);
    return r;
  }

  async findOrder(id: string): Promise<PurchaseOrder> {
    const o = await this.db.tx
      .selectFrom('purchase_orders')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!o) throw new NotFoundException(MSG.PURCHASE_ORDER_NOT_FOUND);
    return o;
  }

  /** The requisition's company and department: what procurement.view / receive scopes check. */
  resourceOf(doc: { company_id: string; department_id: string | null }) {
    return { companyId: doc.company_id, departmentId: doc.department_id };
  }

  /** Expense or asset accounts a bill line may post to (not cash, bank or payables). */
  async assertExpenseAccounts(companyId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const rows = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'postable', 'is_active', 'role'])
      .where('id', 'in', unique)
      .execute();
    const byId = new Map(rows.map((a) => [a.id, a]));
    const bad = unique.some((id) => {
      const a = byId.get(id);
      return (
        !a ||
        a.company_id !== companyId ||
        !a.postable ||
        !a.is_active ||
        ['cash', 'bank', 'payables', 'employee_advances'].includes(a.role ?? '')
      );
    });
    if (bad) throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
  }

  /** User id -> the person's name (their employee record, else the login). */
  async userNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!list.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select(['u.id', 'u.email', 'e.full_name_en'])
      .where('u.id', 'in', list)
      .execute();
    return new Map(rows.map((r) => [r.id, r.full_name_en ?? r.email]));
  }
}
