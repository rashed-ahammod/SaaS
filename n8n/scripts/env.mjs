/**
 * Settings for the local n8n, from n8n/.env (copy .env.example). The webhook
 * secret is read from backend/.env so both sides always agree.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function parse(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

const local = parse(path.join(root, '.env'));
const backend = parse(path.join(root, '..', 'backend', '.env'));

export const settings = {
  root,
  webhookSecret: local.ERP_WEBHOOK_SECRET || backend.OUTBOX_WEBHOOK_SECRET,
  env: {
    // where n8n keeps its own database, credentials and encryption key (git-ignored)
    N8N_USER_FOLDER: path.join(root, '.n8n'),
    N8N_PORT: local.N8N_PORT ?? '5678',
    N8N_LISTEN_ADDRESS: '127.0.0.1',
    // the workflows read their endpoints from these; nothing else from the environment
    N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false',
    ERP_API_URL: local.ERP_API_URL ?? 'http://localhost:3000',
    EMAIL_API_URL: local.EMAIL_API_URL ?? 'http://localhost:5680/email',
    SMS_PRIMARY_URL: local.SMS_PRIMARY_URL ?? 'http://localhost:5680/sms/primary',
    SMS_FALLBACK_URL: local.SMS_FALLBACK_URL ?? 'http://localhost:5680/sms/fallback',
    // guide §15 / spec §11: no code execution or shell in workflows
    NODES_EXCLUDE: JSON.stringify(['n8n-nodes-base.code', 'n8n-nodes-base.function', 'n8n-nodes-base.functionItem', 'n8n-nodes-base.executeCommand', 'n8n-nodes-base.ssh', 'n8n-nodes-base.localFileTrigger', 'n8n-nodes-base.readWriteFile']),
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',

    GENERIC_TIMEZONE: 'Asia/Dhaka',
    EXECUTIONS_DATA_PRUNE: 'true',
    EXECUTIONS_DATA_MAX_AGE: '168',
  },
  credentials: {
    emailApiKey: local.EMAIL_API_KEY ?? 'local-test-key',
    smsPrimaryKey: local.SMS_PRIMARY_KEY ?? 'local-test-key',
    smsFallbackKey: local.SMS_FALLBACK_KEY ?? 'local-test-key',
  },
};
