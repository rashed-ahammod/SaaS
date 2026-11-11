/**
 * Request bodies for /auth routes. Checked by the global ValidationPipe
 * before the controller runs.
 */
import {
  IsBoolean,
  IsJWT,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class LoginDto {
  /** Workspace code of the company, e.g. "acme". */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,40}$/i)
  workspace: string;

  /** Email or mobile number. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  login: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;

  /**
   * The token from the "remember this device" cookie, if the browser has one.
   * A valid one skips the 2FA code step; the password above is still required.
   * The employee app sends it server-side; it never reaches the page.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  deviceToken?: string;
}

export class VerifyMfaDto {
  /** The mfaToken returned by /auth/login. */
  @IsJWT()
  mfaToken: string;

  @IsString()
  @Length(6, 6)
  code: string;

  /** Trust this device for 30 days, so only the password is asked next time. */
  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}

export class EnableMfaDto {
  @IsString()
  @Length(6, 6)
  code: string;
}
