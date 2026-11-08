/**
 * npm run push-statement -- <bank account id> <statement.csv>
 *
 * Plays the bank's host-to-host channel (or the company's SFTP / e-mail fetcher) for a
 * local test: signs the file with the feed secret and pushes it to the "ERP bank
 * statements" workflow, which hands it to the ERP. n8n answers at once without the
 * ERP's result (it never returns workflow data); see the account's Statements tab.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { settings } from './env.mjs';

const [bankAccountId, file] = process.argv.slice(2);
if (!bankAccountId || !file) {
  console.error('Usage: npm run push-statement -- <bank account id> <statement.csv>');
  process.exit(1);
}

const body = { bankAccountId, fileName: path.basename(file), content: readFileSync(file, 'utf8') };
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', settings.bankFeedSecret).update(`${timestamp}.${JSON.stringify(body)}`).digest('hex');
const url = `http://127.0.0.1:${settings.env.N8N_PORT}/webhook/bank-statement`;

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Timestamp': timestamp, 'X-Signature': signature },
  body: JSON.stringify(body),
});
console.log(res.status, await res.text());
