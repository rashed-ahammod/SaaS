/**
 * Phone numbers and e-mails of leads, customers and contacts: each once per company
 * (crm_contact_keys). The table's key makes a duplicate impossible; the advisory locks make two
 * enquiries from the same number at the same moment wait for each other instead of failing.
 *
 *   lockAndFind(company, keys)   lock the keys (in order) and say who has any of them
 *   claim(company, keys, owner)  record them for a lead, or a customer (and its contact)
 *   moveToCustomer(lead, customer)   on qualification
 *   release(company, kind, value, owner)   when a phone / e-mail changes
 */
import { ConflictException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';

export interface ContactKey {
  kind: 'phone' | 'email';
  value: string;
}

export interface KeyOwner {
  leadId?: string | null;
  customerId?: string | null;
  contactId?: string | null;
}

export const keysOf = (
  phone: string | null,
  email: string | null,
): ContactKey[] => [
  ...(phone ? [{ kind: 'phone' as const, value: phone }] : []),
  ...(email ? [{ kind: 'email' as const, value: email }] : []),
];

@Injectable()
export class CrmKeys {
  constructor(private readonly db: DatabaseService) {}

  async lockAndFind(companyId: string, keys: ContactKey[]) {
    const sorted = [...keys].sort((a, b) =>
      `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
    );
    for (const k of sorted)
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm:${companyId}:${k.kind}:${k.value}`}, 0))`.execute(
        this.db.tx,
      );
    if (!keys.length) return [];
    return this.db.tx
      .selectFrom('crm_contact_keys')
      .selectAll()
      .where('company_id', '=', companyId)
      .where((eb) =>
        eb.or(
          keys.map((k) =>
            eb.and([eb('kind', '=', k.kind), eb('value', '=', k.value)]),
          ),
        ),
      )
      .execute();
  }

  async claim(companyId: string, keys: ContactKey[], owner: KeyOwner) {
    if (!keys.length) return;
    const taken = await this.lockAndFind(companyId, keys);
    const others = taken.filter(
      (t) =>
        !(owner.leadId && t.lead_id === owner.leadId) &&
        !(
          owner.customerId &&
          t.customer_id === owner.customerId &&
          (t.contact_id ?? null) === (owner.contactId ?? null)
        ),
    );
    if (others.length)
      throw new ConflictException({
        message: MSG.CRM_DUPLICATE,
        details: {
          taken: others.map((t) => ({
            kind: t.kind,
            value: t.value,
            leadId: t.lead_id,
            customerId: t.customer_id,
          })),
        },
      });
    const fresh = keys.filter(
      (k) => !taken.some((t) => t.kind === k.kind && t.value === k.value),
    );
    if (fresh.length) {
      await this.db.tx
        .insertInto('crm_contact_keys')
        .values(
          fresh.map((k) => ({
            company_id: companyId,
            kind: k.kind,
            value: k.value,
            lead_id: owner.leadId ?? null,
            customer_id: owner.customerId ?? null,
            contact_id: owner.contactId ?? null,
          })),
        )
        .execute();
    }
  }

  async moveToCustomer(leadId: string, customerId: string) {
    await this.db.tx
      .updateTable('crm_contact_keys')
      .set({ lead_id: null, customer_id: customerId })
      .where('lead_id', '=', leadId)
      .execute();
  }

  async release(companyId: string, key: ContactKey) {
    await this.db.tx
      .deleteFrom('crm_contact_keys')
      .where('company_id', '=', companyId)
      .where('kind', '=', key.kind)
      .where('value', '=', key.value)
      .execute();
  }
}
