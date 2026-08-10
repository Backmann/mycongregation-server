import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
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
