import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  /** 32 random bytes, hex-encoded — exactly 64 lowercase hex chars. */
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]+$/)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
