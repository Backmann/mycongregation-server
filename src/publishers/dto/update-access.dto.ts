import {
  IsBoolean,
  IsEmail,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';
/**
 * Manage an existing login linked to a publisher: reset the password,
 * toggle administrator status, enable/disable the account, and/or grant or
 * revoke access to private data. Every field is optional — only the provided
 * ones are applied.
 */
export class UpdateAccessDto {
  /** New login email — e.g. to fix a typo. Must be unique. */
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @MinLength(8)
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
