/**
 * Statutory rule values for business code (guide §18, spec §7).
 *
 *   const days = await this.rules.getInteger('leave.maternity.days', onDate);
 *   const rate = await this.rules.getDecimal('overtime.rate_multiplier', onDate);   // "2"
 *
 * How a value is found for a tenant and a date:
 *   1. the rule pack version the tenant accepted for that date (latest acceptance on or before it);
 *   2. the value in that pack whose period covers the date.
 *
 * Safety rule (WP3 acceptance): a value still marked "verify" is refused in
 * production (422 RULE_NOT_VERIFIED, naming the rule). Development and tests may
 * use it, so work can continue while the compliance owner checks the law.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import {
  businessDate,
  todayInDhaka,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { RuleValue } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AccessService } from '../identity/access/access.service.js';
import type { AcceptRulePackDto } from './dto/rules.dto.js';

export interface ResolvedRule {
  key: string;
  value: unknown;
  valueType: RuleValue['value_type'];
  unit: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'verify' | 'verified';
  sourceUrl: string | null;
  pack: string; // e.g. "BD-LABOUR 2026.1"
}

@Injectable()
export class RulesService {
  private readonly logger = new Logger('Rules');

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ==================================================== for business modules

  /** One rule on a date. Throws if missing, or if unverified in production. */
  async get(key: string, onDate: BusinessDate): Promise<ResolvedRule> {
    // which pack the tenant uses on that date
    const pack = await this.acceptedPackOn(onDate);

    // the value whose period covers the date
    const row = await this.db.tx
      .selectFrom('rule_values')
      .selectAll()
      .where('pack_id', '=', pack.packId)
      .where('rule_key', '=', key)
      .where('effective_from', '<=', onDate)
      .where((eb) =>
        eb.or([
          eb('effective_to', 'is', null),
          eb('effective_to', '>', onDate),
        ]),
      )
      .executeTakeFirst();
    if (!row)
      throw new NotFoundException({
        message: MSG.RULE_NOT_FOUND,
        details: { key, date: onDate, pack: pack.label },
      });

    // unverified values never reach live calculations
    if (row.status !== 'verified' && this.config.isProduction) {
      this.logger.error(
        `Refused unverified rule ${key} (${pack.label}) for ${onDate}`,
      );
      throw new UnprocessableEntityException({
        message: MSG.RULE_NOT_VERIFIED,
        details: { key, date: onDate, pack: pack.label },
      });
    }
    return toResolved(row, pack.label);
  }

  async getInteger(key: string, onDate: BusinessDate): Promise<number> {
    const rule = await this.get(key, onDate);
    if (rule.valueType !== 'integer')
      throw new Error(`Rule ${key} is ${rule.valueType}, not integer`);
    return rule.value as number;
  }

  /** Decimal as a string (e.g. "2", "0.10"); never a float. */
  async getDecimal(key: string, onDate: BusinessDate): Promise<string> {
    const rule = await this.get(key, onDate);
    if (rule.valueType !== 'decimal' && rule.valueType !== 'money')
      throw new Error(`Rule ${key} is ${rule.valueType}, not decimal`);
    return rule.value as string;
  }

  async getMoney(key: string, onDate: BusinessDate): Promise<Money> {
    return Money.of(await this.getDecimal(key, onDate));
  }

  async getBoolean(key: string, onDate: BusinessDate): Promise<boolean> {
    const rule = await this.get(key, onDate);
    if (rule.valueType !== 'boolean')
      throw new Error(`Rule ${key} is ${rule.valueType}, not boolean`);
    return rule.value as boolean;
  }

  async getJson<T>(key: string, onDate: BusinessDate): Promise<T> {
    return (await this.get(key, onDate)).value as T;
  }

  // ==================================================== for the API

  /** Published packs, and which ones this tenant has accepted from which date. */
  async listPacks() {
    const packs = await this.db.tx
      .selectFrom('rule_packs')
      .selectAll()
      .orderBy('code')
      .orderBy('version', 'desc')
      .execute();
    const counts = await this.db.tx
      .selectFrom('rule_values')
      .select(['pack_id', 'status', (eb) => eb.fn.countAll<number>().as('n')])
      .groupBy(['pack_id', 'status'])
      .execute();
    const accepted = await this.db.tx
      .selectFrom('tenant_rule_packs')
      .selectAll()
      .orderBy('effective_from')
      .execute();
    const label = (packId: string) => {
      const p = packs.find((x) => x.id === packId);
      return p ? `${p.code} ${p.version}` : packId;
    };

    return {
      packs: packs.map((p) => ({
        id: p.id,
        code: p.code,
        version: p.version,
        title: p.title,
        notes: p.notes,
        status: p.status,
        publishedAt: p.published_at,
        values: Number(
          counts
            .filter((c) => c.pack_id === p.id)
            .reduce((s, c) => s + Number(c.n), 0),
        ),
        unverifiedValues: Number(
          counts.find((c) => c.pack_id === p.id && c.status === 'verify')?.n ??
            0,
        ),
      })),
      acceptedByMyCompany: accepted.map((a) => ({
        packId: a.pack_id,
        pack: label(a.pack_id),
        effectiveFrom: a.effective_from,
        acceptedBy: a.accepted_by,
        acceptedAt: a.accepted_at,
        note: a.note,
      })),
    };
  }

  /** Every value of a pack, with sources, status and verification history. */
  async getPack(packId: string) {
    const pack = await this.findPack(packId);
    const values = await this.db.tx
      .selectFrom('rule_values')
      .selectAll()
      .where('pack_id', '=', packId)
      .orderBy('rule_key')
      .orderBy('effective_from')
      .execute();
    const history = values.length
      ? await this.db.tx
          .selectFrom('rule_value_history')
          .selectAll()
          .where(
            'rule_value_id',
            'in',
            values.map((v) => v.id),
          )
          .orderBy('at')
          .execute()
      : [];
    const lang = this.langOrEn();

    return {
      id: pack.id,
      code: pack.code,
      version: pack.version,
      title: pack.title,
      notes: pack.notes,
      values: values.map((v) => ({
        ...toResolved(v, `${pack.code} ${pack.version}`),
        description:
          lang === 'bn' && v.description_bn
            ? v.description_bn
            : v.description_en,
        sourceNote: v.source_note,
        verifiedBy: v.verified_by,
        verifiedAt: v.verified_at,
        history: history
          .filter((h) => h.rule_value_id === v.id)
          .map((h) => ({
            action: h.action,
            by: h.by_name,
            sourceUrl: h.source_url,
            note: h.note,
            at: h.at,
          })),
      })),
    };
  }

  /**
   * The tenant starts using a pack version from a date (guide §18). Tenant-wide
   * (group scope). Unverified values are reported: they work in development but
   * are refused in production until the compliance owner verifies them.
   */
  async acceptPack(packId: string, dto: AcceptRulePackDto) {
    this.access.assert('rules.accept', {});
    const pack = await this.findPack(packId);
    if (pack.status !== 'published')
      throw new BadRequestException(
        'Only published rule packs can be accepted',
      );

    // save (one acceptance per date: a second one for the same date is refused)
    await this.db.tx
      .insertInto('tenant_rule_packs')
      .values({
        pack_id: packId,
        effective_from: dto.effectiveFrom,
        note: dto.note ?? null,
      })
      .execute();
    await this.audit.record({
      action: 'rule_pack.accepted',
      entity: 'rule_pack',
      entityId: packId,
      after: {
        pack: `${pack.code} ${pack.version}`,
        effectiveFrom: dto.effectiveFrom,
        note: dto.note ?? null,
      },
    });

    const unverified = await this.db.tx
      .selectFrom('rule_values')
      .select('rule_key')
      .distinct()
      .where('pack_id', '=', packId)
      .where('status', '=', 'verify')
      .orderBy('rule_key')
      .execute();
    return {
      accepted: `${pack.code} ${pack.version}`,
      effectiveFrom: dto.effectiveFrom,
      unverifiedRules: unverified.map((u) => u.rule_key),
      warning: unverified.length
        ? `${unverified.length} rule(s) are not verified yet; they are refused in production until the compliance owner verifies them`
        : null,
    };
  }

  /** All rules in force for this tenant on a date (default today). */
  async effectiveRules(onDate?: string) {
    const date = onDate ? businessDate(onDate) : todayInDhaka();
    const pack = await this.acceptedPackOn(date);
    const rows = await this.db.tx
      .selectFrom('rule_values')
      .selectAll()
      .where('pack_id', '=', pack.packId)
      .where('effective_from', '<=', date)
      .where((eb) =>
        eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', date)]),
      )
      .orderBy('rule_key')
      .execute();
    const lang = this.langOrEn();
    return {
      date,
      pack: pack.label,
      usableInProduction: rows.every((r) => r.status === 'verified'),
      rules: rows.map((r) => ({
        ...toResolved(r, pack.label),
        description:
          lang === 'bn' && r.description_bn
            ? r.description_bn
            : r.description_en,
      })),
    };
  }

  // ------------------------------------------------------------------ helpers

  private async acceptedPackOn(
    date: BusinessDate,
  ): Promise<{ packId: string; label: string }> {
    const row = await this.db.tx
      .selectFrom('tenant_rule_packs as t')
      .innerJoin('rule_packs as p', 'p.id', 't.pack_id')
      .select(['t.pack_id', 'p.code', 'p.version'])
      .where('t.effective_from', '<=', date)
      .orderBy('t.effective_from', 'desc')
      .executeTakeFirst();
    if (!row)
      throw new BadRequestException({
        message: MSG.RULE_PACK_NOT_ACCEPTED,
        details: { date },
      });
    return { packId: row.pack_id, label: `${row.code} ${row.version}` };
  }

  private async findPack(packId: string) {
    const pack = await this.db.tx
      .selectFrom('rule_packs')
      .selectAll()
      .where('id', '=', packId)
      .executeTakeFirst();
    if (!pack) throw new NotFoundException(MSG.RULE_PACK_NOT_FOUND);
    return pack;
  }

  private langOrEn(): 'bn' | 'en' {
    return requestContext.find()?.language ?? 'en';
  }
}

function toResolved(v: RuleValue, pack: string): ResolvedRule {
  return {
    key: v.rule_key,
    value: v.value,
    valueType: v.value_type,
    unit: v.unit,
    effectiveFrom: v.effective_from,
    effectiveTo: v.effective_to,
    status: v.status,
    sourceUrl: v.source_url,
    pack,
  };
}
