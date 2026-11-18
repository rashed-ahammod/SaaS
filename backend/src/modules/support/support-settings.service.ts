/**
 * Support settings (WP28): the ticket categories of a company, and the SLA per priority
 * (which TicketSlaService owns, because it also counts with it).
 *
 * A company with no categories yet gets the shipped list the first time it looks, so the
 * first ticket can be raised without a setup trip (the same idea as the SLA defaults). It
 * may rename them, change their default priority, or retire the ones it does not use.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { DEFAULT_CATEGORIES } from './support-rules.js';
import type { CategoryDto, UpdateCategoryDto } from './dto/support.dto.js';

@Injectable()
export class SupportSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly org: OrgLookupService,
  ) {}

  async categories(companyId: string, opts: { all?: boolean } = {}) {
    await this.org.assertCompanyExists(companyId);
    await this.ensureDefaults(companyId);
    let q = this.db.tx
      .selectFrom('support_categories')
      .select([
        'id',
        'code',
        'name',
        'name_bn',
        'default_priority',
        'is_active',
        'version',
      ])
      .where('company_id', '=', companyId)
      .orderBy('code');
    if (!opts.all) q = q.where('is_active', '=', true);
    const rows = await q.execute();
    return {
      categories: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        nameBn: r.name_bn,
        defaultPriority: r.default_priority,
        isActive: r.is_active,
        version: r.version,
      })),
    };
  }

  async createCategory(companyId: string, dto: CategoryDto) {
    await this.org.assertCompanyExists(companyId);
    const taken = await this.db.tx
      .selectFrom('support_categories')
      .select('id')
      .where('company_id', '=', companyId)
      .where('code', '=', dto.code)
      .executeTakeFirst();
    if (taken) throw new ConflictException(MSG.TICKET_CATEGORY_CODE_TAKEN);
    const row = await this.db.tx
      .insertInto('support_categories')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name,
        name_bn: dto.nameBn ?? null,
        default_priority: dto.defaultPriority ?? 'normal',
      })
      .returning(['id', 'code'])
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'ticket_category.created',
      entity: 'support_category',
      entityId: row.id,
      after: { code: row.code, name: dto.name },
    });
    return this.categories(companyId, { all: true });
  }

  async updateCategory(categoryId: string, dto: UpdateCategoryDto) {
    const category = await this.db.tx
      .selectFrom('support_categories')
      .selectAll()
      .where('id', '=', categoryId)
      .executeTakeFirst();
    if (!category) throw new NotFoundException(MSG.TICKET_CATEGORY_NOT_FOUND);
    if (category.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);

    const row = await this.db.tx
      .updateTable('support_categories')
      .set({
        name: dto.name ?? category.name,
        name_bn: dto.nameBn ?? category.name_bn,
        default_priority: dto.defaultPriority ?? category.default_priority,
        is_active: dto.isActive ?? category.is_active,
      })
      .where('id', '=', categoryId)
      .returning(['company_id', 'code', 'name', 'is_active'])
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'ticket_category.updated',
      entity: 'support_category',
      entityId: categoryId,
      before: {
        name: category.name,
        defaultPriority: category.default_priority,
        isActive: category.is_active,
      },
      after: { name: row.name, isActive: row.is_active },
    });
    return this.categories(row.company_id, { all: true });
  }

  /** The shipped categories, written once per company. */
  private async ensureDefaults(companyId: string) {
    const any = await this.db.tx
      .selectFrom('support_categories')
      .select('id')
      .where('company_id', '=', companyId)
      .executeTakeFirst();
    if (any) return;
    await this.db.tx
      .insertInto('support_categories')
      .values(
        DEFAULT_CATEGORIES.map((c) => ({
          company_id: companyId,
          code: c.code,
          name: c.name,
          name_bn: c.nameBn,
          default_priority: c.defaultPriority,
        })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}
