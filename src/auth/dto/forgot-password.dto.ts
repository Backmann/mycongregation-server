import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

/**
 * Who forgot their password — a login name or an address.
 *
 * @IsEmail used to sit on this, which after this month would refuse a login
 * name before the service ever saw it. `email` keeps its name on the wire for
 * app builds already installed; `login` is what the new screen sends.
 */
export class ForgotPasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trimLower)
  login?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trimLower)
  email?: string;
}
