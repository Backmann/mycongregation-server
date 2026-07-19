import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * What a publisher may change in their own card. Deliberately only contacts:
 * the name identifies them across schedules, reports and printed sheets, so it
 * stays with the administrators.
 */
export class UpdateMyContactsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mobilePhone?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(255)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;
}
