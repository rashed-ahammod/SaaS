/**
 * The WP9 usability tasks (docs/usability-test-wp9.md), done by a script on a
 * phone-sized browser with the demo data (Demo Trading Ltd, password Demo-Pass-123).
 * Pilot employees do the same tasks on their own phones for the acceptance test.
 */
import { expect, test, type Page } from '@playwright/test';
import { USERS } from './users';

/** Open the app as an already signed-in user, in the given language. */
async function open(page: Page, path = '/', lang: 'bn' | 'en' = 'en') {
  await page.addInitScript((l) => localStorage.setItem('erp-lang', l), lang);
  await page.goto(path);
}

test.describe('employee (Rafi)', () => {
  test.use({ storageState: USERS.rafi.state });

  test('task 1: see today, balances and the latest payslip, in Bangla', async ({ page }) => {
    await open(page, '/', 'bn');
    await expect(page.getByRole('heading', { name: /আসসালামু আলাইকুম/ })).toBeVisible();
    await expect(page.getByText('ছুটির ব্যালান্স')).toBeVisible();
    await expect(page.getByRole('link', { name: 'পাঞ্চ ইন / আউট' })).toBeVisible();
  });

  test('task 2: register the phone once (HR approves), then punch in at the office', async ({ page, playwright, baseURL }) => {
    await open(page);
    await page.getByRole('link', { name: 'Punch in / out' }).click();
    await page.getByLabel('Phone name, e.g. Samsung A15').fill('Rafi test phone');
    await page.getByRole('button', { name: 'Register this phone' }).click();
    await expect(page.getByText(/waiting for HR approval/)).toBeVisible();

    // HR (Farzana) approves the phone
    const hr = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { 'x-erp-client': 'pwa' } });
    const signedIn = await hr.post('/api/session', { data: { workspace: 'demo', login: 'farzana.akter@demo.test', password: 'Demo-Pass-123' } });
    expect(signedIn.ok()).toBe(true);
    const pending = await (await hr.get('/api/erp/attendance/devices?status=pending')).json();
    // only this browser's phone (approving another one would revoke this one: one active phone per person)
    const myDeviceId = await page.evaluate(() => localStorage.getItem('erp-device-id'));
    for (const d of pending.filter((x: { deviceId: string }) => x.deviceId === myDeviceId)) {
      const res = await hr.post(`/api/erp/attendance/devices/${d.id}/approve`, { headers: { 'idempotency-key': crypto.randomUUID() } });
      expect(res.status()).toBe(200);
    }
    await hr.dispose();

    await page.reload();
    await page.getByRole('button', { name: 'Punch now' }).click();
    await expect(page.getByText(/Punched at \d\d:\d\d\./)).toBeVisible();
  });

  test('task 3: check the leave balance, apply for casual leave, then cancel it', async ({ page }) => {
    await open(page, '/leave');
    await expect(page.getByRole('heading', { name: 'Leave' })).toBeVisible();
    await page.getByRole('link', { name: 'Apply for leave' }).click();

    const casual = await page.locator('option', { hasText: 'Casual leave' }).getAttribute('value');
    await page.getByLabel('Leave type').selectOption(casual!);
    await page.getByLabel('From').fill('2026-12-09');
    await page.getByLabel('To').fill('2026-12-10');
    await page.getByRole('button', { name: 'Check days' }).click();
    await expect(page.getByText('2 day(s) will be counted.')).toBeVisible();
    await page.getByRole('button', { name: 'Submit' }).click();

    await page.waitForURL('**/leave');
    const request = page.locator('li', { hasText: '9 Dec' }).filter({ hasText: 'Waiting' }).first();
    await expect(request).toBeVisible();
    await request.getByRole('button', { name: 'Cancel request' }).click();
    await request.getByLabel('Why do you cancel it?').fill('Plans changed (test)');
    await request.getByRole('button', { name: 'Cancel request' }).click();
    await expect(page.getByText('Request cancelled.')).toBeVisible();
  });

  test('task 4: open payslips', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: 'Payslips' }).click();
    await expect(page.getByRole('heading', { name: 'Payslips' })).toBeVisible();
  });

  test('task 5: update my emergency contact and switch the language', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: 'Me', exact: true }).click();
    await page.getByLabel('Emergency contact mobile').fill('01812345678');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.getByRole('button', { name: 'বাংলা' }).click();
    await expect(page.getByRole('heading', { name: 'আমার প্রোফাইল' })).toBeVisible();
  });

  test('offline: the app says so', async ({ page, context }) => {
    await open(page);
    await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/You are offline/)).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('manager (Tanvir)', () => {
  test.use({ storageState: USERS.tanvir.state });

  test('task 6: open the approvals inbox; reject needs a comment', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: /Approvals/ }).click();
    const item = page.getByText(/Leave: Mahmudul Hasan Rafi/).first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText('A comment is needed to reject or return.')).toBeVisible();
  });
});

test.describe('signed out', () => {
  test('sign in from the login page (Bangla)', async ({ page }) => {
    await open(page, '/leave', 'bn');
    await expect(page).toHaveURL(/\/login\?next=%2Fleave/);
    await page.getByLabel('কোম্পানি কোড').fill('demo');
    await page.getByLabel('ই-মেইল বা মোবাইল নম্বর').fill('rafi@demo.test');
    await page.getByLabel('পাসওয়ার্ড').fill('Demo-Pass-123');
    await page.getByRole('button', { name: 'সাইন ইন' }).click();
    await expect(page).toHaveURL(/\/leave$/);
    await expect(page.getByRole('heading', { name: 'ছুটি' })).toBeVisible();
  });
});
