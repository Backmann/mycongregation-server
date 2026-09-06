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

/**
 * Asking for a fresh invitation code — with whatever the person holds.
 *
 * It used to demand an address, which made it useless to exactly the people it
 * was built for: the letter tells them their LOGIN NAME, in a box of its own,
 * and says to write it down. An address they may never have been told at all —
 * an elder typed it in when granting access.
 *
 * `email` stays accepted because app builds already installed send it under
 * that name. Whichever arrives, it is one field and the server tells the two
 * apart by the @, exactly as the sign-in screen does.
 */
export class ResendInviteDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  login?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;
}
