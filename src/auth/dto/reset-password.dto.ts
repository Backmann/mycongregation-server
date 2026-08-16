import {
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

/** Finishing an invitation from inside the app: address, code, new password. */
export class RedeemInviteDto {
  // No @Transform here: redeemInvite lowercases and trims the address itself,
  // and one place doing it is easier to trust than two.
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  password!: string;
}
