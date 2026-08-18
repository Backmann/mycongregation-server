import {
  IsBoolean,
  IsEmail,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';
/**
 * Manage an existing login linked to a publisher: reset the password,
 * toggle administrator status, enable/disable the account, and/or grant or
 * revoke access to private data. Every field is optional — only the provided
 * ones are applied.
 */
export class UpdateAccessDto {
  /** Where this account's letters go — e.g. to fix a typo. May be shared. */
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

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
