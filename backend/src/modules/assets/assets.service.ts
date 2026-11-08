/**
 * Fixed assets (WP19; spec §6.7, §4 "Assets: Admin F, HR V, Accounts V (depreciation),
 * Dept Head V (dept), Employee O assigned").
 *
 *   register      the Admin records an asset (tag AST-00001) of a class; its cost is
 *                 already in the books through the vendor bill (or the opening balances)
 *   assignment    to an employee, who acknowledges it in the app; taken back with its
 *                 condition. An asset still with an employee blocks their final settlement.
 *   maintenance   a log of service, repair and inspection
 *   depreciation  Accounts runs a month: each asset's scheduled accumulated depreciation
 *                 (depreciation.ts) less what is already posted; one journal, Dr expense
 *                 (cost centre = the asset's department), Cr accumulated depreciation.
 *                 Missing months are caught up; only the latest run can be reversed
 *                 (a voucher reversal through the checker).
 *   disposal      sale, scrap or write-off: depreciation up to the month before, then
 *                 Dr accumulated, Dr cash / bank (proceeds), Cr cost, gain or loss.
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
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Asset, AssetClass, Voucher } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import {
  VouchersService,
  type PostingLine,
} from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import {
  accumulatedAt,
  addMonths,
  schedule,
  type DepreciableAsset,
} from './depreciation.js';
import type {
  AssetClassDto,
  AssetQueryDto,
  AssignAssetDto,
  CreateAssetDto,
  DisposeAssetDto,
  MaintenanceDto,
  ReturnAssetDto,
  UpdateAssetDto,
} from './dto/assets.dto.js';

export const DEPRECIATION_SOURCE = 'depreciation_run';
export const DISPOSAL_SOURCE = 'asset_disposal';

/** Placeholder classes (the accountant confirms methods and lives). */
const DEFAULT_CLASSES = [
  {
    code: 'FURN',
    name: 'Furniture and fixtures',
    account: '1210',
    method: 'straight_line' as const,
    life: 120,
  },
  {
    code: 'OFFEQ',
    name: 'Office equipment',
    account: '1220',
    method: 'straight_line' as const,
    life: 60,
  },
  {
    code: 'IT',
    name: 'Computers and IT equipment',
    account: '1230',
    method: 'straight_line' as const,
    life: 36,
  },
  {
    code: 'VEH',
    name: 'Vehicles',
    account: '1240',
    method: 'reducing_balance' as const,
    rate: '20',
  },
];

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

@Injectable()
export class AssetsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly org: OrgLookupService,
    private readonly ledger: LedgerSetupService,
    private readonly vouchers: VouchersService,
  ) {}

  onModuleInit() {
    // only the latest run can be reversed; a disposal is final
    this.vouchers.registerSource(DEPRECIATION_SOURCE, {
      assertReversible: (v) => this.assertLatestRun(v),
      onReversed: (v) => this.runReversed(v),
    });
    this.vouchers.registerSource(DISPOSAL_SOURCE, {
      assertReversible: async () => {
        throw new ConflictException(MSG.ASSET_WRONG_STATE);
      },
    });
  }

  private today() {
    return todayInDhaka(this.clock.now());
  }

  // ================================================================ classes

  async listClasses(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertView({ companyId });
    const rows = await this.db.tx
      .selectFrom('asset_classes')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    return rows.map(toClassResponse);
  }

  async createClass(companyId: string, dto: AssetClassDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('assets.manage', { companyId });
    const accounts = await this.ledger.resolvePostingAccounts(companyId);
    const accumulated =
      dto.accumulatedAccountId ?? accounts('assets.accumulated_depreciation');
    const expense =
      dto.expenseAccountId ?? accounts('assets.depreciation_expense');
    if (!accumulated || !expense)
      throw new BadRequestException(MSG.LEDGER_NOT_SET_UP);
    await this.assertAccounts(companyId, [
      dto.assetAccountId,
      accumulated,
      expense,
    ]);
    const row = await this.db.tx
      .insertInto('asset_classes')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name,
        asset_account_id: dto.assetAccountId,
        accumulated_account_id: accumulated,
        expense_account_id: expense,
        method: dto.method,
        useful_life_months:
          dto.method === 'straight_line' ? dto.usefulLifeMonths! : null,
        annual_rate_percent:
          dto.method === 'reducing_balance' ? dto.annualRatePercent! : null,
        residual_percent: dto.residualPercent ?? '0',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'asset_class.created',
      entity: 'asset_class',
      entityId: row.id,
      after: dto,
    });
    return toClassResponse(row);
  }

  /** Furniture, office equipment, computers, vehicles on the template accounts (missing ones only). */
  async createDefaultClasses(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('assets.manage', { companyId });
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', companyId)
      .execute();
    if (!accounts.length) throw new BadRequestException(MSG.LEDGER_NOT_SET_UP);
    const have = new Set(
      (
        await this.db.tx
          .selectFrom('asset_classes')
          .select('code')
          .where('company_id', '=', companyId)
          .execute()
      ).map((c) => c.code),
    );
    for (const c of DEFAULT_CLASSES) {
      const account = accounts.find((a) => a.code === c.account);
      if (have.has(c.code) || !account) continue;
      await this.createClass(companyId, {
        code: c.code,
        name: c.name,
        assetAccountId: account.id,
        method: c.method,
        ...(c.method === 'straight_line'
          ? { usefulLifeMonths: c.life }
          : { annualRatePercent: c.rate }),
      });
    }
    return this.listClasses(companyId);
  }

  async updateClass(
    id: string,
    dto: Partial<AssetClassDto> & { version: number },
  ) {
    const c = await this.findClass(id);
    this.access.assert('assets.manage', { companyId: c.company_id });
    if (c.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    // the method and life change the schedule of every asset of the class: only before any depreciation
    const used = await this.db.tx
      .selectFrom('depreciation_lines as l')
      .innerJoin('assets as a', 'a.id', 'l.asset_id')
      .select('l.id')
      .where('a.class_id', '=', id)
      .limit(1)
      .executeTakeFirst();
    if (
      used &&
      (dto.method ||
        dto.usefulLifeMonths ||
        dto.annualRatePercent ||
        dto.residualPercent ||
        dto.assetAccountId ||
        dto.accumulatedAccountId ||
        dto.expenseAccountId)
    ) {
      throw new ConflictException(MSG.ASSET_WRONG_STATE);
    }
    await this.db.tx
      .updateTable('asset_classes')
      .set({
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        ...(dto.usefulLifeMonths
          ? { useful_life_months: dto.usefulLifeMonths }
          : {}),
        ...(dto.annualRatePercent
          ? { annual_rate_percent: dto.annualRatePercent }
          : {}),
        ...(dto.residualPercent
          ? { residual_percent: dto.residualPercent }
          : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'asset_class.updated',
      entity: 'asset_class',
      entityId: id,
      after: dto,
    });
    return toClassResponse(await this.findClass(id));
  }

  // ================================================================ register

  async create(companyId: string, dto: CreateAssetDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('assets.manage', { companyId });
    const cls = await this.findClass(dto.classId);
    if (cls.company_id !== companyId || !cls.is_active)
      throw new NotFoundException(MSG.ASSET_CLASS_NOT_FOUND);
    if (dto.departmentId) {
      const d = await this.db.tx
        .selectFrom('departments')
        .select('company_id')
        .where('id', '=', dto.departmentId)
        .executeTakeFirst();
      if (!d || d.company_id !== companyId)
        throw new NotFoundException(MSG.DEPARTMENT_NOT_FOUND);
    }
    if (dto.vendorBillId) {
      const bill = await this.db.tx
        .selectFrom('vendor_bills')
        .select(['company_id', 'state'])
        .where('id', '=', dto.vendorBillId)
        .executeTakeFirst();
      if (!bill || bill.company_id !== companyId)
        throw new NotFoundException(MSG.BILL_NOT_FOUND);
    }
    const cost = Money.of(dto.cost);
    const residual = dto.residualValue
      ? Money.of(dto.residualValue)
      : cost.times(cls.residual_percent).dividedBy(100).round();
    const opening = Money.of(dto.openingAccumulated ?? '0');
    if (residual.greaterThan(cost) || opening.greaterThan(cost.minus(residual)))
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    if (
      opening.isPositive() &&
      (!dto.openingAsOf || dto.openingAsOf < dto.inServiceDate)
    )
      throw new BadRequestException(MSG.VALIDATION_FAILED);

    const tag = await this.nextTag(companyId);
    const asset = await this.db.tx
      .insertInto('assets')
      .values({
        company_id: companyId,
        class_id: cls.id,
        tag,
        name: dto.name,
        serial_no: dto.serialNo ?? null,
        in_service_date: dto.inServiceDate,
        cost: cost.toDb(),
        residual_value: residual.toDb(),
        opening_accumulated: opening.toDb(),
        opening_as_of: opening.isPositive() ? dto.openingAsOf! : null,
        department_id: dto.departmentId ?? null,
        branch_id: dto.branchId ?? null,
        location: dto.location ?? null,
        vendor_bill_id: dto.vendorBillId ?? null,
        note: dto.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'asset.registered',
      entity: 'asset',
      entityId: asset.id,
      after: { tag, name: dto.name, cost: asset.cost, classCode: cls.code },
    });
    return this.get(asset.id);
  }

  async update(id: string, dto: UpdateAssetDto) {
    const a = await this.find(id);
    this.access.assert('assets.manage', { companyId: a.company_id });
    if (a.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    if (a.state === 'disposed')
      throw new ConflictException(MSG.ASSET_WRONG_STATE);
    await this.db.tx
      .updateTable('assets')
      .set({
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.serialNo !== undefined ? { serial_no: dto.serialNo } : {}),
        ...(dto.departmentId !== undefined
          ? { department_id: dto.departmentId }
          : {}),
        ...(dto.branchId !== undefined ? { branch_id: dto.branchId } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'asset.updated',
      entity: 'asset',
      entityId: id,
      after: dto,
    });
    return this.get(id);
  }

  // ================================================================ assignment

  async assign(id: string, dto: AssignAssetDto) {
    const a = await this.find(id);
    this.access.assert('assets.manage', { companyId: a.company_id });
    if (a.state !== 'in_store')
      throw new ConflictException(
        a.state === 'assigned' ? MSG.ASSET_ASSIGNED : MSG.ASSET_WRONG_STATE,
      );
    const employee = await this.employeeAccess.find(dto.employeeId);
    if (
      employee.company_id !== a.company_id ||
      employee.status === 'separated' ||
      employee.status === 'draft'
    )
      throw new BadRequestException(MSG.EMPLOYEE_NOT_FOUND);
    await this.db.tx
      .insertInto('asset_assignments')
      .values({
        asset_id: id,
        employee_id: employee.id,
        assigned_on: dto.assignedOn,
        expected_return: dto.expectedReturn ?? null,
        note: dto.note ?? null,
      })
      .execute();
    await this.db.tx
      .updateTable('assets')
      .set({ state: 'assigned' })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'asset.assigned',
      entity: 'asset',
      entityId: id,
      after: {
        tag: a.tag,
        employeeId: employee.id,
        assignedOn: dto.assignedOn,
      },
    });
    return this.get(id);
  }

  async takeBack(id: string, dto: ReturnAssetDto) {
    const a = await this.find(id);
    this.access.assert('assets.manage', { companyId: a.company_id });
    const open = await this.openAssignment(id);
    if (!open) throw new ConflictException(MSG.ASSET_WRONG_STATE);
    if (dto.returnedOn < open.assigned_on)
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    await this.db.tx
      .updateTable('asset_assignments')
      .set({
        returned_on: dto.returnedOn,
        return_condition: dto.condition,
        return_note: dto.note ?? null,
        returned_by: this.access.current().userId,
      })
      .where('id', '=', open.id)
      .execute();
    await this.db.tx
      .updateTable('assets')
      .set({ state: 'in_store' })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'asset.returned',
      entity: 'asset',
      entityId: id,
      after: {
        tag: a.tag,
        employeeId: open.employee_id,
        returnedOn: dto.returnedOn,
        condition: dto.condition,
      },
    });
    return this.get(id);
  }

  /** The employee confirms they received it (in the app). */
  async acknowledge(assignmentId: string) {
    const row = await this.db.tx
      .selectFrom('asset_assignments')
      .selectAll()
      .where('id', '=', assignmentId)
      .executeTakeFirst();
    const me = this.access.current().employeeId;
    if (!row || !me || row.employee_id !== me)
      throw new NotFoundException(MSG.ASSET_NOT_FOUND);
    if (row.returned_on) throw new ConflictException(MSG.ASSET_WRONG_STATE);
    if (!row.acknowledged_at) {
      await this.db.tx
        .updateTable('asset_assignments')
        .set({
          acknowledged_at: this.clock.now(),
          acknowledged_ip: requestContext.get().ip ?? null,
        })
        .where('id', '=', assignmentId)
        .execute();
      await this.audit.record({
        action: 'asset.acknowledged',
        entity: 'asset',
        entityId: row.asset_id,
        after: { assignmentId },
      });
    }
    return this.myAssets();
  }

  /** The signed-in employee's assets: with them now, and before. */
  async myAssets() {
    const me = this.access.current().employeeId;
    if (!me) return [];
    const rows = await this.db.tx
      .selectFrom('asset_assignments as g')
      .innerJoin('assets as a', 'a.id', 'g.asset_id')
      .innerJoin('asset_classes as c', 'c.id', 'a.class_id')
      .select([
        'g.id',
        'g.assigned_on',
        'g.expected_return',
        'g.note',
        'g.acknowledged_at',
        'g.returned_on',
        'g.return_condition',
        'a.tag',
        'a.name',
        'a.serial_no',
        'c.name as class_name',
      ])
      .where('g.employee_id', '=', me)
      .orderBy('g.returned_on', 'desc')
      .orderBy('g.assigned_on', 'desc')
      .execute();
    return rows.map((r) => ({
      assignmentId: r.id,
      tag: r.tag,
      name: r.name,
      serialNo: r.serial_no,
      className: r.class_name,
      assignedOn: r.assigned_on,
      expectedReturn: r.expected_return,
      note: r.note,
      acknowledgedAt: r.acknowledged_at,
      returnedOn: r.returned_on,
      returnCondition: r.return_condition,
    }));
  }

  // ================================================================ maintenance

  async addMaintenance(id: string, dto: MaintenanceDto) {
    const a = await this.find(id);
    this.access.assert('assets.manage', { companyId: a.company_id });
    if (a.state === 'disposed')
      throw new ConflictException(MSG.ASSET_WRONG_STATE);
    await this.db.tx
      .insertInto('asset_maintenance')
      .values({
        asset_id: id,
        done_on: dto.doneOn,
        kind: dto.kind,
        description: dto.description,
        vendor_id: dto.vendorId ?? null,
        cost: Money.of(dto.cost ?? '0').toDb(),
        next_due: dto.nextDue ?? null,
      })
      .execute();
    await this.audit.record({
      action: 'asset.maintained',
      entity: 'asset',
      entityId: id,
      after: dto,
    });
    return this.get(id);
  }

  // ================================================================ depreciation

  /** What a run of the month would post (nothing is saved). */
  async previewRun(companyId: string, period: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('assets.depreciate', { companyId });
    return this.computeRun(companyId, period);
  }

  async runDepreciation(companyId: string, period: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('assets.depreciate', { companyId });
    const latest = await this.latestRun(companyId);
    if (
      period > this.today().slice(0, 7) ||
      (latest && period <= latest.period)
    )
      throw new BadRequestException({
        message: MSG.DEPRECIATION_PERIOD_INVALID,
        details: { lastRun: latest?.period ?? null },
      });
    const lines = await this.computeRun(companyId, period);
    const total = Money.sum(lines.map((l) => l.charge));

    const run = await this.db.tx
      .insertInto('depreciation_runs')
      .values({ company_id: companyId, period, total: total.toDb() })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (lines.length) {
      await this.db.tx
        .insertInto('depreciation_lines')
        .values(
          lines.map((l) => ({
            run_id: run.id,
            asset_id: l.assetId,
            amount: l.charge,
            accumulated_after: l.accumulatedAfter,
            book_value_after: l.bookValueAfter,
          })),
        )
        .execute();
      const posting: PostingLine[] = lines.flatMap((l) => [
        {
          accountId: l.expenseAccountId,
          departmentId: l.departmentId,
          debit: l.charge,
          narration: `Depreciation ${period}: ${l.tag}`,
        },
        {
          accountId: l.accumulatedAccountId,
          credit: l.charge,
          narration: `Depreciation ${period}: ${l.tag}`,
        },
      ]);
      const voucher = await this.vouchers.postAutomatic({
        companyId,
        voucherType: 'journal',
        voucherDate: lastDay(period),
        narration: `Depreciation for ${period} (${lines.length} assets)`,
        sourceType: DEPRECIATION_SOURCE,
        sourceId: run.id,
        lines: posting,
      });
      await this.db.tx
        .updateTable('depreciation_runs')
        .set({ voucher_id: voucher.id })
        .where('id', '=', run.id)
        .execute();
    }
    await this.audit.record({
      action: 'depreciation.run',
      entity: 'depreciation_run',
      entityId: run.id,
      after: { period, assets: lines.length, total: total.toDb() },
    });
    return this.getRun(run.id);
  }

  /**
   * For each asset in service by the end of the month and not disposed: the
   * scheduled accumulated depreciation at the end of the month, less the opening
   * amount and everything already posted. Missing months are caught up.
   */
  private async computeRun(companyId: string, period: string) {
    const assets = await this.db.tx
      .selectFrom('assets as a')
      .innerJoin('asset_classes as c', 'c.id', 'a.class_id')
      .selectAll('a')
      .select([
        'c.method',
        'c.useful_life_months',
        'c.annual_rate_percent',
        'c.expense_account_id',
        'c.accumulated_account_id',
      ])
      .where('a.company_id', '=', companyId)
      .where('a.state', '<>', 'disposed')
      .where('a.in_service_date', '<=', lastDay(period))
      .orderBy('a.tag')
      .execute();
    const posted = await this.postedByAsset(assets.map((a) => a.id));
    const out = [];
    for (const a of assets) {
      const target = Money.of(accumulatedAt(toDepreciable(a), period));
      const already = Money.of(a.opening_accumulated).plus(
        posted.get(a.id) ?? Money.zero(),
      );
      const charge = target.minus(already);
      if (!charge.isPositive()) continue;
      out.push({
        assetId: a.id,
        tag: a.tag,
        name: a.name,
        departmentId: a.department_id,
        expenseAccountId: a.expense_account_id,
        accumulatedAccountId: a.accumulated_account_id,
        charge: charge.toDb(),
        accumulatedAfter: target.toDb(),
        bookValueAfter: Money.of(a.cost).minus(target).toDb(),
      });
    }
    return out;
  }

  /** The latest run is reversed through a voucher reversal (the checker approves). */
  async reverseRun(runId: string, reason: string) {
    const run = await this.findRun(runId);
    this.access.assert('assets.depreciate', { companyId: run.company_id });
    if (run.state !== 'posted')
      throw new ConflictException(MSG.ASSET_WRONG_STATE);
    const latest = await this.latestRun(run.company_id);
    if (latest?.id !== run.id)
      throw new ConflictException(MSG.DEPRECIATION_NOT_LATEST);
    if (!run.voucher_id) {
      // nothing was posted: the month is simply open again
      await this.db.tx
        .updateTable('depreciation_runs')
        .set({ state: 'reversed' })
        .where('id', '=', run.id)
        .execute();
      await this.audit.record({
        action: 'depreciation.reversed',
        entity: 'depreciation_run',
        entityId: run.id,
        after: { period: run.period, reason },
      });
      return this.getRun(run.id);
    }
    await this.vouchers.reverse(run.voucher_id, { reason });
    await this.audit.record({
      action: 'depreciation.reversal_requested',
      entity: 'depreciation_run',
      entityId: run.id,
      after: { period: run.period, reason },
    });
    return this.getRun(run.id);
  }

  private async assertLatestRun(v: Voucher) {
    const run = await this.findRun(v.source_id!);
    const latest = await this.latestRun(run.company_id);
    if (latest?.id !== run.id)
      throw new ConflictException(MSG.DEPRECIATION_NOT_LATEST);
    const disposedSince = await this.db.tx
      .selectFrom('depreciation_lines as l')
      .innerJoin('assets as a', 'a.id', 'l.asset_id')
      .select('a.id')
      .where('l.run_id', '=', run.id)
      .where('a.state', '=', 'disposed')
      .executeTakeFirst();
    if (disposedSince) throw new ConflictException(MSG.ASSET_WRONG_STATE);
  }

  private async runReversed(v: Voucher) {
    await this.db.tx
      .updateTable('depreciation_runs')
      .set({ state: 'reversed' })
      .where('id', '=', v.source_id!)
      .execute();
    await this.audit.record({
      action: 'depreciation.reversed',
      entity: 'depreciation_run',
      entityId: v.source_id!,
      after: { voucher: v.number },
    });
  }

  async listRuns(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertView({ companyId });
    const rows = await this.db.tx
      .selectFrom('depreciation_runs as r')
      .leftJoin('vouchers as v', 'v.id', 'r.voucher_id')
      .selectAll('r')
      .select(['v.number as voucher_number', 'v.reversed_by'])
      .where('r.company_id', '=', companyId)
      .orderBy('r.period', 'desc')
      .orderBy('r.created_at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      period: r.period,
      state: r.state,
      total: r.total,
      voucherId: r.voucher_id,
      voucherNumber: r.voucher_number,
      reversalPending: Boolean(r.reversed_by) && r.state === 'posted',
      createdAt: r.created_at,
    }));
  }

  async getRun(id: string) {
    const run = await this.findRun(id);
    this.assertView({ companyId: run.company_id });
    const lines = await this.db.tx
      .selectFrom('depreciation_lines as l')
      .innerJoin('assets as a', 'a.id', 'l.asset_id')
      .select([
        'l.asset_id',
        'a.tag',
        'a.name',
        'l.amount',
        'l.accumulated_after',
        'l.book_value_after',
      ])
      .where('l.run_id', '=', id)
      .orderBy('a.tag')
      .execute();
    const voucher = run.voucher_id
      ? await this.vouchers.find(run.voucher_id)
      : null;
    return {
      id: run.id,
      companyId: run.company_id,
      period: run.period,
      state: run.state,
      total: run.total,
      voucherId: run.voucher_id,
      voucherNumber: voucher?.number ?? null,
      lines: lines.map((l) => ({
        assetId: l.asset_id,
        tag: l.tag,
        name: l.name,
        amount: l.amount,
        accumulatedAfter: l.accumulated_after,
        bookValueAfter: l.book_value_after,
      })),
    };
  }

  /** Worker: last month's run for every company that has assets and books (if not run yet). */
  async runScheduled(): Promise<number> {
    const companies = await this.org.activeCompanyIds();
    const period = addMonths(this.today().slice(0, 7), -1);
    let runs = 0;
    for (const companyId of companies) {
      const any = await this.db.tx
        .selectFrom('assets')
        .select('id')
        .where('company_id', '=', companyId)
        .where('state', '<>', 'disposed')
        .limit(1)
        .executeTakeFirst();
      const latest = await this.latestRun(companyId);
      if (!any || (latest && latest.period >= period)) continue;
      if (!(await this.vouchers.canPostOn(companyId, lastDay(period))))
        continue;
      await this.runDepreciation(companyId, period);
      runs += 1;
    }
    return runs;
  }

  // ================================================================ disposal

  async dispose(id: string, dto: DisposeAssetDto) {
    const a = await this.find(id);
    this.access.assert('assets.manage', { companyId: a.company_id });
    if (a.state === 'assigned') throw new ConflictException(MSG.ASSET_ASSIGNED);
    if (a.state === 'disposed')
      throw new ConflictException(MSG.ASSET_WRONG_STATE);
    if (dto.disposedOn < a.in_service_date)
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    const month = dto.disposedOn.slice(0, 7);
    const latest = await this.latestRun(a.company_id);
    if (latest && latest.period >= month)
      throw new BadRequestException({
        message: MSG.DEPRECIATION_PERIOD_INVALID,
        details: { lastRun: latest.period },
      });
    const cls = await this.findClass(a.class_id);

    // depreciation up to the end of the month before, then the disposal
    const before = addMonths(month, -1);
    const target = Money.of(
      accumulatedAt(toDepreciable({ ...a, ...classFields(cls) }), before),
    );
    const already = Money.of(a.opening_accumulated).plus(
      (await this.postedByAsset([a.id])).get(a.id) ?? Money.zero(),
    );
    const catchUp = target.minus(already).isPositive()
      ? target.minus(already)
      : Money.zero();
    const accumulated = already.plus(catchUp);
    const bookValue = Money.of(a.cost).minus(accumulated);
    const proceeds =
      dto.method === 'sale' ? Money.of(dto.proceeds!) : Money.zero();
    const gain = proceeds.minus(bookValue);

    const accounts = await this.ledger.resolvePostingAccounts(a.company_id);
    const gainAccount = accounts('assets.disposal_gain');
    const lossAccount = accounts('assets.disposal_loss');
    if (!gainAccount || !lossAccount)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: {
          missingPostingAccounts: [
            'assets.disposal_gain',
            'assets.disposal_loss',
          ],
        },
      });
    if (dto.method === 'sale') {
      const into = await this.db.tx
        .selectFrom('accounts')
        .select(['company_id', 'role', 'postable'])
        .where('id', '=', dto.receivedIntoAccountId!)
        .executeTakeFirst();
      if (
        !into ||
        into.company_id !== a.company_id ||
        !into.postable ||
        !['cash', 'bank'].includes(into.role ?? '')
      )
        throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
    }

    const label = `${a.tag} ${a.name}`;
    const lines: PostingLine[] = [];
    if (catchUp.isPositive()) {
      lines.push({
        accountId: cls.expense_account_id,
        departmentId: a.department_id,
        debit: catchUp.toDb(),
        narration: `Depreciation to ${before}: ${label}`,
      });
      lines.push({
        accountId: cls.accumulated_account_id,
        credit: catchUp.toDb(),
        narration: `Depreciation to ${before}: ${label}`,
      });
    }
    if (accumulated.isPositive())
      lines.push({
        accountId: cls.accumulated_account_id,
        debit: accumulated.toDb(),
        narration: `Disposal: ${label}`,
      });
    if (proceeds.isPositive())
      lines.push({
        accountId: dto.receivedIntoAccountId!,
        debit: proceeds.toDb(),
        narration: `Sale: ${label}`,
      });
    lines.push({
      accountId: cls.asset_account_id,
      credit: Money.of(a.cost).toDb(),
      narration: `Disposal: ${label}`,
    });
    if (gain.isPositive())
      lines.push({
        accountId: gainAccount,
        credit: gain.toDb(),
        narration: `Gain on disposal: ${label}`,
      });
    if (gain.isNegative())
      lines.push({
        accountId: lossAccount,
        departmentId: a.department_id,
        debit: gain.negate().toDb(),
        narration: `Loss on disposal: ${label}`,
      });

    const voucher = await this.vouchers.postAutomatic({
      companyId: a.company_id,
      voucherType: 'journal',
      voucherDate: dto.disposedOn,
      narration: `Disposal (${dto.method}) of ${label}: ${dto.note}`,
      sourceType: DISPOSAL_SOURCE,
      sourceId: a.id,
      lines,
    });
    await this.db.tx
      .updateTable('assets')
      .set({
        state: 'disposed',
        disposed_on: dto.disposedOn,
        disposal_method: dto.method,
        disposal_proceeds: proceeds.toDb(),
        disposal_voucher_id: voucher.id,
        disposal_note: dto.note,
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'asset.disposed',
      entity: 'asset',
      entityId: id,
      after: {
        tag: a.tag,
        method: dto.method,
        proceeds: proceeds.toDb(),
        bookValue: bookValue.toDb(),
        gain: gain.toDb(),
        catchUpDepreciation: catchUp.toDb(),
        voucher: voucher.number,
      },
    });
    return this.get(id);
  }

  // ================================================================ read

  async list(companyId: string, query: AssetQueryDto) {
    await this.org.assertCompanyExists(companyId);
    let q = this.db.tx
      .selectFrom('assets as a')
      .innerJoin('asset_classes as c', 'c.id', 'a.class_id')
      .leftJoin('departments as d', 'd.id', 'a.department_id')
      .leftJoin('asset_assignments as g', (j) =>
        j.onRef('g.asset_id', '=', 'a.id').on('g.returned_on', 'is', null),
      )
      .leftJoin('employees as e', 'e.id', 'g.employee_id')
      .selectAll('a')
      .select([
        'c.code as class_code',
        'c.name as class_name',
        'd.name as department_name',
        'e.id as holder_id',
        'e.employee_code as holder_code',
        'e.full_name_en as holder_name',
        'g.acknowledged_at',
      ])
      .where('a.company_id', '=', companyId);
    const scope = this.access.scopeFilter('assets.view');
    const manage = this.access.allows('assets.manage', { companyId });
    if (!manage && !scope.all && !scope.companyIds.includes(companyId)) {
      if (!scope.departmentIds.length)
        throw new ForbiddenException(MSG.FORBIDDEN);
      q = q.where('a.department_id', 'in', scope.departmentIds);
    }
    if (query.state) q = q.where('a.state', '=', query.state);
    if (query.classId) q = q.where('a.class_id', '=', query.classId);
    if (query.departmentId)
      q = q.where('a.department_id', '=', query.departmentId);
    if (query.employeeId) q = q.where('g.employee_id', '=', query.employeeId);
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) =>
        eb.or([
          eb('a.tag', 'ilike', like),
          eb('a.name', 'ilike', like),
          eb('a.serial_no', 'ilike', like),
        ]),
      );
    }
    const rows = await q.orderBy('a.tag').limit(500).execute();
    const posted = await this.postedByAsset(rows.map((r) => r.id));
    return rows.map((r) => {
      const accumulated = Money.of(r.opening_accumulated).plus(
        posted.get(r.id) ?? Money.zero(),
      );
      return {
        ...toAssetResponse(r),
        classCode: r.class_code,
        className: r.class_name,
        departmentName: r.department_name,
        accumulated: accumulated.toDb(),
        bookValue:
          r.state === 'disposed'
            ? '0.00'
            : Money.of(r.cost).minus(accumulated).toDb(),
        holder: r.holder_id
          ? {
              employeeId: r.holder_id,
              code: r.holder_code,
              name: r.holder_name,
              acknowledged: Boolean(r.acknowledged_at),
            }
          : null,
      };
    });
  }

  async get(id: string) {
    const a = await this.find(id);
    this.assertView({ companyId: a.company_id, departmentId: a.department_id });
    const cls = await this.findClass(a.class_id);
    const assignments = await this.db.tx
      .selectFrom('asset_assignments as g')
      .innerJoin('employees as e', 'e.id', 'g.employee_id')
      .selectAll('g')
      .select(['e.employee_code', 'e.full_name_en'])
      .where('g.asset_id', '=', id)
      .orderBy('g.assigned_on', 'desc')
      .execute();
    const maintenance = await this.db.tx
      .selectFrom('asset_maintenance as m')
      .leftJoin('vendors as v', 'v.id', 'm.vendor_id')
      .selectAll('m')
      .select('v.name as vendor_name')
      .where('m.asset_id', '=', id)
      .orderBy('m.done_on', 'desc')
      .execute();
    const postedLines = await this.db.tx
      .selectFrom('depreciation_lines as l')
      .innerJoin('depreciation_runs as r', 'r.id', 'l.run_id')
      .select([
        'r.period',
        'l.amount',
        'l.accumulated_after',
        'l.book_value_after',
      ])
      .where('l.asset_id', '=', id)
      .where('r.state', '=', 'posted')
      .orderBy('r.period')
      .execute();
    const posted = Money.sum(postedLines.map((l) => l.amount));
    const accumulated = Money.of(a.opening_accumulated).plus(posted);
    const department = a.department_id
      ? await this.db.tx
          .selectFrom('departments')
          .select('name')
          .where('id', '=', a.department_id)
          .executeTakeFirst()
      : undefined;
    const disposal = a.disposal_voucher_id
      ? await this.vouchers.find(a.disposal_voucher_id)
      : null;
    return {
      ...toAssetResponse(a),
      class: toClassResponse(cls),
      departmentName: department?.name ?? null,
      accumulated: accumulated.toDb(),
      bookValue:
        a.state === 'disposed'
          ? '0.00'
          : Money.of(a.cost).minus(accumulated).toDb(),
      disposalVoucherNumber: disposal?.number ?? null,
      assignments: assignments.map((g) => ({
        id: g.id,
        employeeId: g.employee_id,
        employeeCode: g.employee_code,
        employeeName: g.full_name_en,
        assignedOn: g.assigned_on,
        expectedReturn: g.expected_return,
        note: g.note,
        acknowledgedAt: g.acknowledged_at,
        returnedOn: g.returned_on,
        returnCondition: g.return_condition,
        returnNote: g.return_note,
      })),
      maintenance: maintenance.map((m) => ({
        id: m.id,
        doneOn: m.done_on,
        kind: m.kind,
        description: m.description,
        vendorName: m.vendor_name,
        cost: m.cost,
        nextDue: m.next_due,
      })),
      depreciation: postedLines.map((l) => ({
        period: l.period,
        amount: l.amount,
        accumulatedAfter: l.accumulated_after,
        bookValueAfter: l.book_value_after,
      })),
    };
  }

  /** The whole schedule of an asset (reproducible from the asset alone). */
  async schedule(id: string) {
    const a = await this.find(id);
    this.assertView({ companyId: a.company_id, departmentId: a.department_id });
    const cls = await this.findClass(a.class_id);
    return {
      assetId: a.id,
      tag: a.tag,
      method: cls.method,
      rows: schedule(toDepreciable({ ...a, ...classFields(cls) }), '2200-12'),
    };
  }

  // ================================================================ helpers

  async find(id: string): Promise<Asset> {
    const a = await this.db.tx
      .selectFrom('assets')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!a) throw new NotFoundException(MSG.ASSET_NOT_FOUND);
    return a;
  }

  private async findClass(id: string): Promise<AssetClass> {
    const c = await this.db.tx
      .selectFrom('asset_classes')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!c) throw new NotFoundException(MSG.ASSET_CLASS_NOT_FOUND);
    return c;
  }

  private async findRun(id: string) {
    const r = await this.db.tx
      .selectFrom('depreciation_runs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException(MSG.DEPRECIATION_RUN_NOT_FOUND);
    return r;
  }

  private async latestRun(companyId: string) {
    return this.db.tx
      .selectFrom('depreciation_runs')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('state', '=', 'posted')
      .orderBy('period', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  private async openAssignment(assetId: string) {
    return this.db.tx
      .selectFrom('asset_assignments')
      .selectAll()
      .where('asset_id', '=', assetId)
      .where('returned_on', 'is', null)
      .executeTakeFirst();
  }

  private async postedByAsset(ids: string[]): Promise<Map<string, Money>> {
    if (!ids.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('depreciation_lines as l')
      .innerJoin('depreciation_runs as r', 'r.id', 'l.run_id')
      .select(['l.asset_id', sql<string>`sum(l.amount)`.as('amount')])
      .where('l.asset_id', 'in', ids)
      .where('r.state', '=', 'posted')
      .groupBy('l.asset_id')
      .execute();
    return new Map(rows.map((r) => [r.asset_id, Money.of(r.amount)]));
  }

  private async nextTag(companyId: string): Promise<string> {
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'asset_tag',
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
    return `AST-${String(row.last_no).padStart(5, '0')}`;
  }

  private assertView(resource: {
    companyId: string;
    departmentId?: string | null;
  }) {
    if (
      this.access.allows('assets.view', resource) ||
      this.access.allows('assets.manage', resource) ||
      this.access.allows('assets.depreciate', resource)
    )
      return;
    throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private async assertAccounts(companyId: string, ids: string[]) {
    const rows = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'postable'])
      .where('id', 'in', ids)
      .execute();
    if (
      ids.some(
        (id) =>
          !rows.find(
            (r) => r.id === id && r.company_id === companyId && r.postable,
          ),
      )
    )
      throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
  }
}

function classFields(c: AssetClass) {
  return {
    method: c.method,
    useful_life_months: c.useful_life_months,
    annual_rate_percent: c.annual_rate_percent,
  };
}

function toDepreciable(a: {
  cost: string;
  residual_value: string;
  in_service_date: string;
  opening_accumulated: string;
  opening_as_of: string | null;
  method: AssetClass['method'];
  useful_life_months: number | null;
  annual_rate_percent: string | null;
}): DepreciableAsset {
  return {
    cost: a.cost,
    residualValue: a.residual_value,
    inServiceDate: a.in_service_date,
    openingAccumulated: a.opening_accumulated,
    openingAsOf: a.opening_as_of,
    method: a.method,
    usefulLifeMonths: a.useful_life_months,
    annualRatePercent: a.annual_rate_percent,
  };
}

function toClassResponse(c: AssetClass) {
  return {
    id: c.id,
    companyId: c.company_id,
    code: c.code,
    name: c.name,
    assetAccountId: c.asset_account_id,
    accumulatedAccountId: c.accumulated_account_id,
    expenseAccountId: c.expense_account_id,
    method: c.method,
    usefulLifeMonths: c.useful_life_months,
    annualRatePercent: c.annual_rate_percent,
    residualPercent: c.residual_percent,
    isActive: c.is_active,
    version: c.version,
  };
}

function toAssetResponse(a: Asset) {
  return {
    id: a.id,
    companyId: a.company_id,
    classId: a.class_id,
    tag: a.tag,
    name: a.name,
    serialNo: a.serial_no,
    inServiceDate: a.in_service_date,
    cost: a.cost,
    residualValue: a.residual_value,
    openingAccumulated: a.opening_accumulated,
    openingAsOf: a.opening_as_of,
    departmentId: a.department_id,
    branchId: a.branch_id,
    location: a.location,
    vendorBillId: a.vendor_bill_id,
    state: a.state,
    disposedOn: a.disposed_on,
    disposalMethod: a.disposal_method,
    disposalProceeds: a.disposal_proceeds,
    disposalNote: a.disposal_note,
    disposalVoucherId: a.disposal_voucher_id,
    note: a.note,
    version: a.version,
  };
}
