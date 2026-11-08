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
