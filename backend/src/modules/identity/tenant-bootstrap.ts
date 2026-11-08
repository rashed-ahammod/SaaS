/**
 * Creates a new tenant (customer workspace) with its first login, who receives
 * System Admin, Admin and HR with group scope, so they can set up the company and
 * its first employees. Nobody may grant roles to themselves, so without HR here
 * the first user could not create employees. Another admin can revoke it later.
 *
 * Used by the seed script and the tests. A self-service sign-up flow (Phase 0/1
 * sales decision) will call the same function.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseService } from '../../platform/db/database.service.js';
import { AccessGrants } from './access/access-grants.js';
import { hashPassword } from './password.js';

export interface NewTenant {
  slug: string;
  name: string;
  ownerEmail: string;
  ownerPassword: string;
}

export async function createTenantWithOwner(
  db: DatabaseService,
  input: NewTenant,
): Promise<{ tenantId: string; ownerUserId: string }> {
  const tenantId = randomUUID();
  const passwordHash = await hashPassword(input.ownerPassword);

  const ownerUserId = await db.withTenant(
    { tenantId, access: AccessGrants.system() },
    async () => {
      await db.tx
        .insertInto('tenants')
        .values({ id: tenantId, slug: input.slug, name: input.name })
        .execute();
      const owner = await db.tx
        .insertInto('users')
        .values({
          email: input.ownerEmail.toLowerCase(),
          password_hash: passwordHash,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db.tx
        .insertInto('user_roles')
        .values([
          {
            user_id: owner.id,
            system_role: 'system_admin',
            scope_type: 'group',
            scope_id: null,
          },
          {
            user_id: owner.id,
            system_role: 'admin',
            scope_type: 'group',
            scope_id: null,
          },
          {
            user_id: owner.id,
            system_role: 'hr',
            scope_type: 'group',
            scope_id: null,
          },
        ])
        .execute();
      return owner.id;
    },
  );

  return { tenantId, ownerUserId };
}
