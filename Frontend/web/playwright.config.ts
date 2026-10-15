import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end checks of the usability tasks (e2e/*.spec.ts) on a phone-sized
 * browser, against the running app and API with the demo data:
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
      testMatch: /\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        // Chattogram office (Agrabad), inside the branch geo-fence of the demo data
        geolocation: { latitude: 22.3246, longitude: 91.8124 },
        permissions: ['geolocation'],
        locale: 'bn-BD',
        timezoneId: 'Asia/Dhaka',
      },
    },
  ],
});
