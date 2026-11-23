/**
 * Protects a route. Use on every route except login and health:
 *
 *   @UseGuards(AuthGuard)
 *   @RequirePermission('employee.manage')
 *   @Post('employees')
 *
 * In order, it checks:
 *   1. a valid access token                         -> else 401 AUTH_REQUIRED
 *   2. the login is still active, and the token was issued after the user's
 *      tokens_valid_from (sign-out moves it forward, which ends every session
 *      that user holds at once, 0049)
 *                                                   -> else 401 AUTH_REQUIRED
 *   3. privileged roles (Admin, System Admin, HR, Accounts) signed in with 2FA
 *                                                   -> else 403 AUTH_MFA_REQUIRED (spec §11)
 *   4. the permission named by @RequirePermission   -> else 403 FORBIDDEN
 *   5. a fresh 2FA code in X-OTP-Code for @RequireStepUp routes (an employee without
 *      2FA is let through where the route allows it and a privileged user approves later)
 *                                                   -> else 403 AUTH_STEP_UP_REQUIRED / 401
 * and loads the user's roles into req.access for the services.
 *
 * Checks 3 and 5 are skipped when SECURITY_MFA_ENFORCED=false (never in production).
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { FieldEncryption } from '../../platform/crypto/field-encryption.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { languageOverride, MSG } from '../../platform/i18n/messages.js';
import { AccessService } from './access/access.service.js';
import {
  ALLOW_WITHOUT_MFA_KEY,
  PERMISSIONS_KEY,
  STEP_UP_KEY,
  type StepUpRule,
} from './access/decorators.js';
import type { PermissionKey } from './access/permissions.js';
import { TokenService } from './token.service.js';
import { verifyTotp } from './totp.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly db: DatabaseService,
    private readonly accessService: AccessService,
    private readonly encryption: FieldEncryption,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const meta = <T>(key: string) =>
      this.reflector.getAllAndOverride<T>(key, [
        context.getHandler(),
        context.getClass(),
      ]);
    const required = meta<PermissionKey[]>(PERMISSIONS_KEY) ?? [];
    const allowWithoutMfa = meta<boolean>(ALLOW_WITHOUT_MFA_KEY) ?? false;
    const stepUp = meta<StepUpRule>(STEP_UP_KEY) ?? false;

    // 1. read and verify "Authorization: Bearer <token>"
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token)
      throw new UnauthorizedException(MSG.AUTH_REQUIRED);
    const payload = await this.tokens.verifyAccessToken(token);
    if (!payload) throw new UnauthorizedException(MSG.AUTH_REQUIRED);
    // known from here on, so even a refusal below is answered in the user's language
    // (X-Language from the app's language switch wins over the saved preference)
    req.auth = {
      userId: payload.sub,
      tenantId: payload.tid,
      language: languageOverride(req.headers['x-language']) ?? payload.lang,
      mfa: payload.mfa,
    };

    // 2. login still active + load roles (one short read transaction)
    const loaded = await this.db.withTenant(
      { tenantId: payload.tid, userId: payload.sub },
      async () => {
        const user = await this.db.tx
          .selectFrom('users')
          .select(['status', 'tokens_valid_from'])
          .where('id', '=', payload.sub)
          .executeTakeFirst();
        if (!user || user.status !== 'active') return null;
        // Signed out since this token was issued (0049). `ims` is missing only
        // on a token signed before this check existed; those are left alone and
        // expire on their own within the half hour.
        if (
          payload.ims !== undefined &&
          payload.ims < user.tokens_valid_from.getTime()
        )
          return null;
        return this.accessService.load(payload.sub);
      },
    );
    if (!loaded) throw new UnauthorizedException(MSG.AUTH_REQUIRED);

    // 3. privileged roles must have signed in with 2FA
    if (
      this.config.auth.mfaEnforced &&
      loaded.privileged &&
      !payload.mfa &&
      !allowWithoutMfa
    ) {
      throw new ForbiddenException(MSG.AUTH_MFA_REQUIRED);
    }

    // 4. permission (in any scope; the service checks the specific record)
    if (required.length > 0 && !required.some((p) => loaded.has(p))) {
      throw new ForbiddenException(MSG.FORBIDDEN);
    }

    // 5. step-up code for high-risk actions
    if (stepUp && this.config.auth.mfaEnforced) {
      await this.verifyStepUp(
        payload.tid,
        payload.sub,
        req.header('x-otp-code'),
        stepUp === 'allow_unenrolled_employees' && !loaded.privileged,
      );
    }

    req.access = loaded;
    return true;
  }

  /** The code must be a fresh TOTP from the user's authenticator (each code works once). */
  private async verifyStepUp(
    tenantId: string,
    userId: string,
    code: string | undefined,
    allowUnenrolled: boolean,
  ): Promise<void> {
    if (!code && !allowUnenrolled)
      throw new ForbiddenException(MSG.AUTH_STEP_UP_REQUIRED);

    const ok = await this.db.withTenant({ tenantId, userId }, async () => {
      const user = await this.db.tx
        .selectFrom('users')
        .select(['mfa_enabled', 'mfa_secret', 'mfa_last_time_step'])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!user?.mfa_enabled || !user.mfa_secret)
        return allowUnenrolled ? ('ok' as const) : ('no-mfa' as const);
      if (!code) return 'missing' as const;

      const timeStep = await verifyTotp(
        this.encryption.decrypt(tenantId, user.mfa_secret),
        code,
        user.mfa_last_time_step,
      );
      if (timeStep === null) return 'invalid' as const;
      await this.db.tx
        .updateTable('users')
        .set({ mfa_last_time_step: timeStep })
        .where('id', '=', userId)
        .execute();
      return 'ok' as const;
    });

    if (ok === 'missing')
      throw new ForbiddenException(MSG.AUTH_STEP_UP_REQUIRED);
    if (ok === 'no-mfa') throw new ForbiddenException(MSG.AUTH_MFA_NOT_SET_UP);
    if (ok === 'invalid')
      throw new UnauthorizedException(MSG.AUTH_STEP_UP_INVALID);
  }
}
