/**
 * Application configuration.
 *
 * All settings come from environment variables (guide §5 rule 11: secrets never
 * in code). They are validated once at startup so a missing or malformed value
 * fails fast with a clear message instead of failing later inside a request.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  PG_HOST: z.string().default('localhost'),
  PG_PORT: z.coerce.number().int().positive().default(5432),
  PG_DATABASE: z.string().min(1),
  PG_OWNER_PASSWORD: z.string().min(1),
  PG_APP_PASSWORD: z.string().min(1),
  PG_WORKER_PASSWORD: z.string().min(1),
  // A managed PostgreSQL (Supabase, Neon, RDS) accepts TLS connections only; a
  // server on the same private network, reachable through no published port,
  // does not need it.
  //   off          plain connection
  //   require      TLS, without checking who the server is. What a pooler whose
  //                CA is not published needs (Supabase Supavisor).
  //   verify-full  TLS, and the server certificate must be signed by
  //                PG_SSL_ROOT_CERT. Use this whenever the provider publishes
  //                its CA certificate.
  PG_SSL: z.enum(['off', 'require', 'verify-full']).default('off'),
  // The CA certificate itself (PEM), not a path: it comes from the secret store.
  PG_SSL_ROOT_CERT: z.string().optional(),
  // Appended to every role name at login. Some connection poolers expect the
  // project in the user name: Supabase's Supavisor wants `erp_app.<project-ref>`,
  // so PG_USER_SUFFIX=.<project-ref>. Empty everywhere else.
  PG_USER_SUFFIX: z.string().default(''),
  // How many connections each pool may open. The defaults suit a PostgreSQL of
  // your own. Behind a pooler in session mode every connection is held for as
  // long as it is open, and a free plan's pooler allows few of them: 8 and 3
  // fit inside Supavisor's default pool size of 15.
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  PG_POOL_MAX_WORKER: z.coerce.number().int().min(1).max(100).default(5),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    ),

  OUTBOX_WEBHOOK_BASE_URL: z.url().optional().or(z.literal('')),
  OUTBOX_WEBHOOK_SECRET: z.string().optional(),
  // address of the employee app (links in e-mails and SMS)
  PUBLIC_APP_URL: z.url().default('http://localhost:3001'),

  // Two-factor rules (spec §11): mandatory 2FA for privileged roles and step-up
  // codes for high-risk actions. Can be switched off ONLY outside production,
  // to make manual testing easier.
  SECURITY_MFA_ENFORCED: z.enum(['true', 'false']).default('true'),

  // Turns the rate limiter off (app.module.ts). The integration tests make
  // hundreds of logins from one IP and would otherwise trip the login limit.
  // Refused in production, where it would remove the brute-force defence.
  DISABLE_RATE_LIMIT: z.enum(['0', '1']).default('0'),

  // The demo scenario's "today" (development only; refused in production).
  //
  // The dev seed writes one story — September's payroll, October's bills and
  // invoices, the October VAT return, a part-punched October — and that story
  // only hangs together when "now" is the day it was written for. Left unset,
  // the API runs on the real clock and the demo drifts a month further out of
  // shape every month: invoices land in the wrong period, a return that must
  // not be filable yet can be filed, a calendar's "days left" is overdue.
  // Set it, and the demo (and the e2e suite) behave the same on any day.
  // An ISO date-time with an offset, e.g. 2026-10-29T10:30:00+06:00.
  DEV_CLOCK: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), {
      message:
        'must be an ISO date-time with an offset, e.g. 2026-10-29T10:30:00+06:00',
    })
    .optional(),

  // Where uploaded files are kept.
  //   local  a folder on disk (FILE_STORAGE_DIR). One API instance only: two
  //          instances cannot share it, and a container without a mounted
  //          volume loses every file on the next deploy.
  //   s3     any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO). Required
  //          as soon as more than one API instance runs.
  FILE_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  FILE_STORAGE_DIR: z.string().default('storage'),
  S3_BUCKET: z.string().optional(),
  // R2 uses "auto"; AWS wants the bucket's region.
  S3_REGION: z.string().default('auto'),
  // Empty for AWS S3; the account endpoint for R2, the server for MinIO.
  S3_ENDPOINT: z.url().optional().or(z.literal('')),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // MinIO and some proxies need path-style addressing.
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),

  // AI gateway (WP11). "off": the app runs without AI (every screen still works).
  // "fake": a deterministic stand-in for tests and demos (never in production).
  AI_PROVIDER: z.enum(['off', 'anthropic', 'fake']).default('off'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  // the user waits at most this long; then the normal screens take over
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(25000),
  // release gate (guide §16): a feature is offered only when the fixed test set
  // passed for this model and prompt version. Always enforced in production.
  AI_REQUIRE_RELEASE_GATE: z.enum(['true', 'false']).default('false'),
  AI_REQUIRED_PASS_RATE: z.coerce.number().min(0).max(1).default(0.9),

  // Prometheus scrapes GET /metrics with Authorization: Bearer <METRICS_TOKEN> (unset = route disabled)
  METRICS_TOKEN: z.string().optional(),

  // Run the scheduled jobs (src/jobs.ts) inside the API process instead of a
  // worker of its own. For a host whose free plan offers one web service only.
  // ONE API instance only: two would run every job twice.
  RUN_JOBS_IN_API: z.enum(['true', 'false']).default('false'),

  // Apply pending migrations at API start, before the first request is served.
  // A free Render service has no shell, so this is the only way a deploy can
  // migrate itself; runMigrations takes a pg_advisory_lock, so two instances
  // starting together is safe. Off by default: a platform WITH a shell or a
  // pre-deploy hook should keep running npm run db:migrate there instead.
  RUN_MIGRATIONS_ON_BOOT: z.enum(['true', 'false']).default('false'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

/** The three database roles. See db/migrations/0001 and docs/adr/0002. */
export type DbRole = 'erp_owner' | 'erp_app' | 'erp_worker';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\nSee backend/.env.example.`,
    );
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production') {
    const problems = productionProblems(e);
    if (problems.length)
      throw new Error(
        `Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      );
  }

  if (e.PG_SSL === 'verify-full' && !e.PG_SSL_ROOT_CERT)
    throw new Error(
      'PG_SSL=verify-full needs PG_SSL_ROOT_CERT (the CA certificate in PEM form). See backend/.env.example.',
    );

  if (e.FILE_STORAGE_DRIVER === 's3') {
    const missing = (
      ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const
    ).filter((name) => !e[name]);
    if (missing.length)
      throw new Error(
        `FILE_STORAGE_DRIVER=s3 needs ${missing.join(', ')}. See backend/.env.example.`,
      );
  }

  /** What `pg` wants for the `ssl` option, built once. */
  const ssl =
    e.PG_SSL === 'off'
      ? false
      : e.PG_SSL === 'require'
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true, ca: e.PG_SSL_ROOT_CERT as string };

  const passwords: Record<DbRole, string> = {
    erp_owner: e.PG_OWNER_PASSWORD,
    erp_app: e.PG_APP_PASSWORD,
    erp_worker: e.PG_WORKER_PASSWORD,
  };

  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    db: {
      host: e.PG_HOST,
      port: e.PG_PORT,
      database: e.PG_DATABASE,
      /** How many connections the pool for this role may open. */
      poolMaxFor(role: DbRole) {
        return role === 'erp_worker' ? e.PG_POOL_MAX_WORKER : e.PG_POOL_MAX;
      },
      /** Connection settings for one of the three database roles. */
      connectionFor(role: DbRole) {
        return {
          host: e.PG_HOST,
          port: e.PG_PORT,
          database: e.PG_DATABASE,
          // the role itself; PG_USER_SUFFIX only changes how it logs in
          user: `${role}${e.PG_USER_SUFFIX}`,
          password: passwords[role],
          ssl,
        };
      },
    },
    auth: {
      jwtSecret: e.JWT_SECRET,
      accessTokenTtlSeconds: 30 * 60, // session timeout (spec §11)
      mfaTokenTtlSeconds: 5 * 60, // time allowed to type the 2FA code after the password
      maxFailedLogins: 5,
      lockoutMinutes: 15,
      /** Mandatory 2FA for privileged roles + step-up codes for high-risk actions. */
      mfaEnforced: e.SECURITY_MFA_ENFORCED === 'true',
    },
    /**
     * The fixed "now" the demo scenario is told against, or null for the real
     * clock. Only business time comes from here (dates, periods, due dates and
     * ages): tokens are signed and checked against the machine's own clock, so
     * a pinned demo clock cannot expire a session.
     *
     * Development only, and that is load-bearing in both directions. Production
     * refuses to start with it set. Tests ignore it: they read the same .env
     * through dotenv, so a developer's demo clock would otherwise quietly pin
     * time inside the suite - the tests that assume the real clock failed, and
     * CI, which has no .env, still passed. A test that wants a fixed clock says
     * so itself, with ManualClock.
     */
    devClock:
      e.DEV_CLOCK && e.NODE_ENV === 'development' ? new Date(e.DEV_CLOCK) : null,
    fieldEncryptionKey: Buffer.from(e.FIELD_ENCRYPTION_KEY, 'base64'),
    fileStorageDir: e.FILE_STORAGE_DIR,
    /** Which FileStorage to build. See platform.module.ts. */
    storage:
      e.FILE_STORAGE_DRIVER === 's3'
        ? ({
            driver: 's3',
            bucket: e.S3_BUCKET as string,
            region: e.S3_REGION,
            endpoint: e.S3_ENDPOINT || undefined,
            accessKeyId: e.S3_ACCESS_KEY_ID as string,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY as string,
            forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
          } as const)
        : ({ driver: 'local', dir: e.FILE_STORAGE_DIR } as const),
    outbox: {
      webhookBaseUrl: e.OUTBOX_WEBHOOK_BASE_URL || undefined,
      webhookSecret: e.OUTBOX_WEBHOOK_SECRET || undefined,
      maxAttempts: 10,
      batchSize: 20,
      pollIntervalMs: 2000,
    },
    notifications: {
      publicAppUrl: e.PUBLIC_APP_URL.replace(/\/$/, ''),
    },
    monitoring: {
      metricsToken: e.METRICS_TOKEN || undefined,
    },
    /** Scheduled jobs run in this process, with no worker of its own. */
    runJobsInApi: e.RUN_JOBS_IN_API === 'true',
    /** Apply pending migrations at start, before the port is opened. */
    runMigrationsOnBoot: e.RUN_MIGRATIONS_ON_BOOT === 'true',
    ai: {
      provider: e.AI_PROVIDER,
      /** Optional: without it the Anthropic SDK uses ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile. */
      anthropicApiKey: e.ANTHROPIC_API_KEY || undefined,
      model: e.AI_MODEL,
      timeoutMs: e.AI_TIMEOUT_MS,
      requireReleaseGate:
        e.NODE_ENV === 'production' || e.AI_REQUIRE_RELEASE_GATE === 'true',
      requiredPassRate: e.AI_REQUIRED_PASS_RATE,
    },
  };
}

/** Keys published in this repository (CI, examples). Never valid in production. */
const PUBLIC_KEYS = new Set(['AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=']);

/**
 * Production must not start with test settings or secrets anyone can read
 * (guide §20, WP12). Returns what is wrong; empty = fine.
 */
export function productionProblems(e: z.infer<typeof envSchema>): string[] {
  const p: string[] = [];
  if (e.DEV_CLOCK)
    p.push('DEV_CLOCK pins the demo clock and is for development only');
  if (e.SECURITY_MFA_ENFORCED !== 'true')
    p.push('SECURITY_MFA_ENFORCED must be true');
  if (e.DISABLE_RATE_LIMIT === '1')
    p.push(
      'DISABLE_RATE_LIMIT turns off the login rate limit and is for the test suite only',
    );
  if (e.AI_PROVIDER === 'fake') p.push('AI_PROVIDER=fake is for tests only');
  // Salaries, NID numbers and bank details travel on this connection. A managed
  // database is reached across a network nobody here controls, so production
  // never speaks to it in the clear -- even though 'off' is the right default
  // for a server on a private network with no published port.
  if (e.PG_SSL === 'off')
    p.push(
      "PG_SSL must be 'require' or 'verify-full' in production (the database connection carries payroll and NID data)",
    );
  if (!e.PUBLIC_APP_URL.startsWith('https://'))
    p.push('PUBLIC_APP_URL must be https:// (secure cookies, phone location)');
  if (/change-me|^ci-|ci-only|example|secret/i.test(e.JWT_SECRET))
    p.push('JWT_SECRET looks like a placeholder');
  if (PUBLIC_KEYS.has(e.FIELD_ENCRYPTION_KEY))
    p.push('FIELD_ENCRYPTION_KEY is a published test key');
  for (const key of [
    'PG_OWNER_PASSWORD',
    'PG_APP_PASSWORD',
    'PG_WORKER_PASSWORD',
  ] as const) {
    if (/change-me|^ci-/i.test(e[key]) || e[key].length < 16)
      p.push(`${key} must be a long random value`);
  }
  if (!e.METRICS_TOKEN || e.METRICS_TOKEN.length < 32)
    p.push(
      'METRICS_TOKEN must be set (at least 32 characters): alerts depend on /metrics',
    );
  if (
    e.OUTBOX_WEBHOOK_BASE_URL &&
    (!e.OUTBOX_WEBHOOK_SECRET || e.OUTBOX_WEBHOOK_SECRET.length < 32)
  ) {
    p.push(
      'OUTBOX_WEBHOOK_SECRET must be at least 32 characters when n8n is configured',
    );
  }
  return p;
}

/** Nest injection token for the AppConfig object. */
export const APP_CONFIG = Symbol('APP_CONFIG');
