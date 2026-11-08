/**
 * Test helpers. Every test creates its own tenants with random workspace codes,
 * so tests never depend on each other or on old data (the audit log cannot be
 * cleared, by design).
 */
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config/config.js';
import { createTenantWithOwner } from '../../src/modules/identity/tenant-bootstrap.js';
import { DatabaseService } from '../../src/platform/db/database.service.js';

export const config = loadConfig();

export function appDb() {
  return new DatabaseService(config, 'erp_app');
}
export function workerDb() {
  return new DatabaseService(config, 'erp_worker');
}
export function ownerDb() {
  return new DatabaseService(config, 'erp_owner');
}

export interface TestTenant {
  id: string;
  slug: string;
  userId: string;
  email: string;
  password: string;
}

/**
 * Create a tenant whose first user is System Admin + Admin (group scope), the
 * same way a real workspace starts. Goes through RLS like real code.
 */
export async function createTenant(
  db: DatabaseService,
  label = 'co',
): Promise<TestTenant> {
  const slug = `t-${label}-${randomUUID().slice(0, 8)}`;
  const email = `admin@${slug}.test`;
  const password = 'Correct-Horse-9';
  const { tenantId, ownerUserId } = await createTenantWithOwner(db, {
    slug,
    name: `Test ${label}`,
    ownerEmail: email,
    ownerPassword: password,
  });
  return { id: tenantId, slug, userId: ownerUserId, email, password };
}
