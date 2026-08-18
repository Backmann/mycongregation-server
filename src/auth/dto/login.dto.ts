import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

/**
 * One field on the screen, two fields on the wire.
 *
 * `login` is the new name for what is typed — a login name or an address. It
 * used to be `email`, with @IsEmail on it, which is why a login name would
 * have been refused by validation before it ever reached the service, with no
 * line in the log to say why. Both are accepted so that the app can be renamed
 * on its own day rather than in the same hour as the server.
 */
export class LoginDto {
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

  /**
   * Eight, deliberately, and NOT the ten that password-policy now demands.
   *
   * That floor governs SETTING a password. People who set theirs before it was
   * raised still have eight-character passwords that are perfectly valid, and
   * a longer minimum here would lock them out of their own accounts while
   * telling them their password was wrong.
   */
  @IsString()
  @MinLength(8)
  password!: string;
}
