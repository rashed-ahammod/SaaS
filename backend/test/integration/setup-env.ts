// Runs before every integration test file: point the app at the test database.
import 'dotenv/config';

if (!process.env.PG_TEST_DATABASE)
  throw new Error('PG_TEST_DATABASE is not set in backend/.env');
process.env.PG_DATABASE = process.env.PG_TEST_DATABASE;
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
// Most tests sign in as an admin without 2FA; mfa-enforcement.int-spec.ts turns it on.
process.env.SECURITY_MFA_ENFORCED ??= 'false';
