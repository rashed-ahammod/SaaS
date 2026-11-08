import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real PostgreSQL (the PG_TEST_DATABASE from .env).
 *   npm run test:int
 * The test database is migrated automatically before the tests start.
 */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.int-spec.ts'],
    setupFiles: ['test/integration/setup-env.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
