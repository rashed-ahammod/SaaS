/**
 * Guide §8 "Permission checks happen in the API layer": every route of every
 * controller must either be explicitly public, or use AuthGuard (users) or
 * ServiceKeyGuard / EventTokenGuard (machines) AND declare who may call it (@RequirePermission or
 * @AnyAuthenticated). A new route that forgets this fails here.
 */
import { allRoutes } from './routes.js';

/** Routes that are public on purpose. */
const PUBLIC_ROUTES = new Set([
  'POST /auth/login',
  'POST /auth/mfa/verify',
  'GET /health',
  'GET /health/ready',
]);

describe('every route declares who may call it', () => {
  it('finds the routes', async () => {
    expect((await allRoutes()).length).toBeGreaterThan(60);
  });

  it('non-public routes use AuthGuard and @RequirePermission / @AnyAuthenticated', async () => {
    const problems = (await allRoutes())
      .filter((r) => !PUBLIC_ROUTES.has(r.route))
      .filter((r) => !r.guarded || !r.declared)
      .map(
        (r) =>
          `${r.route}${r.guarded ? '' : ' (no AuthGuard)'}${r.declared ? '' : ' (no permission declared)'}`,
      );
    expect(problems).toEqual([]);
  });

  it('public routes are exactly the expected ones', async () => {
    const unguarded = (await allRoutes())
      .filter((r) => !r.guarded)
      .map((r) => r.route)
      .sort();
    expect(unguarded).toEqual([...PUBLIC_ROUTES].sort());
  });
});
