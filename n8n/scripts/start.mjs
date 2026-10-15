/** npm start — run the local n8n with the ERP settings (http://localhost:5678). */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { settings } from './env.mjs';

const n8n = path.join(settings.root, 'node_modules', 'n8n', 'bin', 'n8n');
const child = spawn(process.execPath, [n8n, 'start'], { env: { ...process.env, ...settings.env }, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
