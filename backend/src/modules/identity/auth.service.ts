/**
 * Sign-in and two-factor authentication (guide §8, spec §11).
 *
 * Login flow:
 *   POST /auth/login       workspace + email/phone + password
 *       -> 2FA off: { accessToken }
 *       -> 2FA on : { mfaRequired: true, mfaToken }
 *   POST /auth/mfa/verify  mfaToken + 6-digit code -> { accessToken }
 *
 * Protection:
 *   - 5 wrong passwords or codes lock the account for 15 minutes;
 *   - the same answer is given for "no such workspace", "no such user" and
 *     "wrong password", so attackers cannot discover accounts;
 *   - every success and failure is audited.
 *
 * 2FA is mandatory for privileged roles (Admin, System Admin, HR, Accounts):
 * without it, login still works but returns mfaSetupRequired=true and AuthGuard
 * allows only the 2FA setup routes until it is enabled.
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { FieldEncryption } from '../../platform/crypto/field-encryption.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { User } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import type { EnableMfaDto, LoginDto, VerifyMfaDto } from './dto/auth.dto.js';
import { burnPasswordCheckTime, verifyPassword } from './password.js';
import { AccessService } from './access/access.service.js';
import { TokenService } from './token.service.js';
import { newTotpSecret, totpUri, verifyTotp } from './totp.js';

/** Where the request came from, recorded in the audit log. */
export interface ClientInfo {
  ip?: string;
  device?: string;
}

export type LoginResult =
  | { accessToken: string; expiresIn: number; mfaSetupRequired?: true }
  | { mfaRequired: true; mfaToken: string };

/** Result of a check that must save its changes (failed count) even when it fails. */
type CheckOutcome =
  | { ok: true; user: User; privileged: boolean }
  | { ok: false; error: 'invalid' | 'locked' };

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly encryption: FieldEncryption,
    private readonly access: AccessService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(dto: LoginDto, client: ClientInfo): Promise<LoginResult> {
    // find workspace (tenant)
    const tenantId = await this.findTenantId(dto.workspace);
    if (!tenantId) {
      await burnPasswordCheckTime(dto.password);
      throw new UnauthorizedException(MSG.AUTH_INVALID_CREDENTIALS);
    }

    // check password inside the tenant; the transaction commits even when the
    // password is wrong, so the failed-attempt counter is saved
    const outcome = await this.db.withTenant(
      { tenantId, ...client },
      async (): Promise<CheckOutcome> => {
        // find user by email or phone
        const login = dto.login.trim().toLowerCase();
        const user = await this.db.tx
          .selectFrom('users')
          .selectAll()
          .where((eb) =>
            eb.or([eb('email', '=', login), eb('phone', '=', login)]),
          )
          .executeTakeFirst();

        if (!user || user.status !== 'active') {
          await burnPasswordCheckTime(dto.password);
          await this.audit.record({
            action: 'auth.login_failed',
            entity: 'user',
            entityId: user?.id,
            after: { reason: 'unknown_or_inactive_user' },
          });
          return { ok: false, error: 'invalid' };
        }
        if (this.isLocked(user)) {
          await this.audit.record({
            action: 'auth.login_blocked',
            entity: 'user',
            entityId: user.id,
          });
          return { ok: false, error: 'locked' };
        }

        // verify password
        if (!(await verifyPassword(user.password_hash, dto.password))) {
          return this.registerFailure(user, 'wrong_password');
        }

        // password correct
        await this.resetFailures(user);
        await this.audit.record({
          action: user.mfa_enabled ? 'auth.password_verified' : 'auth.login',
          entity: 'user',
          entityId: user.id,
        });
        const { privileged } = await this.access.load(user.id);
        return { ok: true, user, privileged };
      },
    );

    if (!outcome.ok) this.throwFor(outcome.error);

    // second step needed?
    if (outcome.user.mfa_enabled) {
      return {
        mfaRequired: true,
        mfaToken: this.tokens.issueMfaToken(outcome.user),
      };
    }

    // privileged role without 2FA: may only set up 2FA with this session
    const tokens = this.tokens.issueAccessToken(outcome.user, false);
    return outcome.privileged && this.config.auth.mfaEnforced
      ? { ...tokens, mfaSetupRequired: true }
      : tokens;
  }

  async verifyMfa(dto: VerifyMfaDto, client: ClientInfo): Promise<LoginResult> {
    // check the token from step 1
    const pending = await this.tokens.verifyMfaToken(dto.mfaToken);
    if (!pending) throw new UnauthorizedException(MSG.AUTH_MFA_INVALID_CODE);

    const outcome = await this.db.withTenant(
      { tenantId: pending.tid, userId: pending.sub, ...client },
      async (): Promise<CheckOutcome> => {
        // find user
        const user = await this.db.tx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', pending.sub)
          .executeTakeFirst();
        if (
          !user ||
          user.status !== 'active' ||
          !user.mfa_enabled ||
          !user.mfa_secret
        )
          return { ok: false, error: 'invalid' };
        if (this.isLocked(user)) return { ok: false, error: 'locked' };

        // verify code
        const secret = this.encryption.decrypt(user.tenant_id, user.mfa_secret);
        const timeStep = await verifyTotp(
          secret,
          dto.code,
          user.mfa_last_time_step,
        );
        if (timeStep === null)
          return this.registerFailure(user, 'wrong_mfa_code');

        // code correct: remember the step so the same code cannot be used again
        await this.resetFailures(user, { mfa_last_time_step: timeStep });
        await this.audit.record({
          action: 'auth.login',
          entity: 'user',
          entityId: user.id,
          after: { mfa: true },
        });
        return { ok: true, user, privileged: false };
      },
    );

    if (!outcome.ok) {
      if (outcome.error === 'locked')
        throw new ForbiddenException(MSG.AUTH_ACCOUNT_LOCKED);
      throw new UnauthorizedException(MSG.AUTH_MFA_INVALID_CODE);
    }
    return this.tokens.issueAccessToken(outcome.user, true);
  }

  /** Runs inside the request's tenant transaction (route uses AuthGuard). */
  async me() {
    const { userId } = requestContext.get();

    // find user
    const user = await this.db.tx
      .selectFrom('users')
      .select([
        'id',
        'tenant_id',
        'email',
        'phone',
        'status',
        'preferred_language',
        'mfa_enabled',
        'employee_id',
        'last_login_at',
      ])
      .where('id', '=', userId!)
      .executeTakeFirst();
    if (!user) throw new NotFoundException(MSG.USER_NOT_FOUND);
    const access = this.access.current();
    return {
      id: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      phone: user.phone,
      status: user.status,
      preferredLanguage: user.preferred_language,
      mfaEnabled: user.mfa_enabled,
      employeeId: user.employee_id,
      lastLoginAt: user.last_login_at,
      roles: access.roleLabels,
      permissions: access.permissionKeys(),
    };
  }

  /** Step 1 of turning on 2FA: create a secret and return the QR link. */
  async setupMfa() {
    const user = await this.currentUser();
    if (user.mfa_enabled)
      throw new ConflictException(MSG.AUTH_MFA_ALREADY_ENABLED);

    // create secret, store encrypted (not active until confirmed)
    const secret = newTotpSecret();
    await this.db.tx
      .updateTable('users')
      .set({
        mfa_secret: this.encryption.encrypt(user.tenant_id, secret),
        mfa_last_time_step: null,
      })
      .where('id', '=', user.id)
      .execute();
    await this.audit.record({
      action: 'auth.mfa_setup_started',
      entity: 'user',
      entityId: user.id,
    });

    return { secret, otpauthUrl: totpUri(secret, user.email) };
  }

  /** Step 2 of turning on 2FA: the user proves the app works by sending a code. */
  async enableMfa(dto: EnableMfaDto) {
    const user = await this.currentUser();
    if (user.mfa_enabled)
      throw new ConflictException(MSG.AUTH_MFA_ALREADY_ENABLED);
    if (!user.mfa_secret) throw new ConflictException(MSG.AUTH_MFA_NOT_SET_UP);

    // verify code
    const secret = this.encryption.decrypt(user.tenant_id, user.mfa_secret);
    const timeStep = await verifyTotp(
      secret,
      dto.code,
      user.mfa_last_time_step,
    );
    if (timeStep === null)
      throw new UnauthorizedException(MSG.AUTH_MFA_INVALID_CODE);

    // turn on
    await this.db.tx
      .updateTable('users')
      .set({ mfa_enabled: true, mfa_last_time_step: timeStep })
      .where('id', '=', user.id)
      .execute();
    await this.audit.record({
      action: 'auth.mfa_enabled',
      entity: 'user',
      entityId: user.id,
      before: { mfa_enabled: false },
      after: { mfa_enabled: true },
    });
    // the code just proved the second factor: this session now counts as 2FA
    return { mfaEnabled: true, ...this.tokens.issueAccessToken(user, true) };
  }

  // ------------------------------------------------------------------ helpers

  private async findTenantId(workspace: string): Promise<string | null> {
    const result = await sql<{
      id: string | null;
    }>`SELECT auth_find_tenant_id(${workspace}) AS id`.execute(this.db.kysely);
    return result.rows[0]?.id ?? null;
  }

  private async currentUser(): Promise<User> {
    const { userId } = requestContext.get();
    const user = await this.db.tx
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId!)
      .executeTakeFirst();
    if (!user) throw new NotFoundException(MSG.USER_NOT_FOUND);
    return user;
  }

  private isLocked(user: User): boolean {
    return user.locked_until !== null && user.locked_until > new Date();
  }

  /** Count a failed attempt; lock the account when the limit is reached. */
  private async registerFailure(
    user: User,
    reason: string,
  ): Promise<CheckOutcome> {
    const failures = user.failed_login_count + 1;
    const lock = failures >= this.config.auth.maxFailedLogins;
    await this.db.tx
      .updateTable('users')
      .set({
        failed_login_count: lock ? 0 : failures,
        locked_until: lock
          ? new Date(Date.now() + this.config.auth.lockoutMinutes * 60_000)
          : user.locked_until,
      })
      .where('id', '=', user.id)
      .execute();
    await this.audit.record({
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      entity: 'user',
      entityId: user.id,
      after: { reason },
    });
    return { ok: false, error: lock ? 'locked' : 'invalid' };
  }

  private async resetFailures(
    user: User,
    extra: { mfa_last_time_step?: number } = {},
  ): Promise<void> {
    await this.db.tx
      .updateTable('users')
      .set({
        failed_login_count: 0,
        locked_until: null,
        last_login_at: new Date(),
        ...extra,
      })
      .where('id', '=', user.id)
      .execute();
  }

  private throwFor(error: 'invalid' | 'locked'): never {
    if (error === 'locked')
      throw new ForbiddenException(MSG.AUTH_ACCOUNT_LOCKED);
    throw new UnauthorizedException(MSG.AUTH_INVALID_CREDENTIALS);
  }
}
