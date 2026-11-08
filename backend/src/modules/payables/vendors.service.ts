/**
 * Vendors, their bank accounts and the company's payables settings (spec §3, §6.6, §11).
 *
 *   vendors         Accounts keeps them; TIN and BIN decide the tax treatment
 *                   (no TIN: higher income tax at source; no BIN: VAT is cost)
 *   bank accounts   where a vendor is paid by transfer: a classic fraud path, so
 *                   a step-up code (route), stored encrypted, and approved by
 *                   another Accounts user before it can be used (request type
 *                   "vendor_bank_account"); the previous one is retired
 *   settings        is the company a VAT withholding entity? default payment terms
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { FieldEncryption } from '../../platform/crypto/field-encryption.js';
import {
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ApprovalRequest, Vendor } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { RulesService } from '../rules/rules.service.js';
import type {
  CreateVendorDto,
  PayablesSettingsDto,
  UpdateVendorDto,
  VendorBankAccountDto,
  VendorQueryDto,
} from './dto/payables.dto.js';
import {
  validateCategories,
  type WithholdingCategory,
  type WithholdingRules,
} from './withholding.js';

export const VENDOR_BANK_ACCOUNT = 'vendor_bank_account';

interface VendorBankDetails {
  accountName: string;
  bankName: string;
  branchName: string;
  routingNumber: string;
  accountNumber: string;
}

@Injectable()
export class VendorsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly encryption: FieldEncryption,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly rules: RulesService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
  ) {}

  onModuleInit() {
    // spec §3: "Vendor bank details need maker–checker"
    this.handlers.register(
      VENDOR_BANK_ACCOUNT,
      {
        onApproved: (r) => this.applyBankAccount(r),
        onClosed: (r, outcome) => this.discardBankAccount(r, outcome),
      },
      [defaultChain('Vendor bank account (default)', step(1, 'role:accounts'))],
    );
  }

  // ============================================================ settings

  async settings(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    return toSettingsResponse(await this.settingsOf(companyId));
  }

  async updateSettings(companyId: string, dto: PayablesSettingsDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.tax', { companyId });
    const values = {
      vat_withholding_entity: dto.vatWithholdingEntity,
      ...(dto.defaultPaymentTermsDays !== undefined
        ? { default_payment_terms_days: dto.defaultPaymentTermsDays }
        : {}),
    };
    await this.db.tx
      .insertInto('payables_settings')
      .values({ company_id: companyId, ...values })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'company_id']).doUpdateSet(values),
      )
      .execute();
    await this.audit.record({
      action: 'payables.settings_changed',
      entity: 'company',
      entityId: companyId,
      after: dto,
    });
    return this.settings(companyId);
  }

  /** The company's settings (defaults when never saved). */
  async settingsOf(companyId: string) {
    const row = await this.db.tx
      .selectFrom('payables_settings')
      .selectAll()
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    return (
      row ?? {
        company_id: companyId,
        vat_withholding_entity: false,
        default_payment_terms_days: 30,
        version: 0,
      }
    );
  }

  // ======================================================= tax categories

  /** Payment categories for tax at source on a date, from the accepted rule pack. */
  async categories(companyId: string, date?: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    const on = businessDate(date ?? todayInDhaka(this.clock.now()));
    const { rules, pack } = await this.withholdingRules(on);
    return {
      date: on,
      pack,
      noTinSurchargePercent: rules.noTinSurchargePercent,
      categories: rules.categories.map((c) => ({
        code: c.code,
        nameEn: c.nameEn,
        nameBn: c.nameBn ?? null,
        section: c.section ?? null,
        tdsPercent: c.tdsPercent ?? null,
        tdsSlabs: c.tdsSlabs ?? null,
        vdsShareOfVatPercent: c.vdsShareOfVatPercent,
      })),
    };
  }

  /** The rates in force on a date (unverified values are refused in production by RulesService). */
  async withholdingRules(
    on: string,
  ): Promise<{ rules: WithholdingRules; pack: string; status: string }> {
    const categories = await this.rules.get(
      'tax.tds.vendor_categories',
      businessDate(on),
    );
    const surcharge = await this.rules.getDecimal(
      'tax.tds.no_tin_surcharge_percent',
      businessDate(on),
    );
    if (!validateCategories(categories.value))
      throw new BadRequestException(MSG.WITHHOLDING_CATEGORY_UNKNOWN);
    return {
      rules: {
        categories: categories.value as WithholdingCategory[],
        noTinSurchargePercent: surcharge,
      },
      pack: categories.pack,
      status: categories.status,
    };
  }

  // ============================================================== vendors

  async create(companyId: string, dto: CreateVendorDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.manage', { companyId });
    // the category must exist today; code and TIN are unique in the company
    if (dto.withholdingCategory)
      await this.assertCategory(dto.withholdingCategory);
    const code = dto.code ?? (await this.nextCode(companyId));
    await this.assertUnique(companyId, code, dto.tin);

    const vendor = await this.db.tx
      .insertInto('vendors')
      .values({
        company_id: companyId,
        code,
        name: dto.name,
        name_bn: dto.nameBn ?? null,
        vendor_type: dto.vendorType ?? 'company',
        tin: dto.tin ?? null,
        bin: dto.bin ?? null,
        trade_licence: dto.tradeLicence ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        withholding_category: dto.withholdingCategory ?? 'SUPPLY',
        payment_terms_days: dto.paymentTermsDays ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'vendor.created',
      entity: 'vendor',
      entityId: vendor.id,
      after: {
        code,
        name: dto.name,
        tin: dto.tin ?? null,
        bin: dto.bin ?? null,
      },
    });
    return this.get(vendor.id);
  }

  async update(id: string, dto: UpdateVendorDto) {
    const vendor = await this.find(id);
    this.access.assert('payables.manage', { companyId: vendor.company_id });
    if (vendor.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    if (dto.withholdingCategory)
      await this.assertCategory(dto.withholdingCategory);
    if (dto.tin && dto.tin !== vendor.tin)
      await this.assertUnique(vendor.company_id, null, dto.tin);

    const { version: _version, ...changes } = dto;
    await this.db.tx
      .updateTable('vendors')
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.nameBn !== undefined ? { name_bn: changes.nameBn } : {}),
        ...(changes.tin !== undefined ? { tin: changes.tin } : {}),
        ...(changes.bin !== undefined ? { bin: changes.bin } : {}),
        ...(changes.tradeLicence !== undefined
          ? { trade_licence: changes.tradeLicence }
          : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
        ...(changes.email !== undefined ? { email: changes.email } : {}),
        ...(changes.address !== undefined ? { address: changes.address } : {}),
        ...(changes.withholdingCategory !== undefined
          ? { withholding_category: changes.withholdingCategory }
          : {}),
        ...(changes.paymentTermsDays !== undefined
          ? { payment_terms_days: changes.paymentTermsDays }
          : {}),
        ...(changes.isActive !== undefined
          ? { is_active: changes.isActive }
          : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'vendor.updated',
      entity: 'vendor',
      entityId: id,
      before: {
        tin: vendor.tin,
        bin: vendor.bin,
        category: vendor.withholding_category,
      },
      after: changes,
    });
    return this.get(id);
  }

  async list(companyId: string, query: VendorQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    let q = this.db.tx
      .selectFrom('vendors')
      .selectAll()
      .where('company_id', '=', companyId);
    if (query.active !== undefined) q = q.where('is_active', '=', query.active);
    if (query.search) {
      const like = `%${query.search.replace(/[%_]/g, '')}%`;
      q = q.where((eb) =>
        eb.or([
          eb('name', 'ilike', like),
          eb('code', 'ilike', like),
          eb('tin', 'like', like),
          eb('name_bn', 'like', like),
        ]),
      );
    }
    const rows = await q.orderBy('code').limit(500).execute();
    return rows.map(toVendorResponse);
  }

  async get(id: string) {
    const vendor = await this.find(id);
    this.access.assert('payables.view', { companyId: vendor.company_id });
    const bank = await this.db.tx
      .selectFrom('vendor_bank_accounts')
      .select([
        'id',
        'bank_name',
        'account_last4',
        'status',
        'approval_request_id',
        'approved_at',
        'created_at',
      ])
      .where('vendor_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();
    return {
      ...toVendorResponse(vendor),
      bankAccounts: bank.map((b) => ({
        id: b.id,
        bankName: b.bank_name,
        account: `**** ${b.account_last4}`,
        status: b.status,
        approvalRequestId: b.approval_request_id,
        approvedAt: b.approved_at,
        createdAt: b.created_at,
      })),
    };
  }

  async find(id: string): Promise<Vendor> {
    const vendor = await this.db.tx
      .selectFrom('vendors')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!vendor) throw new NotFoundException(MSG.VENDOR_NOT_FOUND);
    return vendor;
  }

  // ======================================================== bank accounts

  async requestBankAccount(vendorId: string, dto: VendorBankAccountDto) {
    const vendor = await this.find(vendorId);
    this.access.assert('payables.manage', { companyId: vendor.company_id });
    const pending = await this.db.tx
      .selectFrom('vendor_bank_accounts')
      .select('id')
      .where('vendor_id', '=', vendorId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (pending) throw new ConflictException(MSG.VENDOR_BANK_PENDING_EXISTS);

    // stored encrypted; the approval snapshot holds only masked values
    const details: VendorBankDetails = {
      accountName: dto.accountName,
      bankName: dto.bankName,
      branchName: dto.branchName,
      routingNumber: dto.routingNumber,
      accountNumber: dto.accountNumber,
    };
    const last4 = dto.accountNumber.slice(-4);
    const account = await this.db.tx
      .insertInto('vendor_bank_accounts')
      .values({
        vendor_id: vendorId,
        bank_name: dto.bankName,
        account_last4: last4,
        details_encrypted: this.encryption.encrypt(
          vendor.tenant_id,
          JSON.stringify(details),
        ),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const request = await this.approvals.submit({
      requestType: VENDOR_BANK_ACCOUNT,
      sourceId: account.id,
      subjectEmployeeId: null,
      companyId: vendor.company_id,
      summary: `Vendor bank account: ${vendor.name} (${vendor.code}) -> ${dto.bankName} ****${last4}`,
      snapshot: {
        vendorCode: vendor.code,
        vendorName: vendor.name,
        bankName: dto.bankName,
        branchName: dto.branchName,
        routingNumber: dto.routingNumber,
        accountName: dto.accountName,
        accountLast4: last4,
      },
    });
    await this.db.tx
      .updateTable('vendor_bank_accounts')
      .set({ approval_request_id: request.id })
      .where('id', '=', account.id)
      .execute();
    await this.audit.record({
      action: 'vendor.bank_account_requested',
      entity: 'vendor',
      entityId: vendorId,
      after: {
        accountId: account.id,
        bankName: dto.bankName,
        accountLast4: last4,
        approvalRequestId: request.id,
      },
    });
    return {
      accountId: account.id,
      status: 'pending',
      approvalRequestId: request.id,
    };
  }

  /** The approved account of a vendor (for a bank transfer), or null. */
  async approvedBankAccount(vendorId: string) {
    return (
      (await this.db.tx
        .selectFrom('vendor_bank_accounts')
        .select(['id', 'bank_name', 'account_last4'])
        .where('vendor_id', '=', vendorId)
        .where('status', '=', 'approved')
        .executeTakeFirst()) ?? null
    );
  }

  private async applyBankAccount(request: ApprovalRequest) {
    const account = await this.db.tx
      .selectFrom('vendor_bank_accounts')
      .selectAll()
      .where('id', '=', request.source_id)
      .executeTakeFirstOrThrow();
    const now = new Date();
    await this.db.tx
      .updateTable('vendor_bank_accounts')
      .set({ status: 'retired', retired_at: now })
      .where('vendor_id', '=', account.vendor_id)
      .where('status', '=', 'approved')
      .execute();
    await this.db.tx
      .updateTable('vendor_bank_accounts')
      .set({ status: 'approved', approved_at: now })
      .where('id', '=', account.id)
      .execute();
    await this.audit.record({
      action: 'vendor.bank_account_approved',
      entity: 'vendor',
      entityId: account.vendor_id,
      after: { accountId: account.id },
    });
    await this.outbox.add({
      type: 'vendor.bank_account_changed',
      entityId: account.vendor_id,
      payload: {
        vendorId: account.vendor_id,
        accountId: account.id,
        approvalRequestId: request.id,
      },
    });
  }

  private async discardBankAccount(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    await this.db.tx
      .updateTable('vendor_bank_accounts')
      .set({ status: outcome === 'cancelled' ? 'cancelled' : 'rejected' })
      .where('id', '=', request.source_id)
      .where('status', '=', 'pending')
      .execute();
  }

  // ============================================================== helpers

  private async assertCategory(code: string) {
    const { rules } = await this.withholdingRules(
      todayInDhaka(this.clock.now()),
    );
    if (!rules.categories.some((c) => c.code === code))
      throw new BadRequestException({
        message: MSG.WITHHOLDING_CATEGORY_UNKNOWN,
        details: { category: code },
      });
  }

  private async assertUnique(
    companyId: string,
    code: string | null,
    tin?: string,
  ) {
    if (!code && !tin) return;
    const clash = await this.db.tx
      .selectFrom('vendors')
      .select(['code', 'name'])
      .where('company_id', '=', companyId)
      .where((eb) =>
        eb.or([
          ...(code ? [eb('code', '=', code)] : []),
          ...(tin ? [eb('tin', '=', tin)] : []),
        ]),
      )
      .executeTakeFirst();
    if (clash)
      throw new ConflictException({
        message: MSG.VENDOR_DUPLICATE,
        details: { code: clash.code, name: clash.name },
      });
  }

  private async nextCode(companyId: string): Promise<string> {
    const row = await this.db.tx
      .selectFrom('vendors')
      .select(
        sql<number>`coalesce(max(substring(code from 3)::int), 0)`.as('n'),
      )
      .where('company_id', '=', companyId)
      .where('code', '~', '^V-[0-9]+$')
      .executeTakeFirstOrThrow();
    return `V-${String(Number(row.n) + 1).padStart(4, '0')}`;
  }
}

export function toVendorResponse(v: Vendor) {
  return {
    id: v.id,
    companyId: v.company_id,
    code: v.code,
    name: v.name,
    nameBn: v.name_bn,
    vendorType: v.vendor_type,
    tin: v.tin,
    bin: v.bin,
    tradeLicence: v.trade_licence,
    phone: v.phone,
    email: v.email,
    address: v.address,
    withholdingCategory: v.withholding_category,
    paymentTermsDays: v.payment_terms_days,
    isActive: v.is_active,
    createdAt: v.created_at,
    version: v.version,
  };
}

function toSettingsResponse(s: {
  company_id: string;
  vat_withholding_entity: boolean;
  default_payment_terms_days: number;
  version: number;
}) {
  return {
    companyId: s.company_id,
    vatWithholdingEntity: s.vat_withholding_entity,
    defaultPaymentTermsDays: s.default_payment_terms_days,
    version: s.version,
  };
}
