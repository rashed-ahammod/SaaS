/**
 * Request bodies for /auth routes. Checked by the global ValidationPipe
 * before the controller runs.
 */
import {
  IsJWT,
  IsNotEmpty,
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
}

export class VerifyMfaDto {
  /** The mfaToken returned by /auth/login. */
  @IsJWT()
  mfaToken: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class EnableMfaDto {
  @IsString()
  @Length(6, 6)
  code: string;
}
