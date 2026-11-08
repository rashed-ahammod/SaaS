/**
 * Adds `req.auth` and `req.access` to the Express request type. AuthGuard fills
 * them in after the access token is verified.
 */
import 'express';
import type { AccessGrants } from '../../modules/identity/access/access-grants.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      userId: string;
      tenantId: string;
      language: 'bn' | 'en';
      /** This session passed two-factor authentication. */
      mfa: boolean;
    };
    /** A machine caller (office sync agent, n8n), set by ServiceKeyGuard instead of auth. */
    service?: { tenantId: string; keyId: string; companyId: string | null };
    /** n8n calling back for one outbox event (EventTokenGuard, WP10). */
    callbackEventId?: string;
    /** Roles and scopes of the user (or permissions of the service key). */
    access?: AccessGrants;
  }
}
