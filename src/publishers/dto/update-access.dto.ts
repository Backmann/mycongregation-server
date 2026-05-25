import { IsBoolean, IsOptional, MaxLength, MinLength } from 'class-validator';

/**
 * Manage an existing login linked to a publisher: reset the password,
 * toggle administrator status, and/or enable/disable the account.
 * Every field is optional — only the provided ones are applied.
 */
export class UpdateAccessDto {
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
}
