import {
  IsBoolean,
  IsEmail,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Grant a login to an existing publisher. The email defaults to the
 * publisher's own email when omitted; the role is derived from the
 * publisher's appointment unless `isAdmin` is set.
 */
export class GrantAccessDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}
