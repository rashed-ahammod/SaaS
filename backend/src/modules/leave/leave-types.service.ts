/**
 * Leave types and the company leave policy (spec §3: leave types are HR master
 * data; spec §6.3: entitlement, accrual, carry cap, encashable, document rule,
 * eligibility; spec §7: defaults follow the Labour Act through the rule pack).
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { LeavePolicy, LeaveType } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  CreateLeaveTypeDto,
  LeavePolicyDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto.js';

/**
 * Bangladesh defaults (spec §7). Every statutory number is a rule pack key, so
 * an amendment changes the pack, not these definitions. Company choices
 * (document rule, earned-leave carry cap) are ordinary settings HR can change.
 */
export const BD_DEFAULT_LEAVE_TYPES: CreateLeaveTypeDto[] = [
  {
    code: 'CL',
    nameEn: 'Casual leave',
    nameBn: 'নৈমিত্তিক ছুটি',
    accrualMethod: 'annual_grant',
    entitlementRuleKey: 'leave.casual.days_per_year',
    allowHalfDay: true,
    yearEndAction: 'lapse',
  },
  {
    code: 'SL',
    nameEn: 'Sick leave',
    nameBn: 'অসুস্থতাজনিত ছুটি',
    accrualMethod: 'annual_grant',
    entitlementRuleKey: 'leave.sick.days_per_year',
    documentRequiredOverDays: 2,
    yearEndAction: 'lapse',
  },
  {
    code: 'EL',
    nameEn: 'Earned (annual) leave',
    nameBn: 'অর্জিত (বার্ষিক) ছুটি',
    accrualMethod: 'per_worked_days',
    entitlementRuleKey: 'leave.earned.worked_days_per_leave_day',
    yearEndAction: 'carry',
    carryCapDays: 40,
    encashable: true,
    eligibility: { minServiceMonths: 12 },
  },
  {
    code: 'ML',
    nameEn: 'Maternity leave',
    nameBn: 'মাতৃত্বকালীন ছুটি',
    accrualMethod: 'none',
    maxDaysRuleKey: 'leave.maternity.days',
    countsNonWorkingDays: true,
    eligibility: {
      gender: 'female',
      minServiceRuleKey: 'leave.maternity.min_service_months',
      allowDuringProbation: true,
    },
  },
  {
    code: 'LWP',
    nameEn: 'Leave without pay',
    nameBn: 'বিনা বেতনে ছুটি',
    accrualMethod: 'none',
    paid: false,
    allowHalfDay: true,
  },
];

@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  // ------------------------------------------------------------------ policy

  /** The company's leave policy (defaults when HR has not saved one). */
  async getPolicy(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    return toPolicyResponse(companyId, await this.findPolicy(companyId));
  }

  async savePolicy(companyId: string, dto: LeavePolicyDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('leave.manage', { companyId });
    const values = changesOnly({
      leave_year_start: dto.leaveYearStart,
      sandwich_rule: dto.sandwichRule,
      team_absence_warn_pct: dto.teamAbsenceWarnPct,
      max_backdated_days: dto.maxBackdatedDays,
    });

    const existing = await this.findPolicy(companyId);
    const saved = existing
      ? values
        ? await this.db.tx
            .updateTable('leave_policies')
            .set(values)
            .where('id', '=', existing.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : existing
      : await this.db.tx
          .insertInto('leave_policies')
          .values({ company_id: companyId, ...values })
          .returningAll()
          .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'leave_policy.saved',
      entity: 'company',
      entityId: companyId,
      after: dto,
    });
    return toPolicyResponse(companyId, saved);
  }

  /** Used by the other leave services. */
  async policyFor(companyId: string) {
    return toPolicyResponse(companyId, await this.findPolicy(companyId));
  }

  // ------------------------------------------------------------------ types

  async createType(companyId: string, dto: CreateLeaveTypeDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('leave.manage', { companyId });
    if (
      dto.accrualMethod !== 'none' &&
      dto.entitlementDays === undefined &&
      !dto.entitlementRuleKey
    ) {
      throw new BadRequestException(
        'entitlementDays or entitlementRuleKey is required for this accrual method',
      );
    }

    const type = await this.db.tx
      .insertInto('leave_types')
      .values({
        company_id: companyId,
        code: dto.code,
        name_en: dto.nameEn.trim(),
        name_bn: dto.nameBn ?? null,
        paid: dto.paid,
        accrual_method: dto.accrualMethod,
        entitlement_days:
          dto.entitlementDays != null ? String(dto.entitlementDays) : null,
        entitlement_rule_key: dto.entitlementRuleKey ?? null,
        max_days_per_request:
          dto.maxDaysPerRequest != null ? String(dto.maxDaysPerRequest) : null,
        max_days_rule_key: dto.maxDaysRuleKey ?? null,
        counts_non_working_days: dto.countsNonWorkingDays,
        allow_half_day: dto.allowHalfDay,
        document_required_over_days:
          dto.documentRequiredOverDays != null
            ? String(dto.documentRequiredOverDays)
            : null,
        year_end_action: dto.yearEndAction,
        carry_cap_days:
          dto.carryCapDays != null ? String(dto.carryCapDays) : null,
        encashable: dto.encashable,
        eligibility: JSON.stringify(dto.eligibility ?? {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'leave_type.created',
      entity: 'leave_type',
      entityId: type.id,
      after: dto,
    });
    return toLeaveTypeResponse(type);
  }

  /** Creates the Bangladesh default leave types that the company does not have yet. */
  async createDefaults(companyId: string) {
    const existing = new Set(
      (
        await this.db.tx
          .selectFrom('leave_types')
          .select('code')
          .where('company_id', '=', companyId)
          .execute()
      ).map((t) => t.code),
    );
    const created = [];
    for (const def of BD_DEFAULT_LEAVE_TYPES) {
      if (!existing.has(def.code))
        created.push(await this.createType(companyId, def));
    }
    return {
      created: created.map((t) => t.code),
      skipped: [...existing].sort(),
    };
  }

  async listTypes(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const rows = await this.db.tx
      .selectFrom('leave_types')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    return rows.map(toLeaveTypeResponse);
  }

  async updateType(id: string, dto: UpdateLeaveTypeDto) {
    const before = await this.findType(id);
    this.access.assert('leave.manage', { companyId: before.company_id });
    assertVersion(before, dto.version);

    const changes = changesOnly({
      name_en: dto.nameEn?.trim(),
      name_bn: dto.nameBn,
      allow_half_day: dto.allowHalfDay,
      document_required_over_days:
        dto.documentRequiredOverDays === undefined
          ? undefined
          : dto.documentRequiredOverDays === null
            ? null
            : String(dto.documentRequiredOverDays),
      carry_cap_days:
        dto.carryCapDays === undefined
          ? undefined
          : dto.carryCapDays === null
            ? null
            : String(dto.carryCapDays),
      encashable: dto.encashable,
      eligibility: dto.eligibility
        ? JSON.stringify(dto.eligibility)
        : undefined,
      is_active: dto.isActive,
    });
    if (!changes) return toLeaveTypeResponse(before);

    const result = await this.db.tx
      .updateTable('leave_types')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);
    const after = await this.findType(id);
    await this.audit.record({
      action: 'leave_type.updated',
      entity: 'leave_type',
      entityId: id,
      ...auditDiff(before, after),
    });
    return toLeaveTypeResponse(after);
  }

  async findType(id: string): Promise<LeaveType> {
    const type = await this.db.tx
      .selectFrom('leave_types')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!type) throw new NotFoundException(MSG.LEAVE_TYPE_NOT_FOUND);
    return type;
  }

  private findPolicy(companyId: string) {
    return this.db.tx
      .selectFrom('leave_policies')
      .selectAll()
      .where('company_id', '=', companyId)
      .executeTakeFirst();
  }
}

function toPolicyResponse(companyId: string, p: LeavePolicy | undefined) {
  return {
    companyId,
    leaveYearStart: p?.leave_year_start ?? '01-01',
    sandwichRule: p?.sandwich_rule ?? false,
    teamAbsenceWarnPct: p?.team_absence_warn_pct ?? 30,
    maxBackdatedDays: p?.max_backdated_days ?? 7,
    version: p?.version ?? 0,
  };
}

export function toLeaveTypeResponse(t: LeaveType) {
  return {
    id: t.id,
    companyId: t.company_id,
    code: t.code,
    nameEn: t.name_en,
    nameBn: t.name_bn,
    paid: t.paid,
    accrualMethod: t.accrual_method,
    entitlementDays:
      t.entitlement_days !== null ? Number(t.entitlement_days) : null,
    entitlementRuleKey: t.entitlement_rule_key,
    maxDaysPerRequest:
      t.max_days_per_request !== null ? Number(t.max_days_per_request) : null,
    maxDaysRuleKey: t.max_days_rule_key,
    countsNonWorkingDays: t.counts_non_working_days,
    allowHalfDay: t.allow_half_day,
    documentRequiredOverDays:
      t.document_required_over_days !== null
        ? Number(t.document_required_over_days)
        : null,
    yearEndAction: t.year_end_action,
    carryCapDays: t.carry_cap_days !== null ? Number(t.carry_cap_days) : null,
    encashable: t.encashable,
    eligibility: t.eligibility,
    isActive: t.is_active,
    version: t.version,
  };
}
