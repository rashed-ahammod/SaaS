/**
 * Onboarding checklist (spec §6.1): documents, NID, TIN, bank account, assets,
 * email and ID card must be done before the employee becomes active.
 * An item that does not apply is completed with a note ("Not applicable: ...").
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { OnboardingItem } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import type { CompleteOnboardingItemDto } from './dto/document.dto.js';
import { EmployeeAccess } from './employee-access.js';

/** Default items. Company-specific checklists can be added later as a setting. */
export const DEFAULT_ONBOARDING_ITEMS: Array<{
  code: string;
  en: string;
  bn: string;
}> = [
  {
    code: 'personal_documents',
    en: 'Personal documents collected',
    bn: 'ব্যক্তিগত কাগজপত্র সংগ্রহ',
  },
  {
    code: 'nid_verified',
    en: 'National ID copy verified',
    bn: 'জাতীয় পরিচয়পত্রের কপি যাচাই',
  },
  {
    code: 'tin_collected',
    en: 'TIN certificate collected',
    bn: 'টিআইএন সনদ সংগ্রহ',
  },
  {
    code: 'bank_account',
    en: 'Salary bank / wallet account recorded',
    bn: 'বেতনের ব্যাংক / ওয়ালেট হিসাব সংরক্ষণ',
  },
  {
    code: 'assets_issued',
    en: 'Assets issued (laptop, phone ...)',
    bn: 'সম্পদ প্রদান (ল্যাপটপ, ফোন ...)',
  },
  {
    code: 'email_account',
    en: 'Email account created',
    bn: 'ইমেইল অ্যাকাউন্ট তৈরি',
  },
  { code: 'id_card', en: 'ID card issued', bn: 'আইডি কার্ড প্রদান' },
];

@Injectable()
export class OnboardingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly employeeAccess: EmployeeAccess,
  ) {}

  /** Called by EmployeesService when an employee is created. */
  async createChecklist(employeeId: string): Promise<void> {
    await this.db.tx
      .insertInto('onboarding_checklists')
      .values(
        DEFAULT_ONBOARDING_ITEMS.map((item, i) => ({
          employee_id: employeeId,
          item_code: item.code,
          sort_order: i,
        })),
      )
      .execute();
  }

  async getChecklist(employeeId: string) {
    await this.employeeAccess.check('employee.view', employeeId);
    const items = await this.loadItems(employeeId);
    return {
      complete: items.every((i) => !i.required || i.done_at !== null),
      items: items.map(toItemResponse),
    };
  }

  async completeItem(
    employeeId: string,
    itemCode: string,
    dto: CompleteOnboardingItemDto,
  ) {
    // check access and find item
    await this.employeeAccess.check('employee.manage', employeeId);
    const item = await this.findItem(employeeId, itemCode);

    // already done: nothing to change
    if (item.done_at) return toItemResponse(item);

    // mark done
    const updated = await this.db.tx
      .updateTable('onboarding_checklists')
      .set({
        done_at: new Date(),
        done_by: requestContext.get().userId ?? null,
        note: dto.note ?? null,
      })
      .where('id', '=', item.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'employee.onboarding_item_done',
      entity: 'employee',
      entityId: employeeId,
      after: { item: itemCode, note: dto.note ?? null },
    });
    return toItemResponse(updated);
  }

  /** Data migration: people employed before go-live were on-boarded in the old system. */
  async completeAllForImport(employeeId: string): Promise<void> {
    await this.db.tx
      .updateTable('onboarding_checklists')
      .set({
        done_at: new Date(),
        done_by: requestContext.get().userId ?? null,
        note: 'Employed before go-live (data migration)',
      })
      .where('employee_id', '=', employeeId)
      .where('done_at', 'is', null)
      .execute();
  }

  async reopenItem(employeeId: string, itemCode: string) {
    // check access and find item
    await this.employeeAccess.check('employee.manage', employeeId);
    const item = await this.findItem(employeeId, itemCode);
    if (!item.done_at) return toItemResponse(item);

    // mark not done
    const updated = await this.db.tx
      .updateTable('onboarding_checklists')
      .set({ done_at: null, done_by: null, note: null })
      .where('id', '=', item.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'employee.onboarding_item_reopened',
      entity: 'employee',
      entityId: employeeId,
      after: { item: itemCode },
    });
    return toItemResponse(updated);
  }

  /** Used by EmployeesService.activateEmployee(). */
  async isComplete(employeeId: string): Promise<boolean> {
    const items = await this.loadItems(employeeId);
    return items.every((i) => !i.required || i.done_at !== null);
  }

  // ------------------------------------------------------------------ helpers

  private loadItems(employeeId: string) {
    return this.db.tx
      .selectFrom('onboarding_checklists')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('sort_order')
      .execute();
  }

  private async findItem(
    employeeId: string,
    itemCode: string,
  ): Promise<OnboardingItem> {
    const item = await this.db.tx
      .selectFrom('onboarding_checklists')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('item_code', '=', itemCode)
      .executeTakeFirst();
    if (!item) throw new NotFoundException(MSG.ONBOARDING_ITEM_NOT_FOUND);
    return item;
  }
}

function toItemResponse(i: OnboardingItem) {
  const lang = requestContext.get().language;
  const def = DEFAULT_ONBOARDING_ITEMS.find((d) => d.code === i.item_code);
  return {
    code: i.item_code,
    label: def ? def[lang] : i.item_code,
    required: i.required,
    done: i.done_at !== null,
    doneAt: i.done_at,
    doneBy: i.done_by,
    note: i.note,
  };
}
