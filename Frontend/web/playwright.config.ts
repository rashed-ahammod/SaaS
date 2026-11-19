import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end checks against the running app and API with the demo data:
 *   - usability.spec.ts: the employee app's tasks, on a phone-sized browser;
 *   - portal.spec.ts: the HR & Admin portal (WP13), on a desktop browser;
 *   - finance.spec.ts: the finance screens (Phase 2: books, vendors, bills, tax at source), desktop;
 *   - enquiry.spec.ts: the public enquiry form, on a phone, signed out.
 *
 *   cd backend && npm run db:seed && npm run start      (API on :3000)
 *   cd Frontend/web && npm run build && npm run start   (app on :3001)
 *   npm run e2e
 *
 * Two things the suite needs, or it fails on the setup rather than the code:
 *   - DEV_CLOCK in backend/.env. The demo is one story told on one day; without
 *     its clock the API runs on the real one and the data drifts out of the story
 *     (periods, due dates, ages).
 *   - a built app, not `next dev`: dev keeps an HMR connection open, so
 *     waitForLoadState('networkidle') never settles and every test times out.
 *   - the app STARTED AFTER the seed. `db:seed` rewrites ENQUIRY_FORMS in
 *     .env.local (a reseed gives the company a new id and a new service key),
 *     and a Next server already running holds the env it started with: the
 *     public enquiry form then posts to a company that no longer exists.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'phone',
      dependencies: ['setup'],
      testMatch: /usability\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        // Chattogram office (Agrabad), inside the branch geo-fence of the demo data
        geolocation: { latitude: 22.3246, longitude: 91.8124 },
        permissions: ['geolocation'],
        locale: 'bn-BD',
        timezoneId: 'Asia/Dhaka',
      },
    },
    {
      // the public enquiry form: nobody signed in
      name: 'public',
      testMatch: /enquiry\.spec\.ts/,
      use: { ...devices['Pixel 7'], locale: 'bn-BD', timezoneId: 'Asia/Dhaka' },
    },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testMatch: /(portal|finance).spec.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, timezoneId: 'Asia/Dhaka' },
    },
  ],
});
