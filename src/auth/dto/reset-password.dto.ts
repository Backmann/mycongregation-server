import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  IsEmail,
} from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../password-policy';

export class ResetPasswordDto {
  /** 32 random bytes, hex-encoded — exactly 64 lowercase hex chars. */
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]+$/)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password!: string;
}

/**
 * Finishing an invitation from inside the app: the code and a new password.
 *
 * The address is optional and unused — the code identifies the account by
 * itself. It stays in the shape only because app builds already installed
 * still send it, and rejecting those would strand whoever is mid-invitation
 * on the day this ships.
 */
export class RedeemInviteDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  password!: string;
}

/** Asking for a fresh invitation code. The address, and nothing else. */
export class ResendInviteDto {
  @IsEmail()
  email!: string;
}
