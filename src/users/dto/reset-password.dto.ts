import { IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';

export class ResetPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password!: string;
}
