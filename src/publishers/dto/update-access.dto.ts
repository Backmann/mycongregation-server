import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { LOGIN_NAME_MAX } from '../../users/login-name';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';
/**
 * Manage an existing login linked to a publisher: reset the password,
 * toggle administrator status, enable/disable the account, and/or grant or
 * revoke access to private data. Every field is optional — only the provided
 * ones are applied.
 */
export class UpdateAccessDto {
  /**
   * Where this account's letters go. May be shared with another account, and
   * may be EMPTY: an address is optional now, and somebody who asks to have
   * theirs removed must be able to have it removed. Validated in the service,
   * because @IsEmail cannot express «a valid address, or nothing».
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  /**
   * Correct the login name — same rule and same implementation as
   * PATCH /users/:id/login-name. Two doors, one lock: a second implementation
   * is how «Дать доступ» and «Пользователи» came to behave differently.
   */
  @IsOptional()
  @IsString()
  @MaxLength(LOGIN_NAME_MAX)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  loginName?: string;

  @IsOptional()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password?: string;
  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
  @IsOptional()
  @IsBoolean()
  canViewPrivateData?: boolean;
}
