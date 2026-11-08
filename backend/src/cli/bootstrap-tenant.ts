/**
 * Creates the first workspace of a deployment, with its first login:
 *
 *   node dist/cli/bootstrap-tenant.js --slug=acme --name="Acme Trading Ltd" \
 *     --email=admin@acme.com.bd
 *
 * The password comes from BOOTSTRAP_OWNER_PASSWORD (preferred: command-line
 * arguments are visible to every process on the host via `ps`), or from
 * --password for a local try.
 *
 * The owner receives System Admin, Admin and HR with group scope, so they can
 * set up the company and the first employees. Nobody may grant roles to
 * themselves, so without HR here the first user could not create employees.
 *
 * Unlike `npm run db:seed` (development only, fake Bangladeshi workspaces with a
 * published password) this is meant for production: it creates exactly one real
 * workspace and no demo data. Starting the application context applies the
 * production checks in config.ts first, so an unsafe environment stops here
 * rather than after the workspace exists.
 *
 * Run it again with the same slug and it refuses instead of creating a second
 * workspace. Pass --force-second-workspace to add another one on purpose.
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';
import { AppModule } from '../app.module.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { createTenantWithOwner } from '../modules/identity/tenant-bootstrap.js';
import { DatabaseService } from '../platform/db/database.service.js';

/** Same rule as the tenants.slug CHECK in db/migrations/0002. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const MIN_PASSWORD_LENGTH = 12;
/** Passwords that appear in this repository or in the documentation. */
const PUBLISHED_PASSWORDS = new Set(['demo-pass-123', 'change-me', 'password']);

function fail(message: string): never {
  console.error(`bootstrap-tenant: ${message}`);
  process.exit(1);
}

function readInput() {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
      'force-second-workspace': { type: 'boolean', default: false },
    },
  });

  const slug = values.slug?.trim().toLowerCase() ?? '';
  const name = values.name?.trim() ?? '';
  const email = values.email?.trim().toLowerCase() ?? '';
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? values.password ?? '';

  if (!slug || !name || !email)
    fail(
      'usage: bootstrap-tenant --slug=<workspace> --name="<Company Ltd>" --email=<owner e-mail>\n' +
        '       the password comes from BOOTSTRAP_OWNER_PASSWORD, or from --password',
    );
  if (!SLUG_RE.test(slug))
    fail(
      `invalid --slug "${slug}": 2 to 41 characters, lowercase letters, digits and "-", ` +
        'starting with a letter or digit',
    );
  if (!EMAIL_RE.test(email)) fail(`invalid --email "${email}"`);
  if (!password)
    fail('no password: set BOOTSTRAP_OWNER_PASSWORD, or pass --password');
  if (password.length < MIN_PASSWORD_LENGTH)
    fail(`the password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (PUBLISHED_PASSWORDS.has(password.toLowerCase()))
    fail('that password appears in this repository; choose another one');
  if (!process.env.BOOTSTRAP_OWNER_PASSWORD)
    console.warn(
      'warning: --password is visible to other processes on this host. ' +
        'BOOTSTRAP_OWNER_PASSWORD is safer.',
    );

  return { slug, name, email, password, force: values['force-second-workspace'] };
}

async function main() {
  const input = readInput();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = app.get(DatabaseService);

    // auth_find_tenant_id is the only slug lookup that works without a tenant
    // context (SECURITY DEFINER, granted to erp_app).
    const existing = await sql<{ id: string | null }>`
      SELECT auth_find_tenant_id(${input.slug}) AS id
    `.execute(db.kysely);
    if (existing.rows[0]?.id)
      fail(
        `workspace "${input.slug}" already exists (${existing.rows[0].id}). ` +
          'Nothing was changed.',
      );

    if (!input.force) {
      // erp_app sees no tenant rows outside withTenant (FORCE row level
      // security), so count them as erp_owner, which migration 0002 gives a
      // read-all policy on tenants. A second workspace on a live deployment
      // should be deliberate.
      const owner = new DatabaseService(app.get<AppConfig>(APP_CONFIG), 'erp_owner');
      try {
        const count = await owner.kysely
          .selectFrom('tenants')
          .select(owner.kysely.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow();
        if (Number(count.n) > 0)
          fail(
            `this database already holds ${count.n} workspace(s). Pass ` +
              '--force-second-workspace to add another one on purpose.',
          );
      } finally {
        await owner.kysely.destroy();
      }
    }

    const { tenantId, ownerUserId } = await createTenantWithOwner(db, {
      slug: input.slug,
      name: input.name,
      ownerEmail: input.email,
      ownerPassword: input.password,
    });

    console.log(
      [
        '',
        `workspace "${input.slug}" created`,
        `  name      ${input.name}`,
        `  tenant id ${tenantId}`,
        `  owner     ${input.email} (${ownerUserId})`,
        '  roles     System Admin, Admin, HR (group scope)',
        '',
        'Next, at PUBLIC_APP_URL:',
        '  1. sign in with that e-mail and the password you chose;',
        '  2. set up two-factor authentication at once — it is mandatory for',
        '     System Admin, Admin, HR and Accounts (SECURITY_MFA_ENFORCED=true);',
        '  3. change the password, and delete it from your shell history or',
        '     BOOTSTRAP_OWNER_PASSWORD.',
        '',
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
