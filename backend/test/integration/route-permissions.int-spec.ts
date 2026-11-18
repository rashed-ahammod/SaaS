/**
 * Guide §8 "Permission checks happen in the API layer": every route of every
 * controller must either be explicitly public, or use AuthGuard (users) or
 * ServiceKeyGuard / EventTokenGuard (machines) AND declare who may call it (@RequirePermission or
 * @AnyAuthenticated). A new route that forgets this fails here.
 */
import { allRoutes } from './routes.js';

/**
 * allRoutes() imports every controller in the application, which grew with Phase 3 (support,
 * recruitment, performance, commissions). The first call pays the whole transform cost, so
 * these three checks get the same generous timeout the other heavy suites use.
 */
const TIMEOUT = 180_000;

/** Routes that are public on purpose. */
const PUBLIC_ROUTES = new Set([
  'POST /auth/login',
  'POST /auth/mfa/verify',
  'GET /health',
  'GET /health/ready',
]);

describe('every route declares who may call it', () => {
  it(
    'finds the routes',
    async () => {
      expect((await allRoutes()).length).toBeGreaterThan(60);
    },
    TIMEOUT,
  );

  it(
    'non-public routes use AuthGuard and @RequirePermission / @AnyAuthenticated',
    async () => {
      const problems = (await allRoutes())
        .filter((r) => !PUBLIC_ROUTES.has(r.route))
        .filter((r) => !r.guarded || !r.declared)
        .map(
          (r) =>
            `${r.route}${r.guarded ? '' : ' (no AuthGuard)'}${r.declared ? '' : ' (no permission declared)'}`,
        );
      expect(problems).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'public routes are exactly the expected ones',
    async () => {
      const unguarded = (await allRoutes())
        .filter((r) => !r.guarded)
        .map((r) => r.route)
        .sort();
      expect(unguarded).toEqual([...PUBLIC_ROUTES].sort());
    },
    TIMEOUT,
  );
});
