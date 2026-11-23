/**
 * Issues and checks signed tokens (JWT, HS256).
 *
 *   access token  - sent on every request; expires after the session timeout
 *   mfa token     - proves the password step passed; only accepted by /auth/mfa/verify
 *
 * The `typ` claim keeps the two apart: an MFA token can never be used as an
 * access token.
 */
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';

export interface AccessTokenPayload {
  typ: 'access';
  sub: string; // user id
  tid: string; // tenant id
  lang: 'bn' | 'en';
  /** This session passed two-factor authentication. */
  mfa: boolean;
  /**
   * When the token was issued, in milliseconds. AuthGuard refuses a token
   * issued before the user's `tokens_valid_from`, which is how sign-out ends a
   * session before it expires (0050).
   *
   * Why not the standard `iat` claim: it is in whole seconds, so a token signed
   * in the same second as the sign-out that should have killed it cannot be
   * told apart from the one the next login issues. Rounding either way gets one
   * of the two wrong -- it either lets the dead token live for up to a second,
   * or rejects the fresh one. Milliseconds make both comparisons exact.
   *
   * Optional, so that tokens signed before this was deployed keep working for
   * the rest of their half hour instead of signing everybody out at once.
   */
  ims?: number;
}

export interface MfaTokenPayload {
  typ: 'mfa';
  sub: string;
  tid: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  issueAccessToken(
    user: { id: string; tenant_id: string; preferred_language: 'bn' | 'en' },
    mfa: boolean,
  ) {
    const payload: AccessTokenPayload = {
      typ: 'access',
      sub: user.id,
      tid: user.tenant_id,
      lang: user.preferred_language,
      mfa,
      ims: Date.now(),
    };
    return {
      accessToken: this.jwt.sign(payload, {
        expiresIn: this.config.auth.accessTokenTtlSeconds,
      }),
      expiresIn: this.config.auth.accessTokenTtlSeconds,
    };
  }

  issueMfaToken(user: { id: string; tenant_id: string }): string {
    const payload: MfaTokenPayload = {
      typ: 'mfa',
      sub: user.id,
      tid: user.tenant_id,
    };
    return this.jwt.sign(payload, {
      expiresIn: this.config.auth.mfaTokenTtlSeconds,
    });
  }

  /** Returns the payload, or null if the token is invalid, expired or not an access token. */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    const payload = await this.verify<AccessTokenPayload>(token);
    return payload?.typ === 'access' ? payload : null;
  }

  async verifyMfaToken(token: string): Promise<MfaTokenPayload | null> {
    const payload = await this.verify<MfaTokenPayload>(token);
    return payload?.typ === 'mfa' ? payload : null;
  }

  private async verify<T extends object>(token: string): Promise<T | null> {
    try {
      return await this.jwt.verifyAsync<T>(token, { algorithms: ['HS256'] });
    } catch {
      return null;
    }
  }
}
