import { loadConfig } from './config.js';

const good = {
  NODE_ENV: 'production',
  PG_DATABASE: 'erp',
  PG_OWNER_PASSWORD: 'Qm7w2Lx9pR4tZ8vB1nK6',
  PG_APP_PASSWORD: 'Hs3dF8jK2lQ9wE5rT7yU',
  PG_WORKER_PASSWORD: 'Zx4cV7bN1mA8sD3fG6hJ',
  JWT_SECRET: 'p7Hq2Rk9Wm4Tz8Lx3Nv6Bc1Yd5Fs0Gj-Ua',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PUBLIC_APP_URL: 'https://office.example.com.bd',
  SECURITY_MFA_ENFORCED: 'true',
  METRICS_TOKEN: 'mT9x2Kq7Lw4Zr8Pv1Nb6Hc3Yd5Fs0Gj-Ua',
};

describe('production start-up checks (WP12)', () => {
  it('starts with real secrets, HTTPS and 2FA on', () => {
    expect(loadConfig(good).isProduction).toBe(true);
  });

  it.each([
    [
      '2FA switched off',
      { SECURITY_MFA_ENFORCED: 'false' },
      /SECURITY_MFA_ENFORCED/,
    ],
    ['the fake AI model', { AI_PROVIDER: 'fake' }, /AI_PROVIDER=fake/],
    [
      'plain-http app address',
      { PUBLIC_APP_URL: 'http://office.example.com.bd' },
      /PUBLIC_APP_URL/,
    ],
    [
      'the CI JWT secret',
      { JWT_SECRET: 'ci-only-jwt-secret-at-least-32-characters-long' },
      /JWT_SECRET/,
    ],
    [
      'the published encryption key',
      { FIELD_ENCRYPTION_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' },
      /FIELD_ENCRYPTION_KEY/,
    ],
    [
      'an example database password',
      { PG_APP_PASSWORD: 'change-me-app' },
      /PG_APP_PASSWORD/,
    ],
    ['no metrics token', { METRICS_TOKEN: '' }, /METRICS_TOKEN/],
    [
      'a short n8n webhook secret',
      {
        OUTBOX_WEBHOOK_BASE_URL: 'http://n8n:5678/webhook/x/erp',
        OUTBOX_WEBHOOK_SECRET: 'short',
      },
      /OUTBOX_WEBHOOK_SECRET/,
    ],
  ])('refuses %s', (_name, change, message) => {
    expect(() => loadConfig({ ...good, ...change })).toThrow(message);
  });

  it('development is not held to production rules', () => {
    expect(() =>
      loadConfig({
        ...good,
        NODE_ENV: 'development',
        PUBLIC_APP_URL: 'http://localhost:3001',
        SECURITY_MFA_ENFORCED: 'false',
      }),
    ).not.toThrow();
  });
});
