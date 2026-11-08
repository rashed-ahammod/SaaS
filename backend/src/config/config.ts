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

  if (e.FILE_STORAGE_DRIVER === 's3') {
    const missing = (
      ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const
    ).filter((name) => !e[name]);
    if (missing.length)
      throw new Error(
        `FILE_STORAGE_DRIVER=s3 needs ${missing.join(', ')}. See backend/.env.example.`,
      );
  }

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
      /** Connection settings for one of the three database roles. */
      connectionFor(role: DbRole) {
        return {
          host: e.PG_HOST,
          port: e.PG_PORT,
          database: e.PG_DATABASE,
          user: role,
          password: passwords[role],
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
  if (e.SECURITY_MFA_ENFORCED !== 'true')
    p.push('SECURITY_MFA_ENFORCED must be true');
  if (e.AI_PROVIDER === 'fake') p.push('AI_PROVIDER=fake is for tests only');
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
