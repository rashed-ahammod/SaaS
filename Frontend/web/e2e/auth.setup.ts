/**
 * Signs in each demo user once and keeps the session for the tasks
 * (the API allows 10 login attempts per minute per address).
 */
import { test as setup } from '@playwright/test';
import { USERS } from './users';

for (const [name, user] of Object.entries(USERS)) {
  setup(`sign in ${name}`, async ({ request }) => {
    const res = await request.post('/api/session', {
      headers: { 'x-erp-client': 'pwa' },
      data: { workspace: 'demo', login: user.login, password: 'Demo-Pass-123' },
    });
    if (!res.ok()) throw new Error(`Sign-in failed for ${user.login}: ${res.status()} ${await res.text()}`);
    await request.storageState({ path: user.state });
  });
}
