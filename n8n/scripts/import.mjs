/**
 * npm run import   — load the reviewed workflow(s) from workflows/ and the
 * credentials (secrets from .env files, encrypted by n8n on import), then
 * publish the workflow. Run again after editing a workflow file.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { settings } from './env.mjs';

if (!settings.webhookSecret) throw new Error('No webhook secret: set OUTBOX_WEBHOOK_SECRET in backend/.env (or ERP_WEBHOOK_SECRET in n8n/.env)');

const n8n = path.join(settings.root, 'node_modules', 'n8n', 'bin', 'n8n');
const run = (...args) => execFileSync(process.execPath, [n8n, ...args], { env: { ...process.env, ...settings.env }, stdio: 'inherit' });
mkdirSync(settings.env.N8N_USER_FOLDER, { recursive: true });

// credentials: written to a temporary file only for the import
const credentialsFile = path.join(settings.env.N8N_USER_FOLDER, 'credentials-import.json');
const header = (id, name, value) => ({ id, name, type: 'httpHeaderAuth', data: { name: 'Authorization', value: `Bearer ${value}` } });
writeFileSync(
  credentialsFile,
  JSON.stringify([
    { id: 'erpWebhookSecret', name: 'ERP webhook secret', type: 'crypto', data: { hmacSecret: settings.webhookSecret } },
    header('erpEmailApi', 'E-mail API', settings.credentials.emailApiKey),
    header('erpSmsPrimary', 'SMS gateway (primary)', settings.credentials.smsPrimaryKey),
    header('erpSmsFallback', 'SMS gateway (fallback)', settings.credentials.smsFallbackKey),
    { id: 'bankFeedSecret', name: 'Bank statement feed secret', type: 'crypto', data: { hmacSecret: settings.bankFeedSecret } },
    { id: 'erpBankImportKey', name: 'ERP bank import service key', type: 'httpHeaderAuth', data: { name: 'Authorization', value: settings.credentials.erpBankImportKey || 'ServiceKey not-configured' } },
    { id: 'leadFeedSecret', name: 'Lead feed secret', type: 'crypto', data: { hmacSecret: settings.leadFeedSecret } },
    { id: 'erpCrmCaptureKey', name: 'ERP CRM capture service key', type: 'httpHeaderAuth', data: { name: 'Authorization', value: settings.credentials.erpCrmCaptureKey || 'ServiceKey not-configured' } },
  ]),
);
try {
  run('import:credentials', `--input=${credentialsFile}`);
} finally {
  rmSync(credentialsFile, { force: true });
}

// workflows, then publish (active)
for (const file of readdirSync(path.join(settings.root, 'workflows')).filter((f) => f.endsWith('.json'))) {
  run('import:workflow', `--input=${path.join(settings.root, 'workflows', file)}`);
}
run('publish:workflow', '--id=erpNotifications01');
run('publish:workflow', '--id=erpBankStatements01');
run('publish:workflow', '--id=erpLeadCapture01');
run('publish:workflow', '--id=erpKits01');
if (!settings.credentials.erpBankImportKey) console.log('No ERP_BANK_IMPORT_KEY in n8n/.env: bank statement pushes will be refused by the ERP (401) until you add one.');
if (!settings.credentials.erpCrmCaptureKey) console.log('No ERP_CRM_CAPTURE_KEY in n8n/.env: captured leads will be refused by the ERP (401) until you add one (service key with crm.capture).');
console.log('Imported and published. Start (or restart) n8n: npm start');
